/**
 * dsh-cubox — core sync/business logic.
 *
 * doSync pulls cards (and today's annotations) from the Cubox API, persists
 * a snapshot to ~/.dsh/dsh-cubox-cache.json, and exports to the configured
 * output dir: optionally one markdown file per card (exportCards), and — when
 * an LLM key is configured — a daily brief generated from the user's prompt
 * template ({collection} placeholder), written as 今日收藏简报-YYYY-MM-DD.md.
 */
import type { CuboxApi, CuboxCard, CuboxAnnotation } from './api.ts';
import type { CuboxStore } from './store.ts';
import { type CuboxCredentials } from './store.ts';
import { type LlmConfig } from './llm.ts';
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
    /** Path of the LLM daily brief written ('' = not written). */
    briefPath: string;
    /** Annotation digest candidates selected this run (0 = none). */
    digestCandidates: number;
    /** flomo/other memos (or files/pages) delivered for the digest. */
    digestMemos: number;
    /** Human-readable digest delivery message ('' = not attempted). */
    digestMessage: string;
    /** Memos sent for the daily brief push (0 = not attempted/skipped). */
    briefFlomoMemos: number;
    /** Human-readable brief-push message, including the skip reason ('' = not attempted). */
    briefFlomoMessage: string;
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
 * Format cards within a time window (from `end` going back `days` days) into
 * a plain text list for the LLM prompt. Each entry: title (source), link,
 * summary, annotations. A leading line states the covered time range so the
 * model knows the window.
 */
export declare function formatCollectionForPrompt(cache: CuboxCache, end: Date, days: number): string;
/**
 * Generate the brief from the user's prompt and write it to the output dir.
 * File name reflects the window: 今日收藏简报-YYYY-MM-DD.md for days=1,
 * 最近N日收藏简报-YYYY-MM-DD.md for days>1 (so a 7-day sync writes its own
 * file instead of overwriting today's).
 */
export declare function writeDailyBrief(cache: CuboxCache, outputDir: string, llm: LlmConfig & {
    prompt: string;
}, opts?: {
    days?: number;
}): Promise<string>;
/** Machine-wide per-day ledger for the brief push (JSON map date → content hash, 0600). */
export declare const DEFAULT_BRIEF_LEDGER_FILE: string;
/** Ledger location: DSH_CUBOX_BRIEF_LEDGER → DSH_HOME → ~/.dsh. */
export declare function briefLedgerPath(): string;
/** Outcome of one daily-brief push attempt. */
export interface BriefPushResult {
    ok: boolean;
    /** True when a gate (time / no cards / already pushed / disabled) skipped the push. */
    skipped: boolean;
    memos: number;
    delivered: number;
    message: string;
}
/**
 * Push the day's collection brief (the LLM brief already written to outputDir)
 * to flomo. Separate from the annotation digest: this is the "collected
 * something today → there is a daily report" path, so days without highlights
 * still get one.
 *
 * At most one push per local day — gates in order: enabled → a brief file
 * exists → the hour gate (briefFlomoHour, 0 = no gate) → the day actually has
 * cards → the per-day ledger. A skipped gate is a normal outcome, not an
 * error, so a 120-minute sync loop stays quiet.
 */
export declare function deliverDailyBrief(cache: CuboxCache, config: CuboxCredentials, briefPath: string, opts?: {
    now?: Date;
    force?: boolean;
}): Promise<BriefPushResult>;
/**
 * Write one markdown file per card into the output directory. Card files
 * mirror the official Cubox Obsidian plugin layout (frontmatter with
 * id/cubox_url/url/tags + title + description + links + annotations).
 * Only today's cards are written (older ones were already exported).
 * Returns the number of files written.
 */
export declare function exportSyncToMarkdown(cache: CuboxCache, outputDir: string): Promise<number>;
