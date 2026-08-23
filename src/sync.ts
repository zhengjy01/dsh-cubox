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
  opts: { days?: number; limit?: number } = {},
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
  let cards: CuboxCard[] = []
  try {
    cards = await api.filterCards({ start_time: cardStart, end_time: cardEnd, limit })
  } catch {
    // Fall back to a plain latest-card pull when the time filter is rejected.
    cards = await api.filterCards({ limit })
  }

  // Annotation window: today's full range.
  const range = todayRange()
  let annotations: CuboxAnnotation[] = []
  try {
    annotations = await api.filterAnnotations({ start_time: range.start, end_time: range.end, limit: 500 })
  } catch {
    annotations = []
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

  const message =
    '同步完成：拉取卡片 ' + cards.length + ' 条、标注 ' + annotations.length + ' 条；' +
    '缓存现有卡片 ' + mergedCards.length + ' 条、标注 ' + mergedAnnotations.length + ' 条。'
  return {
    ok: true,
    message,
    pulledCards: cards.length,
    pulledAnnotations: annotations.length,
    cachedCards: mergedCards.length,
    cachedAnnotations: mergedAnnotations.length,
    since: cardStart,
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

/** Domain of a card URL, or '' when unparsable. */
export function cardDomain(card: CuboxCard): string {
  try {
    return new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    return card.domain ?? ''
  }
}

/**
 * Build a markdown outline of a date's collection (default: today) from the
 * cached cards. Sections: overview stats, then per-card entries with title,
 * source, URL, description, tags, and annotation count.
 */
export function buildDailyOutline(cards: CuboxCard[], annotations: CuboxAnnotation[], dateLabel: string): string {
  const lines: string[] = []
  lines.push('# ' + dateLabel + ' 收藏总结大纲')
  lines.push('')
  lines.push('- 收藏 ' + cards.length + ' 条 · 标注 ' + annotations.length + ' 条')
  if (cards.length === 0) {
    lines.push('')
    lines.push('今天还没有新收藏。')
    return lines.join('\n')
  }
  lines.push('')
  lines.push('## 收藏概览')
  lines.push('')
  const domains = new Map<string, number>()
  for (const card of cards) {
    const d = cardDomain(card)
    domains.set(d, (domains.get(d) ?? 0) + 1)
  }
  for (const [domain, count] of [...domains.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push('- **' + (domain || '其他') + '**：' + count + ' 条')
  }
  lines.push('')
  lines.push('## 收藏明细')
  lines.push('')
  for (const card of cards) {
    const title = card.title || card.article_title || card.url
    lines.push('### ' + title)
    lines.push('')
    lines.push('- 来源：' + (cardDomain(card) || '未知'))
    if (card.url !== '') lines.push('- 链接：' + card.url)
    if (card.description !== '') lines.push('- 描述：' + card.description.trim())
    if (card.tags !== undefined && card.tags.length > 0) lines.push('- 标签：' + card.tags.join('、'))
    const cardAnnotations = annotations.filter((a) => a.card_id === card.id)
    if (cardAnnotations.length > 0) {
      lines.push('- 标注 ' + cardAnnotations.length + ' 条：')
      for (const a of cardAnnotations.slice(0, 5)) {
        const parts: string[] = []
        const highlight = (a.text || '').trim().replace(/\s+/g, ' ')
        const note = (a.note || '').trim().replace(/\s+/g, ' ')
        if (highlight !== '') parts.push(highlight)
        if (note !== '') parts.push('笔记：' + note)
        if (parts.length === 0) parts.push('（无文本内容）')
        const snippet = parts.join(' ｜ ')
        lines.push('  - ' + snippet.slice(0, 140) + (snippet.length > 140 ? '…' : ''))
      }
      if (cardAnnotations.length > 5) lines.push('  - …（其余 ' + (cardAnnotations.length - 5) + ' 条见缓存）')
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Aggregate annotations into a markdown summary grouped by card title.
 * Each entry: source card, the annotation text and its note, color, time.
 */
export function buildAnnotationsSummary(
  annotations: CuboxAnnotation[],
  cardTitleById: Map<string, string>,
): string {
  if (annotations.length === 0) return '（没有符合条件的标注/笔记）'
  const byCard = new Map<string, CuboxAnnotation[]>()
  for (const a of annotations) {
    const list = byCard.get(a.card_id) ?? []
    list.push(a)
    byCard.set(a.card_id, list)
  }
  const lines: string[] = ['共 ' + annotations.length + ' 条标注/笔记：', '']
  for (const [cardId, list] of byCard) {
    const title = cardTitleById.get(cardId) ?? cardId
    lines.push('### ' + title)
    lines.push('')
    for (const a of list) {
      const parts: string[] = []
      if (a.text !== '') parts.push('高亮：' + a.text.trim())
      if (a.note !== '') parts.push('笔记：' + a.note.trim())
      if (parts.length === 0) parts.push('（无文本内容）')
      lines.push('- ' + parts.join(' ｜ '))
      if (a.color !== '') lines.push('  - 颜色：' + a.color)
      if (a.create_time !== '') lines.push('  - 时间：' + a.create_time)
    }
    lines.push('')
  }
  return lines.join('\n')
}
