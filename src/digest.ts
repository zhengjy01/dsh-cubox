/**
 * dsh-cubox — annotation digest export with a local dedup ledger.
 *
 * After `doSync` merges the cache, newly created / changed annotations are
 * collected and delivered as one daily digest (card title + link +
 * highlights/notes), auto-split across flomo memos when long. flomo is a
 * write-only sink (no query/update/delete), so a local ledger records every
 * annotation id + content hash that has been pushed — otherwise every sync
 * would re-send the same notes. The ledger mirrors the daily-report pattern
 * (~/.dsh/.flomo-daily-report-sent).
 *
 * Delivery targets: flomo (default) / local markdown / Notion page. The
 * configured LLM may rewrite the digest first (usePrompt + exportPrompt).
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { CuboxAnnotation, CuboxCard } from './api.ts'
import type { CuboxCache } from './sync.ts'
import type { CuboxCredentials, ExportDest } from './store.ts'
import { pluginPath } from './home.ts'
import { chatComplete, llmConfigured } from './llm.ts'
import { buildTaggedContent, postMemo, resolveFlomoUrl } from './flomo.ts'
import { exportToNotion } from './notion.ts'

/** Safe per-memo size cap (flomo does not document a hard limit). */
export const FLOMO_MAX_CHARS = 1800

/** Default look-back window (days) for eligible annotations. */
export const DEFAULT_DIGEST_WINDOW_DAYS = 2

/** Machine-wide dedup ledger (JSON map id → content hash, mode 0600). */
export const DEFAULT_FLOMO_LEDGER_FILE = pluginPath(undefined, '.cubox-flomo-annotations-sent')

/** Ledger location: DSH_CUBOX_FLOMO_LEDGER → DSH_HOME → ~/.dsh. */
export function flomoLedgerPath(): string {
  return pluginPath(process.env.DSH_CUBOX_FLOMO_LEDGER, '.cubox-flomo-annotations-sent')
}

/** Dedup ledger shape: annotation id → content hash. */
export type FlomoLedger = Record<string, string>

