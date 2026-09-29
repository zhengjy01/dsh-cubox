/**
 * dsh-cubox — core sync/business logic.
 *
 * doSync pulls cards (and today's annotations) from the Cubox API, persists
 * a snapshot to ~/.dsh/dsh-cubox-cache.json, and exports to the configured
 * output dir: optionally one markdown file per card (exportCards), and — when
 * an LLM key is configured — a daily brief generated from the user's prompt
 * template ({collection} placeholder), written as 今日收藏简报-YYYY-MM-DD.md.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { CuboxApi, CuboxCard, CuboxAnnotation } from './api.ts'
import { todayRange } from './api.ts'
import type { CuboxStore } from './store.ts'
import { cachePath, type CuboxCredentials } from './store.ts'
import { chatComplete, llmConfigured, type LlmConfig } from './llm.ts'
import { chunkText, deliverAnnotationDigest, FLOMO_MAX_CHARS, type DigestResult } from './digest.ts'
import { buildTaggedContent, postMemo, resolveFlomoUrl } from './flomo.ts'
import { pluginPath } from './home.ts'

/** Sync snapshot persisted to the cache file. */
export interface CuboxCache {
  updatedAt: string
  cards: CuboxCard[]
  annotations: CuboxAnnotation[]
}

/** Result of one sync run. */
export interface SyncResult {
  ok: boolean
  message: string
  pulledCards: number
  pulledAnnotations: number
  cachedCards: number
  cachedAnnotations: number
  since: string
  /** Number of markdown files written to the output dir (0 = none). */
  exportedFiles: number
  /** Path of the LLM daily brief written ('' = not written). */
  briefPath: string
  /** Annotation digest candidates selected this run (0 = none). */
  digestCandidates: number
  /** flomo/other memos (or files/pages) delivered for the digest. */
  digestMemos: number
  /** Human-readable digest delivery message ('' = not attempted). */
  digestMessage: string
  /** Memos sent for the daily brief push (0 = not attempted/skipped). */
  briefFlomoMemos: number
  /** Human-readable brief-push message, including the skip reason ('' = not attempted). */
  briefFlomoMessage: string
}

