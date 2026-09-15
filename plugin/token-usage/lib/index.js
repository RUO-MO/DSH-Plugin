/**
 * dsh-plugin-token-usage — host half (aggregator + 127.0.0.1 usage bridge).
 *
 * The browser client half renders the dark TraeCode-style dashboard; *this* half
 * is the real data source. On the local desktop build it runs in the same host
 * process as DSH, so it can read `ctx.sessionQuery` (the SQLite-backed session
 * corpus) and recompute every turn's token usage directly from the durable
 * session events — the exact fields the official `deriveTurnTokenUsage` reads:
 *   - `assistant/message` event.data.stream  → last `{ type: 'usage', usage }`
 *   - `assistant/message` event.data.source  → { provider, model }
 *
 * It aggregates cross-session / cross-directory history into a small JSON
 * payload and serves it over an HTTP endpoint bound ONLY to 127.0.0.1, so the
 * renderer can fetch it. Everything is released through the `ctx.effect`
 * disposer (port closed on unload).
 *
 * Zero-invasion: no deepseek-harness file is touched.
 */

import http from 'node:http'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'token-usage'

/** Requires the host-side session corpus so we can aggregate historical usage. */
export const inject = ['sessionQuery']

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 47820

/**
 * Validated plugin configuration.
 * - `sessionTab`: keep the session-scoped `conversation.view` tab (live, exact
 *   per-turn usage while the session is open). Remains the live complement to
 *   the aggregated history the host half computes.
 * - `dashboard.http`: local usage bridge. `enabled:false` disables the HTTP
 *   endpoint (then the browser falls back to an honest empty state).
 */
export const Config = z.object({
  sessionTab: z.boolean().default(true),
  dashboard: z.object({
    http: z
      .object({
        enabled: z.boolean().default(true),
        host: z.string().default(DEFAULT_HOST),
        port: z.number().default(DEFAULT_PORT),
      })
      .default({}),
  }).default({}),
})

// --- pure aggregation (official accounting semantics) -----------------------

function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Last usage chunk of an assistant/message stream: { type:'usage', usage }. */
function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const entry = stream[i]
    if (entry && entry.chunk && entry.chunk.type === 'usage' && entry.chunk.usage) {
      return entry.chunk.usage
    }
  }
  return undefined
}

/**
 * Resolve the provider-reported usage of one assistant/message event.
 * Mirrors the official deriveTurnTokenUsage precedence: a top-level
 * `data.usage` is used when present, otherwise the stream's final usage chunk.
 */
function eventUsage(data) {
  if (!data) return undefined
  if (data.usage && typeof data.usage === 'object') return data.usage
  return streamUsage(data.stream)
}

/**
 * Resolve the { provider, model } route of one assistant/message event.
 * Mirrors the official token-meter's messageRoute: read data.message.source.
 */
function eventRoute(data) {
  if (!data || !data.message || !data.message.source) return undefined
  const { provider, model } = data.message.source
  return provider && model ? { provider: String(provider), model: String(model) } : undefined
}

/** Mirror of token-meter's usageTokens(): input + cacheRead + cacheWrite + output. */
function usageTokens(usage) {
  const { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens } = usage
  // Prefer provider total when it is a consistent count; else sum disjoint buckets.
  if (isCount(totalTokens) && (inputTokens ?? 0) + outputTokens <= totalTokens) {
    return totalTokens
  }
  return Math.max(0, (inputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) + (outputTokens ?? 0))
}

