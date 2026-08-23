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
/** Route paths. */
export declare const CUBOX_API: {
    readonly config: "/api/dsh-cubox/config";
    readonly sync: "/api/dsh-cubox/sync";
    readonly status: "/api/dsh-cubox/status";
};
/** Route handler context. */
export interface RouteContext {
    store: CuboxStore;
    api: CuboxApi;
}
/**
 * Build every /api/dsh-cubox route (exact paths).
 * @param deps - store and api client.
 * @returns the route list.
 */
export declare function makeRoutes(deps: RouteContext): ({
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
})[];
