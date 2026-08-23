/**
 * dsh-cubox — credential/cache store.
 *
 * Persists the Cubox API-extension credentials to ~/.dsh/dsh-cubox.json
 * (mode 0600) and the latest sync snapshot to ~/.dsh/dsh-cubox-cache.json.
 * The config file holds the API-extension link (or its server + token) plus
 * the scheduled-sync interval. Reads are lazy and cached; the public view()
 * never exposes secrets. Config paths can be overridden with DSH_CUBOX_CONFIG
 * / DSH_CUBOX_CACHE (used by the smoke tests).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default machine-wide config location (mode 0600). */
export const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-cubox.json')

/** Default sync cache location (mode 0600). */
export const DEFAULT_CACHE_FILE = path.join(homedir(), '.dsh', 'dsh-cubox-cache.json')

/** Test override for the config location. */
export function configPath(): string {
  const override = process.env.DSH_CUBOX_CONFIG
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_FILE
}

/** Test override for the cache location. */
export function cachePath(): string {
  const override = process.env.DSH_CUBOX_CACHE
  return override !== undefined && override !== '' ? override : DEFAULT_CACHE_FILE
}

/** Cubox server instances. */
export type CuboxServer = 'cubox.pro' | 'cubox.cc'

export const SERVER_LABEL: Record<CuboxServer, string> = {
  'cubox.pro': 'Cubox（cubox.pro，国内）',
  'cubox.cc': 'Cubox（cubox.cc，国际版）',
}

/** Persisted credential shape. Secrets never leave this module. */
export interface CuboxCredentials {
  /** cubox.pro (default) or cubox.cc. */
  server: CuboxServer
  /** API-extension token (the last path segment of the API link). */
  token: string
  /** Scheduled sync interval in minutes; 0 disables the timer. */
  syncMinutes: number
  /** ISO timestamp of the last successful sync. */
  lastSyncAt: string
  /** Local directory for markdown export on sync ('' = no export). */
  outputDir: string
  /** Whether to write one markdown file per card on sync (default true). */
  exportCards: boolean
  /** LLM base URL (OpenAI-compatible). */
  llmBaseUrl: string
  /** LLM API key. */
  llmApiKey: string
  /** LLM model name. */
  llmModel: string
  /** Prompt template for the daily brief; {collection} is replaced with the formatted collection. */
  llmPrompt: string
}

/** Default prompt for the daily collection brief. */
export const DEFAULT_LLM_PROMPT =
  '你是一个信息整理助手。请根据以下我今日收藏的内容列表，生成一份"今日收藏简报"。\n' +
  '\n' +
  '【今日收藏列表】\n' +
  '{collection}\n' +
  '\n' +
  '请按以下要求输出纯文本简报（不要用markdown符号，不要加粗，不要列表符号，只用自然段落和换行）：\n' +
  '\n' +
  '1. 摘要总结：用3-5句话概括今天收藏的整体主题和覆盖范围。\n' +
  '2. 突出重点：按重要性从高到低，列出今日最值得关注的3条内容。每条单独一段，格式为"重点一：xxx。理由：xxx。"\n' +
  '3. 原文链接：每条重点的段落末尾必须附上该条收藏的完整原文链接，格式为"原文链接：<URL>"。链接必须取自上面收藏列表中该条目的"链接："字段，不得编造、不得省略；原文链接不计入下面的字数限制。\n' +
  '4. 分类概览：按类型（如技术文章/行业资讯/生活灵感/工具资源）统计数量分布，用一句话说清楚，例如"今日共收藏X条，其中技术类X条，资讯类X条，生活类X条。"\n' +
  '5. 总字数控制在300字以内（不含原文链接），语言精炼，一目了然。不要出现"根据提供的列表"、"以下是"之类的引导语，直接输出内容本身。'

/** Public, secret-free status view. */
export interface CuboxConfigView {
  configured: boolean
  server: CuboxServer
  tokenMasked: string
  syncMinutes: number
  lastSyncAt: string
  outputDir: string
  exportCards: boolean
  llmBaseUrl: string
  llmModel: string
  llmKeyMasked: string
  llmPrompt: string
  configPath: string
}

/** Mask a credential for display, keeping only the head and tail. */
export function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value.slice(0, 2) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/**
 * Parse an API-extension link into { server, token }. The link looks like
 * https://cubox.pro/c/api/save/abcd12345 — server from the host, token from
 * the last path segment. Accepts bare tokens too (default server cubox.pro).
 */
export function parseApiLink(input: string): { server: CuboxServer; token: string } | null {
  const value = (input ?? '').trim()
  if (value === '') return null
  if (!value.includes('/')) {
    return { server: 'cubox.pro', token: value }
  }
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host.endsWith('cubox.cc')) return { server: 'cubox.cc', token: lastSegment(url.pathname) }
    if (host.endsWith('cubox.pro')) return { server: 'cubox.pro', token: lastSegment(url.pathname) }
    return null
  } catch {
    return null
  }
}

