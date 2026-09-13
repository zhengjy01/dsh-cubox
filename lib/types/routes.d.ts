/**
 * dsh-cubox — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-cubox/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin) — the settings panel is the only
 * consumer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CuboxStore } from './store.ts';
import type { CuboxApi } from './api.ts';
/** Minimal host directory-picker seam (duck-typed; native = OS folder chooser). */
export interface NativeDirectoryPicker {
    capability(): {
        kind: 'native';
        pick(signal: AbortSignal): Promise<string | null>;
    } | {
        kind: 'browse';
    };
}
/** Route paths. */
export declare const CUBOX_API: {
    readonly probe: "/api/dsh-cubox/probe";
    readonly config: "/api/dsh-cubox/config";
    readonly sync: "/api/dsh-cubox/sync";
    readonly status: "/api/dsh-cubox/status";
    readonly pickDir: "/api/dsh-cubox/pick-dir";
    readonly flomo: "/api/dsh-cubox/flomo";
    readonly digest: "/api/dsh-cubox/digest";
    readonly testFlomo: "/api/dsh-cubox/test-flomo";
    readonly testNotion: "/api/dsh-cubox/test-notion";
};
/** Route handler context. */
export interface RouteContext {
    store: CuboxStore;
    api: CuboxApi;
    /**
     * Lazily resolve the host directory picker at request time (by then every
     * plugin is loaded, so the picker service is guaranteed registered).
     */
    getPicker?: () => NativeDirectoryPicker | undefined;
}
/**
 * Build every /api/dsh-cubox route (exact paths).
 * @param deps - store, api client, and optional picker resolver.
 * @returns the route list.
 */
export declare function makeRoutes(deps: RouteContext): ({
    kind: "exact";
    path: "/api/dsh-cubox/probe";
    handler: (req: IncomingMessage, res: ServerResponse) => void;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/config";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/status";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/sync";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/pick-dir";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/flomo";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/digest";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/test-flomo";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-cubox/test-notion";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
})[];
