/**
 * dsh-cubox — Cubox sync for DeepSeek Harness.
 * Host half.
 *
 * Mounts the cubox tools (status / config / sync / today / annotations /
 * cards), the /api/dsh-cubox route family the settings panel talks to, a
 * scheduled sync timer (cordis ctx.interval, interval in minutes from the
 * plugin config, 0 disables), and a system-prompt announcement. The Cubox
 * API-extension credentials live in ~/.dsh/dsh-cubox.json (mode 0600) and
 * the sync snapshot in ~/.dsh/dsh-cubox-cache.json. All reads ride the
 * /c/api/cli endpoints shared with the official cubox-cli — no dsh source
 * changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CuboxStore } from './store.ts'
import { CuboxApi } from './api.ts'
import { buildTools } from './tools.ts'
import { makeRoutes, CUBOX_API, type NativeDirectoryPicker } from './routes.ts'
import { doSync } from './sync.ts'

/** Stable cordis plugin name. */
export const name = 'cubox'

/** Services required before the cubox surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer', 'timer', 'directoryPicker']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const CUBOX_GUIDANCE =
  '本机已安装 dsh-cubox 插件（Cubox 收藏同步）：配置一次 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接，形如 https://cubox.pro/c/api/save/xxxx）后，' +
  '可用 cubox_sync 同步收藏（默认拉取今天，可 days 指定最近 N 天；若配置了 outputDir 导出目录，会同时把今日收藏写成 Markdown 到该目录）、' +
  'cubox_cards 按关键词/时间/标注状态查询收藏，cubox_config / cubox_status 配置与查看状态。' +
  '插件支持定时同步（配置 syncMinutes，默认每 60 分钟一次；cubox_config 可调 syncMinutes，0 关闭）。' +
  '凭据存 ~/.dsh/dsh-cubox.json（权限 0600），同步快照存 ~/.dsh/dsh-cubox-cache.json；cubox_status 不回显完整 token。' +
  '也可在 Web 设置页「Cubox」面板中配置、选择导出目录与手动同步。用户提到「cubox / 收藏 / 稍后读 / 收录」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section, timer). */
  enabled?: boolean
  /** Scheduled sync interval in minutes; 0 disables the timer. */
  syncMinutes?: number
}

/**
 * Mount the cubox tools, routes, announcement, and scheduled sync.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer/timer.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx: Context, config?: Config): void {
  const announceToAgent = config?.announceToAgent !== false
  const enabled = config?.enabled !== false
  const store = new CuboxStore()
  const api = new CuboxApi(store)
  const toolContext = { store, api }

  let disposeTools: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined
  let disposeTimer: (() => void) | undefined

  const sync = (): void => {
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeTimer !== undefined) {
      disposeTimer()
      disposeTimer = undefined
    }
    if (!enabled) return

    disposeTools = ctx.effect(
      () => {
        const disposers = buildTools(toolContext).map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-cubox: tools',
    )
    disposeRoutes = ctx.effect(
      () => {
        // The directory picker is optional and may be registered after this
        // plugin's apply — resolve it lazily per request instead.
        // 'directoryPicker' is injected, so it is guaranteed available here.
        const getPicker = (): NativeDirectoryPicker | undefined => {
          try {
            return (ctx as unknown as { directoryPicker?: NativeDirectoryPicker }).directoryPicker
          } catch (error) {
            console.error('[dsh-cubox] directoryPicker access failed:', error)
            return undefined
          }
        }
        const disposers = makeRoutes({ store, api, getPicker }).map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-cubox: routes',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-cubox',
        order: SECTION_ORDER,
        text: CUBOX_GUIDANCE,
      })
    }

    // Scheduled sync: interval in minutes (0 = disabled). The first tick
    // runs after the interval elapses; tools still allow manual sync anytime.
    const minutes = typeof config?.syncMinutes === 'number' && config.syncMinutes >= 0
      ? Math.floor(config.syncMinutes)
      : 60
    if (minutes > 0) {
      disposeTimer = ctx.interval(() => {
        void (async () => {
          try {
            const view = await store.view()
            if (!view.configured) return
            await doSync(api, store, { days: 1, limit: 200 })
            ctx.logger?.info?.('[dsh-cubox] scheduled sync completed')
          } catch (error) {
            ctx.logger?.warn?.('[dsh-cubox] scheduled sync failed: ' + String(error instanceof Error ? error.message : error))
          }
        })()
      }, minutes * 60 * 1000)
    }
  }

  sync()
}

/** Re-exports for host consumers and the smoke tests. */
export { CuboxStore, mask, parseApiLink, configPath, cachePath, type CuboxConfigView, type CuboxCredentials } from './store.ts'
export { CuboxApi, CuboxApiError, formatApiTime, todayRange, type CuboxCard, type CuboxAnnotation, type CuboxCardDetail, type CuboxFolder, type CuboxTag } from './api.ts'
export { cuboxStatusTool, cuboxConfigTool, cuboxSyncTool, cuboxCardsTool, buildTools, type ToolContext } from './tools.ts'
export { doSync, readCache, writeCache, exportSyncToMarkdown, type CuboxCache, type SyncResult } from './sync.ts'
export { makeRoutes, CUBOX_API, type NativeDirectoryPicker } from './routes.ts'
export { defineTool }
