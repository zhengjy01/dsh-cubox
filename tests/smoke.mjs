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
process.env.DSH_CUBOX_FLOMO_CONFIG = path.join(tmp, 'flomo.json')
process.env.DSH_CUBOX_FLOMO_LEDGER = path.join(tmp, 'flomo-ledger.json')

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

  check('digest defaults off', llm.flomoEnabled === false && llm.exportDest === 'flomo' && llm.flomoTag === 'AI/cubox' && llm.flomoMinAgeMinutes === 60 && llm.usePrompt === false && llm.exportPrompt.includes('{digest}'))
  const digestCfg = await store.patch({ flomoEnabled: true, exportDest: 'local', flomoTag: '#我的标签', flomoMinAgeMinutes: 5, usePrompt: true, exportPrompt: '整理：{digest}', notionTargetPageId: 'page123' })
  check('patch digest config', digestCfg.flomoEnabled === true && digestCfg.exportDest === 'local' && digestCfg.flomoTag === '我的标签' && digestCfg.flomoMinAgeMinutes === 5 && digestCfg.usePrompt === true && digestCfg.notionTargetPageId === 'page123')

  // onSaved hook: fires after every successful save (drives the timer re-arm).
  const savedIntervals = []
  store.onSaved = (cfg) => savedIntervals.push(cfg.syncMinutes)
  await store.patch({ syncMinutes: 45 })
  check('store.onSaved fires on interval save', savedIntervals.length === 1 && savedIntervals[0] === 45, JSON.stringify(savedIntervals))
  await store.patch({ flomoTag: 'AI/cubox' })
  check('store.onSaved fires on other saves', savedIntervals.length === 2 && savedIntervals[1] === 45, JSON.stringify(savedIntervals))
  store.onSaved = undefined

  // Restore defaults so later sections (doSync) are unaffected by this block.
  await store.patch({ flomoEnabled: false, exportDest: 'flomo', flomoTag: 'AI/cubox', flomoMinAgeMinutes: 60, usePrompt: false })
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

// --------------------------------------------------------------- flomo
console.log('\n[flomo]')
{
  const { stripHashTags, buildTaggedContent, resolveFlomoUrl, writeFlomoCredentials, flomoStatus } = mod
  check('stripHashTags removes every #', stripHashTags('标题 #tag 与 #另一个，还有 C#') === '标题 tag 与 另一个，还有 C')
  check('buildTaggedContent appends one tag', buildTaggedContent('正文 #x', 'AI/cubox') === '正文 x #AI/cubox')
  check('buildTaggedContent splits tag list', buildTaggedContent('正文', 'a, b') === '正文 #a #b')
  check('flomo unconfigured initially', (await resolveFlomoUrl()) === null)
  await writeFlomoCredentials({ webhookUrl: 'https://flomoapp.com/iwh/testtoken', apiKey: '' })
  check('flomo resolves webhook url', (await resolveFlomoUrl()) === 'https://flomoapp.com/iwh/testtoken')
  const st = await flomoStatus()
  check('flomo status masked', st.configured === true && st.source === 'webhookUrl' && st.masked.includes('****') && !JSON.stringify(st).includes('testtoken'))
}

