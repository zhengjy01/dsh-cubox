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
}
