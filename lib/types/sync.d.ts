/**
 * dsh-cubox — core sync/business logic.
 *
 * doSync pulls cards (and optionally today's annotations) from the Cubox
 * API and persists a snapshot to ~/.dsh/dsh-cubox-cache.json so agents can
 * answer "what did I save today" without another round trip. buildTodayOutline
 * renders today's collection into a markdown outline (title + source +
 * description + annotation summary); buildAnnotationsSummary aggregates
 * highlights/notes across cards.
 */
import type { CuboxApi, CuboxCard, CuboxAnnotation } from './api.ts';
import type { CuboxStore } from './store.ts';
/** Sync snapshot persisted to the cache file. */
export interface CuboxCache {
    updatedAt: string;
    cards: CuboxCard[];
    annotations: CuboxAnnotation[];
}
/** Result of one sync run. */
export interface SyncResult {
    ok: boolean;
    message: string;
    pulledCards: number;
    pulledAnnotations: number;
    cachedCards: number;
    cachedAnnotations: number;
    since: string;
    /** Number of markdown files written to the output dir (0 = none). */
    exportedFiles: number;
}
/** Parse the cache file (missing/unreadable → empty). */
export declare function readCache(): Promise<CuboxCache>;
/** Write the cache file (mode 0600). */
export declare function writeCache(cache: CuboxCache): Promise<void>;
/**
 * Pull cards (and today's annotations) and persist the snapshot.
 * `days` controls the look-back window for cards (default 1 = today).
 * Always refreshes the annotation snapshot for today's range so the daily
 * summary has data even when few cards exist.
 */
export declare function doSync(api: CuboxApi, store: CuboxStore, opts?: {
    days?: number;
    limit?: number;
    outputDir?: string;
}): Promise<SyncResult>;
/**
 * Write one markdown file per card into the output directory. Card files
 * mirror the official Cubox Obsidian plugin layout (frontmatter with
 * id/cubox_url/url/tags + title + description + links + annotations).
 * Only today's cards are written (older ones were already exported).
 * Returns the number of files written.
 */
export declare function exportSyncToMarkdown(cache: CuboxCache, outputDir: string): Promise<number>;
