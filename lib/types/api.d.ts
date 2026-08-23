/**
 * dsh-cubox — Cubox internal API client (/c/api/cli).
 *
 * The public Cubox "open API" only accepts saves; reads go through the
 * internal /c/api/cli/* family used by the official cubox-cli (reverse
 * engineered from OLCUBO/cubox-cli). Covered surface:
 *
 *   GET  /c/api/cli/folder/list              list folders
 *   GET  /c/api/cli/tag/list                 list tags
 *   POST /c/api/cli/card/filter              filter cards (folder/tag/time/…)
 *   GET  /c/api/cli/card/detail?id=          full card detail (content, annotations, insight)
 *   POST /c/api/cli/card/rag/query           semantic search
 *   POST /c/api/cli/annotation/filter        filter annotations/notes
 *
 * Every call carries `Authorization: Bearer <token>`; the response is
 * wrapped as { code, message, data } and code != 200 is an error.
 * Time parameters use the Cubox API layout `YYYY-MM-DDTHH:mm:ss.SSS±HHmm`.
 */
import type { CuboxStore } from './store.ts';
/** API error carrying the server code/message. */
export declare class CuboxApiError extends Error {
    code: number;
    constructor(code: number, message: string);
}
/** One Cubox folder. */
export interface CuboxFolder {
    id: string;
    nested_name: string;
    name: string;
    parent_id: string | null;
    uncategorized?: boolean;
}
/** One Cubox tag. */
export interface CuboxTag {
    id: string;
    nested_name: string;
    name: string;
    parent_id: string | null;
}
/** One annotation (highlight) or note attached to a card. */
export interface CuboxAnnotation {
    id: string;
    text: string;
    note: string;
    image_url: string;
    color: string;
    card_id: string;
    create_time: string;
    update_time: string;
}
/** Card shape from the card/filter list endpoint. */
export interface CuboxCard {
    id: string;
    title: string;
    description: string;
    article_title: string;
    domain: string;
    read: boolean;
    starred: boolean;
    tags: string[];
    folder: CuboxFolder | null;
    url: string;
    create_time: string;
    update_time: string;
}
/** AI insight on a card (summary + Q&A). */
export interface CuboxInsight {
    id: string;
    summary: string;
    qas: Array<{
        q: string;
        a: string;
    }>;
    create_time: string;
    update_time: string;
}
/** Full card detail. */
export interface CuboxCardDetail extends CuboxCard {
    content: string;
    author: string;
    annotations: CuboxAnnotation[];
    insight: CuboxInsight | null;
}
/** card/filter request. */
export interface CuboxCardFilter {
    folder_filters?: string[];
    tag_filters?: string[];
    starred?: boolean;
    read?: boolean;
    annotated?: boolean;
    archived?: boolean;
    last_card_id?: string;
    limit?: number;
    keyword?: string;
    page?: number;
    start_time?: string;
    end_time?: string;
}
/** annotation/filter request. */
export interface CuboxAnnotationFilter {
    colors?: string[];
    last_annotation_id?: string;
    limit?: number;
    keyword?: string;
    start_time?: string;
    end_time?: string;
}
/** Minimal fetch-compatible response contract used by tests. */
export interface FetchLikeResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
}
/** Minimal fetch-compatible global (Node 22+ global fetch already matches). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<FetchLikeResponse>;
/** Format a Date into the Cubox API time layout YYYY-MM-DDTHH:mm:ss.SSS±HHmm. */
export declare function formatApiTime(date: Date): string;
/** Local start-of-day and end-of-day in API format (for "today" ranges). */
export declare function todayRange(): {
    start: string;
    end: string;
};
/**
 * Thin API client bound to one credential store. Stateless besides the
 * store; every call reads the freshest credentials before sending.
 */
export declare class CuboxApi {
    private readonly store;
    private readonly fetchImpl;
    constructor(store: CuboxStore, fetchImpl?: FetchLike);
    /** Base URL for the stored server. */
    private baseUrl;
    /** GET a path with query params, unwrapping the envelope. */
    private get;
    /** POST a JSON body, unwrapping the envelope. */
    private post;
    /** Perform one request and unwrap the { code, message, data } envelope. */
    private request;
    /** List folders. */
    listFolders(): Promise<CuboxFolder[]>;
    /** List tags. */
    listTags(): Promise<CuboxTag[]>;
    /** Filter cards (bookmarks). */
    filterCards(filter: CuboxCardFilter): Promise<CuboxCard[]>;
    /** Full card detail (content, annotations, insight). */
    cardDetail(id: string): Promise<CuboxCardDetail>;
    /** Filter annotations (highlights + notes) across cards. */
    filterAnnotations(filter: CuboxAnnotationFilter): Promise<CuboxAnnotation[]>;
    /** Semantic RAG search over cards. */
    ragQuery(query: string): Promise<CuboxCard[]>;
}