// -------------------------------------------------------------- digest
console.log('\n[digest]')
{
  const { formatApiTime, annotationHash, selectUnpushedAnnotations, buildDigestMemos, readFlomoLedger, writeFlomoLedger, chunkText, parseCuboxTime } = mod
  const now = new Date()
  const ago = (min) => formatApiTime(new Date(now.getTime() - min * 60000))
  check('parseCuboxTime parses +0800', parseCuboxTime('2026-08-23T10:00:00.000+0800') === new Date('2026-08-23T10:00:00.000+08:00').getTime())
  check('parseCuboxTime rejects junk', parseCuboxTime('not-a-date') === 0)

  const cards = [
    { id: 'c1', title: '标题一', description: '', article_title: '', domain: 'a.com', read: false, starred: false, tags: [], folder: null, url: 'https://a.com/1', create_time: ago(200), update_time: ago(200) },
    { id: 'c2', title: 'C# 与 标签', description: '', article_title: '', domain: 'b.com', read: false, starred: false, tags: [], folder: null, url: 'https://b.com/2', create_time: ago(200), update_time: ago(200) },
  ]
  const anns = [
    { id: 'old', text: '十天前的旧标注', note: '', image_url: '', color: 'Yellow', card_id: 'c1', create_time: ago(10 * 24 * 60), update_time: ago(10 * 24 * 60) },
    { id: 'fresh', text: '刚写的', note: '', image_url: '', color: 'Yellow', card_id: 'c1', create_time: ago(5), update_time: ago(5) },
    { id: 'a1', text: '关键段落 #要点', note: '我的笔记', image_url: '', color: 'Yellow', card_id: 'c1', create_time: ago(120), update_time: ago(120) },
    { id: 'a2', text: '第二个高亮', note: '', image_url: '', color: 'Blue', card_id: 'c2', create_time: ago(130), update_time: ago(130) },
  ]
  const cache = { updatedAt: now.toISOString(), cards, annotations: anns }

  const picked = selectUnpushedAnnotations(cache, { ledger: {}, now, windowDays: 2, minAgeMinutes: 60 })
  check('select filters window + min age', picked.map((a) => a.id).join(',') === 'a2,a1', picked.map((a) => a.id).join(','))

  const ledger = { a1: annotationHash(anns[2]) }
  const picked2 = selectUnpushedAnnotations(cache, { ledger, now, windowDays: 2, minAgeMinutes: 60 })
  check('select skips already-pushed id', picked2.map((a) => a.id).join(',') === 'a2', picked2.map((a) => a.id).join(','))

  const changed = { ...cache, annotations: anns.map((a) => (a.id === 'a1' ? { ...a, note: '改过的笔记' } : a)) }
  const picked3 = selectUnpushedAnnotations(changed, { ledger, now, windowDays: 2, minAgeMinutes: 60 })
  check('select re-picks changed annotation', picked3.map((a) => a.id).join(',') === 'a2,a1', picked3.map((a) => a.id).join(','))

  const memos = buildDigestMemos(cache, [anns[2], anns[3]], { date: now })
  check('digest one memo for small set', memos.length === 1 && memos[0].annotationIds.length === 2)
  const body = memos[0].content
  check('digest has title/link/highlight/note', body.includes('《标题一》') && body.includes('https://a.com/1') && body.includes('- 高亮：关键段落 #要点') && body.includes('  - 笔记：我的笔记'), body)

  const many = []
  for (let i = 0; i < 40; i++) {
    many.push({ id: 'x' + i, text: '长内容'.repeat(60), note: '', image_url: '', color: 'Yellow', card_id: 'c1', create_time: ago(300 - i), update_time: ago(300 - i) })
  }
  const manyMemos = buildDigestMemos(cache, many, { date: now })
  check('digest splits when long', manyMemos.length > 1, 'memos=' + manyMemos.length)
  check('continuation repeats card header', manyMemos.slice(1).every((m) => m.content.includes('（续）') && m.content.includes('《标题一》')))
  check('digest keeps every annotation id', manyMemos.reduce((n, m) => n + m.annotationIds.length, 0) === 40)

  await writeFlomoLedger({ a1: 'hash1' })
  const ledgerBack = await readFlomoLedger()
  check('ledger round-trip', ledgerBack.a1 === 'hash1')

  const chunks = chunkText(Array.from({ length: 80 }, (_, i) => '行' + i).join('\n'), 60, '头')
  check('chunkText split + header', chunks.length > 1 && chunks[0].startsWith('头') && chunks[1].startsWith('头（续）'))
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

  // doSync pushes newly settled annotations to flomo when flomoEnabled (stubbed).
  const { formatApiTime, readFlomoLedger, writeFlomoLedger } = mod
  await writeFlomoLedger({})
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const tooFresh = new Date(Date.now() - 10 * 60 * 1000)
  await writeCache({
    updatedAt: new Date().toISOString(),
    cards: [{ id: 'fc1', title: 'flomo 卡片', description: '', article_title: '', domain: 'a.com', read: false, starred: false, tags: [], folder: null, url: 'https://a.com/fc1', create_time: formatApiTime(past), update_time: formatApiTime(past) }],
    annotations: [
      { id: 'fa1', text: '值得记的 #要点', note: '想法', image_url: '', color: 'Yellow', card_id: 'fc1', create_time: formatApiTime(past), update_time: formatApiTime(past) },
      { id: 'fa2', text: '太新了', note: '', image_url: '', color: 'Yellow', card_id: 'fc1', create_time: formatApiTime(tooFresh), update_time: formatApiTime(tooFresh) },
    ],
  })
  await store.patch({ token: 'tok12345', flomoEnabled: true, exportDest: 'flomo', flomoTag: 'AI/cubox', flomoMinAgeMinutes: 60, outputDir: '', exportCards: false, llmApiKey: '' })
  const posted = []
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('flomoapp')) {
      posted.push(JSON.parse(init.body).content)
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'ok' }) }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 200, message: 'ok', data: [] }) }
  }
  try {
    const r3 = await doSync(api, store, { days: 1, limit: 10 })
    check('doSync pushes flomo digest', posted.length === 1 && r3.digestCandidates === 1 && r3.digestMemos === 1, JSON.stringify({ posted: posted.length, candidates: r3.digestCandidates }))
    check('flomo body keeps only the tag #', posted[0].includes('要点') && posted[0].includes('#AI/cubox') && !posted[0].replace('#AI/cubox', '').includes('#'))
    const ledgerAfter = await readFlomoLedger()
    check('ledger records pushed (not too-fresh)', ledgerAfter.fa1 !== undefined && ledgerAfter.fa2 === undefined)
    const r4 = await doSync(api, store, { days: 1, limit: 10 })
    check('doSync flomo dedupe (no re-push)', posted.length === 1 && r4.digestCandidates === 0, JSON.stringify({ posted: posted.length, candidates: r4.digestCandidates }))
  } finally {
    globalThis.fetch = origFetch
  }
}

