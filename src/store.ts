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
}

/** Public, secret-free status view. */
export interface CuboxConfigView {
  configured: boolean
  server: CuboxServer
  tokenMasked: string
  syncMinutes: number
  lastSyncAt: string
  outputDir: string
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
  return { server: 'cubox.pro', token: '', syncMinutes: 60, lastSyncAt: '', outputDir: '' }
}

/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw: unknown): CuboxCredentials {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const server = record.server === 'cubox.cc' ? 'cubox.cc' : 'cubox.pro'
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 60)
  return {
    server,
    token: str(record.token),
    syncMinutes: num(record.syncMinutes),
    lastSyncAt: str(record.lastSyncAt),
    outputDir: str(record.outputDir),
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
      configPath: configPath(),
    }
  }

  /**
   * Apply a config patch: apiLink (parse into server+token) / server / token
   * / syncMinutes / outputDir replace, reset clears. Returns the public view.
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
    await this.save(next)
    return this.view()
  }
}