/** Last non-empty path segment. */
function lastSegment(pathname: string): string {
  const parts = pathname.split('/').filter((p) => p !== '')
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : ''
}

/** Empty credentials record. */
function empty(): CuboxCredentials {
  return {
    server: 'cubox.pro',
    token: '',
    syncMinutes: 60,
    lastSyncAt: '',
    outputDir: '',
    exportCards: true,
    llmBaseUrl: 'https://api.deepseek.com/v1',
    llmApiKey: '',
    llmModel: 'deepseek-chat',
    llmPrompt: DEFAULT_LLM_PROMPT,
  }
}

/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw: unknown): CuboxCredentials {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const server = record.server === 'cubox.cc' ? 'cubox.cc' : 'cubox.pro'
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 60)
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
  return {
    server,
    token: str(record.token),
    syncMinutes: num(record.syncMinutes),
    lastSyncAt: str(record.lastSyncAt),
    outputDir: str(record.outputDir),
    exportCards: bool(record.exportCards, true),
    llmBaseUrl: str(record.llmBaseUrl) || 'https://api.deepseek.com/v1',
    llmApiKey: str(record.llmApiKey),
    llmModel: str(record.llmModel) || 'deepseek-chat',
    llmPrompt: str(record.llmPrompt) || DEFAULT_LLM_PROMPT,
  }
}

/**
 * Small credential store backed by ~/.dsh/dsh-cubox.json.
 * Reads are lazy and cached; writes use mode 0600 so the API token never
 * leaks to other local users.
 */
export class CuboxStore {
  config: CuboxCredentials | null = null

  async load(): Promise<CuboxCredentials> {
    if (this.config !== null) return this.config
    try {
      const raw = await readFile(configPath(), 'utf8')
      this.config = parse(JSON.parse(raw))
    } catch {
      // Missing or unreadable config file: treat as unconfigured.
      this.config = empty()
    }
    return this.config
  }

  async save(next: CuboxCredentials): Promise<void> {
    this.config = next
    await mkdir(path.dirname(configPath()), { recursive: true })
    await writeFile(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
  }

  /** Public, secret-free view. */
  async view(): Promise<CuboxConfigView> {
    const cfg = await this.load()
    return {
      configured: cfg.token.trim() !== '',
      server: cfg.server,
      tokenMasked: cfg.token.trim() !== '' ? mask(cfg.token) : '',
      syncMinutes: cfg.syncMinutes,
      lastSyncAt: cfg.lastSyncAt,
      outputDir: cfg.outputDir,
      exportCards: cfg.exportCards,
      llmBaseUrl: cfg.llmBaseUrl,
      llmModel: cfg.llmModel,
      llmKeyMasked: cfg.llmApiKey.trim() !== '' ? mask(cfg.llmApiKey) : '',
      llmPrompt: cfg.llmPrompt,
      configPath: configPath(),
    }
  }

  /**
   * Apply a config patch: apiLink (parse into server+token) / server / token
   * / syncMinutes / outputDir / exportCards / LLM fields replace, reset clears.
   * Returns the public view.
   */
  async patch(args: Record<string, unknown> | undefined): Promise<CuboxConfigView> {
    const cfg = await this.load()
    let next: CuboxCredentials = { ...cfg }
    if (args !== undefined && args.reset === true) {
      next = { ...empty(), syncMinutes: cfg.syncMinutes }
    }
    if (args !== undefined && typeof args.apiLink === 'string' && args.apiLink.trim() !== '') {
      const parsed = parseApiLink(args.apiLink)
      if (parsed !== null) {
        next.server = parsed.server
        next.token = parsed.token
      }
    }
    if (args !== undefined && typeof args.token === 'string') next.token = args.token.trim()
    if (args !== undefined && typeof args.server === 'string') {
      next.server = args.server === 'cubox.cc' ? 'cubox.cc' : 'cubox.pro'
    }
    if (args !== undefined && typeof args.syncMinutes === 'number' && Number.isFinite(args.syncMinutes)) {
      next.syncMinutes = Math.max(0, Math.floor(args.syncMinutes))
    }
    if (args !== undefined && typeof args.outputDir === 'string') next.outputDir = args.outputDir.trim()
    if (args !== undefined && typeof args.exportCards === 'boolean') next.exportCards = args.exportCards
    if (args !== undefined && typeof args.llmBaseUrl === 'string') next.llmBaseUrl = args.llmBaseUrl.trim()
    if (args !== undefined && typeof args.llmApiKey === 'string') next.llmApiKey = args.llmApiKey.trim()
    if (args !== undefined && typeof args.llmModel === 'string') next.llmModel = args.llmModel.trim()
    if (args !== undefined && typeof args.llmPrompt === 'string') next.llmPrompt = args.llmPrompt
    await this.save(next)
    return this.view()
  }
}
