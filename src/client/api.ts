/**
 * Browser-side API client for the /api/dsh-cubox route family. The only
 * data access path the settings panel uses — plain fetch, same origin.
 */

/** Public config view (mirrors the host contract). */
export interface CuboxConfigView {
  configured: boolean
  server: string
  tokenMasked: string
  syncMinutes: number
  lastSyncAt: string
  outputDir: string
  configPath: string
}

/** Status view with cache stats. */
export interface CuboxStatusView extends CuboxConfigView {
  cachedCards: number
  cachedAnnotations: number
  cacheUpdatedAt: string
}

/** Sync result. */
export interface CuboxSyncResult {
  ok: boolean
  message: string
  pulledCards: number
  pulledAnnotations: number
  cachedCards: number
  cachedAnnotations: number
  exportedFiles: number
}

/** Error carrying the route's JSON error message. */
export class CuboxApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CuboxApiError'
  }
}

/** Parse a JSON response or throw a CuboxApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new CuboxApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new CuboxApiError(message)
  }
  return body as T
}

/** Plain fetch helper with an error wrapper. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new CuboxApiError('网络请求失败: ' + String(error instanceof Error ? error.message : error))
  }
  return readJson<T>(response)
}

/** The cubox panel API. */
export class CuboxApi {
  async getConfig(): Promise<CuboxConfigView> {
    return request<CuboxConfigView>('/api/dsh-cubox/config')
  }

  async setConfig(patch: Record<string, unknown>): Promise<CuboxConfigView> {
    return request<CuboxConfigView>('/api/dsh-cubox/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async getStatus(): Promise<CuboxStatusView> {
    return request<CuboxStatusView>('/api/dsh-cubox/status')
  }

  async sync(days = 1): Promise<CuboxSyncResult> {
    return request<CuboxSyncResult>('/api/dsh-cubox/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    })
  }

  /** Open the host OS folder chooser; resolves with the picked path. */
  async pickDir(): Promise<{ ok: boolean; path?: string; cancelled?: boolean; unsupported?: boolean; message?: string }> {
    return request<{ ok: boolean; path?: string; cancelled?: boolean; unsupported?: boolean; message?: string }>('/api/dsh-cubox/pick-dir', {
      method: 'POST',
    })
  }
}
