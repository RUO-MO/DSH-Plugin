/**
 * dsh-deepseek-web — host half.
 *
 * A loopback reverse proxy in front of https://chat.deepseek.com so the web
 * DeepSeek chat can live inside a Harness `<iframe>` panel. Two things stop a
 * naive embed, and this proxy removes both:
 *
 * 1. The upstream sends `content-security-policy: frame-ancestors 'none'`,
 *    which no browser will violate. The proxy re-originates the browser's
 *    requests and strips exactly the framing/coop headers, plus rewrites
 *    cookie attributes and redirect targets for the proxy origin.
 * 2. The page's own scripts and styles live on https://fe-static.deepseek.com
 *    and are loaded with `crossorigin`, while that CDN answers
 *    `access-control-allow-origin: https://*.deepseek.com` — a proxy-origin
 *    browser cannot pass that check. The proxy therefore also serves the
 *    static host under `/fe-static/` and rewrites the absolute host strings
 *    in text responses (html/js/css) to proxy-relative ones, dropping the
 *    subresource-integrity attributes that the rewrite would invalidate.
 *
 * Everything else streams byte-for-byte; nothing is buffered for binary
 * content, so downloads and streaming replies behave. Binding is loopback
 * only; the proxy carries the browser's own cookies and User-Agent, so one
 * login inside the panel persists in the proxy-origin cookie jar.
 */

import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'deepseek-web'

/** No host services are needed: plain node:http against the upstreams. */
export const inject = []

/** Marker path the browser panel probes to discover the proxy port. */
export const PING_PATH = '/dsh-deepseek-web/ping'

/** Static-host mount point served by this proxy. */
const STATIC_PREFIX = '/fe-static'
const STATIC_UPSTREAM = 'https://fe-static.deepseek.com'

const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36'

/** Text responses whose absolute host strings must become proxy-relative. */
const REWRITABLE_CONTENT_TYPE = /^(?:text\/html|text\/css|text\/plain|application\/(?:javascript|x-javascript|json)|text\/javascript)\b/i
/** Cap for the buffering a rewrite needs; binaries stream and are unbounded. */
const MAX_REWRITE_BYTES = 64 * 1024 * 1024

/** Validated plugin configuration; also drives the settings surface. */
export const Config = z.object({
  /** Loopback port to bind; when taken the server scans upward `portScan` times. */
  port: z.number().default(3838),
  /** How many ports past `port` may be tried. The panel scans the same range. */
  portScan: z.number().default(10),
  /** Site the panel should read. */
  upstream: z.string().default('https://chat.deepseek.com'),
  /** Conversation path the panel opens, /a/chat/s/<share id>. */
  startPath: z.string().default('/'),
  /** Used only when the browser request carries no User-Agent of its own. */
  userAgent: z.string().default(FALLBACK_USER_AGENT),
  /** Log every proxied request line to the launcher's stdout. */
  debug: z.boolean().default(false),
})

/** Response headers that exist to refuse exactly what this plugin does. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'report-to',
  'nel',
  'alt-svc',
])

/** Hop-by-hop request headers a re-originating proxy must not forward. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailers',
])

/**
 * Resolve one request path against the two upstreams: the `/fe-static`
 * prefix belongs to the static CDN, everything else to the chat origin.
 */
function routeOf(pathname, config) {
  if (pathname === STATIC_PREFIX || pathname.startsWith(`${STATIC_PREFIX}/`)) {
    return {
      origin: new URL('/', STATIC_UPSTREAM).origin,
      path: pathname.slice(STATIC_PREFIX.length) || '/',
      rewritableBase: STATIC_UPSTREAM,
    }
  }
  return {
    origin: new URL('/', config.upstream).origin,
    path: pathname,
    rewritableBase: new URL('/', config.upstream).origin,
  }
}

/**
 * Rewrite one Set-Cookie for the proxy origin: the upstream's Domain/Secure/
 * Partitioned attributes cannot apply to a loopback http origin, and a
 * SameSite value is re-pinned to Lax so the jar survives the port hop.
 */
function rewriteSetCookie(value) {
  const kept = value.split(';').filter((attribute) => {
    const name = attribute.split('=')[0].trim().toLowerCase()
    return name !== 'domain' && name !== 'secure' && name !== 'samesite' && name !== 'partitioned'
  })
  kept.push('SameSite=Lax')
  return kept.join(';')
}

/**
 * Same-host absolute redirects must become proxy-relative, or the frame would
 * escape to the real site. Foreign-host redirects pass through untouched.
 */
function rewriteLocation(value, config) {
  const staticOrigin = new URL('/', STATIC_UPSTREAM).origin
  const chatOrigin = new URL('/', config.upstream).origin
  if (value === chatOrigin) return '/'
  if (value.startsWith(`${chatOrigin}/`)) return value.slice(chatOrigin.length)
  if (value.startsWith(`${staticOrigin}/`)) return STATIC_PREFIX + value.slice(staticOrigin.length)
  if (value === staticOrigin) return STATIC_PREFIX
  return value
}

