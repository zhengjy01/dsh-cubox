/**
 * dsh-cubox — model-facing tools.
 *
 * Mounted via ctx.tools.register. Covers the Cubox surface: status, config,
 * manual sync, today's outline, annotation aggregation, and card queries.
 * Every tool resolves to { ok, message, ... } and never throws for API-level
 * outcomes.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CuboxApi } from './api.ts'
import { CuboxApiError } from './api.ts'
import type { CuboxStore } from './store.ts'
import { readCache, doSync } from './sync.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Shared tool dependencies. */
export interface ToolContext {
  store: CuboxStore
  api: CuboxApi
}

/** Readable error for API failures. */
function apiError(err: unknown): string {
  if (err instanceof CuboxApiError) return err.message
  return String(err instanceof Error ? err.message : err)
}

/** Status tool: configuration + latest sync snapshot summary. */
export function cuboxStatusTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_status',
    description: '查看 dsh-cubox 插件状态：是否已配置 Cubox API 链接、服务器（cubox.pro / cubox.cc）、定时同步间隔、最近同步时间与缓存规模。不会泄露 token。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          server: { type: 'string' },
          tokenMasked: { type: 'string' },
          syncMinutes: { type: 'number' },
          lastSyncAt: { type: 'string' },
          outputDir: { type: 'string' },
          exportCards: { type: 'boolean' },
          llmBaseUrl: { type: 'string' },
          llmModel: { type: 'string' },
          llmKeyMasked: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      const cache = await readCache()
      const lines = [
        view.configured
          ? '已配置：服务器 ' + view.server + '，token ' + view.tokenMasked
          : '未配置：请先提供 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接），调用 cubox_config 配置。',
        '定时同步：' + (view.syncMinutes > 0 ? '每 ' + view.syncMinutes + ' 分钟' : '已关闭'),
        '最近同步：' + (view.lastSyncAt !== '' ? view.lastSyncAt : '从未同步'),
        '缓存：卡片 ' + cache.cards.length + ' 条、标注 ' + cache.annotations.length + ' 条',
        '导出目录：' + (view.outputDir !== '' ? view.outputDir : '未设置（不同步到本地文件）'),
        '卡片导出：' + (view.exportCards ? '开（每张收藏一个 md）' : '关'),
        'AI 简报：' + (view.llmKeyMasked !== '' ? '已配置（' + view.llmModel + '，' + view.llmBaseUrl + '，key ' + view.llmKeyMasked + '）' : '未配置'),
        '配置路径：' + view.configPath,
      ]
      return {
        ok: true,
        message: lines.join('\n'),
        configured: view.configured,
        server: view.server,
        tokenMasked: view.tokenMasked,
        syncMinutes: view.syncMinutes,
        lastSyncAt: view.lastSyncAt,
        outputDir: view.outputDir,
        exportCards: view.exportCards,
        llmBaseUrl: view.llmBaseUrl,
        llmModel: view.llmModel,
        llmKeyMasked: view.llmKeyMasked,
        configPath: view.configPath,
      }
    },
  })
}

