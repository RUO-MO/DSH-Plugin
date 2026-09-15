/**
 * Desktop development-mode injector for dsh-deepseek-web.
 *
 * `pnpm start:desktop` / `dev:desktop` rebuild the disposable desktop npm
 * project (apps/desktop/.desktop-build/development/project) from scratch on
 * every launch, so a plugin installed there never survives a relaunch. The
 * official composition reads the profile's user patch layer from the
 * project's `cordis.patch.yml`, and a Loader row may name its module by
 * absolute file URL — so this watcher re-writes that one file inside the
 * prepare→boot window, pointing at this plugin directory. No harness file is
 * modified and no junction or package-manager run is needed.
 *
 * Usage: node inject-dev-project.mjs [--harness <harness 仓库路径>] [--once]
 * Without --once the watcher keeps polling and re-injects after every project
 * rebuild until the process is killed (the launcher .cmd stops it).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROW_MARKER = 'id: deepseek-web'
const POLL_MS = 150

/** Resolve the harness root: explicit env var, else a sibling deepseek-harness. */
function resolveHarnessRoot() {
  if (process.env.DSH_SKIN_HARNESS_ROOT) return process.env.DSH_SKIN_HARNESS_ROOT
  const sibling = join(PLUGIN_ROOT, '..', 'deepseek-harness')
  return existsSync(sibling) ? sibling : null
}

function parseArgs(argv) {
  const values = { harness: resolveHarnessRoot(), once: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--harness') values.harness = argv[++index] ?? values.harness
    else if (argument === '--once') values.once = true
  }
  return values
}

function projectPatchRow() {
  const entry = pathToFileURL(join(PLUGIN_ROOT, 'lib', 'index.js')).href
  return [
    '# dsh-deepseek-web user patch layer, rewritten by scripts/inject-dev-project.mjs.',
    '- insert:',
    '    - id: deepseek-web',
    `      name: '${entry}'`,
    '',
  ].join('\n')
}

/** Inject when the project exists and lacks the row; true when injected now. */
function injectOnce(projectDir) {
  const packageJson = join(projectDir, 'package.json')
  const modules = join(projectDir, 'node_modules')
  if (!existsSync(packageJson) || !existsSync(modules)) return false
  const patchFile = join(projectDir, 'cordis.patch.yml')
  if (existsSync(patchFile)) {
    const current = readFileSync(patchFile, 'utf8')
    if (current.includes(ROW_MARKER)) return false
    writeFileSync(patchFile, `${current.endsWith('\n') ? current : `${current}\n`}${projectPatchRow()}`)
  } else {
    writeFileSync(patchFile, projectPatchRow())
  }
  console.log(`[dsh-deepseek-web] injected patch row into ${patchFile}`)
  return true
}

async function main() {
  const values = parseArgs(process.argv.slice(2))
  if (!values.harness) {
    console.error('[dsh-deepseek-web] 未找到 deepseek-harness！请设置环境变量 DSH_SKIN_HARNESS_ROOT 指向 harness 仓库，或将本插件放在 deepseek-harness 同级目录。')
    process.exit(1)
  }
  const projectDir = resolve(values.harness, 'apps', 'desktop', '.desktop-build', 'development', 'project')
  if (!existsSync(join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai', 'schemastery'))) {
    console.warn('[dsh-deepseek-web] warning: 插件目录 node_modules 缺失 — 请在插件目录执行 `npm install`，否则 host 半无法解析 @deepseek-ai/schemastery。')
  }
  if (values.once) {
    injectOnce(projectDir)
    return
  }
  console.log(`[dsh-deepseek-web] watching ${projectDir} (Ctrl+C or taskkill to stop)`)
  while (true) {
    try {
      injectOnce(projectDir)
    } catch (error) {
      console.warn(`[dsh-deepseek-web] inject failed: ${String(error)}`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS))
  }
}

await main()