/** Read the dedup ledger (never throws; missing file → empty). */
export async function readFlomoLedger(): Promise<FlomoLedger> {
  try {
    const raw = await readFile(flomoLedgerPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: FlomoLedger = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the dedup ledger (mode 0600). */
export async function writeFlomoLedger(ledger: FlomoLedger): Promise<void> {
  await mkdir(path.dirname(flomoLedgerPath()), { recursive: true })
  await writeFile(flomoLedgerPath(), JSON.stringify(ledger, null, 2), { mode: 0o600 })
}

/** Content hash: changes when text/note/update_time/color change. */
export function annotationHash(a: CuboxAnnotation): string {
  return createHash('sha1')
    .update([a.text ?? '', a.note ?? '', a.update_time ?? '', a.color ?? ''].join('\u0001'))
    .digest('hex')
    .slice(0, 16)
}

/** Parse the Cubox API time layout (also tolerates an ISO offset with colon). */
export function parseCuboxTime(value: string): number {
  const normalized = (value ?? '').trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const time = Date.parse(normalized)
  return Number.isNaN(time) ? 0 : time
}

/** Local YYYY-MM-DD. */
export function ymd(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** Collapse whitespace for one-line digest entries. */
function oneLine(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Card display title. */
function cardTitle(card: CuboxCard | undefined): string {
  if (card === undefined) return '未命名收藏'
  return (card.title || card.article_title || card.url || '未命名收藏').trim() || '未命名收藏'
}

/** Card link (original URL, falling back to the Cubox web card). */
function cardLink(card: CuboxCard | undefined, cardId: string): string {
  if (card !== undefined && card.url.trim() !== '') return card.url.trim()
  return 'https://cubox.pro/web/card/' + cardId
}

/** Digest header line. */
export function digestHeader(date: Date): string {
  return '📥 Cubox 标注 · ' + ymd(date)
}

/** Select unsent, settled annotations within the window. */
export function selectUnpushedAnnotations(
  cache: CuboxCache,
  opts: {
    ledger: FlomoLedger
    now?: Date
    windowDays?: number
    minAgeMinutes?: number
  },
): CuboxAnnotation[] {
  const now = opts.now ?? new Date()
  const windowDays = typeof opts.windowDays === 'number' && opts.windowDays > 0 ? Math.floor(opts.windowDays) : DEFAULT_DIGEST_WINDOW_DAYS
  const minAge = typeof opts.minAgeMinutes === 'number' && opts.minAgeMinutes >= 0 ? opts.minAgeMinutes : 60
  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const settledBefore = now.getTime() - minAge * 60 * 1000

  const out: CuboxAnnotation[] = []
  for (const a of cache.annotations) {
    const created = parseCuboxTime(a.create_time)
    if (created === 0) continue
    if (created < windowStart) continue
    if (created > settledBefore) continue
    if (opts.ledger[a.id] === annotationHash(a)) continue
    out.push(a)
  }
  return out.sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time))
}

/** One outgoing memo plus the annotation ids it carries (for ledger marking). */
export interface DigestMemo {
  content: string
  annotationIds: string[]
}

/**
 * Build the raw digest memos for a set of annotations: one daily digest,
 * auto-split by character count (never truncates). Each card contributes a
 * title + link header, then one block per annotation. Splits repeat the
 * digest header and the card header so every memo stays readable.
 */
export function buildDigestMemos(
  cache: CuboxCache,
  annotations: CuboxAnnotation[],
  opts: { date?: Date; maxChars?: number } = {},
): DigestMemo[] {
  const maxChars = typeof opts.maxChars === 'number' && opts.maxChars > 0 ? opts.maxChars : FLOMO_MAX_CHARS
  const date = opts.date ?? new Date()
  const firstHeader = digestHeader(date)
  const contHeader = firstHeader + '（续）'
  const cardById = new Map(cache.cards.map((c) => [c.id, c]))

  const order: string[] = []
  const groups = new Map<string, CuboxAnnotation[]>()
  const sorted = [...annotations].sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time))
  for (const a of sorted) {
    if (!groups.has(a.card_id)) {
      groups.set(a.card_id, [])
      order.push(a.card_id)
    }
    groups.get(a.card_id)?.push(a)
  }

  const memos: DigestMemo[] = []
  let lines: string[] = []
  let ids: string[] = []
  let len = 0
  let continued = false
  /** Card header of the card currently being emitted (re-added after a split). */
  let activeHeader: string[] | null = null

  const open = (): void => {
    lines = [continued ? contHeader : firstHeader]
    len = lines[0]?.length ?? 0
    if (activeHeader !== null) {
      for (const h of activeHeader) {
        lines.push(h)
        len += 1 + h.length
      }
    }
  }
  const flush = (): void => {
    if (ids.length > 0) {
      memos.push({ content: lines.join('\n'), annotationIds: [...ids] })
      continued = true
    }
    lines = []
    ids = []
    len = 0
  }
  const append = (line: string, id?: string): void => {
    if (lines.length === 0) open()
    if (len + 1 + line.length > maxChars && lines.length > 1) {
      flush()
      open()
    }
    lines.push(line)
    len += 1 + line.length
    if (id !== undefined) ids.push(id)
  }

  for (const cardId of order) {
    const card = cardById.get(cardId)
    const headerLines = ['《' + cardTitle(card) + '》', cardLink(card, cardId)]
    activeHeader = headerLines
    let headerInMemo = false
    for (const a of groups.get(cardId) ?? []) {
      const annLines: string[] = []
      const text = oneLine(a.text)
      const note = oneLine(a.note)
      if (text !== '') annLines.push('- 高亮：' + text)
      if (note !== '') annLines.push('  - 笔记：' + note)
      if (annLines.length === 0) continue

      if (!headerInMemo) {
        const headerLen = headerLines.reduce((n, l) => n + 1 + l.length, 0)
        const firstLen = 1 + (annLines[0]?.length ?? 0)
        if (lines.length > 0 && len + headerLen + firstLen > maxChars) flush()
        if (lines.length === 0) {
          // open() emits the digest header plus activeHeader.
          open()
        } else {
          for (const h of headerLines) {
            lines.push(h)
            len += 1 + h.length
          }
        }
        headerInMemo = true
      }
      for (let i = 0; i < annLines.length; i += 1) append(annLines[i] ?? '', i === 0 ? a.id : undefined)
    }
  }
  flush()
  return memos
}

/** Full digest markdown (no splitting) — for local files / Notion pages. */
export function buildDigestMarkdown(
  cache: CuboxCache,
  annotations: CuboxAnnotation[],
  opts: { date?: Date } = {},
): string {
  return buildDigestMemos(cache, annotations, { date: opts.date, maxChars: Number.MAX_SAFE_INTEGER })
    .map((m) => m.content)
    .join('\n\n')
}

/** Split arbitrary text into size-capped chunks with a repeated header. */
export function chunkText(text: string, maxChars: number, header: string): string[] {
  const memos: string[] = []
  let current = header
  for (const line of text.split('\n')) {
    if (current.length + 1 + line.length > maxChars && current !== header) {
      memos.push(current)
      current = header + '（续）'
    }
    current += '\n' + line
  }
  memos.push(current)
  return memos
}

/** Annotations inside the look-back window (for a full-day local/Notion digest). */
export function annotationsInWindow(cache: CuboxCache, now: Date, windowDays: number): CuboxAnnotation[] {
  const start = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  return cache.annotations
    .filter((a) => {
      const t = parseCuboxTime(a.create_time)
      return t !== 0 && t >= start
    })
    .sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time))
}

