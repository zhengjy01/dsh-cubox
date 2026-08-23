/**
 * dsh-cubox — core sync/business logic.
 *
 * doSync pulls cards (and optionally today's annotations) from the Cubox
 * API and persists a snapshot to ~/.dsh/dsh-cubox-cache.json so agents can
 * answer "what did I save today" without another round trip. buildTodayOutline
 * renders today's collection into a markdown outline (title + source +
 * description + annotation summary); buildAnnotationsSummary aggregates
 * highlights/notes across cards.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { CuboxApi, CuboxCard, CuboxAnnotation } from './api.ts'
import { todayRange } from './api.ts'
import type { CuboxStore } from './store.ts'
import { cachePath } from './store.ts'

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

  // Markdown export to the configured output dir ('' = disabled). Export
  // failures degrade gracefully — the snapshot is already saved.
  const outputDir = typeof opts.outputDir === 'string' ? opts.outputDir : (await store.load()).outputDir
  let exportedFiles = 0
  if (outputDir.trim() !== '') {
    try {
      exportedFiles = await exportSyncToMarkdown(cache, outputDir.trim())
    } catch (exportError) {
      warnings.push('导出 Markdown 失败：' + String(exportError instanceof Error ? exportError.message : exportError))
    }
  }

  const message =
    '同步完成：拉取卡片 ' + cards.length + ' 条、标注 ' + annotations.length + ' 条；' +
    '缓存现有卡片 ' + mergedCards.length + ' 条、标注 ' + mergedAnnotations.length + ' 条。' +
    (exportedFiles > 0 ? '已导出 ' + exportedFiles + ' 个 Markdown 文件到 ' + outputDir.trim() : '') +
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