// ------------------------------------------------------------- apply
console.log('\n[apply]')
{
  const registered = []
  const routes = []
  const ctx = {
    get: () => null,
    logger: { info: () => {}, warn: () => {} },
    tools: { register: (t) => { registered.push(t.name); return () => {} } },
    systemPrompt: { section: (s) => { registered.push('section:' + s.name); return () => {} } },
    webServer: { register: (r) => { registered.push('route:' + r.path); routes.push(r); return () => {} } },
    effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined) },
    interval: () => () => {},
  }
  mod.apply(ctx, { syncMinutes: 0 })
  const tools = ['cubox_status', 'cubox_config', 'cubox_sync', 'cubox_cards', 'cubox_flomo']
  for (const name of tools) check('tool registered: ' + name, registered.includes(name))
  check('section registered', registered.includes('section:plugin:dsh-cubox'))
  check('routes registered', registered.includes('route:/api/dsh-cubox/config') && registered.includes('route:/api/dsh-cubox/sync') && registered.includes('route:/api/dsh-cubox/pick-dir') && registered.includes('route:/api/dsh-cubox/flomo') && registered.includes('route:/api/dsh-cubox/test-flomo'), registered.filter((r) => r.startsWith('route:')).join(', '))

  // Timer branch: syncMinutes > 0 schedules (interval called with ms).
  let intervalMs = null
  routes.length = 0 // only inspect the routes mounted by the second apply
  const ctx2 = { ...ctx, interval: (fn, ms) => { intervalMs = ms; return () => {} } }
  mod.apply(ctx2, { syncMinutes: 5 })
  check('timer scheduled', intervalMs === 5 * 60 * 1000, String(intervalMs))

  // Panel config save re-arms the running timer (no `dsh web` restart needed).
  // Let the initial store read settle, then drive the real config route twice.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const configRoute = routes.find((r) => r.path === '/api/dsh-cubox/config')
  const postConfig = async (body) => {
    const out = { status: 0, body: '' }
    const res = { writeHead: (status) => { out.status = status }, end: (payload) => { out.body = String(payload) } }
    const req = {
      method: 'POST',
      headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
    }
    await configRoute.handler(req, res)
    return out
  }
  await postConfig({ syncMinutes: 7 })
  const afterSeven = intervalMs
  const second = await postConfig({ syncMinutes: 17 })
  check('panel interval save re-arms timer', afterSeven === 7 * 60 * 1000 && intervalMs === 17 * 60 * 1000, 'after7=' + afterSeven + ' after17=' + intervalMs)
  check('panel interval save persisted to view', second.status === 200 && JSON.parse(second.body).syncMinutes === 17, second.body)
}

rmSync(tmp, { recursive: true, force: true })
console.log('\n' + (failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`))
process.exit(failures === 0 ? 0 : 1)
