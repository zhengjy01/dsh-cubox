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
    configPath: string;
}
/** Status view with cache stats. */
export interface CuboxStatusView extends CuboxConfigView {
    cachedCards: number;
    cachedAnnotations: number;
    cacheUpdatedAt: string;
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
}