/** Parse the cache file (missing/unreadable → empty). */
export async function readCache(): Promise<CuboxCache> {
  try {
    const raw = await readFile(cachePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { updatedAt: '', cards: [], annotations: [] }
    const record = parsed as Record<string, unknown>
    return {
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      cards: Array.isArray(record.cards) ? record.cards as CuboxCard[] : [],
      annotations: Array.isArray(record.annotations) ? record.annotations as CuboxAnnotation[] : [],
    }
  } catch {
    return { updatedAt: '', cards: [], annotations: [] }
  }
}

/** Write the cache file (mode 0600). */
export async function writeCache(cache: CuboxCache): Promise<void> {
  await mkdir(path.dirname(cachePath()), { recursive: true })
  await writeFile(cachePath(), JSON.stringify(cache, null, 2), { mode: 0o600 })
}

/**
 * Pull cards (and today's annotations) and persist the snapshot.
 * `days` controls the look-back window for cards (default 1 = today).
 * Always refreshes the annotation snapshot for today's range so the daily
 * summary has data even when few cards exist.
 */
export async function doSync(
  api: CuboxApi,
  store: CuboxStore,
  opts: { days?: number; limit?: number; outputDir?: string } = {},
): Promise<SyncResult> {
  const days = typeof opts.days === 'number' && opts.days > 0 ? Math.floor(opts.days) : 1
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? Math.floor(opts.limit) : 200
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0)
  const { start: startStr } = { start: '' }
  void startStr

  // Card window: from start-of-window to end-of-today.
  const cardStart = formatLocal(start)
  const cardEnd = formatLocal(now)
  const warnings: string[] = []
  let cards: CuboxCard[] = []
  try {
    cards = await api.filterCards({ start_time: cardStart, end_time: cardEnd, limit })
  } catch (cardError) {
    // Fall back to a plain latest-card pull when the time filter is rejected.
    try {
      cards = await api.filterCards({ limit })
    } catch (fallbackError) {
      warnings.push('拉取收藏失败：' + String(fallbackError instanceof Error ? fallbackError.message : fallbackError))
    }
    if (warnings.length === 0) {
      warnings.push('时间过滤被拒绝，已退回拉取最新收藏：' + String(cardError instanceof Error ? cardError.message : cardError))
    }
  }

  // Annotation window: today's full range.
  const range = todayRange()
  let annotations: CuboxAnnotation[] = []
  try {
    annotations = await api.filterAnnotations({ start_time: range.start, end_time: range.end, limit: 500 })
  } catch (annotationError) {
    warnings.push('拉取标注失败（已忽略）：' + String(annotationError instanceof Error ? annotationError.message : annotationError))
  }

  // Merge into the existing cache (dedupe by id, newest first).
  const prev = await readCache()
  const cardMap = new Map<string, CuboxCard>()
  for (const card of prev.cards) cardMap.set(card.id, card)
  for (const card of cards) cardMap.set(card.id, card)
  const mergedCards = [...cardMap.values()].sort((a, b) => b.create_time.localeCompare(a.create_time))

  const annotationMap = new Map<string, CuboxAnnotation>()
  for (const a of prev.annotations) annotationMap.set(a.id, a)
  for (const a of annotations) annotationMap.set(a.id, a)
  const mergedAnnotations = [...annotationMap.values()].sort((a, b) => b.create_time.localeCompare(a.create_time))

  const cache: CuboxCache = { updatedAt: new Date().toISOString(), cards: mergedCards, annotations: mergedAnnotations }
  await writeCache(cache)
  await store.save({ ...(await store.load()), lastSyncAt: cache.updatedAt })

  // Export to the configured output dir ('' = disabled). Failures degrade
  // gracefully — the snapshot is already saved.
  const cfg = await store.load()
  const outputDir = typeof opts.outputDir === 'string' ? opts.outputDir : cfg.outputDir
  let exportedFiles = 0
  if (outputDir.trim() !== '' && cfg.exportCards !== false) {
    try {
      exportedFiles = await exportSyncToMarkdown(cache, outputDir.trim())
    } catch (exportError) {
      warnings.push('导出 Markdown 失败：' + String(exportError instanceof Error ? exportError.message : exportError))
    }
  }

  // LLM brief: run the sync window's collection through the user's prompt and
  // write the brief file (今日收藏简报-YYYY-MM-DD.md for 1 day, 最近N日收藏简报-… for
  // wider windows — each window gets its own file). Requires an LLM key + prompt.
  let briefPath = ''
  if (outputDir.trim() !== '' && cfg.llmPrompt.trim() !== '' && llmConfigured({ baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, model: cfg.llmModel })) {
    try {
      briefPath = await writeDailyBrief(cache, outputDir.trim(), {
        baseUrl: cfg.llmBaseUrl,
        apiKey: cfg.llmApiKey,
        model: cfg.llmModel,
        prompt: cfg.llmPrompt,
      }, { days })
    } catch (briefError) {
      warnings.push('生成简报失败：' + String(briefError instanceof Error ? briefError.message : briefError))
    }
  }

  // Daily-brief push: the same brief also goes to flomo (at most one memo per
  // local day), so a day with saves but no highlights still yields a report.
  // Independent from the annotation digest below — own gate, own ledger.
  let briefPush: BriefPushResult | null = null
  if (cfg.briefFlomoEnabled && briefPath !== '') {
    try {
      briefPush = await deliverDailyBrief(cache, cfg, briefPath)
    } catch (briefPushError) {
      warnings.push('简报推送失败：' + String(briefPushError instanceof Error ? briefPushError.message : briefPushError))
    }
  }

  // Annotation digest: push newly settled/changed annotations to the configured
  // target (flomo by default). Gated by flomoEnabled; the local dedup ledger
  // prevents re-pushing. Failures degrade gracefully (snapshot is already saved).
  let digest: DigestResult | null = null
  if (cfg.flomoEnabled) {
    try {
      digest = await deliverAnnotationDigest(cache, cfg, { outputDir: outputDir.trim() })
    } catch (digestError) {
      warnings.push('标注 digest 导出失败：' + String(digestError instanceof Error ? digestError.message : digestError))
    }
  }

  const message =
    '同步完成：拉取卡片 ' + cards.length + ' 条、标注 ' + annotations.length + ' 条；' +
    '缓存现有卡片 ' + mergedCards.length + ' 条、标注 ' + mergedAnnotations.length + ' 条。' +
    (exportedFiles > 0 ? '已导出 ' + exportedFiles + ' 个收藏 Markdown 到 ' + outputDir.trim() : '') +
    (briefPath !== '' ? '已生成简报：' + briefPath : '') +
    (briefPush !== null && !briefPush.skipped ? '简报推送：' + briefPush.message : '') +
    (digest !== null && digest.candidates > 0 ? '标注 digest：' + digest.message : '') +
    (warnings.length > 0 ? '\n警告：' + warnings.join('；') : '')
  return {
    ok: true,
    message,
    pulledCards: cards.length,
    pulledAnnotations: annotations.length,
    cachedCards: mergedCards.length,
    cachedAnnotations: mergedAnnotations.length,
    since: cardStart,
    exportedFiles,
    briefPath,
    digestCandidates: digest?.candidates ?? 0,
    digestMemos: digest?.memos ?? 0,
    digestMessage: digest?.message ?? '',
    briefFlomoMemos: briefPush?.memos ?? 0,
    briefFlomoMessage: briefPush?.message ?? '',
  }
}

