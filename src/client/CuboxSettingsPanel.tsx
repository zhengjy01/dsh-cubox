/**
 * Cubox settings panel — rendered inside the web settings page
 * (settings.section entry). Connection setup (API extension link, server,
 * sync interval), a manual sync button with result summary, the current
 * cache/status, AI brief options, and the flomo annotation-digest section
 * (enable / destination / tag / min age / prompt / credentials). Plain React,
 * inline styles only.
 */
import { useCallback, useEffect, useState } from 'react'
import { CuboxApi, type CuboxConfigView, type CuboxStatusView, type CuboxSyncResult } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new CuboxApi()

/** One shared style sheet (kept tiny and theme-agnostic). */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '620px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.3)',
    fontSize: '13px',
    color: 'inherit',
  } as const,
  title: { fontWeight: 600, fontSize: '13px', margin: 0 } as const,
  status: { fontSize: '12px', opacity: 0.85 } as const,
  statusWarn: { fontSize: '12px', opacity: 0.9, color: '#c9763a' } as const,
  row: { display: 'flex', gap: '6px', alignItems: 'center' } as const,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  select: {
    padding: '4px 6px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  flex: { flex: 1 } as const,
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.4)',
    background: 'rgba(128,128,128,0.14)',
    color: 'inherit',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as const,
  msg: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.9 } as const,
  hint: { fontSize: '11px', opacity: 0.75, lineHeight: 1.6 } as const,
  section: { fontWeight: 600, fontSize: '12px', margin: '6px 0 0', opacity: 0.9 } as const,
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '12px',
    fontFamily: 'inherit',
    minHeight: '120px',
    resize: 'vertical',
    lineHeight: 1.5,
  } as const,
  checkRow: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } as const,
}

/** Status line for the current config view. */
function statusText(view: CuboxStatusView | null): string {
  if (view === null) return '加载中…'
  if (!view.configured) {
    return '未配置 — 打开 Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接（形如 https://cubox.pro/c/api/save/xxxx），粘贴到上方输入框。'
  }
  return (
    '已配置 · 服务器 ' + view.server + ' · token ' + view.tokenMasked +
    ' · 定时同步每 ' + view.syncMinutes + ' 分钟' +
    ' · 最近同步 ' + (view.lastSyncAt !== '' ? view.lastSyncAt : '从未') +
    ' · 缓存卡片 ' + view.cachedCards + ' 条 / 标注 ' + view.cachedAnnotations + ' 条' +
    ' · 导出目录 ' + (view.outputDir !== '' ? view.outputDir : '未设置') +
    ' · 卡片导出 ' + (view.exportCards ? '开' : '关') +
    ' · AI 简报 ' + (view.llmKeyMasked !== '' ? '已配置' : '未配置')
  )
}

/** Status line for the flomo annotation-digest block. */
function digestStatusText(view: CuboxStatusView | null): string {
  if (view === null) return '加载中…'
  const destLabel = view.exportDest === 'local' ? '本地文件' : (view.exportDest === 'notion' ? 'Notion' : 'flomo')
  return (
    (view.flomoEnabled ? '已开启' : '未开启') +
    ' · 目标 ' + destLabel +
    ' · 标签 #' + view.flomoTag +
    ' · 最短等待 ' + view.flomoMinAgeMinutes + ' 分钟' +
    (view.usePrompt ? ' · LLM 整理' : '') +
    ' · flomo 凭据 ' + (view.flomoConfigured ? ('已配置 ' + view.flomoSource + ' ' + view.flomoMasked) : '未配置') +
    ' · 已推送标注 ' + view.sentAnnotationCount + ' 条'
  )
}

