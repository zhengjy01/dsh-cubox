/**
 * dsh-cubox — Cubox internal API client (/c/api/cli).
 *
 * The public Cubox "open API" only accepts saves; reads go through the
 * internal /c/api/cli/* family used by the official cubox-cli (reverse
 * engineered from OLCUBO/cubox-cli). Covered surface:
 *
 *   GET  /c/api/cli/folder/list              list folders
 *   GET  /c/api/cli/tag/list                 list tags
 *   POST /c/api/cli/card/filter              filter cards (folder/tag/time/…)
 *   GET  /c/api/cli/card/detail?id=          full card detail (content, annotations, insight)
 *   POST /c/api/cli/card/rag/query           semantic search
 *   POST /c/api/cli/annotation/filter        filter annotations/notes
 *
 * Every call carries `Authorization: Bearer <token>`; the response is
 * wrapped as { code, message, data } and code != 200 is an error.
 * Time parameters use the Cubox API layout `YYYY-MM-DDTHH:mm:ss.SSS±HHmm`.
 */

import type { CuboxCredentials, CuboxStore } from './store.ts'

/** Request timeout for API calls. */
const REQUEST_TIMEOUT_MS = 30000

/** API error carrying the server code/message. */
export class CuboxApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'CuboxApiError'
    this.code = code
  }
}

/** One Cubox folder. */
export interface CuboxFolder {
  id: string
  nested_name: string
  name: string
  parent_id: string | null
  uncategorized?: boolean
}

/** One Cubox tag. */
export interface CuboxTag {
  id: string
  nested_name: string
  name: string
  parent_id: string | null
}

/** One annotation (highlight) or note attached to a card. */
export interface CuboxAnnotation {
  id: string
  text: string
  note: string
  image_url: string
  color: string
  card_id: string
  create_time: string
  update_time: string
}

/** Card shape from the card/filter list endpoint. */
export interface CuboxCard {
  id: string
  title: string
  description: string
  article_title: string
  domain: string
  read: boolean
  starred: boolean
  tags: string[]
  folder: CuboxFolder | null
  url: string
  create_time: string
  update_time: string
}

/** AI insight on a card (summary + Q&A). */
export interface CuboxInsight {
  id: string
  summary: string
  qas: Array<{ q: string; a: string }>
  create_time: string
  update_time: string
}

/** Full card detail. */
export interface CuboxCardDetail extends CuboxCard {
  content: string
  author: string
  annotations: CuboxAnnotation[]
  insight: CuboxInsight | null
}

/** card/filter request. */
export interface CuboxCardFilter {
  folder_filters?: string[]
  tag_filters?: string[]
  starred?: boolean
  read?: boolean
  annotated?: boolean
  archived?: boolean
  last_card_id?: string
  limit?: number
  keyword?: string
  page?: number
  start_time?: string
  end_time?: string
}

/** annotation/filter request. */
export interface CuboxAnnotationFilter {
  colors?: string[]
  last_annotation_id?: string
  limit?: number
  keyword?: string
  start_time?: string
  end_time?: string
}

/** Wrapped API response. */
interface ApiEnvelope {
  code: number
  message: string
  data: unknown
}

/** Minimal fetch-compatible response contract used by tests. */
export interface FetchLikeResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

/** Minimal fetch-compatible global (Node 22+ global fetch already matches). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<FetchLikeResponse>

/** Format a Date into the Cubox API time layout YYYY-MM-DDTHH:mm:ss.SSS±HHmm. */
export function formatApiTime(date: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const off = sign + pad(Math.floor(abs / 60)) + pad(abs % 60)
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    '.' + pad(date.getMilliseconds(), 3) + off
  )
}

/** Local start-of-day and end-of-day in API format (for "today" ranges). */
export function todayRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return { start: formatApiTime(start), end: formatApiTime(end) }
}

/**
 * Thin API client bound to one credential store. Stateless besides the
 * store; every call reads the freshest credentials before sending.
 */
export class CuboxApi {
  constructor(
    private readonly store: CuboxStore,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  /** Base URL for the stored server. */
  private async baseUrl(): Promise<string> {
    const cfg = await this.store.load()
    return 'https://' + cfg.server + '/c/api/cli'
  }

  /** GET a path with query params, unwrapping the envelope. */
  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const cfg = await this.store.load()
    const url = new URL((await this.baseUrl()) + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, value)
    }
    return this.request(url, cfg)
  }

  /** POST a JSON body, unwrapping the envelope. */
  private async post(path: string, body: unknown): Promise<unknown> {
    const cfg = await this.store.load()
    return this.request((await this.baseUrl()) + path, cfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  }

  /** Perform one request and unwrap the { code, message, data } envelope. */
  private async request(input: string | URL, cfg: CuboxCredentials, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(input, {
        ...init,
        headers: { Authorization: 'Bearer ' + cfg.token, ...(init?.headers ?? {}) },
        signal: controller.signal,
      } as RequestInit)
      const textBody = await response.text()
      let envelope: ApiEnvelope
      try {
        envelope = JSON.parse(textBody) as ApiEnvelope
      } catch {
        throw new CuboxApiError(response.status, 'Cubox 返回非 JSON 响应（HTTP ' + response.status + '）：' + textBody.slice(0, 200))
      }
      if (typeof envelope.code !== 'number' || envelope.code !== 200) {
        const message = typeof envelope.message === 'string' && envelope.message !== '' ? envelope.message : 'HTTP ' + response.status
        throw new CuboxApiError(typeof envelope.code === 'number' ? envelope.code : response.status, message)
      }
      return envelope.data
    } catch (error) {
      if (error instanceof CuboxApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CuboxApiError(0, '请求超时（' + REQUEST_TIMEOUT_MS + 'ms）')
      }
      throw new CuboxApiError(0, '网络请求失败：' + String(error instanceof Error ? error.message : error))
    } finally {
      clearTimeout(timer)
    }
  }

  /** List folders. */
  async listFolders(): Promise<CuboxFolder[]> {
    const data = await this.get('/folder/list')
    return Array.isArray(data) ? data as CuboxFolder[] : []
  }

  /** List tags. */
  async listTags(): Promise<CuboxTag[]> {
    const data = await this.get('/tag/list')
    return Array.isArray(data) ? data as CuboxTag[] : []
  }

  /** Filter cards (bookmarks). */
  async filterCards(filter: CuboxCardFilter): Promise<CuboxCard[]> {
    const data = await this.post('/card/filter', filter)
    return Array.isArray(data) ? data as CuboxCard[] : []
  }

  /** Full card detail (content, annotations, insight). */
  async cardDetail(id: string): Promise<CuboxCardDetail> {
    const data = await this.get('/card/detail', { id })
    if (typeof data !== 'object' || data === null) throw new CuboxApiError(0, 'card/detail 返回了空数据')
    return data as CuboxCardDetail
  }

  /** Filter annotations (highlights + notes) across cards. */
  async filterAnnotations(filter: CuboxAnnotationFilter): Promise<CuboxAnnotation[]> {
    const data = await this.post('/annotation/filter', filter)
    return Array.isArray(data) ? data as CuboxAnnotation[] : []
  }

  /** Semantic RAG search over cards. */
  async ragQuery(query: string): Promise<CuboxCard[]> {
    const data = await this.post('/card/rag/query', { query })
    return Array.isArray(data) ? data as CuboxCard[] : []
  }
}
