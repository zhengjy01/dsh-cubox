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
import { readFlomoCredentials, writeFlomoCredentials, flomoStatus, resolveFlomoUrl, postMemo } from './flomo.ts'
import { deliverAnnotationDigest, readFlomoLedger } from './digest.ts'
import { testNotion } from './notion.ts'

/** Minimal host directory-picker seam (duck-typed; native = OS folder chooser). */
export interface NativeDirectoryPicker {
  capability(): { kind: 'native'; pick(signal: AbortSignal): Promise<string | null> } | { kind: 'browse' }
}

/** Route paths. */
export const CUBOX_API = {
  probe: '/api/dsh-cubox/probe',
  config: '/api/dsh-cubox/config',
  sync: '/api/dsh-cubox/sync',
  status: '/api/dsh-cubox/status',
  pickDir: '/api/dsh-cubox/pick-dir',
  flomo: '/api/dsh-cubox/flomo',
  digest: '/api/dsh-cubox/digest',
  testFlomo: '/api/dsh-cubox/test-flomo',
  testNotion: '/api/dsh-cubox/test-notion',
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
      // Tiny liveness probe: the release-kit portability gate (and any external
      // watcher) calls it to confirm the plugin really mounted. Read-only.
      kind: 'exact' as const,
      path: CUBOX_API.probe,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, plugin: 'dsh-cubox' })
      },
    },
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
          // flomo credentials are shared with the dsh-flomo plugin: saving
          // them here writes ~/.dsh/dsh-flomo.json (one place, both plugins).
          const hasFlomoFields = body.flomoWebhookUrl !== undefined || body.flomoApiKey !== undefined || body.flomoReset === true
          if (hasFlomoFields) {
            const creds = await readFlomoCredentials()
            const next = { ...creds }
            if (body.flomoReset === true) {
              next.webhookUrl = ''
              next.apiKey = ''
            } else {
              if (typeof body.flomoWebhookUrl === 'string') next.webhookUrl = body.flomoWebhookUrl.trim()
              if (typeof body.flomoApiKey === 'string') next.apiKey = body.flomoApiKey.trim()
            }
            await writeFlomoCredentials(next)
            const rest = { ...body }
            delete rest.flomoWebhookUrl
            delete rest.flomoApiKey
            delete rest.flomoReset
            await store.patch(rest)
          } else {
            await store.patch(body)
          }
          writeJson(res, 200, await store.view())
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
        const flomo = await flomoStatus()
        const ledger = await readFlomoLedger()
        writeJson(res, 200, {
          ...view,
          cachedCards: cache.cards.length,
          cachedAnnotations: cache.annotations.length,
          cacheUpdatedAt: cache.updatedAt,
          flomoConfigured: flomo.configured,
          flomoSource: flomo.source,
          flomoMasked: flomo.masked,
          flomoConfigPath: flomo.configPath,
          sentAnnotationCount: Object.keys(ledger).length,
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
        try {
          const result = await doSync(api, store, { days, limit: 200 })
          writeJson(res, 200, result)
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '同步失败：' + String(error instanceof Error ? error.message : error) })
        }
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
    {
      // Manual push of the annotation digest to flomo (respects the ledger).
      kind: 'exact' as const,
      path: CUBOX_API.flomo,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (!view.configured) {
          writeJson(res, 400, { error: '未配置 Cubox API 链接：请先填写 API 扩展链接。' })
          return
        }
        const body = (await readJsonBody(req)) ?? {}
        try {
          const cfg = await store.load()
          const cache = await readCache()
          const result = await deliverAnnotationDigest(cache, cfg, {
            dest: 'flomo',
            windowDays: typeof body.days === 'number' && body.days > 0 ? body.days : undefined,
            force: body.force === true,
            tag: typeof body.tag === 'string' ? body.tag : undefined,
          })
          writeJson(res, 200, result)
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '推送标注失败：' + String(error instanceof Error ? error.message : error) })
        }
      },
    },
    {
      // Manual push of the annotation digest to the configured destination.
      kind: 'exact' as const,
      path: CUBOX_API.digest,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (!view.configured) {
          writeJson(res, 400, { error: '未配置 Cubox API 链接：请先填写 API 扩展链接。' })
          return
        }
        const body = (await readJsonBody(req)) ?? {}
        try {
          const cfg = await store.load()
          const cache = await readCache()
          const result = await deliverAnnotationDigest(cache, cfg, {
            dest: cfg.exportDest,
            windowDays: typeof body.days === 'number' && body.days > 0 ? body.days : undefined,
            force: body.force === true,
            tag: typeof body.tag === 'string' ? body.tag : undefined,
          })
          writeJson(res, 200, result)
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '导出标注 digest 失败：' + String(error instanceof Error ? error.message : error) })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: CUBOX_API.testFlomo,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const url = await resolveFlomoUrl()
        if (url === null) {
          writeJson(res, 200, { ok: false, message: 'flomo 未配置：请先在「flomo 标注同步」区填写 API URL / API Key 并保存。' })
          return
        }
        try {
          const result = await postMemo(url, '✅ dsh-cubox 测试：flomo 配置有效（' + new Date().toISOString() + '）')
          writeJson(res, 200, result)
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '测试失败：' + String(error instanceof Error ? error.message : error) })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: CUBOX_API.testNotion,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const cfg = await store.load()
        try {
          writeJson(res, 200, await testNotion(cfg.notionToken, cfg.notionTargetPageId))
        } catch (error) {
          writeJson(res, 200, { ok: false, message: '测试失败：' + String(error instanceof Error ? error.message : error) })
        }
      },
    },
  ]
}
