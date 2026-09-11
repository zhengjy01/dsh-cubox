/**
 * Browser-side API client for the /api/dsh-cubox route family. The only
 * data access path the settings panel uses — plain fetch, same origin.
 */
/** Public config view (mirrors the host contract). */
export interface CuboxConfigView {
    configured: boolean;
    server: string;
    tokenMasked: string;
    syncMinutes: number;
    lastSyncAt: string;
    outputDir: string;
    exportCards: boolean;
    llmBaseUrl: string;
    llmModel: string;
    llmKeyMasked: string;
    llmPrompt: string;
    flomoEnabled: boolean;
    exportDest: string;
    flomoTag: string;
    flomoMinAgeMinutes: number;
    usePrompt: boolean;
    exportPrompt: string;
    notionConfigured: boolean;
    notionTargetPageId: string;
    configPath: string;
}
/** Status view with cache + flomo stats. */
export interface CuboxStatusView extends CuboxConfigView {
    cachedCards: number;
    cachedAnnotations: number;
    cacheUpdatedAt: string;
    flomoConfigured: boolean;
    flomoSource: string;
    flomoMasked: string;
    flomoConfigPath: string;
    sentAnnotationCount: number;
}
/** Sync result. */
export interface CuboxSyncResult {
    ok: boolean;
    message: string;
    pulledCards: number;
    pulledAnnotations: number;
    cachedCards: number;
    cachedAnnotations: number;
    exportedFiles: number;
    briefPath: string;
    digestCandidates: number;
    digestMemos: number;
    digestMessage: string;
}
/** Digest delivery result. */
export interface CuboxDigestResult {
    ok: boolean;
    dest: string;
    candidates: number;
    memos: number;
    delivered: number;
    message: string;
}
/** Error carrying the route's JSON error message. */
export declare class CuboxApiError extends Error {
    constructor(message: string);
}
/** The cubox panel API. */
export declare class CuboxApi {
    getConfig(): Promise<CuboxConfigView>;
    setConfig(patch: Record<string, unknown>): Promise<CuboxConfigView>;
    getStatus(): Promise<CuboxStatusView>;
    sync(days?: number): Promise<CuboxSyncResult>;
    /** Open the host OS folder chooser; resolves with the picked path. */
    pickDir(): Promise<{
        ok: boolean;
        path?: string;
        cancelled?: boolean;
        unsupported?: boolean;
        message?: string;
    }>;
    /** Push the annotation digest to flomo (respects the dedup ledger). */
    pushFlomo(body?: {
        days?: number;
        force?: boolean;
        tag?: string;
    }): Promise<CuboxDigestResult>;
    /** Push the annotation digest to the configured destination. */
    pushDigest(body?: {
        days?: number;
        force?: boolean;
        tag?: string;
    }): Promise<CuboxDigestResult>;
    /** Send a test memo to verify the flomo credential. */
    testFlomo(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** Verify the Notion token + target page. */
    testNotion(): Promise<{
        ok: boolean;
        message: string;
    }>;
}