/** Config tool: set/clear the API link, server, token, sync interval, export + AI options. */
export function cuboxConfigTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_config',
    description: '配置或清除 Cubox API 扩展凭据与同步选项。apiLink 填完整 API 扩展链接（形如 https://cubox.pro/c/api/save/xxxx，自动解析 server 与 token）；也可分别填 server（cubox.pro / cubox.cc）与 token。syncMinutes 为定时同步间隔（分钟，0=关闭定时）。outputDir 为本地导出目录（同步时把收藏与 AI 简报写入该目录；空=不导出）。exportCards 控制是否每张收藏导出一个 md 文件（false=只生成 AI 简报）。llmBaseUrl / llmApiKey / llmModel / llmPrompt 配置 AI 简报（OpenAI 兼容，prompt 中 {collection} 会被替换为今日收藏列表）。reset: true 清除凭据。凭据持久化到 ~/.dsh/dsh-cubox.json（权限 0600）。',
    parameters: {
      apiLink: { type: 'string', description: '完整 API 扩展链接（https://cubox.pro/c/api/save/xxxx 或 https://cubox.cc/c/api/save/xxxx）' },
      server: { type: 'string', description: '服务器：cubox.pro（国内）或 cubox.cc（国际版）' },
      token: { type: 'string', description: 'API token（链接最后一段）' },
      syncMinutes: { type: 'number', description: '定时同步间隔（分钟），0 = 关闭定时' },
      outputDir: { type: 'string', description: '本地导出目录（绝对路径；同步时写入 Markdown 文件，空=不导出）' },
      exportCards: { type: 'boolean', description: '是否每张收藏导出一个 md 文件（默认 true；false 则只生成 AI 简报）' },
      llmBaseUrl: { type: 'string', description: 'LLM Base URL（OpenAI 兼容，默认 https://api.deepseek.com/v1）' },
      llmApiKey: { type: 'string', description: 'LLM API Key' },
      llmModel: { type: 'string', description: 'LLM 模型名（默认 deepseek-chat）' },
      llmPrompt: { type: 'string', description: 'AI 简报 prompt 模板，{collection} 会被替换为今日收藏列表' },
      reset: { type: 'boolean', description: '设为 true 清除全部凭据' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          server: { type: 'string' },
          tokenMasked: { type: 'string' },
          syncMinutes: { type: 'number' },
          lastSyncAt: { type: 'string' },
          outputDir: { type: 'string' },
          exportCards: { type: 'boolean' },
          llmBaseUrl: { type: 'string' },
          llmModel: { type: 'string' },
          llmKeyMasked: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { apiLink?: string; server?: string; token?: string; syncMinutes?: number; outputDir?: string; exportCards?: boolean; llmBaseUrl?: string; llmApiKey?: string; llmModel?: string; llmPrompt?: string; reset?: boolean }) {
      if (args !== undefined && args.reset === true) {
        const view = await ctx.store.patch({ reset: true })
        return { ok: true, message: '已清除 Cubox 凭据。', configured: view.configured, server: view.server, tokenMasked: view.tokenMasked, syncMinutes: view.syncMinutes, lastSyncAt: view.lastSyncAt, outputDir: view.outputDir, exportCards: view.exportCards, llmBaseUrl: view.llmBaseUrl, llmModel: view.llmModel, llmKeyMasked: view.llmKeyMasked, configPath: view.configPath }
      }
      const view = await ctx.store.patch(args)
      if (!view.configured) {
        return { ok: false, message: '配置未生效：缺少 token。请提供完整的 API 扩展链接。', configured: view.configured, server: view.server, tokenMasked: view.tokenMasked, syncMinutes: view.syncMinutes, lastSyncAt: view.lastSyncAt, outputDir: view.outputDir, exportCards: view.exportCards, llmBaseUrl: view.llmBaseUrl, llmModel: view.llmModel, llmKeyMasked: view.llmKeyMasked, configPath: view.configPath }
      }
      const parts = ['已保存 Cubox 配置：服务器 ' + view.server + '，token ' + view.tokenMasked]
      if (view.syncMinutes > 0) parts.push('定时同步每 ' + view.syncMinutes + ' 分钟一次')
      else parts.push('定时同步已关闭（可随时 cubox_sync 手动同步）')
      if (view.outputDir !== '') {
        parts.push(view.exportCards ? '导出每张收藏 md 到 ' + view.outputDir : '不导出卡片，只写 AI 简报到 ' + view.outputDir)
      }
      if (view.llmKeyMasked !== '') parts.push('AI 简报已配置（' + view.llmModel + '）')
      return { ok: true, message: parts.join('；') + '。', configured: view.configured, server: view.server, tokenMasked: view.tokenMasked, syncMinutes: view.syncMinutes, lastSyncAt: view.lastSyncAt, outputDir: view.outputDir, exportCards: view.exportCards, llmBaseUrl: view.llmBaseUrl, llmModel: view.llmModel, llmKeyMasked: view.llmKeyMasked, configPath: view.configPath }
    },
  })
}