/** The Cubox settings panel component. */
export function CuboxSettingsPanel(): JSX.Element {
  const [view, setView] = useState<CuboxStatusView | null>(null)
  const [apiLink, setApiLink] = useState('')
  const [server, setServer] = useState('cubox.pro')
  const [syncMinutes, setSyncMinutes] = useState('60')
  const [outputDir, setOutputDir] = useState('')
  const [exportCards, setExportCards] = useState(true)
  const [llmBaseUrl, setLlmBaseUrl] = useState('https://api.deepseek.com/v1')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('deepseek-chat')
  const [llmPrompt, setLlmPrompt] = useState('')
  const [flomoEnabled, setFlomoEnabled] = useState(false)
  const [exportDest, setExportDest] = useState('flomo')
  const [flomoTag, setFlomoTag] = useState('AI/cubox')
  const [flomoMinAgeMinutes, setFlomoMinAgeMinutes] = useState('60')
  const [usePrompt, setUsePrompt] = useState(false)
  const [exportPrompt, setExportPrompt] = useState('')
  const [flomoWebhookUrl, setFlomoWebhookUrl] = useState('')
  const [flomoApiKey, setFlomoApiKey] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionTargetPageId, setNotionTargetPageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await api.getStatus()
      setView(next)
      if (next.outputDir !== '') setOutputDir(next.outputDir)
      setExportCards(next.exportCards)
      setLlmBaseUrl(next.llmBaseUrl)
      setLlmModel(next.llmModel)
      setLlmPrompt(next.llmPrompt)
      if (next.llmKeyMasked === '') setLlmApiKey('')
      setFlomoEnabled(next.flomoEnabled)
      setExportDest(next.exportDest)
      setFlomoTag(next.flomoTag)
      setFlomoMinAgeMinutes(String(next.flomoMinAgeMinutes))
      setUsePrompt(next.usePrompt)
      setExportPrompt(next.exportPrompt)
      setNotionTargetPageId(next.notionTargetPageId)
      if (!next.notionConfigured) setNotionToken('')
    } catch (error) {
      setMessage('状态读取失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Fields shared by save / test, including optional credentials. */
  const configPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {
      server,
      syncMinutes: Number(syncMinutes) || 0,
      outputDir: outputDir.trim(),
      exportCards,
      llmBaseUrl: llmBaseUrl.trim(),
      llmModel: llmModel.trim(),
      llmPrompt,
      flomoEnabled,
      exportDest,
      flomoTag: flomoTag.trim(),
      flomoMinAgeMinutes: Number(flomoMinAgeMinutes) || 0,
      usePrompt,
      exportPrompt,
      notionTargetPageId: notionTargetPageId.trim(),
    }
    if (apiLink.trim() !== '') patch.apiLink = apiLink.trim()
    if (llmApiKey.trim() !== '') patch.llmApiKey = llmApiKey.trim()
    if (flomoWebhookUrl.trim() !== '') patch.flomoWebhookUrl = flomoWebhookUrl.trim()
    if (flomoApiKey.trim() !== '') patch.flomoApiKey = flomoApiKey.trim()
    if (notionToken.trim() !== '') patch.notionToken = notionToken.trim()
    return patch
  }

  const saveConfig = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const next = await api.setConfig(configPatch())
      setView({ ...next, cachedCards: view?.cachedCards ?? 0, cachedAnnotations: view?.cachedAnnotations ?? 0, cacheUpdatedAt: view?.cacheUpdatedAt ?? '', flomoConfigured: view?.flomoConfigured ?? false, flomoSource: view?.flomoSource ?? '', flomoMasked: view?.flomoMasked ?? '', flomoConfigPath: view?.flomoConfigPath ?? '', sentAnnotationCount: view?.sentAnnotationCount ?? 0 })
      setMessage(next.configured ? '配置已保存。' : '配置未保存完整：缺少 token。')
      setApiLink('')
      if (next.llmKeyMasked !== '') setLlmApiKey('')
      if (next.notionConfigured) setNotionToken('')
      setFlomoWebhookUrl('')
      setFlomoApiKey('')
      await refresh()
    } catch (error) {
      setMessage('保存失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const clearConfig = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const next = await api.setConfig({ reset: true })
      setView({ ...next, cachedCards: 0, cachedAnnotations: 0, cacheUpdatedAt: '', flomoConfigured: false, flomoSource: '', flomoMasked: '', flomoConfigPath: '', sentAnnotationCount: 0 })
      setOutputDir('')
      setLlmApiKey('')
      setNotionToken('')
      setMessage('已清除配置。')
    } catch (error) {
      setMessage('清除失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const runSync = async (days: number): Promise<void> => {
    setBusy(true)
    setMessage('同步中…')
    try {
      const result: CuboxSyncResult = await api.sync(days)
      setMessage(result.ok ? result.message : '同步失败: ' + result.message)
      await refresh()
    } catch (error) {
      setMessage('同步失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  /** Push the annotation digest to flomo now (respects the dedup ledger). */
  const pushFlomoNow = async (): Promise<void> => {
    setBusy(true)
    setMessage('推送标注中…')
    try {
      const result = await api.pushFlomo()
      setMessage(result.message)
      await refresh()
    } catch (error) {
      setMessage('推送失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  /** Save the current flomo fields (if filled), then send a test memo. */
  const testFlomoConfig = async (): Promise<void> => {
    setBusy(true)
    setMessage('测试中…（会向 flomo 发送一条测试 MEMO）')
    try {
      if (flomoWebhookUrl.trim() !== '' || flomoApiKey.trim() !== '') {
        await api.setConfig(configPatch())
      }
      const result = await api.testFlomo()
      setMessage(result.message)
      setFlomoWebhookUrl('')
      setFlomoApiKey('')
      await refresh()
    } catch (error) {
      setMessage('测试失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  /** Save the Notion fields (if filled), then verify the token + page. */
  const testNotionConfig = async (): Promise<void> => {
    setBusy(true)
    setMessage('测试中…')
    try {
      if (notionToken.trim() !== '' || notionTargetPageId.trim() !== '') {
        await api.setConfig(configPatch())
      }
      const result = await api.testNotion()
      setMessage(result.message)
      if (result.ok) setNotionToken('')
      await refresh()
    } catch (error) {
      setMessage('测试失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  /** Open the host OS folder chooser and apply the picked path. */
  const pickFolder = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const result = await api.pickDir()
      if (result.ok && result.path !== undefined) {
        setOutputDir(result.path)
        setMessage('已选择文件夹：' + result.path + '（保存配置后生效）')
      } else if (result.cancelled === true) {
        setMessage('已取消选择。')
      } else {
        setMessage(result.message ?? '无法弹出文件夹选择（当前环境不支持），请手动输入路径。')
      }
    } catch (error) {
      setMessage('选择文件夹失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={s.card}>
      <h3 style={s.title}>Cubox 收藏同步</h3>
      <div style={s.status}>{statusText(view)}</div>
      <div style={s.row}>
        <input
          style={s.input}
          placeholder="API 扩展链接（https://cubox.pro/c/api/save/xxxx）"
          value={apiLink}
          onChange={(e) => setApiLink(e.target.value)}
        />
      </div>
      <div style={s.row}>
        <select style={s.select} value={server} onChange={(e) => setServer(e.target.value)}>
          <option value="cubox.pro">cubox.pro（国内）</option>
          <option value="cubox.cc">cubox.cc（国际版）</option>
        </select>
        <input
          style={{ ...s.input, width: '160px' }}
          placeholder="轮询同步间隔(分钟)"
          title="控制定时同步（含 flomo 标注推送）的频率；建议 60–120，0 关闭定时。保存后即时生效。"
          value={syncMinutes}
          onChange={(e) => setSyncMinutes(e.target.value)}
        />
        <div style={s.flex} />
        <button style={s.button} onClick={() => void saveConfig()} disabled={busy}>保存配置</button>
        <button style={s.button} onClick={() => void clearConfig()} disabled={busy}>清除</button>
      </div>
      <div style={s.row}>
        <input
          style={s.input}
          placeholder="本地导出目录（同步时写入 Markdown，留空=不导出）"
          value={outputDir}
          onChange={(e) => setOutputDir(e.target.value)}
        />
        <button style={s.button} onClick={() => void pickFolder()} disabled={busy}>选择文件夹…</button>
      </div>
      <div style={s.checkRow}>
        <input
          type="checkbox"
          id="cubox-export-cards"
          checked={exportCards}
          onChange={(e) => setExportCards(e.target.checked)}
        />
        <label htmlFor="cubox-export-cards">每张收藏导出一个 md 文件（关闭后只生成 AI 简报）</label>
      </div>

      <h4 style={s.section}>AI 简报（按提示词生成今日收藏简报）</h4>
      <div style={s.row}>
        <input
          style={s.input}
          placeholder="LLM Base URL（OpenAI 兼容）"
          value={llmBaseUrl}
          onChange={(e) => setLlmBaseUrl(e.target.value)}
        />
        <input
          style={{ ...s.input, width: '150px' }}
          placeholder="模型"
          value={llmModel}
          onChange={(e) => setLlmModel(e.target.value)}
        />
      </div>
      <div style={s.row}>
        <input
          style={s.input}
          placeholder={'LLM API Key' + (view !== null && view.llmKeyMasked !== '' ? '（已保存 ' + view.llmKeyMasked + '，留空保持不变）' : '')}
          type="password"
          value={llmApiKey}
          onChange={(e) => setLlmApiKey(e.target.value)}
        />
      </div>
      <textarea
        style={s.textarea}
        placeholder={'提示词模板：{collection} 会被替换为今日收藏列表'}
        value={llmPrompt}
        onChange={(e) => setLlmPrompt(e.target.value)}
      />

      <h4 style={s.section}>flomo 标注同步（新增/变更标注 → 每日 digest）</h4>
      <div style={view !== null && !view.flomoConfigured && flomoEnabled ? s.statusWarn : s.status}>{digestStatusText(view)}</div>
      <div style={s.checkRow}>
        <input
          type="checkbox"
          id="cubox-flomo-enabled"
          checked={flomoEnabled}
          onChange={(e) => setFlomoEnabled(e.target.checked)}
        />
        <label htmlFor="cubox-flomo-enabled">同步后自动推送新增/变更标注（本地去重账本，不重复推送）</label>
      </div>
      <div style={s.row}>
        <select style={s.select} value={exportDest} onChange={(e) => setExportDest(e.target.value)}>
          <option value="flomo">flomo</option>
          <option value="local">本地 Markdown</option>
          <option value="notion">Notion</option>
        </select>
        <input
          style={{ ...s.input, width: '150px' }}
          placeholder="flomo 标签"
          value={flomoTag}
          onChange={(e) => setFlomoTag(e.target.value)}
        />
        <input
          style={{ ...s.input, width: '120px' }}
          placeholder="最短等待(分钟)"
          value={flomoMinAgeMinutes}
          onChange={(e) => setFlomoMinAgeMinutes(e.target.value)}
        />
      </div>
      <div style={s.checkRow}>
        <input
          type="checkbox"
          id="cubox-use-prompt"
          checked={usePrompt}
          onChange={(e) => setUsePrompt(e.target.checked)}
        />
        <label htmlFor="cubox-use-prompt">推送前用 LLM 按提示词整理 digest</label>
      </div>
      <textarea
        style={s.textarea}
        placeholder={'digest 整理提示词：{digest} 会被替换为原始标注列表'}
        value={exportPrompt}
        onChange={(e) => setExportPrompt(e.target.value)}
      />
      <div style={s.row}>
        <input
          style={s.input}
          type="password"
          placeholder={view !== null && view.flomoConfigured ? 'flomo API URL（已配置 ' + view.flomoSource + ' ' + view.flomoMasked + '，留空保持不变）' : 'flomo API URL（https://flomoapp.com/iwh/xxxx）'}
          value={flomoWebhookUrl}
          onChange={(e) => setFlomoWebhookUrl(e.target.value)}
        />
      </div>
      <div style={s.row}>
        <input
          style={s.input}
          type="password"
          placeholder="或 flomo API Key（新版，与 URL 二选一）"
          value={flomoApiKey}
          onChange={(e) => setFlomoApiKey(e.target.value)}
        />
        <button style={s.button} onClick={() => void testFlomoConfig()} disabled={busy}>测试 flomo</button>
      </div>
      <div style={s.row}>
        <input
          style={s.input}
          type="password"
          placeholder={view !== null && view.notionConfigured ? 'Notion Token（已保存，留空保持不变）' : 'Notion Integration Token（目标=Notion 时填）'}
          value={notionToken}
          onChange={(e) => setNotionToken(e.target.value)}
        />
      </div>
      <div style={s.row}>
        <input
          style={s.input}
          placeholder="Notion 目标父页面 URL 或 ID"
          value={notionTargetPageId}
          onChange={(e) => setNotionTargetPageId(e.target.value)}
        />
        <button style={s.button} onClick={() => void testNotionConfig()} disabled={busy}>测试 Notion</button>
      </div>

      <div style={s.row}>
        <button style={s.button} onClick={() => void runSync(1)} disabled={busy}>同步今天</button>
        <button style={s.button} onClick={() => void runSync(7)} disabled={busy}>同步最近 7 天</button>
        <button style={s.button} onClick={() => void pushFlomoNow()} disabled={busy}>推送标注到 flomo</button>
      </div>
      {message !== '' && <div style={s.msg}>{message}</div>}
      <div style={s.hint}>
        API 扩展链接获取：Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接。链接是个人身份凭证，请勿泄露。
        token 与同步快照分别存于 ~/.dsh/dsh-cubox.json 与 ~/.dsh/dsh-cubox-cache.json（权限 0600）；flomo 凭据与「Flomo」面板共享（~/.dsh/dsh-flomo.json，0600）。
        「轮询同步间隔(分钟)」控制定时同步（含 flomo 标注推送）的频率，建议 60–120，0 关闭定时；「flomo 标签」在下方「flomo 标注同步」区设置——两者点「保存配置」后即时生效，无需重启。
        配置导出目录后，每次同步会按上方设置写入：勾选卡片时每张收藏一个 md；配置了 AI Key 时按提示词生成「今日收藏简报-日期.md」（{'{collection}'} 替换为今日收藏列表，未包含则自动追加）。
        标注 digest：只推创建满「最短等待」分钟的新增/变更标注，正文自动去 #（flomo 会把 #词 当标签），只保留配置标签，超长自动拆条；flomo 是追加式镜像，Cubox 里改动/删除标注不会回写 flomo。去重账本 ~/.dsh/.cubox-flomo-annotations-sent 记录已推送标注，删除后可能重复推送。
      </div>
    </div>
  )
}
