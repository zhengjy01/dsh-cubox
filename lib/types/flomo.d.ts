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
/** Config file location shared with dsh-flomo (machine-wide, mode 0600). */
export declare const FLOMO_CONFIG_FILE: string;
/** Test override for the shared flomo config location. */
export declare function flomoConfigPath(): string;
/** Persisted flomo credential shape (read-only from cubox's side). */
export interface FlomoCredentials {
    apiKey: string;
    webhookUrl: string;
}
/** Public flomo status view (never the full credential). */
export interface FlomoStatusView {
    configured: boolean;
    /** 'webhookUrl' | 'apiKey' | '' */
    source: string;
    masked: string;
    configPath: string;
}
/** Whether flomo credentials exist on this machine. */
export declare function flomoConfigured(): Promise<boolean>;
/** Public flomo status: source + masked credential. */
export declare function flomoStatus(): Promise<FlomoStatusView>;
/** Read the persisted flomo credentials (never throws). */
export declare function readFlomoCredentials(): Promise<FlomoCredentials>;
/**
 * Write flomo credentials to the shared ~/.dsh/dsh-flomo.json (mode 0600).
 * Shared with the dsh-flomo plugin — one place, both plugins use it.
 */
export declare function writeFlomoCredentials(next: FlomoCredentials): Promise<void>;
/** Load and resolve the flomo send URL (null when not configured). */
export declare function resolveFlomoUrl(): Promise<string | null>;
/** One send outcome (never throws for HTTP/parse outcomes). */
export interface FlomoSendResult {
    ok: boolean;
    message: string;
    code?: number;
}
/**
 * POST one memo to the flomo logging API. Resolves { ok, message, code? } —
 * rejects only for transport-level failures.
 */
export declare function postMemo(url: string, content: string): Promise<FlomoSendResult>;
/**
 * Full-width number sign (U+FF03). It reads as a hash mark but is a different
 * code point from the ASCII '#', so flomo's tag parser never turns it into a tag.
 */
export declare const HASH_SAFE = "\uFF03";
/**
 * Replace every ASCII `#` in a memo body with the full-width `＃`. flomo treats
 * `#词` as a tag; Cubox card titles / URLs / annotation text may contain `#`, so
 * the body must be hash-free while staying readable. Replacing rather than
 * deleting keeps `#123` readable as `＃123`. The only ASCII-hash tags are the
 * configured one(s), appended separately by buildTaggedContent.
 */
export declare function escapeHashes(content: string): string;
/** Append normalized #tags to a memo body. */
export declare function buildTaggedContent(content: string, tags: string): string;