/** Sync tool: pull the latest collection snapshot into the local cache. */
export function cuboxSyncTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_sync',
    description: '同步 Cubox：拉取最近 N 天（默认今天）的收藏卡片与今日标注，合并进本地缓存（~/.dsh/dsh-cubox-cache.json），并更新最近同步时间。若配置了 outputDir 导出目录，会按配置导出：exportCards 开启时每张收藏一个 md 文件；配置了 LLM 时按 llmPrompt 生成今日收藏简报（今日收藏简报-YYYY-MM-DD.md）写入该目录。days 控制拉取窗口天数；limit 控制卡片拉取上限（默认 200）。返回本次拉取、缓存规模与导出结果。',
    parameters: {
      days: { type: 'number', description: '拉取窗口天数（默认 1 = 今天）' },
      limit: { type: 'number', description: '卡片拉取上限（默认 200）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          pulledCards: { type: 'number' },
          pulledAnnotations: { type: 'number' },
          cachedCards: { type: 'number' },
          cachedAnnotations: { type: 'number' },
          exportedFiles: { type: 'number' },
          briefPath: { type: 'string' },
          since: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { days?: number; limit?: number }) {
      const view = await ctx.store.view()
      if (!view.configured) {
        return { ok: false, message: '未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。' }
      }
      const result = await doSync(ctx.api, ctx.store, {
        days: typeof args?.days === 'number' ? args.days : 1,
        limit: typeof args?.limit === 'number' ? args.limit : 200,
      })
      return {
        ok: result.ok,
        message: result.message,
        pulledCards: result.pulledCards,
        pulledAnnotations: result.pulledAnnotations,
        cachedCards: result.cachedCards,
        cachedAnnotations: result.cachedAnnotations,
        exportedFiles: result.exportedFiles,
        briefPath: result.briefPath,
        since: result.since,
      }
    },
  })
}

/** Cards tool: query the collection with filters. */
export function cuboxCardsTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_cards',
    description: '查询 Cubox 收藏列表：可按关键词（keyword）、最近 N 天（days）、是否已标注（annotated）、是否星标（starred）、是否已读（read）过滤，limit 控制条数（默认 50）。返回每条收藏的标题、来源、链接、创建时间。',
    parameters: {
      keyword: { type: 'string', description: '搜索关键词' },
      days: { type: 'number', description: '最近 N 天（不填=全部时间）' },
      annotated: { type: 'boolean', description: '只看有标注的收藏' },
      starred: { type: 'boolean', description: '只看星标收藏' },
      read: { type: 'boolean', description: '只看已读收藏' },
      limit: { type: 'number', description: '条数上限（默认 50）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          count: { type: 'number' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string' },
                url: { type: 'string' },
                domain: { type: 'string' },
                create_time: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { keyword?: string; days?: number; annotated?: boolean; starred?: boolean; read?: boolean; limit?: number }) {
      const view = await ctx.store.view()
      if (!view.configured) {
        return { ok: false, message: '未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。' }
      }
      const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : ''
      const days = typeof args?.days === 'number' && args.days > 0 ? Math.floor(args.days) : 0
      const limit = typeof args?.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50
      const now = new Date()
      const start = days > 0 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0) : null

      let cards
      try {
        cards = await ctx.api.filterCards({
          keyword: keyword === '' ? undefined : keyword,
          start_time: start !== null ? formatLocal(start) : undefined,
          end_time: start !== null ? formatLocal(now) : undefined,
          annotated: args?.annotated === true ? true : undefined,
          starred: args?.starred === true ? true : undefined,
          read: args?.read === true ? true : undefined,
          limit,
        })
      } catch (error) {
        return { ok: false, message: '查询收藏失败：' + apiError(error) }
      }
      const lines = cards.length === 0 ? ['（没有符合条件的收藏）'] : []
      for (const card of cards) {
        const title = card.title || card.article_title || card.url
        const domain = cardDomain(card)
        const tags = Array.isArray(card.tags) && card.tags.length > 0 ? ' #' + card.tags.join(' #') : ''
        lines.push('- ' + title + (domain !== '' ? '（' + domain + '）' : '') + ' · ' + card.create_time + tags)
        if (card.url !== '') lines.push('  ' + card.url)
      }
      return {
        ok: true,
        message: '共 ' + cards.length + ' 条：\n' + lines.join('\n'),
        count: cards.length,
        cards: cards.map((c) => ({ id: c.id, title: c.title || c.url, url: c.url, domain: cardDomain(c), create_time: c.create_time })),
      }
    },
  })
}

/** Local time in the Cubox API layout. */
function formatLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    '.000' + sign + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0')
  )
}

/** Domain of a card URL. */
function cardDomain(card: { url: string; domain?: string }): string {
  try {
    return new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    return card.domain ?? ''
  }
}

/** Build every cubox tool. */
export function buildTools(ctx: ToolContext) {
  return [
    cuboxStatusTool(ctx),
    cuboxConfigTool(ctx),
    cuboxSyncTool(ctx),
    cuboxCardsTool(ctx),
  ]
}
