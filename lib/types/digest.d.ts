/**
 * dsh-cubox — annotation digest export with a local dedup ledger.
 *
 * After `doSync` merges the cache, newly created / changed annotations are
 * collected and delivered as one daily digest (card title + link +
 * highlights/notes), auto-split across flomo memos when long. flomo is a
 * write-only sink (no query/update/delete), so a local ledger records every
 * annotation id + content hash that has been pushed — otherwise every sync
 * would re-send the same notes. The ledger mirrors the daily-report pattern
 * (~/.dsh/.flomo-daily-report-sent).
 *
 * Delivery targets: flomo (default) / local markdown / Notion page. The
 * configured LLM may rewrite the digest first (usePrompt + exportPrompt).
 */
import type { CuboxAnnotation } from './api.ts';
import type { CuboxCache } from './sync.ts';
import type { CuboxCredentials, ExportDest } from './store.ts';
/** Safe per-memo size cap (flomo does not document a hard limit). */
export declare const FLOMO_MAX_CHARS = 1800;
/** Default look-back window (days) for eligible annotations. */
export declare const DEFAULT_DIGEST_WINDOW_DAYS = 2;
/** Machine-wide dedup ledger (JSON map id → content hash, mode 0600). */
export declare const DEFAULT_FLOMO_LEDGER_FILE: string;
/** Ledger location: DSH_CUBOX_FLOMO_LEDGER → DSH_HOME → ~/.dsh. */
export declare function flomoLedgerPath(): string;
/** Dedup ledger shape: annotation id → content hash. */
export type FlomoLedger = Record<string, string>;
/** Read the dedup ledger (never throws; missing file → empty). */
export declare function readFlomoLedger(): Promise<FlomoLedger>;
/** Persist the dedup ledger (mode 0600). */
export declare function writeFlomoLedger(ledger: FlomoLedger): Promise<void>;
/** Content hash: changes when text/note/update_time/color change. */
export declare function annotationHash(a: CuboxAnnotation): string;
/** Parse the Cubox API time layout (also tolerates an ISO offset with colon). */
export declare function parseCuboxTime(value: string): number;
/** Local YYYY-MM-DD. */
export declare function ymd(date: Date): string;
/** Digest header line. */
export declare function digestHeader(date: Date): string;
/** Select unsent, settled annotations within the window. */
export declare function selectUnpushedAnnotations(cache: CuboxCache, opts: {
    ledger: FlomoLedger;
    now?: Date;
    windowDays?: number;
    minAgeMinutes?: number;
}): CuboxAnnotation[];
/** One outgoing memo plus the annotation ids it carries (for ledger marking). */
export interface DigestMemo {
    content: string;
    annotationIds: string[];
}
/**
 * Build the raw digest memos for a set of annotations: one daily digest,
 * auto-split by character count (never truncates). Each card contributes a
 * title + link header, then one block per annotation. Splits repeat the
 * digest header and the card header so every memo stays readable.
 */
export declare function buildDigestMemos(cache: CuboxCache, annotations: CuboxAnnotation[], opts?: {
    date?: Date;
    maxChars?: number;
}): DigestMemo[];
/** Full digest markdown (no splitting) — for local files / Notion pages. */
export declare function buildDigestMarkdown(cache: CuboxCache, annotations: CuboxAnnotation[], opts?: {
    date?: Date;
}): string;
/** Split arbitrary text into size-capped chunks with a repeated header. */
export declare function chunkText(text: string, maxChars: number, header: string): string[];
/** Annotations inside the look-back window (for a full-day local/Notion digest). */
export declare function annotationsInWindow(cache: CuboxCache, now: Date, windowDays: number): CuboxAnnotation[];
/** Delivery options for one digest run. */
export interface DigestOptions {
    now?: Date;
    windowDays?: number;
    minAgeMinutes?: number;
    /** Bypass the minimum-age gate (manual push). */
    force?: boolean;
    /** Override the configured flomo tag. */
    tag?: string;
    /** Override the configured output dir (local target). */
    outputDir?: string;
    /** Override the configured destination. */
    dest?: ExportDest;
}
/** One digest delivery outcome. */
export interface DigestResult {
    ok: boolean;
    dest: ExportDest;
    candidates: number;
    memos: number;
    delivered: number;
    message: string;
}
/**
 * Collect unsent annotations and deliver them to the configured target.
 * The dedup ledger is updated per successfully delivered annotation, so a
 * partial failure retries only what did not make it.
 */
export declare function deliverAnnotationDigest(cache: CuboxCache, config: CuboxCredentials, opts?: DigestOptions): Promise<DigestResult>;
