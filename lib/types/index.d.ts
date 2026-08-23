/**
 * dsh-cubox — Cubox sync for DeepSeek Harness.
 * Host half.
 *
 * Mounts the cubox tools (status / config / sync / today / annotations /
 * cards), the /api/dsh-cubox route family the settings panel talks to, a
 * scheduled sync timer (cordis ctx.interval, interval in minutes from the
 * plugin config, 0 disables), and a system-prompt announcement. The Cubox
 * API-extension credentials live in ~/.dsh/dsh-cubox.json (mode 0600) and
 * the sync snapshot in ~/.dsh/dsh-cubox-cache.json. All reads ride the
 * /c/api/cli endpoints shared with the official cubox-cli — no dsh source
 * changes.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Stable cordis plugin name. */
export declare const name = "cubox";
/** Services required before the cubox surfaces can mount. */
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const CUBOX_GUIDANCE: string;
/** Plugin config, read from the composition row. */
export interface Config {
    /** When true (default), a system-prompt section announces the plugin. */
    announceToAgent?: boolean;
    /** Master switch for the plugin (routes, tools, prompt section, timer). */
    enabled?: boolean;
    /** Scheduled sync interval in minutes; 0 disables the timer. */
    syncMinutes?: number;
}
/**
 * Mount the cubox tools, routes, announcement, and scheduled sync.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer/timer.
 * @param config - plugin config from the composition row.
 */
export declare function apply(ctx: Context, config?: Config): void;
/** Re-exports for host consumers and the smoke tests. */
export { CuboxStore, mask, parseApiLink, configPath, cachePath, type CuboxConfigView, type CuboxCredentials } from './store.ts';
export { CuboxApi, CuboxApiError, formatApiTime, todayRange, type CuboxCard, type CuboxAnnotation, type CuboxCardDetail, type CuboxFolder, type CuboxTag } from './api.ts';
export { cuboxStatusTool, cuboxConfigTool, cuboxSyncTool, cuboxTodayTool, cuboxAnnotationsTool, cuboxCardsTool, buildTools, dateLabel, type ToolContext } from './tools.ts';
export { doSync, readCache, writeCache, buildDailyOutline, buildAnnotationsSummary, type CuboxCache, type SyncResult } from './sync.ts';
export { makeRoutes, CUBOX_API } from './routes.ts';
export { defineTool };
