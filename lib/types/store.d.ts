/**
 * dsh-cubox — credential/cache store.
 *
 * Persists the Cubox API-extension credentials to ~/.dsh/dsh-cubox.json
 * (mode 0600) and the latest sync snapshot to ~/.dsh/dsh-cubox-cache.json.
 * The config file holds the API-extension link (or its server + token) plus
 * the scheduled-sync interval. Reads are lazy and cached; the public view()
 * never exposes secrets. Config paths can be overridden with DSH_CUBOX_CONFIG
 * / DSH_CUBOX_CACHE (used by the smoke tests).
 */
/** Default machine-wide config location (mode 0600). */
export declare const DEFAULT_CONFIG_FILE: string;
/** Default sync cache location (mode 0600). */
export declare const DEFAULT_CACHE_FILE: string;
/** Test override for the config location. */
export declare function configPath(): string;
/** Test override for the cache location. */
export declare function cachePath(): string;
/** Cubox server instances. */
export type CuboxServer = 'cubox.pro' | 'cubox.cc';
export declare const SERVER_LABEL: Record<CuboxServer, string>;
/** Persisted credential shape. Secrets never leave this module. */
export interface CuboxCredentials {
    /** cubox.pro (default) or cubox.cc. */
    server: CuboxServer;
    /** API-extension token (the last path segment of the API link). */
    token: string;
    /** Scheduled sync interval in minutes; 0 disables the timer. */
    syncMinutes: number;
    /** ISO timestamp of the last successful sync. */
    lastSyncAt: string;
    /** Local directory for markdown export on sync ('' = no export). */
    outputDir: string;
    /** Whether to write one markdown file per card on sync (default true). */
    exportCards: boolean;
    /** LLM base URL (OpenAI-compatible). */
    llmBaseUrl: string;
    /** LLM API key. */
    llmApiKey: string;
    /** LLM model name. */
    llmModel: string;
    /** Prompt template for the daily brief; {collection} is replaced with the formatted collection. */
    llmPrompt: string;
    /** Whether to export newly settled annotations as a digest after each sync. */
    flomoEnabled: boolean;
    /** Annotation digest destination. */
    exportDest: ExportDest;
    /** flomo tag appended to the digest (without leading #). */
    flomoTag: string;
    /** Minimum annotation age (minutes) before it may be pushed (avoid half-typed notes). */
    flomoMinAgeMinutes: number;
    /** Whether to run the digest through the LLM exportPrompt before delivery. */
    usePrompt: boolean;
    /** Digest prompt template; {digest} is replaced with the raw digest. */
    exportPrompt: string;
    /** Notion integration token (for exportDest=notion). */
    notionToken: string;
    /** Notion target parent page id or URL (for exportDest=notion). */
    notionTargetPageId: string;
}
/** Annotation digest destination. */
export type ExportDest = 'flomo' | 'local' | 'notion';
/** Default flomo tag for the Cubox annotation digest. */
export declare const DEFAULT_FLOMO_TAG = "AI/cubox";
/** Default digest prompt template ({digest} placeholder). */
export declare const DEFAULT_EXPORT_PROMPT: string;
/** Default prompt for the daily collection brief. */
export declare const DEFAULT_LLM_PROMPT: string;
/** Public, secret-free status view. */
export interface CuboxConfigView {
    configured: boolean;
    server: CuboxServer;
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
    exportDest: ExportDest;
    flomoTag: string;
    flomoMinAgeMinutes: number;
    usePrompt: boolean;
    exportPrompt: string;
    notionConfigured: boolean;
    notionTargetPageId: string;
    configPath: string;
}
/** Mask a credential for display, keeping only the head and tail. */
export declare function mask(value: string): string;
/**
 * Parse an API-extension link into { server, token }. The link looks like
 * https://cubox.pro/c/api/save/abcd12345 — server from the host, token from
 * the last path segment. Accepts bare tokens too (default server cubox.pro).
 */
export declare function parseApiLink(input: string): {
    server: CuboxServer;
    token: string;
} | null;
/**
 * Small credential store backed by ~/.dsh/dsh-cubox.json.
 * Reads are lazy and cached; writes use mode 0600 so the API token never
 * leaks to other local users.
 */
export declare class CuboxStore {
    config: CuboxCredentials | null;
    /**
     * Optional observer fired after every successful save — from the settings
     * panel POST, the cubox_config tool, or the lastSyncAt stamp in doSync.
     * The host uses it to re-arm the scheduled-sync timer when the interval
     * changes at runtime, so a panel edit applies without a `dsh web` restart.
     */
    onSaved?: (config: CuboxCredentials) => void;
    load(): Promise<CuboxCredentials>;
    save(next: CuboxCredentials): Promise<void>;
    /** Public, secret-free view. */
    view(): Promise<CuboxConfigView>;
    /**
     * Apply a config patch: apiLink (parse into server+token) / server / token
     * / syncMinutes / outputDir / exportCards / LLM fields replace, reset clears.
     * Returns the public view.
     */
    patch(args: Record<string, unknown> | undefined): Promise<CuboxConfigView>;
}