/** Collect a card's annotations (text + note). */
function cardAnnotationLines(card: CuboxCard, annotations: CuboxAnnotation[]): string[] {
  const lines: string[] = []
  for (const a of annotations) {
    if (a.text !== '') lines.push('高亮：' + a.text.trim().replace(/\s+/g, ' '))
    if (a.note !== '') lines.push('笔记：' + a.note.trim().replace(/\s+/g, ' '))
  }
  return lines
}

/**
 * Format cards within a time window (from `end` going back `days` days) into
 * a plain text list for the LLM prompt. Each entry: title (source), link,
 * summary, annotations. A leading line states the covered time range so the
 * model knows the window.
 */
export function formatCollectionForPrompt(cache: CuboxCache, end: Date, days: number): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1), 0, 0, 0, 0)
  const startKey = start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate())
  const endKey = end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate())
  const inWindow = (iso: string): boolean => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return false
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
  }
  const cards = cache.cards.filter((c) => inWindow(c.create_time)).sort((a, b) => b.create_time.localeCompare(a.create_time))
  const lines: string[] = []
  lines.push('收藏时间范围：' + (days === 1 ? endKey : startKey + ' 至 ' + endKey) + '（共 ' + cards.length + ' 条）')
  if (cards.length === 0) {
    lines.push('（该时间段内没有新收藏）')
    return lines.join('\n')
  }
  for (const [index, card] of cards.entries()) {
    const title = (card.title || card.article_title || card.url).trim()
    const domain = (() => { try { return new URL(card.url).hostname.replace(/^www\./, '') } catch { return card.domain ?? '' } })()
    const description = (card.description || '').trim()
    const annotationText = cardAnnotationLines(card, cache.annotations)
    lines.push((index + 1) + '. ' + title + '（来源：' + (domain || '未知') + '）')
    if (card.url !== '') lines.push('   链接：' + card.url)
    if (description !== '') lines.push('   摘要：' + description)
    if (annotationText.length > 0) {
      lines.push('   标注：')
      for (const a of annotationText.slice(0, 5)) lines.push('   - ' + a)
    }
  }
  void pad
  return lines.join('\n')
}

/**
 * Generate the brief from the user's prompt and write it to the output dir.
 * File name reflects the window: 今日收藏简报-YYYY-MM-DD.md for days=1,
 * 最近N日收藏简报-YYYY-MM-DD.md for days>1 (so a 7-day sync writes its own
 * file instead of overwriting today's).
 */
