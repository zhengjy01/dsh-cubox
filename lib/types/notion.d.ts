/**
 * dsh-cubox — minimal Notion exporter.
 *
 * Used when the annotation digest destination is `notion`. Mirrors the
 * verified weread-export implementation: normalize the target page id/URL,
 * convert markdown-ish text into paragraph blocks, and create a child page
 * under the configured parent page (appending in batches of 100).
 */
/** Notion REST base URL. */
export declare const NOTION_API = "https://api.notion.com";
/** API version header (covers every endpoint used here). */
export declare const NOTION_VERSION = "2022-06-28";
/** Normalize a Notion page URL / id to the 32-char page id. */
export declare function normalizeNotionPageId(input: string): string;
/** Split markdown text into Notion paragraph blocks. */
export declare function toNotionBlocks(content: string): Array<Record<string, unknown>>;
/**
 * Create a child page under the target parent page with the export content,
 * appending extra blocks in batches if needed. Returns the new page id.
 */
export declare function exportToNotion(token: string, parentId: string, title: string, content: string): Promise<string>;
/** Verify a Notion token (and optionally the target page). */
export declare function testNotion(token: string, targetPageId: string): Promise<{
    ok: boolean;
    message: string;
}>;
