/**
 * dsh-cubox — model-facing tools.
 *
 * Mounted via ctx.tools.register. Covers the Cubox surface: status, config,
 * manual sync, today's outline, annotation aggregation, and card queries.
 * Every tool resolves to { ok, message, ... } and never throws for API-level
 * outcomes.
 */
import type { CuboxApi } from './api.ts';
import type { CuboxStore } from './store.ts';
/** Shared tool dependencies. */
export interface ToolContext {
    store: CuboxStore;
    api: CuboxApi;
}
/** Date label in local time: YYYY-MM-DD (weekday). */
export declare function dateLabel(date: Date): string;
/** Status tool: configuration + latest sync snapshot summary. */
export declare function cuboxStatusTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Config tool: set/clear the API link, server, token, sync interval. */
export declare function cuboxConfigTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Sync tool: pull the latest collection snapshot into the local cache. */
export declare function cuboxSyncTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Today tool: render a daily outline (summary) of today's collection. */
export declare function cuboxTodayTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Annotations tool: aggregate highlights/notes across cards. */
export declare function cuboxAnnotationsTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Cards tool: query the collection with filters. */
export declare function cuboxCardsTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Build every cubox tool. */
export declare function buildTools(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition[];
