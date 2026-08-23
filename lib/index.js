import { defineTool, defineTool as defineTool$1 } from "@deepseek-ai/dsh-tools";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
//#region src/store.ts
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
const DEFAULT_CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-cubox.json");
/** Default sync cache location (mode 0600). */
const DEFAULT_CACHE_FILE = path.join(homedir(), ".dsh", "dsh-cubox-cache.json");
/** Test override for the config location. */
function configPath() {
	const override = process.env.DSH_CUBOX_CONFIG;
	return override !== void 0 && override !== "" ? override : DEFAULT_CONFIG_FILE;
}
/** Test override for the cache location. */
function cachePath() {
	const override = process.env.DSH_CUBOX_CACHE;
	return override !== void 0 && override !== "" ? override : DEFAULT_CACHE_FILE;
}
/** Mask a credential for display, keeping only the head and tail. */
function mask(value) {
	if (!value) return "";
	if (value.length <= 8) return value.slice(0, 2) + "****";
	return value.slice(0, 4) + "****" + value.slice(-4);
}
/**
* Parse an API-extension link into { server, token }. The link looks like
* https://cubox.pro/c/api/save/abcd12345 — server from the host, token from
* the last path segment. Accepts bare tokens too (default server cubox.pro).
*/
function parseApiLink(input) {
	const value = (input ?? "").trim();
	if (value === "") return null;
	if (!value.includes("/")) return {
		server: "cubox.pro",
		token: value
	};
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		if (host.endsWith("cubox.cc")) return {
			server: "cubox.cc",
			token: lastSegment(url.pathname)
		};
		if (host.endsWith("cubox.pro")) return {
			server: "cubox.pro",
			token: lastSegment(url.pathname)
		};
		return null;
	} catch {
		return null;
	}
}
/** Last non-empty path segment. */
function lastSegment(pathname) {
	const parts = pathname.split("/").filter((p) => p !== "");
	return parts.length > 0 ? parts[parts.length - 1] ?? "" : "";
}
/** Empty credentials record. */
function empty() {
	return {
		server: "cubox.pro",
		token: "",
		syncMinutes: 60,
		lastSyncAt: ""
	};
}
/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const server = record.server === "cubox.cc" ? "cubox.cc" : "cubox.pro";
	const str = (value) => typeof value === "string" ? value : "";
	const num = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 60;
	return {
		server,
		token: str(record.token),
		syncMinutes: num(record.syncMinutes),
		lastSyncAt: str(record.lastSyncAt)
	};
}
/**
* Small credential store backed by ~/.dsh/dsh-cubox.json.
* Reads are lazy and cached; writes use mode 0600 so the API token never
* leaks to other local users.
*/
var CuboxStore = class {
	config = null;
	async load() {
		if (this.config !== null) return this.config;
		try {
			const raw = await readFile(configPath(), "utf8");
			this.config = parse(JSON.parse(raw));
		} catch {
			this.config = empty();
		}
		return this.config;
	}
	async save(next) {
		this.config = next;
		await mkdir(path.dirname(configPath()), { recursive: true });
		await writeFile(configPath(), JSON.stringify(next, null, 2), { mode: 384 });
	}
	/** Public, secret-free view. */
	async view() {
		const cfg = await this.load();
		return {
			configured: cfg.token.trim() !== "",
			server: cfg.server,
			tokenMasked: cfg.token.trim() !== "" ? mask(cfg.token) : "",
			syncMinutes: cfg.syncMinutes,
			lastSyncAt: cfg.lastSyncAt,
			configPath: configPath()
		};
	}
	/**
	* Apply a config patch: apiLink (parse into server+token) / server / token
	* / syncMinutes replace, reset clears. Returns the public view.
	*/
	async patch(args) {
		const cfg = await this.load();
		let next = { ...cfg };
		if (args !== void 0 && args.reset === true) next = {
			...empty(),
			syncMinutes: cfg.syncMinutes
		};
		if (args !== void 0 && typeof args.apiLink === "string" && args.apiLink.trim() !== "") {
			const parsed = parseApiLink(args.apiLink);
			if (parsed !== null) {
				next.server = parsed.server;
				next.token = parsed.token;
			}
		}
		if (args !== void 0 && typeof args.token === "string") next.token = args.token.trim();
		if (args !== void 0 && typeof args.server === "string") next.server = args.server === "cubox.cc" ? "cubox.cc" : "cubox.pro";
		if (args !== void 0 && typeof args.syncMinutes === "number" && Number.isFinite(args.syncMinutes)) next.syncMinutes = Math.max(0, Math.floor(args.syncMinutes));
		await this.save(next);
		return this.view();
	}
};
//#endregion
//#region src/api.ts
/** Request timeout for API calls. */
const REQUEST_TIMEOUT_MS = 3e4;
/** API error carrying the server code/message. */
var CuboxApiError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "CuboxApiError";
		this.code = code;
	}
};
/** Format a Date into the Cubox API time layout YYYY-MM-DDTHH:mm:ss.SSS±HHmm. */
function formatApiTime(date) {
	const pad = (n, w = 2) => String(n).padStart(w, "0");
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	const off = sign + pad(Math.floor(abs / 60)) + pad(abs % 60);
	return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) + "." + pad(date.getMilliseconds(), 3) + off;
}
/** Local start-of-day and end-of-day in API format (for "today" ranges). */
function todayRange() {
	const now = /* @__PURE__ */ new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
	return {
		start: formatApiTime(start),
		end: formatApiTime(end)
	};
}
/**
* Thin API client bound to one credential store. Stateless besides the
* store; every call reads the freshest credentials before sending.
*/
var CuboxApi = class {
	store;
	fetchImpl;
	constructor(store, fetchImpl = fetch) {
		this.store = store;
		this.fetchImpl = fetchImpl;
	}
	/** Base URL for the stored server. */
	async baseUrl() {
		return "https://" + (await this.store.load()).server + "/c/api/cli";
	}
	/** GET a path with query params, unwrapping the envelope. */
	async get(path, params = {}) {
		const cfg = await this.store.load();
		const url = new URL(await this.baseUrl() + path);
		for (const [key, value] of Object.entries(params)) if (value !== "") url.searchParams.set(key, value);
		return this.request(url, cfg);
	}
	/** POST a JSON body, unwrapping the envelope. */
	async post(path, body) {
		const cfg = await this.store.load();
		return this.request(await this.baseUrl() + path, cfg, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body ?? {})
		});
	}
	/** Perform one request and unwrap the { code, message, data } envelope. */
	async request(input, cfg, init) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await this.fetchImpl(input, {
				...init,
				headers: {
					Authorization: "Bearer " + cfg.token,
					...init?.headers ?? {}
				},
				signal: controller.signal
			});
			const textBody = await response.text();
			let envelope;
			try {
				envelope = JSON.parse(textBody);
			} catch {
				throw new CuboxApiError(response.status, "Cubox 返回非 JSON 响应（HTTP " + response.status + "）：" + textBody.slice(0, 200));
			}
			if (typeof envelope.code !== "number" || envelope.code !== 200) {
				const message = typeof envelope.message === "string" && envelope.message !== "" ? envelope.message : "HTTP " + response.status;
				throw new CuboxApiError(typeof envelope.code === "number" ? envelope.code : response.status, message);
			}
			return envelope.data;
		} catch (error) {
			if (error instanceof CuboxApiError) throw error;
			if (error instanceof Error && error.name === "AbortError") throw new CuboxApiError(0, "请求超时（30000ms）");
			throw new CuboxApiError(0, "网络请求失败：" + String(error instanceof Error ? error.message : error));
		} finally {
			clearTimeout(timer);
		}
	}
	/** List folders. */
	async listFolders() {
		const data = await this.get("/folder/list");
		return Array.isArray(data) ? data : [];
	}
	/** List tags. */
	async listTags() {
		const data = await this.get("/tag/list");
		return Array.isArray(data) ? data : [];
	}
	/** Filter cards (bookmarks). */
	async filterCards(filter) {
		const data = await this.post("/card/filter", filter);
		return Array.isArray(data) ? data : [];
	}
	/** Full card detail (content, annotations, insight). */
	async cardDetail(id) {
		const data = await this.get("/card/detail", { id });
		if (typeof data !== "object" || data === null) throw new CuboxApiError(0, "card/detail 返回了空数据");
		return data;
	}
	/** Filter annotations (highlights + notes) across cards. */
	async filterAnnotations(filter) {
		const data = await this.post("/annotation/filter", filter);
		return Array.isArray(data) ? data : [];
	}
	/** Semantic RAG search over cards. */
	async ragQuery(query) {
		const data = await this.post("/card/rag/query", { query });
		return Array.isArray(data) ? data : [];
	}
};
//#endregion
//#region src/sync.ts
/**
* dsh-cubox — core sync/business logic.
*
* doSync pulls cards (and optionally today's annotations) from the Cubox
* API and persists a snapshot to ~/.dsh/dsh-cubox-cache.json so agents can
* answer "what did I save today" without another round trip. buildTodayOutline
* renders today's collection into a markdown outline (title + source +
* description + annotation summary); buildAnnotationsSummary aggregates
* highlights/notes across cards.
*/
/** Parse the cache file (missing/unreadable → empty). */
async function readCache() {
	try {
		const raw = await readFile(cachePath(), "utf8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {
			updatedAt: "",
			cards: [],
			annotations: []
		};
		const record = parsed;
		return {
			updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
			cards: Array.isArray(record.cards) ? record.cards : [],
			annotations: Array.isArray(record.annotations) ? record.annotations : []
		};
	} catch {
		return {
			updatedAt: "",
			cards: [],
			annotations: []
		};
	}
}
/** Write the cache file (mode 0600). */
async function writeCache(cache) {
	await mkdir(path.dirname(cachePath()), { recursive: true });
	await writeFile(cachePath(), JSON.stringify(cache, null, 2), { mode: 384 });
}
/**
* Pull cards (and today's annotations) and persist the snapshot.
* `days` controls the look-back window for cards (default 1 = today).
* Always refreshes the annotation snapshot for today's range so the daily
* summary has data even when few cards exist.
*/
async function doSync(api, store, opts = {}) {
	const days = typeof opts.days === "number" && opts.days > 0 ? Math.floor(opts.days) : 1;
	const limit = typeof opts.limit === "number" && opts.limit > 0 ? Math.floor(opts.limit) : 200;
	const now = /* @__PURE__ */ new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
	const { start: startStr } = { start: "" };
	const cardStart = formatLocal$1(start);
	const cardEnd = formatLocal$1(now);
	let cards = [];
	try {
		cards = await api.filterCards({
			start_time: cardStart,
			end_time: cardEnd,
			limit
		});
	} catch {
		cards = await api.filterCards({ limit });
	}
	const range = todayRange();
	let annotations = [];
	try {
		annotations = await api.filterAnnotations({
			start_time: range.start,
			end_time: range.end,
			limit: 500
		});
	} catch {
		annotations = [];
	}
	const prev = await readCache();
	const cardMap = /* @__PURE__ */ new Map();
	for (const card of prev.cards) cardMap.set(card.id, card);
	for (const card of cards) cardMap.set(card.id, card);
	const mergedCards = [...cardMap.values()].sort((a, b) => b.create_time.localeCompare(a.create_time));
	const annotationMap = /* @__PURE__ */ new Map();
	for (const a of prev.annotations) annotationMap.set(a.id, a);
	for (const a of annotations) annotationMap.set(a.id, a);
	const mergedAnnotations = [...annotationMap.values()].sort((a, b) => b.create_time.localeCompare(a.create_time));
	const cache = {
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		cards: mergedCards,
		annotations: mergedAnnotations
	};
	await writeCache(cache);
	await store.save({
		...await store.load(),
		lastSyncAt: cache.updatedAt
	});
	return {
		ok: true,
		message: "同步完成：拉取卡片 " + cards.length + " 条、标注 " + annotations.length + " 条；缓存现有卡片 " + mergedCards.length + " 条、标注 " + mergedAnnotations.length + " 条。",
		pulledCards: cards.length,
		pulledAnnotations: annotations.length,
		cachedCards: mergedCards.length,
		cachedAnnotations: mergedAnnotations.length,
		since: cardStart
	};
}
/** Local time in the Cubox API layout (no tz-aware dependency). */
function formatLocal$1(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) + ".000" + tzOffset(date);
}
/** ±HHmm offset for a date. */
function tzOffset(date) {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return sign + String(Math.floor(abs / 60)).padStart(2, "0") + String(abs % 60).padStart(2, "0");
}
/** Domain of a card URL, or '' when unparsable. */
function cardDomain$1(card) {
	try {
		return new URL(card.url).hostname.replace(/^www\./, "");
	} catch {
		return card.domain ?? "";
	}
}
/**
* Build a markdown outline of a date's collection (default: today) from the
* cached cards. Sections: overview stats, then per-card entries with title,
* source, URL, description, tags, and annotation count.
*/
function buildDailyOutline(cards, annotations, dateLabel) {
	const lines = [];
	lines.push("# " + dateLabel + " 收藏总结大纲");
	lines.push("");
	lines.push("- 收藏 " + cards.length + " 条 · 标注 " + annotations.length + " 条");
	if (cards.length === 0) {
		lines.push("");
		lines.push("今天还没有新收藏。");
		return lines.join("\n");
	}
	lines.push("");
	lines.push("## 收藏概览");
	lines.push("");
	const domains = /* @__PURE__ */ new Map();
	for (const card of cards) {
		const d = cardDomain$1(card);
		domains.set(d, (domains.get(d) ?? 0) + 1);
	}
	for (const [domain, count] of [...domains.entries()].sort((a, b) => b[1] - a[1])) lines.push("- **" + (domain || "其他") + "**：" + count + " 条");
	lines.push("");
	lines.push("## 收藏明细");
	lines.push("");
	for (const card of cards) {
		const title = card.title || card.article_title || card.url;
		lines.push("### " + title);
		lines.push("");
		lines.push("- 来源：" + (cardDomain$1(card) || "未知"));
		if (card.url !== "") lines.push("- 链接：" + card.url);
		if (card.description !== "") lines.push("- 描述：" + card.description.trim());
		if (card.tags !== void 0 && card.tags.length > 0) lines.push("- 标签：" + card.tags.join("、"));
		const cardAnnotations = annotations.filter((a) => a.card_id === card.id);
		if (cardAnnotations.length > 0) {
			lines.push("- 标注 " + cardAnnotations.length + " 条：");
			for (const a of cardAnnotations.slice(0, 5)) {
				const parts = [];
				const highlight = (a.text || "").trim().replace(/\s+/g, " ");
				const note = (a.note || "").trim().replace(/\s+/g, " ");
				if (highlight !== "") parts.push(highlight);
				if (note !== "") parts.push("笔记：" + note);
				if (parts.length === 0) parts.push("（无文本内容）");
				const snippet = parts.join(" ｜ ");
				lines.push("  - " + snippet.slice(0, 140) + (snippet.length > 140 ? "…" : ""));
			}
			if (cardAnnotations.length > 5) lines.push("  - …（其余 " + (cardAnnotations.length - 5) + " 条见缓存）");
		}
		lines.push("");
	}
	return lines.join("\n");
}
/**
* Aggregate annotations into a markdown summary grouped by card title.
* Each entry: source card, the annotation text and its note, color, time.
*/
function buildAnnotationsSummary(annotations, cardTitleById) {
	if (annotations.length === 0) return "（没有符合条件的标注/笔记）";
	const byCard = /* @__PURE__ */ new Map();
	for (const a of annotations) {
		const list = byCard.get(a.card_id) ?? [];
		list.push(a);
		byCard.set(a.card_id, list);
	}
	const lines = ["共 " + annotations.length + " 条标注/笔记：", ""];
	for (const [cardId, list] of byCard) {
		const title = cardTitleById.get(cardId) ?? cardId;
		lines.push("### " + title);
		lines.push("");
		for (const a of list) {
			const parts = [];
			if (a.text !== "") parts.push("高亮：" + a.text.trim());
			if (a.note !== "") parts.push("笔记：" + a.note.trim());
			if (parts.length === 0) parts.push("（无文本内容）");
			lines.push("- " + parts.join(" ｜ "));
			if (a.color !== "") lines.push("  - 颜色：" + a.color);
			if (a.create_time !== "") lines.push("  - 时间：" + a.create_time);
		}
		lines.push("");
	}
	return lines.join("\n");
}
//#endregion
//#region src/tools.ts
/** One text content block (the only render shape these tools emit). */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Readable error for API failures. */
function apiError(err) {
	if (err instanceof CuboxApiError) return err.message;
	return String(err instanceof Error ? err.message : err);
}
/** Date label in local time: YYYY-MM-DD (weekday). */
function dateLabel(date) {
	const weekdays = [
		"日",
		"一",
		"二",
		"三",
		"四",
		"五",
		"六"
	];
	const pad = (n) => String(n).padStart(2, "0");
	return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "（周" + weekdays[date.getDay()] + "）";
}
/** Is this card created on the given local date? */
function isSameLocalDate(iso, date) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return false;
	return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
}
/** Status tool: configuration + latest sync snapshot summary. */
function cuboxStatusTool(ctx) {
	return defineTool$1({
		name: "cubox_status",
		description: "查看 dsh-cubox 插件状态：是否已配置 Cubox API 链接、服务器（cubox.pro / cubox.cc）、定时同步间隔、最近同步时间与缓存规模。不会泄露 token。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					configured: { type: "boolean" },
					server: { type: "string" },
					tokenMasked: { type: "string" },
					syncMinutes: { type: "number" },
					lastSyncAt: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			const view = await ctx.store.view();
			const cache = await readCache();
			return {
				ok: true,
				message: [
					view.configured ? "已配置：服务器 " + view.server + "，token " + view.tokenMasked : "未配置：请先提供 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接），调用 cubox_config 配置。",
					"定时同步：" + (view.syncMinutes > 0 ? "每 " + view.syncMinutes + " 分钟" : "已关闭"),
					"最近同步：" + (view.lastSyncAt !== "" ? view.lastSyncAt : "从未同步"),
					"缓存：卡片 " + cache.cards.length + " 条、标注 " + cache.annotations.length + " 条",
					"配置路径：" + view.configPath
				].join("\n"),
				configured: view.configured,
				server: view.server,
				tokenMasked: view.tokenMasked,
				syncMinutes: view.syncMinutes,
				lastSyncAt: view.lastSyncAt,
				configPath: view.configPath
			};
		}
	});
}
/** Config tool: set/clear the API link, server, token, sync interval. */
function cuboxConfigTool(ctx) {
	return defineTool$1({
		name: "cubox_config",
		description: "配置或清除 Cubox API 扩展凭据与定时同步间隔。apiLink 填完整 API 扩展链接（形如 https://cubox.pro/c/api/save/xxxx，自动解析 server 与 token）；也可分别填 server（cubox.pro / cubox.cc）与 token。syncMinutes 为定时同步间隔（分钟，0=关闭定时）。reset: true 清除凭据。凭据持久化到 ~/.dsh/dsh-cubox.json（权限 0600）。",
		parameters: {
			apiLink: {
				type: "string",
				description: "完整 API 扩展链接（https://cubox.pro/c/api/save/xxxx 或 https://cubox.cc/c/api/save/xxxx）"
			},
			server: {
				type: "string",
				description: "服务器：cubox.pro（国内）或 cubox.cc（国际版）"
			},
			token: {
				type: "string",
				description: "API token（链接最后一段）"
			},
			syncMinutes: {
				type: "number",
				description: "定时同步间隔（分钟），0 = 关闭定时"
			},
			reset: {
				type: "boolean",
				description: "设为 true 清除全部凭据"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					configured: { type: "boolean" },
					server: { type: "string" },
					tokenMasked: { type: "string" },
					syncMinutes: { type: "number" },
					lastSyncAt: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (args !== void 0 && args.reset === true) {
				const view = await ctx.store.patch({ reset: true });
				return {
					ok: true,
					message: "已清除 Cubox 凭据。",
					configured: view.configured,
					server: view.server,
					tokenMasked: view.tokenMasked,
					syncMinutes: view.syncMinutes,
					lastSyncAt: view.lastSyncAt,
					configPath: view.configPath
				};
			}
			const view = await ctx.store.patch(args);
			if (!view.configured) return {
				ok: false,
				message: "配置未生效：缺少 token。请提供完整的 API 扩展链接。",
				configured: view.configured,
				server: view.server,
				tokenMasked: view.tokenMasked,
				syncMinutes: view.syncMinutes,
				lastSyncAt: view.lastSyncAt,
				configPath: view.configPath
			};
			const parts = ["已保存 Cubox 配置：服务器 " + view.server + "，token " + view.tokenMasked];
			if (view.syncMinutes > 0) parts.push("定时同步每 " + view.syncMinutes + " 分钟一次");
			else parts.push("定时同步已关闭（可随时 cubox_sync 手动同步）");
			return {
				ok: true,
				message: parts.join("；") + "。",
				configured: view.configured,
				server: view.server,
				tokenMasked: view.tokenMasked,
				syncMinutes: view.syncMinutes,
				lastSyncAt: view.lastSyncAt,
				configPath: view.configPath
			};
		}
	});
}
/** Sync tool: pull the latest collection snapshot into the local cache. */
function cuboxSyncTool(ctx) {
	return defineTool$1({
		name: "cubox_sync",
		description: "同步 Cubox：拉取最近 N 天（默认今天）的收藏卡片与今日标注，合并进本地缓存（~/.dsh/dsh-cubox-cache.json），并更新最近同步时间。days 控制拉取窗口天数；limit 控制卡片拉取上限（默认 200）。返回本次拉取与缓存规模。",
		parameters: {
			days: {
				type: "number",
				description: "拉取窗口天数（默认 1 = 今天）"
			},
			limit: {
				type: "number",
				description: "卡片拉取上限（默认 200）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					pulledCards: { type: "number" },
					pulledAnnotations: { type: "number" },
					cachedCards: { type: "number" },
					cachedAnnotations: { type: "number" },
					since: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (!(await ctx.store.view()).configured) return {
				ok: false,
				message: "未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。"
			};
			const result = await doSync(ctx.api, ctx.store, {
				days: typeof args?.days === "number" ? args.days : 1,
				limit: typeof args?.limit === "number" ? args.limit : 200
			});
			return {
				ok: result.ok,
				message: result.message,
				pulledCards: result.pulledCards,
				pulledAnnotations: result.pulledAnnotations,
				cachedCards: result.cachedCards,
				cachedAnnotations: result.cachedAnnotations,
				since: result.since
			};
		}
	});
}
/** Today tool: render a daily outline (summary) of today's collection. */
function cuboxTodayTool(ctx) {
	return defineTool$1({
		name: "cubox_today",
		description: "生成今日收藏总结大纲：读取本地缓存中今天收藏的卡片与标注，输出 Markdown 大纲（统计 + 来源分布 + 每条收藏的标题/来源/链接/描述/标注摘要）。若缓存里没有今天的数据，会先自动同步（等价 cubox_sync days=1）。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					date: { type: "string" },
					cardCount: { type: "number" },
					annotationCount: { type: "number" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			if (!(await ctx.store.view()).configured) return {
				ok: false,
				message: "未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。"
			};
			let cache = await readCache();
			const now = /* @__PURE__ */ new Date();
			if (cache.cards.filter((c) => isSameLocalDate(c.create_time, now)).length === 0 && cache.updatedAt === "") {
				await doSync(ctx.api, ctx.store, {
					days: 1,
					limit: 200
				});
				cache = await readCache();
			}
			const cards = cache.cards.filter((c) => isSameLocalDate(c.create_time, now));
			const annotations = cache.annotations.filter((a) => isSameLocalDate(a.create_time, now));
			return {
				ok: true,
				message: buildDailyOutline(cards, annotations, dateLabel(now)),
				date: dateLabel(now),
				cardCount: cards.length,
				annotationCount: annotations.length
			};
		}
	});
}
/** Annotations tool: aggregate highlights/notes across cards. */
function cuboxAnnotationsTool(ctx) {
	return defineTool$1({
		name: "cubox_annotations",
		description: "汇总 Cubox 收录内容的笔记与标注：跨收藏筛选高亮/笔记（可限制最近 N 天，默认今天；可用 keyword 过滤内容），按收藏分组输出 Markdown 汇总（来源卡片 + 高亮文本 + 笔记 + 颜色 + 时间）。",
		parameters: {
			days: {
				type: "number",
				description: "时间窗口天数（默认 1 = 今天）"
			},
			keyword: {
				type: "string",
				description: "按内容关键词过滤"
			},
			limit: {
				type: "number",
				description: "标注拉取上限（默认 500）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					count: { type: "number" },
					scope: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (!(await ctx.store.view()).configured) return {
				ok: false,
				message: "未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。"
			};
			const days = typeof args?.days === "number" && args.days > 0 ? Math.floor(args.days) : 1;
			const limit = typeof args?.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 500;
			const keyword = typeof args?.keyword === "string" ? args.keyword.trim() : "";
			const now = /* @__PURE__ */ new Date();
			const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
			let annotations;
			try {
				annotations = await ctx.api.filterAnnotations({
					start_time: formatLocal(start),
					end_time: formatLocal(now),
					keyword: keyword === "" ? void 0 : keyword,
					limit
				});
			} catch (error) {
				return {
					ok: false,
					message: "拉取标注失败：" + apiError(error)
				};
			}
			const cache = await readCache();
			const titleById = /* @__PURE__ */ new Map();
			for (const card of cache.cards) titleById.set(card.id, card.title || card.url);
			for (const a of annotations) if (!titleById.has(a.card_id)) try {
				const detail = await ctx.api.cardDetail(a.card_id);
				titleById.set(a.card_id, detail.title || detail.url);
			} catch {
				titleById.set(a.card_id, a.card_id);
			}
			return {
				ok: true,
				message: buildAnnotationsSummary(annotations, titleById),
				count: annotations.length,
				scope: days === 1 ? "今天" : "最近 " + days + " 天"
			};
		}
	});
}
/** Cards tool: query the collection with filters. */
function cuboxCardsTool(ctx) {
	return defineTool$1({
		name: "cubox_cards",
		description: "查询 Cubox 收藏列表：可按关键词（keyword）、最近 N 天（days）、是否已标注（annotated）、是否星标（starred）、是否已读（read）过滤，limit 控制条数（默认 50）。返回每条收藏的标题、来源、链接、创建时间。",
		parameters: {
			keyword: {
				type: "string",
				description: "搜索关键词"
			},
			days: {
				type: "number",
				description: "最近 N 天（不填=全部时间）"
			},
			annotated: {
				type: "boolean",
				description: "只看有标注的收藏"
			},
			starred: {
				type: "boolean",
				description: "只看星标收藏"
			},
			read: {
				type: "boolean",
				description: "只看已读收藏"
			},
			limit: {
				type: "number",
				description: "条数上限（默认 50）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					count: { type: "number" },
					cards: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								title: { type: "string" },
								url: { type: "string" },
								domain: { type: "string" },
								create_time: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (!(await ctx.store.view()).configured) return {
				ok: false,
				message: "未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。"
			};
			const keyword = typeof args?.keyword === "string" ? args.keyword.trim() : "";
			const days = typeof args?.days === "number" && args.days > 0 ? Math.floor(args.days) : 0;
			const limit = typeof args?.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 50;
			const now = /* @__PURE__ */ new Date();
			const start = days > 0 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0) : null;
			let cards;
			try {
				cards = await ctx.api.filterCards({
					keyword: keyword === "" ? void 0 : keyword,
					start_time: start !== null ? formatLocal(start) : void 0,
					end_time: start !== null ? formatLocal(now) : void 0,
					annotated: args?.annotated === true ? true : void 0,
					starred: args?.starred === true ? true : void 0,
					read: args?.read === true ? true : void 0,
					limit
				});
			} catch (error) {
				return {
					ok: false,
					message: "查询收藏失败：" + apiError(error)
				};
			}
			const lines = cards.length === 0 ? ["（没有符合条件的收藏）"] : [];
			for (const card of cards) {
				const title = card.title || card.article_title || card.url;
				const domain = cardDomain(card);
				const tags = Array.isArray(card.tags) && card.tags.length > 0 ? " #" + card.tags.join(" #") : "";
				lines.push("- " + title + (domain !== "" ? "（" + domain + "）" : "") + " · " + card.create_time + tags);
				if (card.url !== "") lines.push("  " + card.url);
			}
			return {
				ok: true,
				message: "共 " + cards.length + " 条：\n" + lines.join("\n"),
				count: cards.length,
				cards: cards.map((c) => ({
					id: c.id,
					title: c.title || c.url,
					url: c.url,
					domain: cardDomain(c),
					create_time: c.create_time
				}))
			};
		}
	});
}
/** Local time in the Cubox API layout. */
function formatLocal(date) {
	const pad = (n) => String(n).padStart(2, "0");
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) + ".000" + sign + String(Math.floor(abs / 60)).padStart(2, "0") + String(abs % 60).padStart(2, "0");
}
/** Domain of a card URL. */
function cardDomain(card) {
	try {
		return new URL(card.url).hostname.replace(/^www\./, "");
	} catch {
		return card.domain ?? "";
	}
}
/** Build every cubox tool. */
function buildTools(ctx) {
	return [
		cuboxStatusTool(ctx),
		cuboxConfigTool(ctx),
		cuboxSyncTool(ctx),
		cuboxTodayTool(ctx),
		cuboxAnnotationsTool(ctx),
		cuboxCardsTool(ctx)
	];
}
//#endregion
//#region src/routes.ts
/** Route paths. */
const CUBOX_API = {
	config: "/api/dsh-cubox/config",
	sync: "/api/dsh-cubox/sync",
	status: "/api/dsh-cubox/status"
};
/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024;
/** Strict loopback fence for all routes. */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/**
* Build every /api/dsh-cubox route (exact paths).
* @param deps - store and api client.
* @returns the route list.
*/
function makeRoutes(deps) {
	const { store, api } = deps;
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	return [
		{
			kind: "exact",
			path: CUBOX_API.config,
			handler: async (req, res) => {
				const method = req.method ?? "GET";
				if (method === "GET") {
					if (!guard(req, res, "GET")) return;
					writeJson(res, 200, await store.view());
					return;
				}
				if (method === "POST") {
					if (!guard(req, res, "POST")) return;
					const body = await readJsonBody(req);
					if (body === void 0) {
						writeJson(res, 400, { error: "invalid JSON body" });
						return;
					}
					writeJson(res, 200, await store.patch(body));
					return;
				}
				writeJson(res, 405, { error: `method not allowed: ${method}` });
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.status,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const view = await store.view();
				const cache = await readCache();
				writeJson(res, 200, {
					...view,
					cachedCards: cache.cards.length,
					cachedAnnotations: cache.annotations.length,
					cacheUpdatedAt: cache.updatedAt
				});
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.sync,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				if (!(await store.view()).configured) {
					writeJson(res, 400, { error: "未配置 Cubox API 链接：请先在面板填写 API 扩展链接。" });
					return;
				}
				const body = await readJsonBody(req);
				const days = typeof body?.days === "number" && body.days > 0 ? body.days : 1;
				writeJson(res, 200, await doSync(api, store, {
					days,
					limit: 200
				}));
			}
		}
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "cubox";
/** Services required before the cubox surfaces can mount. */
const inject = [
	"tools",
	"systemPrompt",
	"webServer",
	"timer"
];
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const CUBOX_GUIDANCE = "本机已安装 dsh-cubox 插件（Cubox 收藏同步）：配置一次 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接，形如 https://cubox.pro/c/api/save/xxxx）后，可用 cubox_sync 同步收藏（默认拉取今天，可 days 指定最近 N 天）、cubox_today 生成今日收藏总结大纲（标题/来源/链接/描述/标注摘要）、cubox_annotations 汇总收录内容的笔记与标注（按天/关键词过滤、按收藏分组）、cubox_cards 按关键词/时间/标注状态查询收藏，cubox_config / cubox_status 配置与查看状态。插件支持定时同步（配置 syncMinutes，默认每 60 分钟一次；cubox_config 可调 syncMinutes，0 关闭）。凭据存 ~/.dsh/dsh-cubox.json（权限 0600），同步快照存 ~/.dsh/dsh-cubox-cache.json；cubox_status 不回显完整 token。也可在 Web 设置页「Cubox」面板中配置与手动同步。用户提到「cubox / 收藏 / 稍后读 / 收录 / 标注汇总 / 今日收藏总结」时即指本插件，请据此协作。";
/**
* Mount the cubox tools, routes, announcement, and scheduled sync.
* @param ctx - host plugin context carrying tools/systemPrompt/webServer/timer.
* @param config - plugin config from the composition row.
*/
function apply(ctx, config) {
	const announceToAgent = config?.announceToAgent !== false;
	const enabled = config?.enabled !== false;
	const store = new CuboxStore();
	const api = new CuboxApi(store);
	const toolContext = {
		store,
		api
	};
	let disposeTools;
	let disposeRoutes;
	let disposeSection;
	let disposeTimer;
	const sync = () => {
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (disposeTimer !== void 0) {
			disposeTimer();
			disposeTimer = void 0;
		}
		if (!enabled) return;
		disposeTools = ctx.effect(() => {
			const disposers = buildTools(toolContext).map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-cubox: tools");
		disposeRoutes = ctx.effect(() => {
			const disposers = makeRoutes({
				store,
				api
			}).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-cubox: routes");
		if (announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-cubox",
			order: SECTION_ORDER,
			text: CUBOX_GUIDANCE
		});
		const minutes = typeof config?.syncMinutes === "number" && config.syncMinutes >= 0 ? Math.floor(config.syncMinutes) : 60;
		if (minutes > 0) disposeTimer = ctx.interval(() => {
			(async () => {
				try {
					if (!(await store.view()).configured) return;
					await doSync(api, store, {
						days: 1,
						limit: 200
					});
					ctx.logger?.info?.("[dsh-cubox] scheduled sync completed");
				} catch (error) {
					ctx.logger?.warn?.("[dsh-cubox] scheduled sync failed: " + String(error instanceof Error ? error.message : error));
				}
			})();
		}, minutes * 60 * 1e3);
	};
	sync();
}
//#endregion
export { CUBOX_API, CUBOX_GUIDANCE, CuboxApi, CuboxApiError, CuboxStore, apply, buildAnnotationsSummary, buildDailyOutline, buildTools, cachePath, configPath, cuboxAnnotationsTool, cuboxCardsTool, cuboxConfigTool, cuboxStatusTool, cuboxSyncTool, cuboxTodayTool, defineTool, doSync, formatApiTime, inject, makeRoutes, mask, name, parseApiLink, readCache, todayRange, writeCache };
