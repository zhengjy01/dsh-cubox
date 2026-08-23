/**
 * dsh-cubox — smoke tests.
 *
 * 1. Mock-boot apply(): every tool registers, routes mount, the timer
 *    branch runs (syncMinutes=0 to keep the test synchronous).
 * 2. API client against a stub fetch: envelope unwrapping, auth header,
 *    error mapping, time formatting, today range.
 * 3. Store: API-link parsing, patch semantics, secret-free view.
 * 4. Sync logic: cache round-trip, daily outline, annotation summary.
 *
 * Run: node tests/smoke.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const mod = await import(path.join(root, 'lib', 'index.js'))

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('  ✅ ' + name)
  } else {
    failures += 1
    console.error('  ❌ ' + name + (detail !== '' ? ' — ' + detail : ''))
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-cubox-test-'))
process.env.DSH_CUBOX_CONFIG = path.join(tmp, 'config.json')
process.env.DSH_CUBOX_CACHE = path.join(tmp, 'cache.json')

// ---------------------------------------------------------------- store
console.log('\n[store]')
{
  const { CuboxStore, parseApiLink, mask } = mod
  check('parseApiLink full link', JSON.stringify(parseApiLink('https://cubox.pro/c/api/save/abcd12345')) === JSON.stringify({ server: 'cubox.pro', token: 'abcd12345' }))
  check('parseApiLink .cc host', JSON.stringify(parseApiLink('https://cubox.cc/c/api/save/xyz')) === JSON.stringify({ server: 'cubox.cc', token: 'xyz' }))
  check('parseApiLink bare token', JSON.stringify(parseApiLink('abcd12345')) === JSON.stringify({ server: 'cubox.pro', token: 'abcd12345' }))
  check('parseApiLink invalid', parseApiLink('') === null && parseApiLink('https://') === null && parseApiLink(undefined) === null)
  check('mask short', mask('abcdefgh') === 'ab****')
  check('mask long', mask('abcd1234efgh') === 'abcd****efgh')

  const store = new CuboxStore()
  const emptyView = await store.view()
  check('empty view not configured', emptyView.configured === false)
  check('empty view defaults', emptyView.exportCards === true && emptyView.llmBaseUrl === 'https://api.deepseek.com/v1' && emptyView.llmModel === 'deepseek-chat' && emptyView.llmPrompt.includes('今日收藏简报'))
  const patched = await store.patch({ apiLink: 'https://cubox.cc/c/api/save/secret99xyz', syncMinutes: 30 })
  check('patch via apiLink', patched.configured === true && patched.server === 'cubox.cc' && patched.tokenMasked === 'secr****9xyz' && patched.syncMinutes === 30)
  const view = await store.view()
  check('view hides token', !JSON.stringify(view).includes('secret99'))
  const reset = await store.patch({ reset: true })
  check('reset clears', reset.configured === false && reset.syncMinutes === 30)
  const bare = await store.patch({ token: 'tok12345', server: 'cubox.pro' })
  check('patch bare token/server', bare.configured === true && bare.server === 'cubox.pro')
  const llm = await store.patch({ exportCards: false, llmApiKey: 'sk-abc12345', llmModel: 'deepseek-chat', llmPrompt: '请总结：{collection}' })
  check('patch llm + exportCards', llm.exportCards === false && llm.llmKeyMasked === 'sk-a****2345' && llm.llmPrompt.includes('{collection}'))
}

// ----------------------------------------------------------------- api
console.log('\n[api]')
{
  const { CuboxApi, formatApiTime, todayRange } = mod
  const calls = []
  const stubFetch = async (input, init) => {
    calls.push({ input: String(input), headers: init?.headers, body: init?.body })
    const text = (await (async () => '')())
    void text
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 200, message: 'ok', data: [{ id: 'c1', title: 'T', url: 'https://a.com/x', create_time: '2026-08-23T10:00:00.000+0800' }] }),
    }
  }
  const { CuboxStore } = mod
  const store = new CuboxStore()
  await store.patch({ token: 'tok12345', server: 'cubox.pro' })
  const api = new CuboxApi(store, stubFetch)
  const cards = await api.filterCards({ limit: 10 })
  check('filterCards unwraps envelope', Array.isArray(cards) && cards.length === 1 && cards[0].id === 'c1')
  check('auth header set', calls[0].headers.Authorization === 'Bearer tok12345')
  check('POST body sent', typeof calls[0].body === 'string' && JSON.parse(calls[0].body).limit === 10)

  const t = formatApiTime(new Date(2026, 7, 23, 9, 5, 7, 123))
  check('formatApiTime shape', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(t), t)
  const range = todayRange()
  check('todayRange start/end', range.start < range.end && range.start.startsWith(new Date().getFullYear() + '-'))

  const errFetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ code: 401, message: 'API Key does not exist' }) })
  const api2 = new CuboxApi(store, errFetch)
  let threw = null
  try { await api2.listFolders() } catch (e) { threw = e }
  check('api error mapped', threw !== null && threw.name === 'CuboxApiError' && String(threw.message).includes('API Key'), String(threw?.message))
}

// --------------------------------------------------------------- sync
console.log('\n[sync]')
{
  const { CuboxStore } = mod
  const store = new CuboxStore()
  await store.patch({ token: 'tok12345' })
  const { readCache, writeCache } = mod
  const cache = await readCache()
  check('empty cache', cache.cards.length === 0 && cache.annotations.length === 0)

  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T10:00:00.000+0800`
  await writeCache({
    updatedAt: new Date().toISOString(),
    cards: [{ id: 'c1', title: 'AI 文章', description: '讲 LLM', article_title: '', domain: 'a.com', read: false, starred: false, tags: ['ai'], folder: null, url: 'https://a.com/1', create_time: todayIso, update_time: todayIso }],
    annotations: [{ id: 'a1', text: '关键段落', note: '我的笔记', image_url: '', color: 'yellow', card_id: 'c1', create_time: todayIso, update_time: todayIso }],
  })
  const reloaded = await readCache()
  check('cache round-trip', reloaded.cards.length === 1 && reloaded.annotations.length === 1)

  const { doSync } = mod
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 200, message: 'ok', data: [] }),
  })
  const { CuboxApi } = mod
  const api = new CuboxApi(store, stubFetch)
  const result = await doSync(api, store, { days: 1, limit: 10 })
  check('doSync ok', result.ok === true && result.pulledCards === 0)
  const viewAfter = await store.view()
  check('doSync stamps lastSyncAt', viewAfter.lastSyncAt !== '')

  // Markdown export to an output dir: one file per card, no outline file.
  const exportDir = path.join(tmp, 'export')
  const { exportSyncToMarkdown } = mod
  const written = await exportSyncToMarkdown(reloaded, exportDir)
  check('export writes card only', written === 1, 'written=' + written)
  const fsMod = await import('node:fs/promises')
  const names = (await fsMod.readdir(exportDir)).sort()
  check('export filenames', names.some((n) => n.includes('AI 文章')) && !names.some((n) => n.startsWith('收藏总结-')), names.join(', '))
  const cardFile = names.find((n) => n.includes('AI 文章'))
  const cardContent = await fsMod.readFile(path.join(exportDir, cardFile), 'utf8')
  check('card frontmatter + links', cardContent.includes('cubox_url: https://cubox.pro/web/card/c1') && cardContent.includes('[Read Original](') && cardContent.includes('## 标注') && cardContent.includes('关键段落'), '')

  // Collection formatting + LLM brief (stubbed fetch).
  const { formatCollectionForPrompt, writeDailyBrief } = mod
  const formatted = formatCollectionForPrompt(reloaded, new Date(), 1)
  check('format collection', formatted.includes('AI 文章') && formatted.includes('来源：a.com') && formatted.includes('链接：https://a.com/1') && formatted.includes('摘要：讲 LLM') && formatted.includes('高亮：关键段落'), formatted)
  // 7-day window includes the same card and reports the range.
  const formatted7 = formatCollectionForPrompt(reloaded, new Date(), 7)
  check('format collection 7d window', formatted7.includes('AI 文章') && formatted7.includes('收藏时间范围：') && formatted7.includes('共 1 条'), formatted7)
  const llmCalls = []
  const llmStub = async (input, init) => {
    llmCalls.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '今日简报正文' } }] }),
      json: async () => ({ choices: [{ message: { content: '今日简报正文' } }] }),
    }
  }
  const origFetch = globalThis.fetch
  globalThis.fetch = llmStub
  try {
    const briefPath = await writeDailyBrief(reloaded, exportDir, {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      prompt: '请生成简报：\n{collection}',
    }, { days: 1 })
    check('brief written (today)', typeof briefPath === 'string' && briefPath.includes('今日收藏简报-'))
    check('brief content', (await fsMod.readFile(briefPath, 'utf8')).includes('今日简报正文'))
    check('llm called with collection', llmCalls.length === 1 && llmCalls[0].messages[1].content.includes('AI 文章'))

    // 7-day window writes a separate 最近N日收藏简报 file, not overwriting today's.
    const brief7Path = await writeDailyBrief(reloaded, exportDir, {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      prompt: '请生成简报：\n{collection}',
    }, { days: 7 })
    check('brief written (7d, separate file)', typeof brief7Path === 'string' && brief7Path.includes('最近7日收藏简报-') && brief7Path !== briefPath)
    const namesAfter7 = (await fsMod.readdir(exportDir)).filter((n) => n.includes('简报'))
    check('both brief files exist', namesAfter7.some((n) => n.startsWith('今日收藏简报-')) && namesAfter7.some((n) => n.startsWith('最近7日收藏简报-')), namesAfter7.join(', '))
  } finally {
    globalThis.fetch = origFetch
  }

  // doSync with exportCards=false and LLM configured (stubbed) writes only the brief.
  await store.patch({ exportCards: false, llmApiKey: 'sk-test', llmBaseUrl: 'https://api.deepseek.com/v1', llmModel: 'deepseek-chat', llmPrompt: '简报：{collection}', outputDir: exportDir })
  const llmCalls2 = []
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('deepseek')) {
      llmCalls2.push(JSON.parse(init.body))
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'AI 简报正文' } }] }), json: async () => ({ choices: [{ message: { content: 'AI 简报正文' } }] }) }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 200, message: 'ok', data: [] }), json: async () => ({ code: 200, message: 'ok', data: [] }) }
  }
  try {
    const result2 = await doSync(api, store, { days: 1, limit: 10 })
    check('doSync brief only (no cards)', result2.ok === true && result2.exportedFiles === 0 && result2.briefPath !== '' && llmCalls2.length === 1, result2.message)
  } finally {
    globalThis.fetch = origFetch
  }
}

// ------------------------------------------------------------- apply
console.log('\n[apply]')
{
  const registered = []
  const ctx = {
    get: () => null,
    logger: { info: () => {}, warn: () => {} },
    tools: { register: (t) => { registered.push(t.name); return () => {} } },
    systemPrompt: { section: (s) => { registered.push('section:' + s.name); return () => {} } },
    webServer: { register: (r) => { registered.push('route:' + r.path); return () => {} } },
    effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined) },
    interval: () => () => {},
  }
  mod.apply(ctx, { syncMinutes: 0 })
  const tools = ['cubox_status', 'cubox_config', 'cubox_sync', 'cubox_cards']
  for (const name of tools) check('tool registered: ' + name, registered.includes(name))
  check('section registered', registered.includes('section:plugin:dsh-cubox'))
  check('routes registered', registered.includes('route:/api/dsh-cubox/config') && registered.includes('route:/api/dsh-cubox/sync') && registered.includes('route:/api/dsh-cubox/pick-dir'))

  // Timer branch: syncMinutes > 0 schedules (interval called with ms).
  let intervalMs = null
  const ctx2 = { ...ctx, interval: (fn, ms) => { intervalMs = ms; return () => {} } }
  mod.apply(ctx2, { syncMinutes: 5 })
  check('timer scheduled', intervalMs === 5 * 60 * 1000, String(intervalMs))
}

rmSync(tmp, { recursive: true, force: true })
console.log('\n' + (failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`))
process.exit(failures === 0 ? 0 : 1)