/** Rewrite one text body to the proxy origin. */
function rewriteText(text, config) {
  const staticOrigin = new URL('/', STATIC_UPSTREAM).origin
  const chatOrigin = new URL('/', config.upstream).origin
  let output = text
    .split(staticOrigin).join(STATIC_PREFIX)
    .split(chatOrigin).join('')
  // The TTS endpoint builder hardcodes the wss scheme; over the http proxy
  // the browser would attempt TLS against a plain socket, so re-pin to ws://
  // and let the upgrade tunnel carry it.
  output = output.replace(/(["'])wss:\/\//g, '$1ws://')
  if (output.includes('<html') || output.includes('<!DOCTYPE')) {
    output = output.replace(/\sintegrity="[^"]*"/gi, '')
  }
  return output
}

/** Apply the response-header policy to one upstream response. */
function responseHeaders(upstreamHeaders, config) {
  const headers = {}
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    const lower = name.toLowerCase()
    if (STRIPPED_RESPONSE_HEADERS.has(lower)) continue
    if (lower === 'set-cookie') continue
    if (lower === 'location') continue
    if (lower === 'content-encoding') continue
    // `content-length` stays: passthrough bytes are unmodified. The rewrite
    // path overrides it with the rewritten body's own length.
    headers[name] = value
  }
  const cookies = upstreamHeaders['set-cookie']
  if (cookies !== undefined) headers['set-cookie'] = cookies.map(rewriteSetCookie)
  const location = upstreamHeaders['location']
  if (typeof location === 'string') headers.location = rewriteLocation(location, config)
  return headers
}

/** Origins allowed to read the proxy cross-origin: this app and loopback. */
const SAFE_CORS_ORIGIN = /^(?:http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?|dsh-app:\/\/app)$/

/** Cors headers for the panel's probe fetch; other origins get none. */
function corsHeaders(req, target) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !SAFE_CORS_ORIGIN.test(origin)) return
  target['access-control-allow-origin'] = origin
  target['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  target['access-control-allow-headers'] = String(req.headers['access-control-request-headers'] ?? '*')
  // The desktop renderer (dsh-app://app) probes loopback: Chromium's Private
  // Network Access preflight requires this opt-in.
  target['access-control-allow-private-network'] = 'true'
  target.vary = 'Origin'
}

/**
 * The proxy's threat model is the local machine: everything loopback may call
 * it. The marker on every answer lets the panel (and a human with curl)
 * tell this proxy from any other loopback service.
 */
function sendPing(req, res, facts) {
  const body = JSON.stringify({ ok: true, plugin: 'dsh-deepseek-web', ...facts })
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  headers['x-dsh-deepseek-web'] = '1'
  corsHeaders(req, headers)
  res.writeHead(200, headers)
  res.end(body)
}

/** Decompress one upstream body when the upstream ignored `identity`. */
function decodeBody(buffer, contentEncoding) {
  const encoding = (contentEncoding ?? '').trim().toLowerCase()
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buffer)
  if (encoding === 'deflate') {
    try {
      return zlib.inflateSync(buffer)
    } catch {
      return zlib.inflateRawSync(buffer)
    }
  }
  if (encoding === 'br') return zlib.brotliDecompressSync(buffer)
  return buffer
}

/** Read one upstream response fully, bounded by the rewrite cap. */
function readBounded(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        stream.destroy()
        reject(new Error(`deepseek-web: rewrite cap exceeded (${limit} bytes)`))
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * Forward one browser request to the routed upstream. Text responses are
 * rewritten to the proxy origin; everything else streams byte-for-byte.
 */
async function proxyRequest(req, res, config, log) {
  const incoming = new URL(req.url ?? '/', 'http://loopback.invalid')
  const route = routeOf(incoming.pathname, config)
  const target = new URL(route.path + incoming.search, route.origin)
  const headers = { ...req.headers }
  for (const name of STRIPPED_REQUEST_HEADERS) delete headers[name]
  if (!headers['user-agent']) headers['user-agent'] = config.userAgent
  // Re-originated identity: the upstream must see its own site, or its own
  // SameSite/CSRF surface would read the request as cross-site. The rewrite
  // path needs uncompressed bytes, so ask for identity up front.
  headers.origin = route.origin
  headers.referer = route.origin + route.path
  headers['accept-encoding'] = 'identity'

  await new Promise((resolveRequest) => {
    const upstream = https.request(target, { method: req.method, headers }, async (answer) => {
      if (config.debug || (answer.statusCode ?? 500) >= 400) {
        log.info(`deepseek-web: ${req.method} ${incoming.pathname}${incoming.search} -> ${answer.statusCode}`)
      }
      const contentType = String(answer.headers['content-type'] ?? '')
      const baseHeaders = responseHeaders(answer.headers, config)
      corsHeaders(req, baseHeaders)
      try {
        // HEAD has no body to rewrite; keep its declared length untouched.
        if (req.method !== 'HEAD' && REWRITABLE_CONTENT_TYPE.test(contentType)) {
          const raw = await readBounded(answer, MAX_REWRITE_BYTES)
          const decoded = decodeBody(raw, answer.headers['content-encoding'])
          const rewritten = rewriteText(decoded.toString('utf8'), config)
          const body = Buffer.from(rewritten, 'utf8')
          res.writeHead(answer.statusCode ?? 502, { ...baseHeaders, 'content-length': body.length })
          res.end(body)
        } else {
          res.writeHead(answer.statusCode ?? 502, baseHeaders)
          answer.pipe(res)
        }
      } catch (error) {
        log.error(`deepseek-web: rewrite ${incoming.pathname} failed: ${String(error)}`)
        res.destroy()
      }
      resolveRequest()
    })
    // SSE/long polls stay alive through activity; a fully idle upstream for
    // five minutes is a hung connection, not a stream.
    upstream.setTimeout(300_000, () => {
      upstream.destroy(new Error('deepseek-web: upstream idle for 300s'))
    })
    upstream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy()
      } else {
        log.error(`deepseek-web: upstream ${req.method} ${incoming.pathname} failed: ${String(error)}`)
        const headers = { 'content-type': 'application/json; charset=utf-8' }
        corsHeaders(req, headers)
        res.writeHead(502, headers)
        res.end(JSON.stringify({ ok: false, error: String(error) }))
      }
      resolveRequest()
    })
    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  })
}

