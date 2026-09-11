/**
 * dsh-cubox — minimal Notion exporter.
 *
 * Used when the annotation digest destination is `notion`. Mirrors the
 * verified weread-export implementation: normalize the target page id/URL,
 * convert markdown-ish text into paragraph blocks, and create a child page
 * under the configured parent page (appending in batches of 100).
 */

/** Notion REST base URL. */
export const NOTION_API = 'https://api.notion.com'
/** API version header (covers every endpoint used here). */
export const NOTION_VERSION = '2022-06-28'
/** Notion allows at most 100 blocks per create/append call. */
const NOTION_BLOCKS_PER_CALL = 100

/** Normalize a Notion page URL / id to the 32-char page id. */
export function normalizeNotionPageId(input: string): string {
  const value = input.trim()
  if (value === '') throw new Error('请填写 Notion 目标页面 URL 或 ID。')
  const hex = value.match(/[0-9a-f]{32}/i)
  if (hex) return hex[0].toLowerCase()
  const compact = value.replace(/-/g, '')
  if (/^[0-9a-f]{32}$/i.test(compact)) return compact.toLowerCase()
  throw new Error('无法识别 Notion 页面 ID：请粘贴页面链接或 32 位页面 ID。')
}

/** Split markdown text into Notion paragraph blocks. */
export function toNotionBlocks(content: string): Array<Record<string, unknown>> {
  const lines = content.split('\n').map((l) => l.trimEnd())
  const blocks: Array<Record<string, unknown>> = []
  for (const line of lines) {
    if (line === '') continue
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
      },
    })
  }
  return blocks
}

/** One Notion API call with normalized errors. */
async function notionCall(token: string, method: string, apiPath: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(NOTION_API + apiPath, {
      method,
      headers: {
        'Authorization': 'Bearer ' + token.trim(),
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error('Notion 请求失败（网络错误）: ' + String(error instanceof Error ? error.message : error))
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Notion 返回了无法解析的响应（HTTP ' + response.status + '）')
  }
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
    const message = typeof record.message === 'string' ? record.message : 'HTTP ' + response.status
    throw new Error('Notion API 错误: ' + message)
  }
  return (typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {})
}

/**
 * Create a child page under the target parent page with the export content,
 * appending extra blocks in batches if needed. Returns the new page id.
 */
export async function exportToNotion(
  token: string,
  parentId: string,
  title: string,
  content: string,
): Promise<string> {
  if (token.trim() === '') throw new Error('Notion 未配置：请先在设置面板「标注 digest」区填写 Integration Token。')
  const pageId = normalizeNotionPageId(parentId)
  const blocks = toNotionBlocks(content)
  const children = blocks.slice(0, NOTION_BLOCKS_PER_CALL)
  const created = await notionCall(token, 'POST', '/v1/pages', {
    parent: { page_id: pageId },
    properties: {
      title: { title: [{ text: { content: title.slice(0, 200) } }] },
    },
    children,
  })
  const newPageId = typeof created.id === 'string' ? created.id : ''
  for (let offset = NOTION_BLOCKS_PER_CALL; offset < blocks.length; offset += NOTION_BLOCKS_PER_CALL) {
    const batch = blocks.slice(offset, offset + NOTION_BLOCKS_PER_CALL)
    await notionCall(token, 'PATCH', '/v1/blocks/' + newPageId + '/children', { children: batch })
  }
  return newPageId
}

/** Verify a Notion token (and optionally the target page). */
export async function testNotion(
  token: string,
  targetPageId: string,
): Promise<{ ok: boolean; message: string }> {
  if (token.trim() === '') return { ok: false, message: 'Notion 未配置：请先填写 Integration Token。' }
  try {
    const meRes = await fetch(NOTION_API + '/v1/users/me', {
      headers: { 'Authorization': 'Bearer ' + token.trim(), 'Notion-Version': NOTION_VERSION },
      signal: AbortSignal.timeout(15000),
    })
    if (!meRes.ok) {
      const body = await meRes.text().catch(() => '')
      return { ok: false, message: 'Token 无效（HTTP ' + meRes.status + '）：' + body.slice(0, 200) }
    }
    const me = await meRes.json().catch(() => ({})) as { name?: string }
    const workspace = me.name ?? '未知工作区'
    if (targetPageId.trim() === '') {
      return { ok: true, message: 'Token 有效（工作区：' + workspace + '）。未配置目标页面。' }
    }
    let pageId: string
    try {
      pageId = normalizeNotionPageId(targetPageId)
    } catch (error) {
      return { ok: false, message: 'Token 有效（工作区：' + workspace + '），但目标页面 ID 无法解析：' + String(error instanceof Error ? error.message : error) }
    }
    const pageRes = await fetch(NOTION_API + '/v1/pages/' + pageId, {
      headers: { 'Authorization': 'Bearer ' + token.trim(), 'Notion-Version': NOTION_VERSION },
      signal: AbortSignal.timeout(15000),
    })
    if (pageRes.status === 404) {
      return { ok: false, message: 'Token 有效（工作区：' + workspace + '），但目标页面不可访问（404）：请先把该页面分享给此 Integration。' }
    }
    if (!pageRes.ok) {
      return { ok: false, message: 'Token 有效（工作区：' + workspace + '），但读取目标页失败（HTTP ' + pageRes.status + '）。' }
    }
    return { ok: true, message: '✅ Notion 配置有效：工作区「' + workspace + '」，目标页面可访问。' }
  } catch (error) {
    return { ok: false, message: '测试失败：' + String(error instanceof Error ? error.message : error) }
  }
}
