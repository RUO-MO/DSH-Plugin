/**
 * Standalone smoke test for the dsh-deepseek-web host half: boots the proxy
 * on a scratch port, probes the ping endpoint, then pulls the configured
 * conversation page through the proxy and asserts the framing headers are
 * gone. Run: node scripts/smoke-proxy.mjs [startPath]
 */

import { apply } from '../lib/index.js'

// 传入一个真实共享会话路径（如 /a/chat/s/<share-id>）可校验页面改写；默认站点根路径即可验证框架头剥离。
const startPath = process.argv[2] ?? '/'
const config = {
  port: 3899,
  portScan: 3,
  upstream: 'https://chat.deepseek.com',
  startPath,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}
const effects = []
const ctx = {
  logger: console,
  effect(factory, label) {
    const disposer = factory()
    if (typeof disposer === 'function') effects.push({ label, disposer })
  },
}

apply(ctx, config)
await new Promise((resolve) => setTimeout(resolve, 1200))

const browserHeaders = { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' }

const ping = await fetch('http://127.0.0.1:3899/dsh-deepseek-web/ping')
const pingBody = await ping.json()
console.log('ping:', ping.status, JSON.stringify(pingBody))
if (pingBody.plugin !== 'dsh-deepseek-web') throw new Error('ping marker missing')

const answer = await fetch(`http://127.0.0.1:3899${startPath}`, { headers: browserHeaders })
const body = await answer.text()
const framing = ['content-security-policy', 'x-frame-options'].filter((name) => answer.headers.get(name) !== null)
console.log('proxied page:', answer.status, 'bytes:', body.length, 'framing headers:', framing.length === 0 ? 'none' : framing)
console.log('content-type:', answer.headers.get('content-type'), '| server:', answer.headers.get('server'))
if (framing.length > 0) throw new Error('framing headers survived the proxy')
if (answer.status !== 200 || body.length < 1000) throw new Error('proxied page did not come back')

for (const { label, disposer } of effects) disposer()
console.log('SMOKE OK')
