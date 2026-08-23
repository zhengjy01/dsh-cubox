/**
 * Cubox settings panel — rendered inside the web settings page
 * (settings.section entry). Connection setup (API extension link, server,
 * sync interval), a manual sync button with result summary, and the current
 * cache/status. Plain React, inline styles only.
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
    ' · 缓存卡片 ' + view.cachedCards + ' 条 / 标注 ' + view.cachedAnnotations + ' 条'
  )
}

/** The Cubox settings panel component. */
export function CuboxSettingsPanel(): JSX.Element {
  const [view, setView] = useState<CuboxStatusView | null>(null)
  const [apiLink, setApiLink] = useState('')
  const [server, setServer] = useState('cubox.pro')
  const [syncMinutes, setSyncMinutes] = useState('60')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      setView(await api.getStatus())
    } catch (error) {
      setMessage('状态读取失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveConfig = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const patch: Record<string, unknown> = { server, syncMinutes: Number(syncMinutes) || 0 }
      if (apiLink.trim() !== '') patch.apiLink = apiLink.trim()
      const next = await api.setConfig(patch)
      setView({ ...next, cachedCards: view?.cachedCards ?? 0, cachedAnnotations: view?.cachedAnnotations ?? 0, cacheUpdatedAt: view?.cacheUpdatedAt ?? '' })
      setMessage(next.configured ? '配置已保存。' : '配置未保存完整：缺少 token。')
      setApiLink('')
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
      setView({ ...next, cachedCards: 0, cachedAnnotations: 0, cacheUpdatedAt: '' })
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
          style={{ ...s.input, width: '120px' }}
          placeholder="同步间隔(分钟)"
          value={syncMinutes}
          onChange={(e) => setSyncMinutes(e.target.value)}
        />
        <div style={s.flex} />
        <button style={s.button} onClick={() => void saveConfig()} disabled={busy}>保存配置</button>
        <button style={s.button} onClick={() => void clearConfig()} disabled={busy}>清除</button>
      </div>
      <div style={s.row}>
        <button style={s.button} onClick={() => void runSync(1)} disabled={busy}>同步今天</button>
        <button style={s.button} onClick={() => void runSync(7)} disabled={busy}>同步最近 7 天</button>
      </div>
      {message !== '' && <div style={s.msg}>{message}</div>}
      <div style={s.hint}>
        API 扩展链接获取：Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接。链接是个人身份凭证，请勿泄露。
        token 与同步快照分别存于 ~/.dsh/dsh-cubox.json 与 ~/.dsh/dsh-cubox-cache.json（权限 0600）。
        同步后可用 cubox_today（今日总结大纲）与 cubox_annotations（笔记标注汇总）等工具。
      </div>
    </div>
  )
}