/** Delivery options for one digest run. */
export interface DigestOptions {
  now?: Date
  windowDays?: number
  minAgeMinutes?: number
  /** Bypass the minimum-age gate (manual push). */
  force?: boolean
  /** Override the configured flomo tag. */
  tag?: string
  /** Override the configured output dir (local target). */
  outputDir?: string
  /** Override the configured destination. */
  dest?: ExportDest
}

/** One digest delivery outcome. */
export interface DigestResult {
  ok: boolean
  dest: ExportDest
  candidates: number
  memos: number
  delivered: number
  message: string
}

/**
 * Collect unsent annotations and deliver them to the configured target.
 * The dedup ledger is updated per successfully delivered annotation, so a
 * partial failure retries only what did not make it.
 */
export async function deliverAnnotationDigest(
  cache: CuboxCache,
  config: CuboxCredentials,
  opts: DigestOptions = {},
): Promise<DigestResult> {
  const now = opts.now ?? new Date()
  const dest: ExportDest = opts.dest ?? config.exportDest
  const windowDays = typeof opts.windowDays === 'number' && opts.windowDays > 0 ? Math.floor(opts.windowDays) : DEFAULT_DIGEST_WINDOW_DAYS
  const minAge = opts.force === true
    ? 0
    : (typeof opts.minAgeMinutes === 'number' && opts.minAgeMinutes >= 0 ? opts.minAgeMinutes : config.flomoMinAgeMinutes)

  const ledger = await readFlomoLedger()
  const candidates = selectUnpushedAnnotations(cache, { ledger, now, windowDays, minAgeMinutes: minAge })
  if (candidates.length === 0) {
    return { ok: true, dest, candidates: 0, memos: 0, delivered: 0, message: '没有新的 Cubox 标注需要导出。' }
  }

  const byId = new Map(candidates.map((a) => [a.id, a]))
  let ledgerChanged = false
  const mark = (ids: string[]): void => {
    for (const id of ids) {
      const a = byId.get(id)
      if (a !== undefined) {
        ledger[id] = annotationHash(a)
        ledgerChanged = true
      }
    }
  }

  // Optional LLM rewrite of the digest before delivery.
  let processed: string | null = null
  if (config.usePrompt) {
    const llm = { baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel }
    if (!llmConfigured(llm)) {
      return {
        ok: false,
        dest,
        candidates: candidates.length,
        memos: 0,
        delivered: 0,
        message: '已启用 prompt 整理但 LLM 未配置：请在设置面板填写 LLM Key / Base URL / 模型，或关闭 prompt 开关。',
      }
    }
    const raw = buildDigestMarkdown(cache, candidates, { date: now })
    const template = (config.exportPrompt ?? '').trim()
    const user = template === ''
      ? raw
      : (template.includes('{digest}') ? template.replaceAll('{digest}', raw) : template + '\n\n' + raw)
    try {
      processed = await chatComplete(
        llm,
        '你是信息整理助手。严格按用户的 prompt 要求输出纯文本，直接输出内容本身，不要使用 # 号，不要添加任何标签。',
        user,
      )
    } catch (error) {
      return {
        ok: false,
        dest,
        candidates: candidates.length,
        memos: 0,
        delivered: 0,
        message: 'LLM 整理失败：' + String(error instanceof Error ? error.message : error),
      }
    }
  }

  // ------------------------------------------------------------- flomo
  if (dest === 'flomo') {
    const url = await resolveFlomoUrl()
    if (url === null) {
      return {
        ok: false,
        dest,
        candidates: candidates.length,
        memos: 0,
        delivered: 0,
        message: 'flomo 未配置：请在设置面板「flomo 标注同步」区填写 API URL / API Key（或先在「Flomo」面板配置），与 dsh-flomo 共享凭据。',
      }
    }
    const tag = (opts.tag ?? '').trim().replace(/^#+/, '') || config.flomoTag
    const outgoing: DigestMemo[] = processed !== null
      ? chunkText(processed, FLOMO_MAX_CHARS, digestHeader(now)).map((content) => ({ content, annotationIds: candidates.map((a) => a.id) }))
      : buildDigestMemos(cache, candidates, { date: now })
    let sent = 0
    let failed = 0
    for (const memo of outgoing) {
      let result: { ok: boolean }
      try {
        result = await postMemo(url, buildTaggedContent(memo.content, tag))
      } catch (error) {
        result = { ok: false }
        void error
      }
      if (result.ok) {
        sent += 1
        mark(memo.annotationIds)
      } else {
        failed += 1
      }
    }
    if (ledgerChanged) await writeFlomoLedger(ledger)
    const message = sent > 0
      ? '已推送 ' + candidates.length + ' 条标注到 flomo（#' + tag + '）：' + sent + ' 条 MEMO 发送成功' + (failed > 0 ? '，' + failed + ' 条失败（下次同步会重试）' : '') + '。'
      : 'flomo 推送失败：' + outgoing.length + ' 条 MEMO 全部失败。'
    return { ok: sent > 0 && failed === 0, dest, candidates: candidates.length, memos: outgoing.length, delivered: sent, message }
  }

  // ------------------------------------------------------------- local
  if (dest === 'local') {
    const dir = ((opts.outputDir ?? '').trim() || config.outputDir.trim())
    if (dir === '') {
      return { ok: false, dest, candidates: candidates.length, memos: 0, delivered: 0, message: '本地导出需要配置 outputDir（设置面板「本地导出目录」）。' }
    }
    const all = annotationsInWindow(cache, now, windowDays)
    const content = buildDigestMarkdown(cache, all.length > 0 ? all : candidates, { date: now })
    try {
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, 'Cubox标注-' + ymd(now) + '.md')
      await writeFile(file, content + '\n')
      mark(candidates.map((a) => a.id))
      await writeFlomoLedger(ledger)
      return { ok: true, dest, candidates: candidates.length, memos: 1, delivered: 1, message: '已写入标注 digest：' + file + '（' + candidates.length + ' 条新标注）' }
    } catch (error) {
      return { ok: false, dest, candidates: candidates.length, memos: 0, delivered: 0, message: '写入本地文件失败：' + String(error instanceof Error ? error.message : error) }
    }
  }

  // ------------------------------------------------------------ notion
  if (config.notionToken.trim() === '') {
    return { ok: false, dest, candidates: candidates.length, memos: 0, delivered: 0, message: 'Notion 未配置（跳过）：请填写 Integration Token。' }
  }
  if (config.notionTargetPageId.trim() === '') {
    return { ok: false, dest, candidates: candidates.length, memos: 0, delivered: 0, message: 'Notion 目标页面未配置（跳过）：请填写目标页面 URL 或 ID。' }
  }
  try {
    const content = buildDigestMarkdown(cache, candidates, { date: now })
    const pageId = await exportToNotion(config.notionToken, config.notionTargetPageId, 'Cubox 标注 ' + ymd(now), content)
    mark(candidates.map((a) => a.id))
    await writeFlomoLedger(ledger)
    return { ok: true, dest, candidates: candidates.length, memos: 1, delivered: 1, message: '已导出 ' + candidates.length + ' 条标注到 Notion：https://www.notion.so/' + pageId }
  } catch (error) {
    return { ok: false, dest, candidates: candidates.length, memos: 0, delivered: 0, message: 'Notion 导出失败：' + String(error instanceof Error ? error.message : error) }
  }
}
