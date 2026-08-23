/**
 * dsh-cubox — live smoke test against the real Cubox API.
 *
 * Requires a real API-extension link. Run:
 *   DSH_CUBOX_API_LINK="https://cubox.pro/c/api/save/xxxx" node tests/live.mjs
 *
 * Exercises: config → sync (today) → export markdown (per card, no outline)
 * → annotations → cards query.
 * cards query → status. Uses temp config/cache files; nothing is written to
 * the real ~/.dsh store.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const link = process.env.DSH_CUBOX_API_LINK ?? ''
if (link === '') {
  console.error('❌ 需要 DSH_CUBOX_API_LINK 环境变量（Cubox API 扩展链接）')
  process.exit(1)
}

const mod = await import(path.join(root, 'lib', 'index.js'))
const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-cubox-live-'))
process.env.DSH_CUBOX_CONFIG = path.join(tmp, 'config.json')
process.env.DSH_CUBOX_CACHE = path.join(tmp, 'cache.json')

let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log('  ✅ ' + name)
  else { failures += 1; console.error('  ❌ ' + name + (detail !== '' ? ' — ' + detail : '')) }
}

const { CuboxStore, CuboxApi, doSync, readCache, exportSyncToMarkdown } = mod
const store = new CuboxStore()
const view = await store.patch({ apiLink: link })
check('配置生效', view.configured === true, JSON.stringify(view))

const api = new CuboxApi(store)

console.log('\n[folders/tags]')
try {
  const folders = await api.listFolders()
  check('listFolders 返回数组', Array.isArray(folders))
  console.log('  📁 收藏夹数：' + folders.length + (folders[0] ? '，首个：' + folders[0].nested_name : ''))
} catch (e) { check('listFolders', false, String(e.message)) }

console.log('\n[sync]')
const result = await doSync(api, store, { days: 1, limit: 200 })
check('sync ok', result.ok === true, result.message)
console.log('  ' + result.message)

const cache = await readCache()
console.log('  缓存：卡片 ' + cache.cards.length + '，标注 ' + cache.annotations.length)
for (const card of cache.cards.slice(0, 5)) {
  console.log('    - ' + (card.title || card.url) + '（' + card.create_time + '）')
}

console.log('\n[markdown export]')
const now = new Date()
const exportDir = path.join(tmp, 'export')
const exported = await exportSyncToMarkdown(cache, exportDir)
check('导出卡片 md（无大纲文件）', exported === cache.cards.filter((c) => {
  const d = new Date(c.create_time)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}).length, 'exported=' + exported)
const fsMod = await import('node:fs/promises')
const exportNames = (await fsMod.readdir(exportDir)).sort()
check('无收藏总结大纲文件', !exportNames.some((n) => n.startsWith('收藏总结-')), exportNames.join(', '))
if (exportNames.length > 0) console.log('  导出文件：' + exportNames.join(', '))

console.log('\n[annotations]')
let ann = []
try {
  ann = await api.filterAnnotations({ limit: 100 })
  check('filterAnnotations 返回数组', Array.isArray(ann))
  console.log('  标注总数（近端）：' + ann.length)
  if (ann.length > 0) console.log('  示例：' + JSON.stringify(ann[0]).slice(0, 200))
} catch (e) { check('filterAnnotations', false, String(e.message)) }

console.log('\n[cards query]')
try {
  const cards = await api.filterCards({ limit: 5 })
  check('filterCards 返回数组', Array.isArray(cards))
  console.log('  最近收藏：' + cards.length + ' 条')
} catch (e) { check('filterCards', false, String(e.message)) }

rmSync(tmp, { recursive: true, force: true })
console.log('\n' + (failures === 0 ? '✅ 真实冒烟通过' : `❌ ${failures} 项失败`))
process.exit(failures === 0 ? 0 : 1)
