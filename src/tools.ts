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
import type { CuboxConfigView, CuboxStore } from './store.ts'
import { readCache, doSync } from './sync.ts'
import { deliverAnnotationDigest, readFlomoLedger } from './digest.ts'
import { flomoConfigured } from './flomo.ts'

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
          flomoEnabled: { type: 'boolean' },
          exportDest: { type: 'string' },
          flomoTag: { type: 'string' },
          flomoMinAgeMinutes: { type: 'number' },
          usePrompt: { type: 'boolean' },
          flomoConfigured: { type: 'boolean' },
          sentAnnotationCount: { type: 'number' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      const cache = await readCache()
      const flomoOk = await flomoConfigured()
      const ledger = await readFlomoLedger()
      const destLabel = view.exportDest === 'local' ? '本地文件' : (view.exportDest === 'notion' ? 'Notion' : 'flomo')
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
        '标注 digest：' + (view.flomoEnabled ? '已开启（目标 ' + destLabel + '，标签 #' + view.flomoTag + '，最短等待 ' + view.flomoMinAgeMinutes + ' 分钟' + (view.usePrompt ? '，LLM 整理' : '') + '）' : '未开启（cubox_config flomoEnabled=true 开启）'),
        'flomo 凭据：' + (flomoOk ? '已配置（共享 ~/.dsh/dsh-flomo.json）' : '未配置'),
        '已推送标注：' + Object.keys(ledger).length + ' 条（本地去重账本）',
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
        flomoEnabled: view.flomoEnabled,
        exportDest: view.exportDest,
        flomoTag: view.flomoTag,
        flomoMinAgeMinutes: view.flomoMinAgeMinutes,
        usePrompt: view.usePrompt,
        flomoConfigured: flomoOk,
        sentAnnotationCount: Object.keys(ledger).length,
        configPath: view.configPath,
      }
    },
  })
}

/** Project a config view onto the fields declared in the config tool schema. */
function configToolFields(view: CuboxConfigView) {
  return {
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
    flomoEnabled: view.flomoEnabled,
    exportDest: view.exportDest,
    flomoTag: view.flomoTag,
    flomoMinAgeMinutes: view.flomoMinAgeMinutes,
    usePrompt: view.usePrompt,
    notionConfigured: view.notionConfigured,
    notionTargetPageId: view.notionTargetPageId,
    configPath: view.configPath,
  }
}