export async function writeDailyBrief(
  cache: CuboxCache,
  outputDir: string,
  llm: LlmConfig & { prompt: string },
  opts: { days?: number } = {},
): Promise<string> {
  const days = typeof opts.days === 'number' && opts.days > 0 ? Math.floor(opts.days) : 1
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const dateKey = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  const collection = formatCollectionForPrompt(cache, now, days)
  const user = llm.prompt.includes('{collection}')
    ? llm.prompt.replaceAll('{collection}', collection)
    : llm.prompt + '\n\n【收藏列表】\n' + collection
  const content = await chatComplete(
    { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
    '你是一个信息整理助手。严格按用户的 prompt 要求输出，直接输出内容本身，不要任何引导语。',
    user,
  )
  const prefix = days === 1 ? '今日收藏简报' : '最近' + days + '日收藏简报'
  const filePath = path.join(outputDir, prefix + '-' + dateKey + '.md')
  await mkdir(outputDir, { recursive: true })
  await writeFile(filePath, content + '\n')
  return filePath
}

/** Machine-wide per-day ledger for the brief push (JSON map date → content hash, 0600). */
export const DEFAULT_BRIEF_LEDGER_FILE = pluginPath(undefined, '.cubox-flomo-brief-sent')

/** Ledger location: DSH_CUBOX_BRIEF_LEDGER → DSH_HOME → ~/.dsh. */
export function briefLedgerPath(): string {
  return pluginPath(process.env.DSH_CUBOX_BRIEF_LEDGER, '.cubox-flomo-brief-sent')
}

/** Ledger shape: local date key (YYYY-MM-DD) → hash of what was pushed. */
type BriefLedger = Record<string, string>

/** Read the brief-push ledger (missing/unreadable → empty). */
async function readBriefLedger(): Promise<BriefLedger> {
  try {
    const raw = await readFile(briefLedgerPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: BriefLedger = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Write the brief-push ledger (mode 0600). */
async function writeBriefLedger(ledger: BriefLedger): Promise<void> {
  await mkdir(path.dirname(briefLedgerPath()), { recursive: true })
  await writeFile(briefLedgerPath(), JSON.stringify(ledger, null, 2), { mode: 0o600 })
}

/** Outcome of one daily-brief push attempt. */
export interface BriefPushResult {
  ok: boolean
  /** True when a gate (time / no cards / already pushed / disabled) skipped the push. */
  skipped: boolean
  memos: number
  delivered: number
  message: string
}

/** Local date key (YYYY-MM-DD) in the host timezone. */
function briefDateKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** Short content hash recorded in the ledger. */
function briefHash(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 16)
}

/**
 * Push the day's collection brief (the LLM brief already written to outputDir)
 * to flomo. Separate from the annotation digest: this is the "collected
 * something today → there is a daily report" path, so days without highlights
 * still get one.
 *
 * At most one push per local day — gates in order: enabled → a brief file
 * exists → the hour gate (briefFlomoHour, 0 = no gate) → the day actually has
 * cards → the per-day ledger. A skipped gate is a normal outcome, not an
 * error, so a 120-minute sync loop stays quiet.
 */
export async function deliverDailyBrief(
  cache: CuboxCache,
  config: CuboxCredentials,
  briefPath: string,
  opts: { now?: Date; force?: boolean } = {},
): Promise<BriefPushResult> {
  const now = opts.now ?? new Date()
  const skip = (message: string): BriefPushResult => ({ ok: true, skipped: true, memos: 0, delivered: 0, message })

  if (!config.briefFlomoEnabled) return skip('未开启「每日简报推送」（briefFlomoEnabled=false）。')
  if (briefPath === '') return skip('今日未生成简报（需要配置输出目录与 LLM）。')
  if (opts.force !== true && config.briefFlomoHour > 0 && now.getHours() < config.briefFlomoHour) {
    return skip('未到推送时间（' + config.briefFlomoHour + ':00 之后才推，避免推半截简报）。')
  }

  const key = briefDateKey(now)
  const todayCards = cache.cards.filter((c) => (c.create_time ?? '').slice(0, 10) === key)
  if (todayCards.length === 0) return skip('今日没有收藏，不推简报。')

  const ledger = await readBriefLedger()
  if (opts.force !== true && ledger[key] !== undefined) return skip('今日简报已推送过（每天一条）。')

  let content = ''
  try {
    content = await readFile(briefPath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      memos: 0,
      delivered: 0,
      message: '读取简报文件失败：' + String(error instanceof Error ? error.message : error),
    }
  }
  if (content.trim() === '') return skip('简报内容为空，不推。')

  const url = await resolveFlomoUrl()
  if (url === null) {
    return {
      ok: false,
      skipped: false,
      memos: 0,
      delivered: 0,
      message: 'flomo 未配置：请在设置面板「Flomo」区填写 API URL / API Key。',
    }
  }

  const tag = config.flomoTag
  const memos = chunkText(content, FLOMO_MAX_CHARS, '📥 Cubox 收藏简报 · ' + key)
  let sent = 0
  for (const memo of memos) {
    let result: { ok: boolean } = { ok: false }
    try {
      // buildTaggedContent escapes every ASCII '#' — flomo would turn them into tags.
      result = await postMemo(url, buildTaggedContent(memo, tag))
    } catch {
      result = { ok: false }
    }
    if (result.ok) sent += 1
  }
  if (sent === 0) {
    return {
      ok: false,
      skipped: false,
      memos: memos.length,
      delivered: 0,
      message: 'flomo 推送失败：' + memos.length + ' 条 MEMO 全部失败（下次同步会重试）。',
    }
  }
  ledger[key] = briefHash(content)
  await writeBriefLedger(ledger)
  return {
    ok: true,
    skipped: false,
    memos: memos.length,
    delivered: sent,
    message: '已推送今日收藏简报（' + todayCards.length + ' 条收藏）到 flomo（#' + tag + '）：' + sent + ' 条 MEMO。',
  }
}

/** Local time in the Cubox API layout (no tz-aware dependency). */
function formatLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    '.000' + tzOffset(date)
  )
}

/** ±HHmm offset for a date. */
function tzOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return sign + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0')
}