/**
 * Tunnel one WebSocket upgrade to the upstream over raw TLS: the handshake
 * bytes are re-originated (Host/Origin rewritten), then both sockets pipe.
 * node:https would re-compress nothing but also cannot carry an Upgrade.
 */
function tunnelUpgrade(req, socket, head, config, log, sockets) {
  const incoming = new URL(req.url ?? '/', 'http://loopback.invalid')
  const route = routeOf(incoming.pathname, config)
  const target = new URL(route.path + incoming.search, route.origin)
  const port = target.port === '' ? 443 : Number(target.port)
  const remote = tls.connect({ host: target.hostname, port, servername: target.hostname })
  sockets.add(remote)
  remote.on('close', () => sockets.delete(remote))
  remote.on('error', (error) => {
    log.error(`deepseek-web: websocket tunnel ${incoming.pathname} failed: ${String(error)}`)
    socket.destroy()
  })
  remote.on('secureConnect', () => {
    const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`]
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index]
      const lower = name.toLowerCase()
      let value = req.rawHeaders[index + 1]
      if (lower === 'host') value = target.host
      else if (lower === 'origin') value = route.origin
      else if (lower === 'referer') value = route.origin + route.path
      lines.push(`${name}: ${value}`)
    }
    remote.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length > 0) remote.write(head)
    socket.pipe(remote)
    remote.pipe(socket)
    socket.on('error', () => remote.destroy())
  })
}

/** Start the loopback server, scanning upward while the port is taken. */
async function listen(server, config, log) {
  let lastError
  for (let attempt = 0; attempt <= Math.max(0, config.portScan); attempt += 1) {
    const port = config.port + attempt
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })
      return port
    } catch (error) {
      lastError = error
      if (error?.code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`deepseek-web: no free loopback port in ${config.port}..${config.port + config.portScan}: ${String(lastError)}`)
}

/**
 * Plugin body: bind the loopback proxy for the plugin's lifetime and publish
 * the resolved facts the browser panel discovers through the ping endpoint.
 * @param ctx - Cordis context (effect registry is used).
 * @param config - Validated {@link Config}.
 */
export function apply(ctx, config) {
  const chatOrigin = new URL('/', config.upstream).origin
  // The vendored cordis LoggerService has no visible console backend in the
  // shipped web composition; console goes to the launcher's stdout.
  const log = {
    info: (message) => console.log(message),
    error: (message) => console.error(message),
  }
  const facts = { port: 0, upstream: chatOrigin, startPath: config.startPath }
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    const incoming = new URL(req.url ?? '/', 'http://loopback.invalid')
    if (req.method === 'OPTIONS') {
      const headers = {}
      corsHeaders(req, headers)
      res.writeHead(204, headers)
      res.end()
      return
    }
    if (incoming.pathname === PING_PATH) {
      sendPing(req, res, facts)
      return
    }
    void proxyRequest(req, res, config, log)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    tunnelUpgrade(req, socket, head, config, log, sockets)
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  ctx.effect(() => {
    let disposed = false
    listen(server, config, log).then((port) => {
      if (disposed) return
      facts.port = port
      log.info(`deepseek-web: loopback proxy ready at http://127.0.0.1:${port} (upstream ${chatOrigin}, panel start ${config.startPath})`)
    }, (error) => {
      if (!disposed) log.error(String(error))
    })
    return () => {
      disposed = true
      for (const socket of sockets) socket.destroy()
      server.close()
    }
  }, 'deepseek-web: loopback proxy server')
}

export default { name, inject, Config, apply }