const DAY_KEY = (time) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Walk every session in the corpus and produce one aggregate snapshot. */
async function aggregate(sessionQuery, signal) {
  const now = new Date()
  const hoursToday = new Array(24).fill(0) // bucket by local hour, calendar-today only
  const days = new Map() // dayKey -> tokens
  const hours = new Array(24).fill(0) // bucket by local hour
  const models = new Map() // "provider/model" -> attempt count
  const modelTokens = new Map() // "provider/model" -> tokens
  let totalTokens = 0
  let turns = 0
  let firstUsedAt = null
  let lastUsedAt = null

  const sessions = await sessionQuery.listSessions(signal)
  for (const record of sessions) {
    let snapshot
    try {
      snapshot = await sessionQuery.readSession(record.header.id, signal)
    } catch (e) {
      continue // a corrupt/unreadable log must not break the whole dashboard
    }
    const events = snapshot && snapshot.events
    if (!Array.isArray(events)) continue
    for (const event of events) {
      if (!event || typeof event.time !== 'number') continue
      if (event.type === 'turn/end') {
        turns += 1
        continue
      }
      if (event.type !== 'assistant/message') continue
      const data = event.data || {}
      const usage = eventUsage(data)
      if (!usage || !isCount(usage.inputTokens) || !isCount(usage.outputTokens)) continue
      const tokens = usageTokens(usage)
      if (tokens <= 0) continue
      // first/last used = first/last event that actually carried usage, so the
      // "day N" greeting starts at real usage, not at any older session event
      if (event.time < (firstUsedAt ?? Infinity)) firstUsedAt = event.time
      if (event.time > (lastUsedAt ?? -Infinity)) lastUsedAt = event.time
      totalTokens += tokens
      const day = DAY_KEY(event.time)
      days.set(day, (days.get(day) || 0) + tokens)
      const date = new Date(event.time)
      const hour = date.getHours()
      hours[hour] += tokens
      // today-only hourly bucket (calendar day in local timezone) for the "今天" range
      if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
        hoursToday[hour] += tokens
      }
      // model attribution, when present (data.message.source = { provider, model })
      const route = eventRoute(data)
      if (route) {
        const key = route.provider && route.provider.length ? `${route.provider}/${route.model}` : route.model
        models.set(key, (models.get(key) || 0) + 1)
        modelTokens.set(key, (modelTokens.get(key) || 0) + tokens)
      }
    }
  }

  return {
    ok: true,
    computedAt: Date.now(),
    totalTokens,
    turns,
    firstUsedAt,
    lastUsedAt,
    days: Object.fromEntries(days),
    hours,
    hoursToday,
    models: Object.fromEntries(models),
    modelTokens: Object.fromEntries(modelTokens),
  }
}

// The browser polls every ~2s; re-walking the entire session corpus on every
// request is heavy disk I/O that grows with history. Recompute at most once
// per TTL and serve the cached snapshot in between (a usage dashboard does
// not need 2s freshness).
const CACHE_TTL_MS = 5000
let usageCache = null // { at: number, data: object }
async function aggregateCached(sessionQuery, signal) {
  const nowTs = Date.now()
  if (usageCache && nowTs - usageCache.at < CACHE_TTL_MS) return usageCache.data
  const data = await aggregate(sessionQuery, signal)
  usageCache = { at: nowTs, data }
  return data
}

// --- HTTP bridge (127.0.0.1 only) -------------------------------------------

/**
 * Plugin body: bind the session corpus and, when enabled, a loopback-only HTTP
 * endpoint exposing the aggregate. All resources are released on unload.
 * @param ctx - Cordis context (sessionQuery + effect registry are used).
 * @param config - Validated {@link Config}.
 */
export function apply(ctx, config) {
  const sessionQuery = ctx.sessionQuery
  const httpCfg = (config && config.dashboard && config.dashboard.http) || {}

  const bridgeEnabled = httpCfg.enabled !== false
  const host = httpCfg.host || DEFAULT_HOST
  const port = typeof httpCfg.port === 'number' ? httpCfg.port : DEFAULT_PORT

  ctx.effect(() => {
    console.log(
      `[token-usage] host half loaded (sessionTab=${!!config.sessionTab}, ` +
        `usageBridge=${bridgeEnabled ? 'http://' + host + ':' + port : 'off'}); ` +
        'browser UI is served by lib/client.js',
    )

    if (!bridgeEnabled) return () => {}

    let server
    try {
      server = http.createServer((req, res) => {
        if (req.url !== '/api/usage') {
          res.writeHead(404)
          res.end()
          return
        }
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cache-Control', 'no-store')
        aggregateCached(sessionQuery)
          .then((data) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(data))
          })
          .catch((err) => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
          })
      })
      server.on('error', (err) => {
        console.error('[token-usage] usage bridge failed', err)
      })
      server.listen(port, host, () => {
        console.log(`[token-usage] usage bridge listening on http://${host}:${port}`)
      })
    } catch (err) {
      console.error('[token-usage] failed to start usage bridge', err)
      server = undefined
    }

    return () => {
      if (server) {
        try {
          server.close()
        } catch (e) {
          /* already closed */
        }
      }
    }
  }, 'token-usage: usage bridge')
}

export default { name, inject, Config, apply }