/** Config tool: set/clear credentials, sync interval, export, AI + digest options. */
export function cuboxConfigTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_config',
    description: '配置或清除 Cubox API 扩展凭据与同步/导出选项。apiLink 填完整 API 扩展链接（形如 https://cubox.pro/c/api/save/xxxx，自动解析 server 与 token）；也可分别填 server（cubox.pro / cubox.cc）与 token。syncMinutes 为定时同步间隔（分钟，0=关闭定时；推送 flomo 建议 60–120）。outputDir 为本地导出目录；exportCards 控制是否每张收藏导出一个 md。llmBaseUrl / llmApiKey / llmModel 配置 LLM（AI 简报与 prompt 整理共用）；llmPrompt 为 AI 简报模板（{collection}）。标注 digest：flomoEnabled 开启同步后推送新增/变更标注；exportDest 选目标（flomo/local/notion）；flomoTag 为 flomo 标签（默认 AI/cubox）；flomoMinAgeMinutes 为标注最短等待分钟数（默认 60，避免半截内容）；usePrompt + exportPrompt（{digest}）让 LLM 先整理再推送；notionToken / notionTargetPageId 供 exportDest=notion。reset: true 清除全部凭据。凭据持久化到 ~/.dsh/dsh-cubox.json（0600），flomo 凭据共享 ~/.dsh/dsh-flomo.json。',
    parameters: {
      apiLink: { type: 'string', description: '完整 API 扩展链接（https://cubox.pro/c/api/save/xxxx 或 https://cubox.cc/c/api/save/xxxx）' },
      server: { type: 'string', description: '服务器：cubox.pro（国内）或 cubox.cc（国际版）' },
      token: { type: 'string', description: 'API token（链接最后一段）' },
      syncMinutes: { type: 'number', description: '定时同步间隔（分钟），0 = 关闭定时；推送 flomo 建议 60–120' },
      outputDir: { type: 'string', description: '本地导出目录（绝对路径；同步时写入 Markdown 文件，空=不导出）' },
      exportCards: { type: 'boolean', description: '是否每张收藏导出一个 md 文件（默认 true；false 则只生成 AI 简报）' },
      llmBaseUrl: { type: 'string', description: 'LLM Base URL（OpenAI 兼容，默认 https://api.deepseek.com/v1）' },
      llmApiKey: { type: 'string', description: 'LLM API Key' },
      llmModel: { type: 'string', description: 'LLM 模型名（默认 deepseek-chat）' },
      llmPrompt: { type: 'string', description: 'AI 简报 prompt 模板，{collection} 会被替换为今日收藏列表' },
      flomoEnabled: { type: 'boolean', description: '是否开启「同步后推送标注 digest」（默认 false）' },
      exportDest: { type: 'string', enum: ['flomo', 'local', 'notion'], description: '标注 digest 目标：flomo（默认）/ local / notion' },
      flomoTag: { type: 'string', description: 'flomo 标签（不带 #，默认 AI/cubox）' },
      flomoMinAgeMinutes: { type: 'number', description: '标注最短等待分钟数（默认 60），早于该时长的标注不推送，避免半截内容' },
      usePrompt: { type: 'boolean', description: '推送前是否用 LLM 按 exportPrompt 整理 digest' },
      exportPrompt: { type: 'string', description: 'digest 整理 prompt 模板，{digest} 会被替换为原始标注列表' },
      notionToken: { type: 'string', description: 'Notion Integration Token（exportDest=notion 时用）' },
      notionTargetPageId: { type: 'string', description: 'Notion 目标父页面 URL 或 32 位 ID（exportDest=notion 时用）' },
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
          flomoEnabled: { type: 'boolean' },
          exportDest: { type: 'string' },
          flomoTag: { type: 'string' },
          flomoMinAgeMinutes: { type: 'number' },
          usePrompt: { type: 'boolean' },
          notionConfigured: { type: 'boolean' },
          notionTargetPageId: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: {
      apiLink?: string; server?: string; token?: string; syncMinutes?: number; outputDir?: string; exportCards?: boolean;
      llmBaseUrl?: string; llmApiKey?: string; llmModel?: string; llmPrompt?: string;
      flomoEnabled?: boolean; exportDest?: string; flomoTag?: string; flomoMinAgeMinutes?: number;
      usePrompt?: boolean; exportPrompt?: string; notionToken?: string; notionTargetPageId?: string;
      reset?: boolean;
    }) {
      if (args !== undefined && args.reset === true) {
        const view = await ctx.store.patch({ reset: true })
        return { ok: true, message: '已清除 Cubox 凭据。', ...configToolFields(view) }
      }
      const view = await ctx.store.patch(args)
      if (!view.configured) {
        return { ok: false, message: '配置未生效：缺少 token。请提供完整的 API 扩展链接。', ...configToolFields(view) }
      }
      const parts = ['已保存 Cubox 配置：服务器 ' + view.server + '，token ' + view.tokenMasked]
      if (view.syncMinutes > 0) parts.push('定时同步每 ' + view.syncMinutes + ' 分钟一次')
      else parts.push('定时同步已关闭（可随时 cubox_sync 手动同步）')
      if (view.outputDir !== '') {
        parts.push(view.exportCards ? '导出每张收藏 md 到 ' + view.outputDir : '不导出卡片，只写 AI 简报到 ' + view.outputDir)
      }
      if (view.llmKeyMasked !== '') parts.push('AI 简报已配置（' + view.llmModel + '）')
      if (view.flomoEnabled) {
        const destLabel = view.exportDest === 'local' ? '本地文件' : (view.exportDest === 'notion' ? 'Notion' : 'flomo')
        parts.push('标注 digest 已开启（' + destLabel + '，标签 #' + view.flomoTag + '，最短等待 ' + view.flomoMinAgeMinutes + ' 分钟' + (view.usePrompt ? '，LLM 整理' : '') + '）')
      } else {
        parts.push('标注 digest 未开启（flomoEnabled=true 开启）')
      }
      return { ok: true, message: parts.join('；') + '。', ...configToolFields(view) }
    },
  })
}

