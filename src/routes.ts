/**
 * dsh-cubox — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-cubox/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin) — the settings panel is the only
 * consumer.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CuboxStore } from './store.ts'
import type { CuboxApi } from './api.ts'
import { doSync, readCache } from './sync.ts'

/** Minimal host directory-picker seam (duck-typed; native = OS folder chooser). */
export interface NativeDirectoryPicker {
  capability(): { kind: 'native'; pick(signal: AbortSignal): Promise<string | null> } | { kind: 'browse' }
}

/** Route paths. */
export const CUBOX_API = {
  config: '/api/dsh-cubox/config',
  sync: '/api/dsh-cubox/sync',
  status: '/api/dsh-cubox/status',
  pickDir: '/api/dsh-cubox/pick-dir',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Strict loopback fence for all routes. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Route handler context. */
export interface RouteContext {
  store: CuboxStore
  api: CuboxApi
  /**
   * Lazily resolve the host directory picker at request time (by then every
   * plugin is loaded, so the picker service is guaranteed registered).
   */
  getPicker?: () => NativeDirectoryPicker | undefined
}

/**
 * Build every /api/dsh-cubox route (exact paths).
 * @param deps - store, api client, and optional picker resolver.
 * @returns the route list.
 */
export function makeRoutes(deps: RouteContext) {
  const { store, api, getPicker } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact' as const,
      path: CUBOX_API.config,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          if (!guard(req, res, 'GET')) return
          writeJson(res, 200, await store.view())
          return
        }
        if (method === 'POST') {
          if (!guard(req, res, 'POST')) return
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          writeJson(res, 200, await store.patch(body))
          return
        }
        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
    {
      kind: 'exact' as const,
      path: CUBOX_API.status,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        const view = await store.view()
        const cache = await readCache()
        writeJson(res, 200, {
          ...view,
          cachedCards: cache.cards.length,
          cachedAnnotations: cache.annotations.length,
          cacheUpdatedAt: cache.updatedAt,
        })
      },
    },
    {
      kind: 'exact' as const,
      path: CUBOX_API.sync,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (!view.configured) {
          writeJson(res, 400, { error: '未配置 Cubox API 链接：请先在面板填写 API 扩展链接。' })
          return
        }
        const body = await readJsonBody(req)
        const days = typeof body?.days === 'number' && body.days > 0 ? body.days : 1
        const result = await doSync(api, store, { days, limit: 200 })
        writeJson(res, 200, result)
      },
    },
    {
      kind: 'exact' as const,
      path: CUBOX_API.pickDir,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const capability = getPicker?.()?.capability()
          if (capability === undefined) {
            writeJson(res, 200, { ok: false, unsupported: true, message: '当前环境没有目录选择服务，请手动输入路径。' })
            return
          }
          if (capability.kind === 'native') {
            // Opens the OS folder chooser on the host display; the request
            // stays pending until the operator picks or cancels.
            const picked = await capability.pick(AbortSignal.timeout(5 * 60 * 1000))
            if (picked === null) {
              writeJson(res, 200, { ok: false, cancelled: true, message: '已取消选择。' })
              return
            }
            writeJson(res, 200, { ok: true, path: picked })
            return
          }
          // browse backend (remote clients): no OS dialog; let the panel know.
          writeJson(res, 200, { ok: false, unsupported: true, message: '当前为远程浏览模式，不支持系统文件夹对话框，请手动输入路径。' })
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '选择文件夹失败：' + String(error instanceof Error ? error.message : error) })
        }
      },
    },
  ]
}