/**
 * Write one markdown file per card into the output directory. Card files
 * mirror the official Cubox Obsidian plugin layout (frontmatter with
 * id/cubox_url/url/tags + title + description + links + annotations).
 * Only today's cards are written (older ones were already exported).
 * Returns the number of files written.
 */
export async function exportSyncToMarkdown(cache: CuboxCache, outputDir: string): Promise<number> {
  await mkdir(outputDir, { recursive: true })
  const today = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')

  let written = 0
  // One file per card (only today's cards — older ones already exported).
  for (const card of cache.cards) {
    const created = new Date(card.create_time)
    if (Number.isNaN(created.getTime())) continue
    if (created.getFullYear() !== today.getFullYear() || created.getMonth() !== today.getMonth() || created.getDate() !== today.getDate()) continue

    const title = (card.title || card.article_title || '未命名收藏').trim()
    const safeName = sanitizeFilename(title)
    const dateKey = created.getFullYear() + '-' + pad(created.getMonth() + 1) + '-' + pad(created.getDate())
    const filePath = path.join(outputDir, safeName + '-' + dateKey + '.md')
    const cardAnnotations = cache.annotations.filter((a) => a.card_id === card.id)

    const parts: string[] = []
    parts.push('---')
    parts.push('id: "' + card.id + '"')
    parts.push('cubox_url: https://cubox.pro/web/card/' + card.id)
    if (card.url !== '') parts.push('url: ' + card.url)
    const tags = Array.isArray(card.tags) && card.tags.length > 0 ? card.tags : []
    parts.push('tags: [' + tags.join(', ') + ']')
    parts.push('---')
    parts.push('')
    parts.push('# ' + title)
    parts.push('')
    if (card.description !== '') {
      parts.push(card.description.trim())
      parts.push('')
    }
    if (card.url !== '') {
      parts.push('[Read in Cubox](https://cubox.pro/web/card/' + card.id + ')  ')
      parts.push('[Read Original](' + card.url + ')  ')
      parts.push('')
      parts.push('---')
      parts.push('')
    }
    if (cardAnnotations.length > 0) {
      parts.push('## 标注')
      parts.push('')
      for (const a of cardAnnotations) {
        if (a.text !== '') parts.push('- > ' + a.text.trim().replace(/\n/g, ' '))
        if (a.note !== '') parts.push('  - 笔记：' + a.note.trim().replace(/\n/g, ' '))
        if (a.color !== '') parts.push('  - 颜色：' + a.color)
      }
      parts.push('')
    }
    await writeFile(filePath, parts.join('\n'))
    written += 1
  }

  return written
}

/** Strip characters that are illegal in filenames; cap the length. */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? '未命名收藏' : cleaned.slice(0, 80)
}
