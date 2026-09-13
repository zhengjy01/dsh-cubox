/**
 * dsh-cubox — flomo export integration.
 *
 * Cubox annotations (highlights + thoughts) are pushed to flomo (浮墨笔记)
 * from `doSync`, and on demand via the cubox_flomo tool / settings panel.
 * This module owns the transport only: it reuses the credentials already
 * configured for the dsh-flomo plugin (~/.dsh/dsh-flomo.json, mode 0600):
 * webhookUrl wins over apiKey. The flomo tag is customizable (store's
 * flomoTag, default AI/cubox).
 *
 * Pitfall this module guards against: flomo turns every `#词` in the body
 * into a tag, so the digest body is stripped of all `#` characters before
 * sending (the single configured tag is appended via buildTaggedContent).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Config file location shared with dsh-flomo (machine-wide, mode 0600). */
export const FLOMO_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-flomo.json')

/** Test override for the shared flomo config location. */
export function flomoConfigPath(): string {
  const override = process.env.DSH_CUBOX_FLOMO_CONFIG
  return override !== undefined && override !== '' ? override : FLOMO_CONFIG_FILE
}

/** Newer apiKey-format endpoint prefix (mirrors dsh-flomo). */
const FLOMO_API_ENDPOINT = 'https://flomoapp.com/api/prod/apis/webhook/v1/'

/** Request timeout for a flomo POST. */
const REQUEST_TIMEOUT_MS = 20000

/** Persisted flomo credential shape (read-only from cubox's side). */
export interface FlomoCredentials {
  apiKey: string
  webhookUrl: string
}

/** Public flomo status view (never the full credential). */
export interface FlomoStatusView {
  configured: boolean
  /** 'webhookUrl' | 'apiKey' | '' */
  source: string
  masked: string
  configPath: string
}

/** Mask a credential for display, keeping only the head and tail. */
function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value.slice(0, 2) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/** Whether flomo credentials exist on this machine. */
export async function flomoConfigured(): Promise<boolean> {
  return (await loadFlomoCredentials()).resolved !== null
}

/** Public flomo status: source + masked credential. */
export async function flomoStatus(): Promise<FlomoStatusView> {
  const creds = await readFlomoCredentials()
  const source = creds.webhookUrl !== '' ? 'webhookUrl' : (creds.apiKey !== '' ? 'apiKey' : '')
  return {
    configured: source !== '',
    source,
    masked: source === 'webhookUrl' ? mask(creds.webhookUrl) : (source === 'apiKey' ? mask(creds.apiKey) : ''),
    configPath: flomoConfigPath(),
  }
}

/** Read the persisted flomo credentials (never throws). */
export async function readFlomoCredentials(): Promise<FlomoCredentials> {
  let record: Record<string, unknown> = {}
  try {
    const raw = await readFile(flomoConfigPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) record = parsed as Record<string, unknown>
  } catch {
    // Missing or unreadable: not configured.
  }
  return {
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    webhookUrl: typeof record.webhookUrl === 'string' ? record.webhookUrl : '',
  }
}

/**
 * Write flomo credentials to the shared ~/.dsh/dsh-flomo.json (mode 0600).
 * Shared with the dsh-flomo plugin — one place, both plugins use it.
 */
export async function writeFlomoCredentials(next: FlomoCredentials): Promise<void> {
  await mkdir(path.dirname(flomoConfigPath()), { recursive: true })
  await writeFile(flomoConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
}

/** Load and resolve the flomo send URL (null when not configured). */
export async function resolveFlomoUrl(): Promise<string | null> {
  return (await loadFlomoCredentials()).resolved
}

/** Read ~/.dsh/dsh-flomo.json and resolve the request URL. */
async function loadFlomoCredentials(): Promise<{ resolved: string | null }> {
  const creds = await readFlomoCredentials()
  const webhook = creds.webhookUrl.trim()
  if (webhook) return { resolved: webhook }
  const key = creds.apiKey.trim()
  if (key) return { resolved: FLOMO_API_ENDPOINT + '?apiKey=' + encodeURIComponent(key) }
  return { resolved: null }
}

/** One send outcome (never throws for HTTP/parse outcomes). */
export interface FlomoSendResult {
  ok: boolean
  message: string
  code?: number
}

/**
 * POST one memo to the flomo logging API. Resolves { ok, message, code? } —
 * rejects only for transport-level failures.
 */
export async function postMemo(url: string, content: string): Promise<FlomoSendResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(body)
  } catch {
    // Non-JSON body handled below.
  }
  if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).code === 'number') {
    const record = parsed as Record<string, unknown>
    if (record.code === 0) return { ok: true, message: '已写入 flomo', code: 0 }
    return {
      ok: false,
      message: 'flomo 返回错误: ' + String(typeof record.message === 'string' ? record.message : JSON.stringify(parsed)),
      code: record.code as number,
    }
  }
  if (!res.ok) {
    return { ok: false, message: '请求失败（HTTP ' + res.status + '）: ' + body.slice(0, 300) }
  }
  return { ok: true, message: 'flomo 已响应: ' + body.slice(0, 300) }
}

/**
 * Full-width number sign (U+FF03). It reads as a hash mark but is a different
 * code point from the ASCII '#', so flomo's tag parser never turns it into a tag.
 */
export const HASH_SAFE = '＃'

/**
 * Replace every ASCII `#` in a memo body with the full-width `＃`. flomo treats
 * `#词` as a tag; Cubox card titles / URLs / annotation text may contain `#`, so
 * the body must be hash-free while staying readable. Replacing rather than
 * deleting keeps `#123` readable as `＃123`. The only ASCII-hash tags are the
 * configured one(s), appended separately by buildTaggedContent.
 */
export function escapeHashes(content: string): string {
  return (content || '').replace(/#/g, HASH_SAFE)
}

/** Append normalized #tags to a memo body. */
export function buildTaggedContent(content: string, tags: string): string {
  const body = escapeHashes(content).trim()
  const tagList = (tags || '').split(/[\s,，;；]+/).map((t) => t.trim().replace(/^#+/, '')).filter(Boolean)
  const suffix = tagList.map((t) => '#' + t).join(' ')
  return suffix ? body + ' ' + suffix : body
}