/** Sync tool: pull the latest collection snapshot into the local cache. */
export function cuboxSyncTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_sync',
    description: '同步 Cubox：拉取最近 N 天（默认今天）的收藏卡片与今日标注，合并进本地缓存（~/.dsh/dsh-cubox-cache.json），并更新最近同步时间。若配置了 outputDir 导出目录，会按配置导出：exportCards 开启时每张收藏一个 md 文件；配置了 LLM 时按 llmPrompt 生成今日收藏简报（今日收藏简报-YYYY-MM-DD.md）写入该目录。若开启了 flomoEnabled，还会把新增/变更且创建满 N 分钟的标注以每日 digest 推送到 exportDest（flomo/local/notion；本地去重账本防重复）。days 控制拉取窗口天数；limit 控制卡片拉取上限（默认 200）。返回本次拉取、缓存规模与导出结果。',
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
          digestCandidates: { type: 'number' },
          digestMemos: { type: 'number' },
          digestMessage: { type: 'string' },
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
        digestCandidates: result.digestCandidates,
        digestMemos: result.digestMemos,
        digestMessage: result.digestMessage,
        since: result.since,
      }
    },
  })
}

/** Flomo tool: push newly settled annotations to flomo as a daily digest. */
export function cuboxFlomoTool(ctx: ToolContext) {
  return defineTool({
    name: 'cubox_flomo',
    description: '把 Cubox 新增/变更的标注（划线+想法）以每日 digest（卡片标题+链接+标注）推送到 flomo（浮墨笔记）。复用 ~/.dsh/dsh-flomo.json 凭据（无需重复配置）；本地去重账本（~/.dsh/.cubox-flomo-annotations-sent）保证同一标注不重复推送；默认只推创建满 N 分钟（配置 flomoMinAgeMinutes，默认 60）的标注，避免半截内容；正文自动去除 #（flomo 会把 #词 抓成标签），只保留配置标签；超长自动拆成多条 MEMO。days 指定回看窗口天数（默认 2）；force=true 忽略最短等待时间（手动补推）；tag 覆盖配置标签。',
    parameters: {
      days: { type: 'number', description: '回看窗口天数（默认 2）' },
      force: { type: 'boolean', description: '忽略最短等待时间，立即推送（仍受去重账本约束）' },
      tag: { type: 'string', description: 'flomo 标签（不带 #，临时覆盖配置）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          candidates: { type: 'number' },
          memos: { type: 'number' },
          delivered: { type: 'number' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { days?: number; force?: boolean; tag?: string }) {
      const view = await ctx.store.view()
      if (!view.configured) {
        return { ok: false, message: '未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。' }
      }
      const cfg = await ctx.store.load()
      const cache = await readCache()
      const result = await deliverAnnotationDigest(cache, cfg, {
        dest: 'flomo',
        windowDays: typeof args?.days === 'number' && args.days > 0 ? args.days : undefined,
        force: args?.force === true,
        tag: typeof args?.tag === 'string' ? args.tag : undefined,
      })
      return {
        ok: result.ok,
        message: result.message,
        candidates: result.candidates,
        memos: result.memos,
        delivered: result.delivered,
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
    cuboxFlomoTool(ctx),
  ]
}
