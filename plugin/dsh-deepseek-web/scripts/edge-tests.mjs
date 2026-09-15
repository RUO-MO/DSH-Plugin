/**
 * Edge-case suite for the dsh-deepseek-web host half. Boots the proxy on a
 * scratch port and exercises the paths the browser panel relies on: POST
 * round-trips, binary passthrough equality, concurrency, HEAD/304 semantics,
 * CORS origin filtering, cookie rewriting, and the raw-TLS upgrade tunnel.
 * Run: node scripts/edge-tests.mjs
 */

import net from 'node:net'
import { apply } from '../lib/index.js'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const PORT = 3877
const BASE = `http://127.0.0.1:${PORT}`
// 需要校验真实会话改写时可设 DSH_EDGE_SHARE=/a/chat/s/<share-id>；否则以站点根路径跑通用断言。
const SHARE = process.env.DSH_EDGE_SHARE || '/'
const failures = []

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures.push(label)
}

const effects = []
apply({
  effect(factory) {
    const disposer = factory()
    if (typeof disposer === 'function') effects.push(disposer)
  },
  logger: null,
}, { port: PORT, portScan: 0, upstream: 'https://chat.deepseek.com', startPath: SHARE, userAgent: BROWSER_UA, debug: false })
await new Promise((resolve) => setTimeout(resolve, 1200))

// 1. HTML rewrite + cookie rewriting + framing-header removal.
const page = await fetch(BASE + SHARE, { headers: { 'user-agent': BROWSER_UA } })
const pageBody = await page.text()
const cookies = page.headers.getSetCookie()
check('html 200 + no absolute hosts', page.status === 200 && !pageBody.includes('https://fe-static') && !pageBody.includes('https://chat.deepseek.com'))
check('set-cookie rewritten (no Domain=/Secure=)', cookies.length > 0 && cookies.every((c) => !/domain=|secure/i.test(c) && /samesite=lax/i.test(c)), `${cookies.length} cookies`)
check('framing headers stripped', page.headers.get('content-security-policy') === null && page.headers.get('x-frame-options') === null)

// 2. POST with a JSON body: forwarded, answered, JSON rewrite path exercised.
const post = await fetch(BASE + '/api/v0/chat_session/create', {
  method: 'POST',
  headers: { 'user-agent': BROWSER_UA, 'content-type': 'application/json' },
  body: JSON.stringify({ probe: 'dsh-deepseek-web' }),
})
const postBody = await post.text()
check('POST reaches upstream and answers', post.status > 0 && postBody.length > 0, `status ${post.status}, ${postBody.length} bytes`)

// 3. Binary passthrough: byte-for-byte equality with a direct fetch.
const direct = await fetch('https://fe-static.deepseek.com/chat/static/web-error-logo-dark.7c806d753d.png', { headers: { 'user-agent': BROWSER_UA } })
const directBytes = new Uint8Array(await direct.arrayBuffer())
const viaProxy = await fetch(BASE + '/fe-static/chat/static/web-error-logo-dark.7c806d753d.png', { headers: { 'user-agent': BROWSER_UA } })
const proxyBytes = new Uint8Array(await viaProxy.arrayBuffer())
check('binary passthrough identical', viaProxy.status === 200 && directBytes.length === proxyBytes.length && directBytes.every((b, i) => b === proxyBytes[i]), `${proxyBytes.length} bytes`)
check('binary content-length preserved', viaProxy.headers.get('content-length') === String(proxyBytes.length))

// 4. HEAD keeps the declared length without a body.
const head = await fetch(BASE + '/fe-static/chat/static/main.d69e3d8c16.js', { method: 'HEAD', headers: { 'user-agent': BROWSER_UA } })
check('HEAD passes through with length', head.status === 200 && Number(head.headers.get('content-length')) > 1_000_000, `length ${head.headers.get('content-length')}`)

// 5. Conditional GET (304 path).
const first = await fetch(BASE + '/fe-static/chat/static/main.cffac0f0da.css', { headers: { 'user-agent': BROWSER_UA } })
await first.text()
const etag = first.headers.get('etag')
if (etag !== null) {
  const second = await fetch(BASE + '/fe-static/chat/static/main.cffac0f0da.css', { headers: { 'user-agent': BROWSER_UA, 'if-none-match': etag } })
  await second.text()
  check('conditional GET stays 304', second.status === 304, `status ${second.status}`)
} else {
  console.log('SKIP  conditional GET (upstream sent no etag)')
}

// 6. Concurrency: 20 parallel HTML fetches all succeed.
const many = await Promise.all(Array.from({ length: 20 }, () => fetch(BASE + SHARE, { headers: { 'user-agent': BROWSER_UA } }).then(async (r) => ({ s: r.status, n: (await r.text()).length }))))
check('20 concurrent requests all 200', many.every((r) => r.s === 200 && r.n > 5000))

// 7. CORS origin filtering.
const evil = await fetch(BASE + '/dsh-deepseek-web/ping', { headers: { origin: 'https://evil.example' } })
await evil.text()
check('foreign origin gets no ACAO', evil.headers.get('access-control-allow-origin') === null)
const local = await fetch(BASE + '/dsh-deepseek-web/ping', { headers: { origin: 'http://127.0.0.1:3080' } })
await local.text()
check('loopback origin reflected', local.headers.get('access-control-allow-origin') === 'http://127.0.0.1:3080')
check('private-network opt-in present', local.headers.get('access-control-allow-private-network') === 'true')

// 8. Upgrade tunnel: a WebSocket handshake must traverse the TLS tunnel and
// draw any real HTTP answer (101, or a 4xx JSON) from the upstream.
const tunnelAnswer = await new Promise((resolve) => {
  const socket = net.connect(PORT, '127.0.0.1', () => {
    socket.write(`GET /api/v0/chat/tts/ HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:${PORT}\r\n\r\n`)
  })
  let data = ''
  socket.on('data', (chunk) => {
    data += chunk.toString('utf8')
    if (data.includes('\r\n\r\n')) {
      socket.destroy()
      resolve(data.split('\r\n')[0])
    }
  })
  socket.on('error', () => resolve('socket-error'))
  setTimeout(() => { socket.destroy(); resolve('timeout') }, 10_000)
})
check('upgrade tunnel reaches upstream', /HTTP\/1\.\d \d{3}/.test(tunnelAnswer), String(tunnelAnswer))

for (const disposer of effects) disposer()
await new Promise((resolve) => setTimeout(resolve, 200))
if (failures.length > 0) {
  console.error(`EDGE FAILURES: ${failures.length}`)
  process.exitCode = 1
} else {
  console.log('EDGE OK')
}
