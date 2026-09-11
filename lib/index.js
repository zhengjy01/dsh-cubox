import { defineTool, defineTool as defineTool$1 } from "@deepseek-ai/dsh-tools";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
/** Default flomo tag for the Cubox annotation digest. */
const DEFAULT_FLOMO_TAG = "AI/cubox";
/** Default digest prompt template ({digest} placeholder). */
const DEFAULT_EXPORT_PROMPT = "你是信息整理助手。请把下面的 Cubox 标注整理成一条简洁的「今日标注回顾」纯文本笔记：\n保留每条标注的卡片标题与原文链接，语言精炼，不要使用 # 号，不要添加任何标签。\n\n{digest}";
/** Default prompt for the daily collection brief. */
const DEFAULT_LLM_PROMPT = "你是一个信息整理助手。请根据以下我今日收藏的内容列表，生成一份\"今日收藏简报\"。\n\n【今日收藏列表】\n{collection}\n\n请按以下要求输出纯文本简报（不要用markdown符号，不要加粗，不要列表符号，只用自然段落和换行）：\n\n1. 摘要总结：用3-5句话概括今天收藏的整体主题和覆盖范围。\n2. 突出重点：按重要性从高到低，列出今日最值得关注的6条内容。每条单独一段，格式为\"重点一：xxx。理由：xxx。\"，以此类推到\"重点六\"。\n3. 原文链接：每条重点的段落末尾必须附上该条收藏的完整原文链接，格式为\"原文链接：<URL>\"。链接必须取自上面收藏列表中该条目的\"链接：\"字段，不得编造、不得省略；原文链接不计入下面的字数限制。\n4. 分类概览：按类型（如技术文章/行业资讯/生活灵感/工具资源）统计数量分布，用一句话说清楚，例如\"今日共收藏X条，其中技术类X条，资讯类X条，生活类X条。\"\n5. 总字数控制在400字以内（不含原文链接），语言精炼，一目了然。不要出现\"根据提供的列表\"、\"以下是\"之类的引导语，直接输出内容本身。";
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
		lastSyncAt: "",
		outputDir: "",
		exportCards: true,
		llmBaseUrl: "https://api.deepseek.com/v1",
		llmApiKey: "",
		llmModel: "deepseek-chat",
		llmPrompt: DEFAULT_LLM_PROMPT,
		flomoEnabled: false,
		exportDest: "flomo",
		flomoTag: DEFAULT_FLOMO_TAG,
		flomoMinAgeMinutes: 60,
		usePrompt: false,
		exportPrompt: DEFAULT_EXPORT_PROMPT,
		notionToken: "",
		notionTargetPageId: ""
	};
}
/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const server = record.server === "cubox.cc" ? "cubox.cc" : "cubox.pro";
	const str = (value) => typeof value === "string" ? value : "";
	const num = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 60;
	const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
	const dest = (value) => value === "local" || value === "notion" ? value : "flomo";
	return {
		server,
		token: str(record.token),
		syncMinutes: num(record.syncMinutes),
		lastSyncAt: str(record.lastSyncAt),
		outputDir: str(record.outputDir),
		exportCards: bool(record.exportCards, true),
		llmBaseUrl: str(record.llmBaseUrl) || "https://api.deepseek.com/v1",
		llmApiKey: str(record.llmApiKey),
		llmModel: str(record.llmModel) || "deepseek-chat",
		llmPrompt: str(record.llmPrompt) || "你是一个信息整理助手。请根据以下我今日收藏的内容列表，生成一份\"今日收藏简报\"。\n\n【今日收藏列表】\n{collection}\n\n请按以下要求输出纯文本简报（不要用markdown符号，不要加粗，不要列表符号，只用自然段落和换行）：\n\n1. 摘要总结：用3-5句话概括今天收藏的整体主题和覆盖范围。\n2. 突出重点：按重要性从高到低，列出今日最值得关注的6条内容。每条单独一段，格式为\"重点一：xxx。理由：xxx。\"，以此类推到\"重点六\"。\n3. 原文链接：每条重点的段落末尾必须附上该条收藏的完整原文链接，格式为\"原文链接：<URL>\"。链接必须取自上面收藏列表中该条目的\"链接：\"字段，不得编造、不得省略；原文链接不计入下面的字数限制。\n4. 分类概览：按类型（如技术文章/行业资讯/生活灵感/工具资源）统计数量分布，用一句话说清楚，例如\"今日共收藏X条，其中技术类X条，资讯类X条，生活类X条。\"\n5. 总字数控制在400字以内（不含原文链接），语言精炼，一目了然。不要出现\"根据提供的列表\"、\"以下是\"之类的引导语，直接输出内容本身。",
		flomoEnabled: bool(record.flomoEnabled, false),
		exportDest: dest(record.exportDest),
		flomoTag: str(record.flomoTag).replace(/^#+/, "") || "AI/cubox",
		flomoMinAgeMinutes: num(record.flomoMinAgeMinutes),
		usePrompt: bool(record.usePrompt, false),
		exportPrompt: str(record.exportPrompt) || "你是信息整理助手。请把下面的 Cubox 标注整理成一条简洁的「今日标注回顾」纯文本笔记：\n保留每条标注的卡片标题与原文链接，语言精炼，不要使用 # 号，不要添加任何标签。\n\n{digest}",
		notionToken: str(record.notionToken),
		notionTargetPageId: str(record.notionTargetPageId)
	};
}
/**
* Small credential store backed by ~/.dsh/dsh-cubox.json.
* Reads are lazy and cached; writes use mode 0600 so the API token never
* leaks to other local users.
*/
var CuboxStore = class {
	config = null;
	/**
	* Optional observer fired after every successful save — from the settings
	* panel POST, the cubox_config tool, or the lastSyncAt stamp in doSync.
	* The host uses it to re-arm the scheduled-sync timer when the interval
	* changes at runtime, so a panel edit applies without a `dsh web` restart.
	*/
	onSaved;
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
		this.onSaved?.(next);
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
			outputDir: cfg.outputDir,
			exportCards: cfg.exportCards,
			llmBaseUrl: cfg.llmBaseUrl,
			llmModel: cfg.llmModel,
			llmKeyMasked: cfg.llmApiKey.trim() !== "" ? mask(cfg.llmApiKey) : "",
			llmPrompt: cfg.llmPrompt,
			flomoEnabled: cfg.flomoEnabled,
			exportDest: cfg.exportDest,
			flomoTag: cfg.flomoTag,
			flomoMinAgeMinutes: cfg.flomoMinAgeMinutes,
			usePrompt: cfg.usePrompt,
			exportPrompt: cfg.exportPrompt,
			notionConfigured: cfg.notionToken.trim() !== "",
			notionTargetPageId: cfg.notionTargetPageId,
			configPath: configPath()
		};
	}
	/**
	* Apply a config patch: apiLink (parse into server+token) / server / token
	* / syncMinutes / outputDir / exportCards / LLM fields replace, reset clears.
	* Returns the public view.
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
		if (args !== void 0 && typeof args.outputDir === "string") next.outputDir = args.outputDir.trim();
		if (args !== void 0 && typeof args.exportCards === "boolean") next.exportCards = args.exportCards;
		if (args !== void 0 && typeof args.llmBaseUrl === "string") next.llmBaseUrl = args.llmBaseUrl.trim();
		if (args !== void 0 && typeof args.llmApiKey === "string") next.llmApiKey = args.llmApiKey.trim();
		if (args !== void 0 && typeof args.llmModel === "string") next.llmModel = args.llmModel.trim();
		if (args !== void 0 && typeof args.llmPrompt === "string") next.llmPrompt = args.llmPrompt;
		if (args !== void 0 && typeof args.flomoEnabled === "boolean") next.flomoEnabled = args.flomoEnabled;
		if (args !== void 0 && (args.exportDest === "flomo" || args.exportDest === "local" || args.exportDest === "notion")) next.exportDest = args.exportDest;
		if (args !== void 0 && typeof args.flomoTag === "string") next.flomoTag = args.flomoTag.trim().replace(/^#+/, "") || "AI/cubox";
		if (args !== void 0 && typeof args.flomoMinAgeMinutes === "number" && Number.isFinite(args.flomoMinAgeMinutes)) next.flomoMinAgeMinutes = Math.max(0, Math.floor(args.flomoMinAgeMinutes));
		if (args !== void 0 && typeof args.usePrompt === "boolean") next.usePrompt = args.usePrompt;
		if (args !== void 0 && typeof args.exportPrompt === "string") next.exportPrompt = args.exportPrompt;
		if (args !== void 0 && typeof args.notionToken === "string") next.notionToken = args.notionToken.trim();
		if (args !== void 0 && typeof args.notionTargetPageId === "string") next.notionTargetPageId = args.notionTargetPageId.trim();
		await this.save(next);
		return this.view();
	}
};
//#endregion
//#region src/api.ts
/** Request timeout for API calls. */
const REQUEST_TIMEOUT_MS$2 = 3e4;
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
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$2);
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
//#region src/llm.ts
/** Request timeout for one chat completion. */
const REQUEST_TIMEOUT_MS$1 = 9e4;
/** Is the LLM configured (key + base url + model present)? */
function llmConfigured(config) {
	return config.apiKey.trim() !== "" && config.baseUrl.trim() !== "" && config.model.trim() !== "";
}
/**
* One chat completion. Resolves the assistant text; rejects with a readable
* error on transport or API failures.
*/
async function chatComplete(config, system, user) {
	if (!llmConfigured(config)) throw new Error("LLM 未配置：请在设置面板「AI 简报」区填写 API Key / Base URL / 模型。");
	const base = config.baseUrl.trim().replace(/\/+$/, "");
	const url = base.endsWith("/chat/completions") ? base : base + "/chat/completions";
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Authorization": "Bearer " + config.apiKey.trim(),
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: config.model.trim(),
				messages: [{
					role: "system",
					content: system
				}, {
					role: "user",
					content: user
				}],
				temperature: .4,
				max_tokens: 4e3,
				stream: false
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS$1)
		});
	} catch (error) {
		throw new Error("LLM 请求失败（网络错误）: " + String(error instanceof Error ? error.message : error));
	}
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new Error("LLM 返回了无法解析的响应（HTTP " + response.status + "）");
	}
	if (!response.ok) {
		const record = typeof payload === "object" && payload !== null ? payload : {};
		const message = typeof record.message === "string" ? record.message : typeof record.error === "object" && record.error !== null ? String(record.error.message ?? JSON.stringify(record.error)) : "HTTP " + response.status;
		throw new Error("LLM 请求失败: " + message);
	}
	const choices = (typeof payload === "object" && payload !== null ? payload : {}).choices;
	if (!Array.isArray(choices) || choices.length === 0) throw new Error("LLM 响应缺少 choices");
	const first = choices[0];
	const message = typeof first.message === "object" && first.message !== null ? first.message : {};
	return typeof message.content === "string" ? message.content : "";
}
//#endregion
//#region src/flomo.ts
/**
* dsh-cubox — flomo export integration.
*
* Cubox annotations (highlights + thoughts) are pushed to flomo (浮墨笔记)
* from `doSync`, and on demand via the cubox_flomo tool / settings panel.
* This module owns the transport only: it reuses the credentials already
* configured for the dsh-flomo plugin (~/.dsh/dsh-flomo.json, mode 0600):
* webhookUrl wins over apiKey. The flomo tag is customizable (store's
* flomoTag, default AI/cubox).
*
* Pitfall this module guards against: flomo turns every `#词` in the body
* into a tag, so the digest body is stripped of all `#` characters before
* sending (the single configured tag is appended via buildTaggedContent).
*/
/** Config file location shared with dsh-flomo (machine-wide, mode 0600). */
const FLOMO_CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-flomo.json");
/** Test override for the shared flomo config location. */
function flomoConfigPath() {
	const override = process.env.DSH_CUBOX_FLOMO_CONFIG;
	return override !== void 0 && override !== "" ? override : FLOMO_CONFIG_FILE;
}
/** Request timeout for a flomo POST. */
const REQUEST_TIMEOUT_MS = 2e4;
/** Mask a credential for display, keeping only the head and tail. */
function mask$1(value) {
	if (!value) return "";
	if (value.length <= 8) return value.slice(0, 2) + "****";
	return value.slice(0, 4) + "****" + value.slice(-4);
}
/** Whether flomo credentials exist on this machine. */
async function flomoConfigured() {
	return (await loadFlomoCredentials()).resolved !== null;
}
/** Public flomo status: source + masked credential. */
async function flomoStatus() {
	const creds = await readFlomoCredentials();
	const source = creds.webhookUrl !== "" ? "webhookUrl" : creds.apiKey !== "" ? "apiKey" : "";
	return {
		configured: source !== "",
		source,
		masked: source === "webhookUrl" ? mask$1(creds.webhookUrl) : source === "apiKey" ? mask$1(creds.apiKey) : "",
		configPath: flomoConfigPath()
	};
}
/** Read the persisted flomo credentials (never throws). */
async function readFlomoCredentials() {
	let record = {};
	try {
		const raw = await readFile(flomoConfigPath(), "utf8");
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null) record = parsed;
	} catch {}
	return {
		apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
		webhookUrl: typeof record.webhookUrl === "string" ? record.webhookUrl : ""
	};
}
/**
* Write flomo credentials to the shared ~/.dsh/dsh-flomo.json (mode 0600).
* Shared with the dsh-flomo plugin — one place, both plugins use it.
*/
async function writeFlomoCredentials(next) {
	await mkdir(path.dirname(flomoConfigPath()), { recursive: true });
	await writeFile(flomoConfigPath(), JSON.stringify(next, null, 2), { mode: 384 });
}
/** Load and resolve the flomo send URL (null when not configured). */
async function resolveFlomoUrl() {
	return (await loadFlomoCredentials()).resolved;
}
/** Read ~/.dsh/dsh-flomo.json and resolve the request URL. */
async function loadFlomoCredentials() {
	const creds = await readFlomoCredentials();
	const webhook = creds.webhookUrl.trim();
	if (webhook) return { resolved: webhook };
	const key = creds.apiKey.trim();
	if (key) return { resolved: "https://flomoapp.com/api/prod/apis/webhook/v1/?apiKey=" + encodeURIComponent(key) };
	return { resolved: null };
}
/**
* POST one memo to the flomo logging API. Resolves { ok, message, code? } —
* rejects only for transport-level failures.
*/
async function postMemo(url, content) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const body = await res.text();
	let parsed = null;
	try {
		parsed = JSON.parse(body);
	} catch {}
	if (parsed && typeof parsed === "object" && typeof parsed.code === "number") {
		const record = parsed;
		if (record.code === 0) return {
			ok: true,
			message: "已写入 flomo",
			code: 0
		};
		return {
			ok: false,
			message: "flomo 返回错误: " + String(typeof record.message === "string" ? record.message : JSON.stringify(parsed)),
			code: record.code
		};
	}
	if (!res.ok) return {
		ok: false,
		message: "请求失败（HTTP " + res.status + "）: " + body.slice(0, 300)
	};
	return {
		ok: true,
		message: "flomo 已响应: " + body.slice(0, 300)
	};
}
/**
* Strip every `#` from a memo body. flomo treats `#词` as a tag; Cubox card
* titles / URLs / annotation text may contain `#`, so the body must be
* hash-free and the only tag is the configured one (appended separately).
*/
function stripHashTags(content) {
	return (content || "").replace(/#/g, "");
}
/** Append normalized #tags to a memo body. */
function buildTaggedContent(content, tags) {
	const body = stripHashTags(content).trim();
	const suffix = (tags || "").split(/[\s,，;；]+/).map((t) => t.trim().replace(/^#+/, "")).filter(Boolean).map((t) => "#" + t).join(" ");
	return suffix ? body + " " + suffix : body;
}
//#endregion
//#region src/notion.ts
/**
* dsh-cubox — minimal Notion exporter.
*
* Used when the annotation digest destination is `notion`. Mirrors the
* verified weread-export implementation: normalize the target page id/URL,
* convert markdown-ish text into paragraph blocks, and create a child page
* under the configured parent page (appending in batches of 100).
*/
/** Notion REST base URL. */
const NOTION_API = "https://api.notion.com";
/** API version header (covers every endpoint used here). */
const NOTION_VERSION = "2022-06-28";
/** Notion allows at most 100 blocks per create/append call. */
const NOTION_BLOCKS_PER_CALL = 100;
/** Normalize a Notion page URL / id to the 32-char page id. */
function normalizeNotionPageId(input) {
	const value = input.trim();
	if (value === "") throw new Error("请填写 Notion 目标页面 URL 或 ID。");
	const hex = value.match(/[0-9a-f]{32}/i);
	if (hex) return hex[0].toLowerCase();
	const compact = value.replace(/-/g, "");
	if (/^[0-9a-f]{32}$/i.test(compact)) return compact.toLowerCase();
	throw new Error("无法识别 Notion 页面 ID：请粘贴页面链接或 32 位页面 ID。");
}
/** Split markdown text into Notion paragraph blocks. */
function toNotionBlocks(content) {
	const lines = content.split("\n").map((l) => l.trimEnd());
	const blocks = [];
	for (const line of lines) {
		if (line === "") continue;
		blocks.push({
			object: "block",
			type: "paragraph",
			paragraph: { rich_text: [{
				type: "text",
				text: { content: line.slice(0, 2e3) }
			}] }
		});
	}
	return blocks;
}
/** One Notion API call with normalized errors. */
async function notionCall(token, method, apiPath, body) {
	let response;
	try {
		response = await fetch(NOTION_API + apiPath, {
			method,
			headers: {
				"Authorization": "Bearer " + token.trim(),
				"Notion-Version": NOTION_VERSION,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});
	} catch (error) {
		throw new Error("Notion 请求失败（网络错误）: " + String(error instanceof Error ? error.message : error));
	}
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new Error("Notion 返回了无法解析的响应（HTTP " + response.status + "）");
	}
	if (!response.ok) {
		const record = typeof payload === "object" && payload !== null ? payload : {};
		const message = typeof record.message === "string" ? record.message : "HTTP " + response.status;
		throw new Error("Notion API 错误: " + message);
	}
	return typeof payload === "object" && payload !== null ? payload : {};
}
/**
* Create a child page under the target parent page with the export content,
* appending extra blocks in batches if needed. Returns the new page id.
*/
async function exportToNotion(token, parentId, title, content) {
	if (token.trim() === "") throw new Error("Notion 未配置：请先在设置面板「标注 digest」区填写 Integration Token。");
	const pageId = normalizeNotionPageId(parentId);
	const blocks = toNotionBlocks(content);
	const children = blocks.slice(0, NOTION_BLOCKS_PER_CALL);
	const created = await notionCall(token, "POST", "/v1/pages", {
		parent: { page_id: pageId },
		properties: { title: { title: [{ text: { content: title.slice(0, 200) } }] } },
		children
	});
	const newPageId = typeof created.id === "string" ? created.id : "";
	for (let offset = NOTION_BLOCKS_PER_CALL; offset < blocks.length; offset += NOTION_BLOCKS_PER_CALL) {
		const batch = blocks.slice(offset, offset + NOTION_BLOCKS_PER_CALL);
		await notionCall(token, "PATCH", "/v1/blocks/" + newPageId + "/children", { children: batch });
	}
	return newPageId;
}
/** Verify a Notion token (and optionally the target page). */
async function testNotion(token, targetPageId) {
	if (token.trim() === "") return {
		ok: false,
		message: "Notion 未配置：请先填写 Integration Token。"
	};
	try {
		const meRes = await fetch("https://api.notion.com/v1/users/me", {
			headers: {
				"Authorization": "Bearer " + token.trim(),
				"Notion-Version": NOTION_VERSION
			},
			signal: AbortSignal.timeout(15e3)
		});
		if (!meRes.ok) {
			const body = await meRes.text().catch(() => "");
			return {
				ok: false,
				message: "Token 无效（HTTP " + meRes.status + "）：" + body.slice(0, 200)
			};
		}
		const workspace = (await meRes.json().catch(() => ({}))).name ?? "未知工作区";
		if (targetPageId.trim() === "") return {
			ok: true,
			message: "Token 有效（工作区：" + workspace + "）。未配置目标页面。"
		};
		let pageId;
		try {
			pageId = normalizeNotionPageId(targetPageId);
		} catch (error) {
			return {
				ok: false,
				message: "Token 有效（工作区：" + workspace + "），但目标页面 ID 无法解析：" + String(error instanceof Error ? error.message : error)
			};
		}
		const pageRes = await fetch("https://api.notion.com/v1/pages/" + pageId, {
			headers: {
				"Authorization": "Bearer " + token.trim(),
				"Notion-Version": NOTION_VERSION
			},
			signal: AbortSignal.timeout(15e3)
		});
		if (pageRes.status === 404) return {
			ok: false,
			message: "Token 有效（工作区：" + workspace + "），但目标页面不可访问（404）：请先把该页面分享给此 Integration。"
		};
		if (!pageRes.ok) return {
			ok: false,
			message: "Token 有效（工作区：" + workspace + "），但读取目标页失败（HTTP " + pageRes.status + "）。"
		};
		return {
			ok: true,
			message: "✅ Notion 配置有效：工作区「" + workspace + "」，目标页面可访问。"
		};
	} catch (error) {
		return {
			ok: false,
			message: "测试失败：" + String(error instanceof Error ? error.message : error)
		};
	}
}
//#endregion
//#region src/digest.ts
/**
* dsh-cubox — annotation digest export with a local dedup ledger.
*
* After `doSync` merges the cache, newly created / changed annotations are
* collected and delivered as one daily digest (card title + link +
* highlights/notes), auto-split across flomo memos when long. flomo is a
* write-only sink (no query/update/delete), so a local ledger records every
* annotation id + content hash that has been pushed — otherwise every sync
* would re-send the same notes. The ledger mirrors the daily-report pattern
* (~/.dsh/.flomo-daily-report-sent).
*
* Delivery targets: flomo (default) / local markdown / Notion page. The
* configured LLM may rewrite the digest first (usePrompt + exportPrompt).
*/
/** Safe per-memo size cap (flomo does not document a hard limit). */
const FLOMO_MAX_CHARS = 1800;
/** Default look-back window (days) for eligible annotations. */
const DEFAULT_DIGEST_WINDOW_DAYS = 2;
/** Machine-wide dedup ledger (JSON map id → content hash, mode 0600). */
const DEFAULT_FLOMO_LEDGER_FILE = path.join(homedir(), ".dsh", ".cubox-flomo-annotations-sent");
/** Test override for the dedup ledger location. */
function flomoLedgerPath() {
	const override = process.env.DSH_CUBOX_FLOMO_LEDGER;
	return override !== void 0 && override !== "" ? override : DEFAULT_FLOMO_LEDGER_FILE;
}
/** Read the dedup ledger (never throws; missing file → empty). */
async function readFlomoLedger() {
	try {
		const raw = await readFile(flomoLedgerPath(), "utf8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const out = {};
		for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
		return out;
	} catch {
		return {};
	}
}
/** Persist the dedup ledger (mode 0600). */
async function writeFlomoLedger(ledger) {
	await mkdir(path.dirname(flomoLedgerPath()), { recursive: true });
	await writeFile(flomoLedgerPath(), JSON.stringify(ledger, null, 2), { mode: 384 });
}
/** Content hash: changes when text/note/update_time/color change. */
function annotationHash(a) {
	return createHash("sha1").update([
		a.text ?? "",
		a.note ?? "",
		a.update_time ?? "",
		a.color ?? ""
	].join("")).digest("hex").slice(0, 16);
}
/** Parse the Cubox API time layout (also tolerates an ISO offset with colon). */
function parseCuboxTime(value) {
	const normalized = (value ?? "").trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
	const time = Date.parse(normalized);
	return Number.isNaN(time) ? 0 : time;
}
/** Local YYYY-MM-DD. */
function ymd(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}
/** Collapse whitespace for one-line digest entries. */
function oneLine(value) {
	return (value ?? "").replace(/\s+/g, " ").trim();
}
/** Card display title. */
function cardTitle(card) {
	if (card === void 0) return "未命名收藏";
	return (card.title || card.article_title || card.url || "未命名收藏").trim() || "未命名收藏";
}
/** Card link (original URL, falling back to the Cubox web card). */
function cardLink(card, cardId) {
	if (card !== void 0 && card.url.trim() !== "") return card.url.trim();
	return "https://cubox.pro/web/card/" + cardId;
}
/** Digest header line. */
function digestHeader(date) {
	return "📥 Cubox 标注 · " + ymd(date);
}
/** Select unsent, settled annotations within the window. */
function selectUnpushedAnnotations(cache, opts) {
	const now = opts.now ?? /* @__PURE__ */ new Date();
	const windowDays = typeof opts.windowDays === "number" && opts.windowDays > 0 ? Math.floor(opts.windowDays) : 2;
	const minAge = typeof opts.minAgeMinutes === "number" && opts.minAgeMinutes >= 0 ? opts.minAgeMinutes : 60;
	const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1e3;
	const settledBefore = now.getTime() - minAge * 60 * 1e3;
	const out = [];
	for (const a of cache.annotations) {
		const created = parseCuboxTime(a.create_time);
		if (created === 0) continue;
		if (created < windowStart) continue;
		if (created > settledBefore) continue;
		if (opts.ledger[a.id] === annotationHash(a)) continue;
		out.push(a);
	}
	return out.sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time));
}
/**
* Build the raw digest memos for a set of annotations: one daily digest,
* auto-split by character count (never truncates). Each card contributes a
* title + link header, then one block per annotation. Splits repeat the
* digest header and the card header so every memo stays readable.
*/
function buildDigestMemos(cache, annotations, opts = {}) {
	const maxChars = typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : FLOMO_MAX_CHARS;
	const firstHeader = digestHeader(opts.date ?? /* @__PURE__ */ new Date());
	const contHeader = firstHeader + "（续）";
	const cardById = new Map(cache.cards.map((c) => [c.id, c]));
	const order = [];
	const groups = /* @__PURE__ */ new Map();
	const sorted = [...annotations].sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time));
	for (const a of sorted) {
		if (!groups.has(a.card_id)) {
			groups.set(a.card_id, []);
			order.push(a.card_id);
		}
		groups.get(a.card_id)?.push(a);
	}
	const memos = [];
	let lines = [];
	let ids = [];
	let len = 0;
	let continued = false;
	/** Card header of the card currently being emitted (re-added after a split). */
	let activeHeader = null;
	const open = () => {
		lines = [continued ? contHeader : firstHeader];
		len = lines[0]?.length ?? 0;
		if (activeHeader !== null) for (const h of activeHeader) {
			lines.push(h);
			len += 1 + h.length;
		}
	};
	const flush = () => {
		if (ids.length > 0) {
			memos.push({
				content: lines.join("\n"),
				annotationIds: [...ids]
			});
			continued = true;
		}
		lines = [];
		ids = [];
		len = 0;
	};
	const append = (line, id) => {
		if (lines.length === 0) open();
		if (len + 1 + line.length > maxChars && lines.length > 1) {
			flush();
			open();
		}
		lines.push(line);
		len += 1 + line.length;
		if (id !== void 0) ids.push(id);
	};
	for (const cardId of order) {
		const card = cardById.get(cardId);
		const headerLines = ["《" + cardTitle(card) + "》", cardLink(card, cardId)];
		activeHeader = headerLines;
		let headerInMemo = false;
		for (const a of groups.get(cardId) ?? []) {
			const annLines = [];
			const text = oneLine(a.text);
			const note = oneLine(a.note);
			if (text !== "") annLines.push("- 高亮：" + text);
			if (note !== "") annLines.push("  - 笔记：" + note);
			if (annLines.length === 0) continue;
			if (!headerInMemo) {
				const headerLen = headerLines.reduce((n, l) => n + 1 + l.length, 0);
				const firstLen = 1 + (annLines[0]?.length ?? 0);
				if (lines.length > 0 && len + headerLen + firstLen > maxChars) flush();
				if (lines.length === 0) open();
				else for (const h of headerLines) {
					lines.push(h);
					len += 1 + h.length;
				}
				headerInMemo = true;
			}
			for (let i = 0; i < annLines.length; i += 1) append(annLines[i] ?? "", i === 0 ? a.id : void 0);
		}
	}
	flush();
	return memos;
}
/** Full digest markdown (no splitting) — for local files / Notion pages. */
function buildDigestMarkdown(cache, annotations, opts = {}) {
	return buildDigestMemos(cache, annotations, {
		date: opts.date,
		maxChars: Number.MAX_SAFE_INTEGER
	}).map((m) => m.content).join("\n\n");
}
/** Split arbitrary text into size-capped chunks with a repeated header. */
function chunkText(text, maxChars, header) {
	const memos = [];
	let current = header;
	for (const line of text.split("\n")) {
		if (current.length + 1 + line.length > maxChars && current !== header) {
			memos.push(current);
			current = header + "（续）";
		}
		current += "\n" + line;
	}
	memos.push(current);
	return memos;
}
/** Annotations inside the look-back window (for a full-day local/Notion digest). */
function annotationsInWindow(cache, now, windowDays) {
	const start = now.getTime() - windowDays * 24 * 60 * 60 * 1e3;
	return cache.annotations.filter((a) => {
		const t = parseCuboxTime(a.create_time);
		return t !== 0 && t >= start;
	}).sort((x, y) => parseCuboxTime(x.create_time) - parseCuboxTime(y.create_time));
}
/**
* Collect unsent annotations and deliver them to the configured target.
* The dedup ledger is updated per successfully delivered annotation, so a
* partial failure retries only what did not make it.
*/
async function deliverAnnotationDigest(cache, config, opts = {}) {
	const now = opts.now ?? /* @__PURE__ */ new Date();
	const dest = opts.dest ?? config.exportDest;
	const windowDays = typeof opts.windowDays === "number" && opts.windowDays > 0 ? Math.floor(opts.windowDays) : 2;
	const minAge = opts.force === true ? 0 : typeof opts.minAgeMinutes === "number" && opts.minAgeMinutes >= 0 ? opts.minAgeMinutes : config.flomoMinAgeMinutes;
	const ledger = await readFlomoLedger();
	const candidates = selectUnpushedAnnotations(cache, {
		ledger,
		now,
		windowDays,
		minAgeMinutes: minAge
	});
	if (candidates.length === 0) return {
		ok: true,
		dest,
		candidates: 0,
		memos: 0,
		delivered: 0,
		message: "没有新的 Cubox 标注需要导出。"
	};
	const byId = new Map(candidates.map((a) => [a.id, a]));
	let ledgerChanged = false;
	const mark = (ids) => {
		for (const id of ids) {
			const a = byId.get(id);
			if (a !== void 0) {
				ledger[id] = annotationHash(a);
				ledgerChanged = true;
			}
		}
	};
	let processed = null;
	if (config.usePrompt) {
		const llm = {
			baseUrl: config.llmBaseUrl,
			apiKey: config.llmApiKey,
			model: config.llmModel
		};
		if (!llmConfigured(llm)) return {
			ok: false,
			dest,
			candidates: candidates.length,
			memos: 0,
			delivered: 0,
			message: "已启用 prompt 整理但 LLM 未配置：请在设置面板填写 LLM Key / Base URL / 模型，或关闭 prompt 开关。"
		};
		const raw = buildDigestMarkdown(cache, candidates, { date: now });
		const template = (config.exportPrompt ?? "").trim();
		const user = template === "" ? raw : template.includes("{digest}") ? template.replaceAll("{digest}", raw) : template + "\n\n" + raw;
		try {
			processed = await chatComplete(llm, "你是信息整理助手。严格按用户的 prompt 要求输出纯文本，直接输出内容本身，不要使用 # 号，不要添加任何标签。", user);
		} catch (error) {
			return {
				ok: false,
				dest,
				candidates: candidates.length,
				memos: 0,
				delivered: 0,
				message: "LLM 整理失败：" + String(error instanceof Error ? error.message : error)
			};
		}
	}
	if (dest === "flomo") {
		const url = await resolveFlomoUrl();
		if (url === null) return {
			ok: false,
			dest,
			candidates: candidates.length,
			memos: 0,
			delivered: 0,
			message: "flomo 未配置：请在设置面板「flomo 标注同步」区填写 API URL / API Key（或先在「Flomo」面板配置），与 dsh-flomo 共享凭据。"
		};
		const tag = (opts.tag ?? "").trim().replace(/^#+/, "") || config.flomoTag;
		const outgoing = processed !== null ? chunkText(processed, FLOMO_MAX_CHARS, digestHeader(now)).map((content) => ({
			content,
			annotationIds: candidates.map((a) => a.id)
		})) : buildDigestMemos(cache, candidates, { date: now });
		let sent = 0;
		let failed = 0;
		for (const memo of outgoing) {
			let result;
			try {
				result = await postMemo(url, buildTaggedContent(memo.content, tag));
			} catch (error) {
				result = { ok: false };
			}
			if (result.ok) {
				sent += 1;
				mark(memo.annotationIds);
			} else failed += 1;
		}
		if (ledgerChanged) await writeFlomoLedger(ledger);
		const message = sent > 0 ? "已推送 " + candidates.length + " 条标注到 flomo（#" + tag + "）：" + sent + " 条 MEMO 发送成功" + (failed > 0 ? "，" + failed + " 条失败（下次同步会重试）" : "") + "。" : "flomo 推送失败：" + outgoing.length + " 条 MEMO 全部失败。";
		return {
			ok: sent > 0 && failed === 0,
			dest,
			candidates: candidates.length,
			memos: outgoing.length,
			delivered: sent,
			message
		};
	}
	if (dest === "local") {
		const dir = (opts.outputDir ?? "").trim() || config.outputDir.trim();
		if (dir === "") return {
			ok: false,
			dest,
			candidates: candidates.length,
			memos: 0,
			delivered: 0,
			message: "本地导出需要配置 outputDir（设置面板「本地导出目录」）。"
		};
		const all = annotationsInWindow(cache, now, windowDays);
		const content = buildDigestMarkdown(cache, all.length > 0 ? all : candidates, { date: now });
		try {
			await mkdir(dir, { recursive: true });
			const file = path.join(dir, "Cubox标注-" + ymd(now) + ".md");
			await writeFile(file, content + "\n");
			mark(candidates.map((a) => a.id));
			await writeFlomoLedger(ledger);
			return {
				ok: true,
				dest,
				candidates: candidates.length,
				memos: 1,
				delivered: 1,
				message: "已写入标注 digest：" + file + "（" + candidates.length + " 条新标注）"
			};
		} catch (error) {
			return {
				ok: false,
				dest,
				candidates: candidates.length,
				memos: 0,
				delivered: 0,
				message: "写入本地文件失败：" + String(error instanceof Error ? error.message : error)
			};
		}
	}
	if (config.notionToken.trim() === "") return {
		ok: false,
		dest,
		candidates: candidates.length,
		memos: 0,
		delivered: 0,
		message: "Notion 未配置（跳过）：请填写 Integration Token。"
	};
	if (config.notionTargetPageId.trim() === "") return {
		ok: false,
		dest,
		candidates: candidates.length,
		memos: 0,
		delivered: 0,
		message: "Notion 目标页面未配置（跳过）：请填写目标页面 URL 或 ID。"
	};
	try {
		const content = buildDigestMarkdown(cache, candidates, { date: now });
		const pageId = await exportToNotion(config.notionToken, config.notionTargetPageId, "Cubox 标注 " + ymd(now), content);
		mark(candidates.map((a) => a.id));
		await writeFlomoLedger(ledger);
		return {
			ok: true,
			dest,
			candidates: candidates.length,
			memos: 1,
			delivered: 1,
			message: "已导出 " + candidates.length + " 条标注到 Notion：https://www.notion.so/" + pageId
		};
	} catch (error) {
		return {
			ok: false,
			dest,
			candidates: candidates.length,
			memos: 0,
			delivered: 0,
			message: "Notion 导出失败：" + String(error instanceof Error ? error.message : error)
		};
	}
}
//#endregion
//#region src/sync.ts
/**
* dsh-cubox — core sync/business logic.
*
* doSync pulls cards (and today's annotations) from the Cubox API, persists
* a snapshot to ~/.dsh/dsh-cubox-cache.json, and exports to the configured
* output dir: optionally one markdown file per card (exportCards), and — when
* an LLM key is configured — a daily brief generated from the user's prompt
* template ({collection} placeholder), written as 今日收藏简报-YYYY-MM-DD.md.
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
	const warnings = [];
	let cards = [];
	try {
		cards = await api.filterCards({
			start_time: cardStart,
			end_time: cardEnd,
			limit
		});
	} catch (cardError) {
		try {
			cards = await api.filterCards({ limit });
		} catch (fallbackError) {
			warnings.push("拉取收藏失败：" + String(fallbackError instanceof Error ? fallbackError.message : fallbackError));
		}
		if (warnings.length === 0) warnings.push("时间过滤被拒绝，已退回拉取最新收藏：" + String(cardError instanceof Error ? cardError.message : cardError));
	}
	const range = todayRange();
	let annotations = [];
	try {
		annotations = await api.filterAnnotations({
			start_time: range.start,
			end_time: range.end,
			limit: 500
		});
	} catch (annotationError) {
		warnings.push("拉取标注失败（已忽略）：" + String(annotationError instanceof Error ? annotationError.message : annotationError));
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
	const cfg = await store.load();
	const outputDir = typeof opts.outputDir === "string" ? opts.outputDir : cfg.outputDir;
	let exportedFiles = 0;
	if (outputDir.trim() !== "" && cfg.exportCards !== false) try {
		exportedFiles = await exportSyncToMarkdown(cache, outputDir.trim());
	} catch (exportError) {
		warnings.push("导出 Markdown 失败：" + String(exportError instanceof Error ? exportError.message : exportError));
	}
	let briefPath = "";
	if (outputDir.trim() !== "" && cfg.llmPrompt.trim() !== "" && llmConfigured({
		baseUrl: cfg.llmBaseUrl,
		apiKey: cfg.llmApiKey,
		model: cfg.llmModel
	})) try {
		briefPath = await writeDailyBrief(cache, outputDir.trim(), {
			baseUrl: cfg.llmBaseUrl,
			apiKey: cfg.llmApiKey,
			model: cfg.llmModel,
			prompt: cfg.llmPrompt
		}, { days });
	} catch (briefError) {
		warnings.push("生成简报失败：" + String(briefError instanceof Error ? briefError.message : briefError));
	}
	let digest = null;
	if (cfg.flomoEnabled) try {
		digest = await deliverAnnotationDigest(cache, cfg, { outputDir: outputDir.trim() });
	} catch (digestError) {
		warnings.push("标注 digest 导出失败：" + String(digestError instanceof Error ? digestError.message : digestError));
	}
	return {
		ok: true,
		message: "同步完成：拉取卡片 " + cards.length + " 条、标注 " + annotations.length + " 条；缓存现有卡片 " + mergedCards.length + " 条、标注 " + mergedAnnotations.length + " 条。" + (exportedFiles > 0 ? "已导出 " + exportedFiles + " 个收藏 Markdown 到 " + outputDir.trim() : "") + (briefPath !== "" ? "已生成简报：" + briefPath : "") + (digest !== null && digest.candidates > 0 ? "标注 digest：" + digest.message : "") + (warnings.length > 0 ? "\n警告：" + warnings.join("；") : ""),
		pulledCards: cards.length,
		pulledAnnotations: annotations.length,
		cachedCards: mergedCards.length,
		cachedAnnotations: mergedAnnotations.length,
		since: cardStart,
		exportedFiles,
		briefPath,
		digestCandidates: digest?.candidates ?? 0,
		digestMemos: digest?.memos ?? 0,
		digestMessage: digest?.message ?? ""
	};
}
/** Collect a card's annotations (text + note). */
function cardAnnotationLines(card, annotations) {
	const lines = [];
	for (const a of annotations) {
		if (a.text !== "") lines.push("高亮：" + a.text.trim().replace(/\s+/g, " "));
		if (a.note !== "") lines.push("笔记：" + a.note.trim().replace(/\s+/g, " "));
	}
	return lines;
}
/**
* Format cards within a time window (from `end` going back `days` days) into
* a plain text list for the LLM prompt. Each entry: title (source), link,
* summary, annotations. A leading line states the covered time range so the
* model knows the window.
*/
function formatCollectionForPrompt(cache, end, days) {
	const pad = (n) => String(n).padStart(2, "0");
	const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1), 0, 0, 0, 0);
	const startKey = start.getFullYear() + "-" + pad(start.getMonth() + 1) + "-" + pad(start.getDate());
	const endKey = end.getFullYear() + "-" + pad(end.getMonth() + 1) + "-" + pad(end.getDate());
	const inWindow = (iso) => {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return false;
		return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
	};
	const cards = cache.cards.filter((c) => inWindow(c.create_time)).sort((a, b) => b.create_time.localeCompare(a.create_time));
	const lines = [];
	lines.push("收藏时间范围：" + (days === 1 ? endKey : startKey + " 至 " + endKey) + "（共 " + cards.length + " 条）");
	if (cards.length === 0) {
		lines.push("（该时间段内没有新收藏）");
		return lines.join("\n");
	}
	for (const [index, card] of cards.entries()) {
		const title = (card.title || card.article_title || card.url).trim();
		const domain = (() => {
			try {
				return new URL(card.url).hostname.replace(/^www\./, "");
			} catch {
				return card.domain ?? "";
			}
		})();
		const description = (card.description || "").trim();
		const annotationText = cardAnnotationLines(card, cache.annotations);
		lines.push(index + 1 + ". " + title + "（来源：" + (domain || "未知") + "）");
		if (card.url !== "") lines.push("   链接：" + card.url);
		if (description !== "") lines.push("   摘要：" + description);
		if (annotationText.length > 0) {
			lines.push("   标注：");
			for (const a of annotationText.slice(0, 5)) lines.push("   - " + a);
		}
	}
	return lines.join("\n");
}
/**
* Generate the brief from the user's prompt and write it to the output dir.
* File name reflects the window: 今日收藏简报-YYYY-MM-DD.md for days=1,
* 最近N日收藏简报-YYYY-MM-DD.md for days>1 (so a 7-day sync writes its own
* file instead of overwriting today's).
*/
async function writeDailyBrief(cache, outputDir, llm, opts = {}) {
	const days = typeof opts.days === "number" && opts.days > 0 ? Math.floor(opts.days) : 1;
	const now = /* @__PURE__ */ new Date();
	const pad = (n) => String(n).padStart(2, "0");
	const dateKey = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
	const collection = formatCollectionForPrompt(cache, now, days);
	const user = llm.prompt.includes("{collection}") ? llm.prompt.replaceAll("{collection}", collection) : llm.prompt + "\n\n【收藏列表】\n" + collection;
	const content = await chatComplete({
		baseUrl: llm.baseUrl,
		apiKey: llm.apiKey,
		model: llm.model
	}, "你是一个信息整理助手。严格按用户的 prompt 要求输出，直接输出内容本身，不要任何引导语。", user);
	const prefix = days === 1 ? "今日收藏简报" : "最近" + days + "日收藏简报";
	const filePath = path.join(outputDir, prefix + "-" + dateKey + ".md");
	await mkdir(outputDir, { recursive: true });
	await writeFile(filePath, content + "\n");
	return filePath;
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
/**
* Write one markdown file per card into the output directory. Card files
* mirror the official Cubox Obsidian plugin layout (frontmatter with
* id/cubox_url/url/tags + title + description + links + annotations).
* Only today's cards are written (older ones were already exported).
* Returns the number of files written.
*/
async function exportSyncToMarkdown(cache, outputDir) {
	await mkdir(outputDir, { recursive: true });
	const today = /* @__PURE__ */ new Date();
	const pad = (n) => String(n).padStart(2, "0");
	let written = 0;
	for (const card of cache.cards) {
		const created = new Date(card.create_time);
		if (Number.isNaN(created.getTime())) continue;
		if (created.getFullYear() !== today.getFullYear() || created.getMonth() !== today.getMonth() || created.getDate() !== today.getDate()) continue;
		const title = (card.title || card.article_title || "未命名收藏").trim();
		const safeName = sanitizeFilename(title);
		const dateKey = created.getFullYear() + "-" + pad(created.getMonth() + 1) + "-" + pad(created.getDate());
		const filePath = path.join(outputDir, safeName + "-" + dateKey + ".md");
		const cardAnnotations = cache.annotations.filter((a) => a.card_id === card.id);
		const parts = [];
		parts.push("---");
		parts.push("id: \"" + card.id + "\"");
		parts.push("cubox_url: https://cubox.pro/web/card/" + card.id);
		if (card.url !== "") parts.push("url: " + card.url);
		const tags = Array.isArray(card.tags) && card.tags.length > 0 ? card.tags : [];
		parts.push("tags: [" + tags.join(", ") + "]");
		parts.push("---");
		parts.push("");
		parts.push("# " + title);
		parts.push("");
		if (card.description !== "") {
			parts.push(card.description.trim());
			parts.push("");
		}
		if (card.url !== "") {
			parts.push("[Read in Cubox](https://cubox.pro/web/card/" + card.id + ")  ");
			parts.push("[Read Original](" + card.url + ")  ");
			parts.push("");
			parts.push("---");
			parts.push("");
		}
		if (cardAnnotations.length > 0) {
			parts.push("## 标注");
			parts.push("");
			for (const a of cardAnnotations) {
				if (a.text !== "") parts.push("- > " + a.text.trim().replace(/\n/g, " "));
				if (a.note !== "") parts.push("  - 笔记：" + a.note.trim().replace(/\n/g, " "));
				if (a.color !== "") parts.push("  - 颜色：" + a.color);
			}
			parts.push("");
		}
		await writeFile(filePath, parts.join("\n"));
		written += 1;
	}
	return written;
}
/** Strip characters that are illegal in filenames; cap the length. */
function sanitizeFilename(name) {
	const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
	return cleaned === "" ? "未命名收藏" : cleaned.slice(0, 80);
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
					outputDir: { type: "string" },
					exportCards: { type: "boolean" },
					llmBaseUrl: { type: "string" },
					llmModel: { type: "string" },
					llmKeyMasked: { type: "string" },
					flomoEnabled: { type: "boolean" },
					exportDest: { type: "string" },
					flomoTag: { type: "string" },
					flomoMinAgeMinutes: { type: "number" },
					usePrompt: { type: "boolean" },
					flomoConfigured: { type: "boolean" },
					sentAnnotationCount: { type: "number" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			const view = await ctx.store.view();
			const cache = await readCache();
			const flomoOk = await flomoConfigured();
			const ledger = await readFlomoLedger();
			const destLabel = view.exportDest === "local" ? "本地文件" : view.exportDest === "notion" ? "Notion" : "flomo";
			return {
				ok: true,
				message: [
					view.configured ? "已配置：服务器 " + view.server + "，token " + view.tokenMasked : "未配置：请先提供 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接），调用 cubox_config 配置。",
					"定时同步：" + (view.syncMinutes > 0 ? "每 " + view.syncMinutes + " 分钟" : "已关闭"),
					"最近同步：" + (view.lastSyncAt !== "" ? view.lastSyncAt : "从未同步"),
					"缓存：卡片 " + cache.cards.length + " 条、标注 " + cache.annotations.length + " 条",
					"导出目录：" + (view.outputDir !== "" ? view.outputDir : "未设置（不同步到本地文件）"),
					"卡片导出：" + (view.exportCards ? "开（每张收藏一个 md）" : "关"),
					"AI 简报：" + (view.llmKeyMasked !== "" ? "已配置（" + view.llmModel + "，" + view.llmBaseUrl + "，key " + view.llmKeyMasked + "）" : "未配置"),
					"标注 digest：" + (view.flomoEnabled ? "已开启（目标 " + destLabel + "，标签 #" + view.flomoTag + "，最短等待 " + view.flomoMinAgeMinutes + " 分钟" + (view.usePrompt ? "，LLM 整理" : "") + "）" : "未开启（cubox_config flomoEnabled=true 开启）"),
					"flomo 凭据：" + (flomoOk ? "已配置（共享 ~/.dsh/dsh-flomo.json）" : "未配置"),
					"已推送标注：" + Object.keys(ledger).length + " 条（本地去重账本）",
					"配置路径：" + view.configPath
				].join("\n"),
				configured: view.configured,
				server: view.server,
				tokenMasked: view.tokenMasked,
				syncMinutes: view.syncMinutes,
				lastSyncAt: view.lastSyncAt,
				outputDir: view.outputDir,
				exportCards: view.exportCards,
				llmBaseUrl: view.llmBaseUrl,
				llmModel: view.llmModel,
				llmKeyMasked: view.llmKeyMasked,
				flomoEnabled: view.flomoEnabled,
				exportDest: view.exportDest,
				flomoTag: view.flomoTag,
				flomoMinAgeMinutes: view.flomoMinAgeMinutes,
				usePrompt: view.usePrompt,
				flomoConfigured: flomoOk,
				sentAnnotationCount: Object.keys(ledger).length,
				configPath: view.configPath
			};
		}
	});
}
/** Project a config view onto the fields declared in the config tool schema. */
function configToolFields(view) {
	return {
		configured: view.configured,
		server: view.server,
		tokenMasked: view.tokenMasked,
		syncMinutes: view.syncMinutes,
		lastSyncAt: view.lastSyncAt,
		outputDir: view.outputDir,
		exportCards: view.exportCards,
		llmBaseUrl: view.llmBaseUrl,
		llmModel: view.llmModel,
		llmKeyMasked: view.llmKeyMasked,
		flomoEnabled: view.flomoEnabled,
		exportDest: view.exportDest,
		flomoTag: view.flomoTag,
		flomoMinAgeMinutes: view.flomoMinAgeMinutes,
		usePrompt: view.usePrompt,
		notionConfigured: view.notionConfigured,
		notionTargetPageId: view.notionTargetPageId,
		configPath: view.configPath
	};
}
/** Config tool: set/clear credentials, sync interval, export, AI + digest options. */
function cuboxConfigTool(ctx) {
	return defineTool$1({
		name: "cubox_config",
		description: "配置或清除 Cubox API 扩展凭据与同步/导出选项。apiLink 填完整 API 扩展链接（形如 https://cubox.pro/c/api/save/xxxx，自动解析 server 与 token）；也可分别填 server（cubox.pro / cubox.cc）与 token。syncMinutes 为定时同步间隔（分钟，0=关闭定时；推送 flomo 建议 60–120）。outputDir 为本地导出目录；exportCards 控制是否每张收藏导出一个 md。llmBaseUrl / llmApiKey / llmModel 配置 LLM（AI 简报与 prompt 整理共用）；llmPrompt 为 AI 简报模板（{collection}）。标注 digest：flomoEnabled 开启同步后推送新增/变更标注；exportDest 选目标（flomo/local/notion）；flomoTag 为 flomo 标签（默认 AI/cubox）；flomoMinAgeMinutes 为标注最短等待分钟数（默认 60，避免半截内容）；usePrompt + exportPrompt（{digest}）让 LLM 先整理再推送；notionToken / notionTargetPageId 供 exportDest=notion。reset: true 清除全部凭据。凭据持久化到 ~/.dsh/dsh-cubox.json（0600），flomo 凭据共享 ~/.dsh/dsh-flomo.json。",
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
				description: "定时同步间隔（分钟），0 = 关闭定时；推送 flomo 建议 60–120"
			},
			outputDir: {
				type: "string",
				description: "本地导出目录（绝对路径；同步时写入 Markdown 文件，空=不导出）"
			},
			exportCards: {
				type: "boolean",
				description: "是否每张收藏导出一个 md 文件（默认 true；false 则只生成 AI 简报）"
			},
			llmBaseUrl: {
				type: "string",
				description: "LLM Base URL（OpenAI 兼容，默认 https://api.deepseek.com/v1）"
			},
			llmApiKey: {
				type: "string",
				description: "LLM API Key"
			},
			llmModel: {
				type: "string",
				description: "LLM 模型名（默认 deepseek-chat）"
			},
			llmPrompt: {
				type: "string",
				description: "AI 简报 prompt 模板，{collection} 会被替换为今日收藏列表"
			},
			flomoEnabled: {
				type: "boolean",
				description: "是否开启「同步后推送标注 digest」（默认 false）"
			},
			exportDest: {
				type: "string",
				enum: [
					"flomo",
					"local",
					"notion"
				],
				description: "标注 digest 目标：flomo（默认）/ local / notion"
			},
			flomoTag: {
				type: "string",
				description: "flomo 标签（不带 #，默认 AI/cubox）"
			},
			flomoMinAgeMinutes: {
				type: "number",
				description: "标注最短等待分钟数（默认 60），早于该时长的标注不推送，避免半截内容"
			},
			usePrompt: {
				type: "boolean",
				description: "推送前是否用 LLM 按 exportPrompt 整理 digest"
			},
			exportPrompt: {
				type: "string",
				description: "digest 整理 prompt 模板，{digest} 会被替换为原始标注列表"
			},
			notionToken: {
				type: "string",
				description: "Notion Integration Token（exportDest=notion 时用）"
			},
			notionTargetPageId: {
				type: "string",
				description: "Notion 目标父页面 URL 或 32 位 ID（exportDest=notion 时用）"
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
					outputDir: { type: "string" },
					exportCards: { type: "boolean" },
					llmBaseUrl: { type: "string" },
					llmModel: { type: "string" },
					llmKeyMasked: { type: "string" },
					flomoEnabled: { type: "boolean" },
					exportDest: { type: "string" },
					flomoTag: { type: "string" },
					flomoMinAgeMinutes: { type: "number" },
					usePrompt: { type: "boolean" },
					notionConfigured: { type: "boolean" },
					notionTargetPageId: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (args !== void 0 && args.reset === true) return {
				ok: true,
				message: "已清除 Cubox 凭据。",
				...configToolFields(await ctx.store.patch({ reset: true }))
			};
			const view = await ctx.store.patch(args);
			if (!view.configured) return {
				ok: false,
				message: "配置未生效：缺少 token。请提供完整的 API 扩展链接。",
				...configToolFields(view)
			};
			const parts = ["已保存 Cubox 配置：服务器 " + view.server + "，token " + view.tokenMasked];
			if (view.syncMinutes > 0) parts.push("定时同步每 " + view.syncMinutes + " 分钟一次");
			else parts.push("定时同步已关闭（可随时 cubox_sync 手动同步）");
			if (view.outputDir !== "") parts.push(view.exportCards ? "导出每张收藏 md 到 " + view.outputDir : "不导出卡片，只写 AI 简报到 " + view.outputDir);
			if (view.llmKeyMasked !== "") parts.push("AI 简报已配置（" + view.llmModel + "）");
			if (view.flomoEnabled) {
				const destLabel = view.exportDest === "local" ? "本地文件" : view.exportDest === "notion" ? "Notion" : "flomo";
				parts.push("标注 digest 已开启（" + destLabel + "，标签 #" + view.flomoTag + "，最短等待 " + view.flomoMinAgeMinutes + " 分钟" + (view.usePrompt ? "，LLM 整理" : "") + "）");
			} else parts.push("标注 digest 未开启（flomoEnabled=true 开启）");
			return {
				ok: true,
				message: parts.join("；") + "。",
				...configToolFields(view)
			};
		}
	});
}
/** Sync tool: pull the latest collection snapshot into the local cache. */
function cuboxSyncTool(ctx) {
	return defineTool$1({
		name: "cubox_sync",
		description: "同步 Cubox：拉取最近 N 天（默认今天）的收藏卡片与今日标注，合并进本地缓存（~/.dsh/dsh-cubox-cache.json），并更新最近同步时间。若配置了 outputDir 导出目录，会按配置导出：exportCards 开启时每张收藏一个 md 文件；配置了 LLM 时按 llmPrompt 生成今日收藏简报（今日收藏简报-YYYY-MM-DD.md）写入该目录。若开启了 flomoEnabled，还会把新增/变更且创建满 N 分钟的标注以每日 digest 推送到 exportDest（flomo/local/notion；本地去重账本防重复）。days 控制拉取窗口天数；limit 控制卡片拉取上限（默认 200）。返回本次拉取、缓存规模与导出结果。",
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
					exportedFiles: { type: "number" },
					briefPath: { type: "string" },
					digestCandidates: { type: "number" },
					digestMemos: { type: "number" },
					digestMessage: { type: "string" },
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
				exportedFiles: result.exportedFiles,
				briefPath: result.briefPath,
				digestCandidates: result.digestCandidates,
				digestMemos: result.digestMemos,
				digestMessage: result.digestMessage,
				since: result.since
			};
		}
	});
}
/** Flomo tool: push newly settled annotations to flomo as a daily digest. */
function cuboxFlomoTool(ctx) {
	return defineTool$1({
		name: "cubox_flomo",
		description: "把 Cubox 新增/变更的标注（划线+想法）以每日 digest（卡片标题+链接+标注）推送到 flomo（浮墨笔记）。复用 ~/.dsh/dsh-flomo.json 凭据（无需重复配置）；本地去重账本（~/.dsh/.cubox-flomo-annotations-sent）保证同一标注不重复推送；默认只推创建满 N 分钟（配置 flomoMinAgeMinutes，默认 60）的标注，避免半截内容；正文自动去除 #（flomo 会把 #词 抓成标签），只保留配置标签；超长自动拆成多条 MEMO。days 指定回看窗口天数（默认 2）；force=true 忽略最短等待时间（手动补推）；tag 覆盖配置标签。",
		parameters: {
			days: {
				type: "number",
				description: "回看窗口天数（默认 2）"
			},
			force: {
				type: "boolean",
				description: "忽略最短等待时间，立即推送（仍受去重账本约束）"
			},
			tag: {
				type: "string",
				description: "flomo 标签（不带 #，临时覆盖配置）"
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
					candidates: { type: "number" },
					memos: { type: "number" },
					delivered: { type: "number" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (!(await ctx.store.view()).configured) return {
				ok: false,
				message: "未配置 Cubox API 链接：请先提供 API 扩展链接并调用 cubox_config。"
			};
			const cfg = await ctx.store.load();
			const result = await deliverAnnotationDigest(await readCache(), cfg, {
				dest: "flomo",
				windowDays: typeof args?.days === "number" && args.days > 0 ? args.days : void 0,
				force: args?.force === true,
				tag: typeof args?.tag === "string" ? args.tag : void 0
			});
			return {
				ok: result.ok,
				message: result.message,
				candidates: result.candidates,
				memos: result.memos,
				delivered: result.delivered
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
		cuboxCardsTool(ctx),
		cuboxFlomoTool(ctx)
	];
}
//#endregion
//#region src/routes.ts
/** Route paths. */
const CUBOX_API = {
	config: "/api/dsh-cubox/config",
	sync: "/api/dsh-cubox/sync",
	status: "/api/dsh-cubox/status",
	pickDir: "/api/dsh-cubox/pick-dir",
	flomo: "/api/dsh-cubox/flomo",
	digest: "/api/dsh-cubox/digest",
	testFlomo: "/api/dsh-cubox/test-flomo",
	testNotion: "/api/dsh-cubox/test-notion"
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
* @param deps - store, api client, and optional picker resolver.
* @returns the route list.
*/
function makeRoutes(deps) {
	const { store, api, getPicker } = deps;
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
					if (body.flomoWebhookUrl !== void 0 || body.flomoApiKey !== void 0 || body.flomoReset === true) {
						const next = { ...await readFlomoCredentials() };
						if (body.flomoReset === true) {
							next.webhookUrl = "";
							next.apiKey = "";
						} else {
							if (typeof body.flomoWebhookUrl === "string") next.webhookUrl = body.flomoWebhookUrl.trim();
							if (typeof body.flomoApiKey === "string") next.apiKey = body.flomoApiKey.trim();
						}
						await writeFlomoCredentials(next);
						const rest = { ...body };
						delete rest.flomoWebhookUrl;
						delete rest.flomoApiKey;
						delete rest.flomoReset;
						await store.patch(rest);
					} else await store.patch(body);
					writeJson(res, 200, await store.view());
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
				const flomo = await flomoStatus();
				const ledger = await readFlomoLedger();
				writeJson(res, 200, {
					...view,
					cachedCards: cache.cards.length,
					cachedAnnotations: cache.annotations.length,
					cacheUpdatedAt: cache.updatedAt,
					flomoConfigured: flomo.configured,
					flomoSource: flomo.source,
					flomoMasked: flomo.masked,
					flomoConfigPath: flomo.configPath,
					sentAnnotationCount: Object.keys(ledger).length
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
				try {
					writeJson(res, 200, await doSync(api, store, {
						days,
						limit: 200
					}));
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "同步失败：" + String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.pickDir,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const capability = getPicker?.()?.capability();
					if (capability === void 0) {
						writeJson(res, 200, {
							ok: false,
							unsupported: true,
							message: "当前环境没有目录选择服务，请手动输入路径。"
						});
						return;
					}
					if (capability.kind === "native") {
						const picked = await capability.pick(AbortSignal.timeout(300 * 1e3));
						if (picked === null) {
							writeJson(res, 200, {
								ok: false,
								cancelled: true,
								message: "已取消选择。"
							});
							return;
						}
						writeJson(res, 200, {
							ok: true,
							path: picked
						});
						return;
					}
					writeJson(res, 200, {
						ok: false,
						unsupported: true,
						message: "当前为远程浏览模式，不支持系统文件夹对话框，请手动输入路径。"
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "选择文件夹失败：" + String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.flomo,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				if (!(await store.view()).configured) {
					writeJson(res, 400, { error: "未配置 Cubox API 链接：请先填写 API 扩展链接。" });
					return;
				}
				const body = await readJsonBody(req) ?? {};
				try {
					const cfg = await store.load();
					writeJson(res, 200, await deliverAnnotationDigest(await readCache(), cfg, {
						dest: "flomo",
						windowDays: typeof body.days === "number" && body.days > 0 ? body.days : void 0,
						force: body.force === true,
						tag: typeof body.tag === "string" ? body.tag : void 0
					}));
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "推送标注失败：" + String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.digest,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				if (!(await store.view()).configured) {
					writeJson(res, 400, { error: "未配置 Cubox API 链接：请先填写 API 扩展链接。" });
					return;
				}
				const body = await readJsonBody(req) ?? {};
				try {
					const cfg = await store.load();
					writeJson(res, 200, await deliverAnnotationDigest(await readCache(), cfg, {
						dest: cfg.exportDest,
						windowDays: typeof body.days === "number" && body.days > 0 ? body.days : void 0,
						force: body.force === true,
						tag: typeof body.tag === "string" ? body.tag : void 0
					}));
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "导出标注 digest 失败：" + String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.testFlomo,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const url = await resolveFlomoUrl();
				if (url === null) {
					writeJson(res, 200, {
						ok: false,
						message: "flomo 未配置：请先在「flomo 标注同步」区填写 API URL / API Key 并保存。"
					});
					return;
				}
				try {
					writeJson(res, 200, await postMemo(url, "✅ dsh-cubox 测试：flomo 配置有效（" + (/* @__PURE__ */ new Date()).toISOString() + "）"));
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "测试失败：" + String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: CUBOX_API.testNotion,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const cfg = await store.load();
				try {
					writeJson(res, 200, await testNotion(cfg.notionToken, cfg.notionTargetPageId));
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						message: "测试失败：" + String(error instanceof Error ? error.message : error)
					});
				}
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
	"timer",
	"directoryPicker"
];
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const CUBOX_GUIDANCE = "本机已安装 dsh-cubox 插件（Cubox 收藏同步）：配置一次 Cubox API 扩展链接（偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接，形如 https://cubox.pro/c/api/save/xxxx）后，可用 cubox_sync 同步收藏（默认拉取今天，可 days 指定最近 N 天；若配置了 outputDir 导出目录，会按配置导出——exportCards 开启时每张收藏一个 md 文件，配置了 LLM 时按 llmPrompt 生成今日收藏简报写入该目录）、cubox_cards 按关键词/时间/标注状态查询收藏，cubox_flomo 把新增/变更标注以每日 digest 推送到 flomo，cubox_config / cubox_status 配置与查看状态。标注 digest：flomoEnabled 开启后每次同步自动推送新标注（目标 exportDest=flomo/local/notion，标签 flomoTag 默认 AI/cubox，只推创建满 flomoMinAgeMinutes 分钟的标注，可用 usePrompt 让 LLM 先整理）；flomo 凭据复用 ~/.dsh/dsh-flomo.json，本地去重账本 ~/.dsh/.cubox-flomo-annotations-sent 防重复，正文自动去 #。插件支持定时同步（配置 syncMinutes；推送 flomo 建议 60–120 分钟，0 关闭）。凭据存 ~/.dsh/dsh-cubox.json（权限 0600），同步快照存 ~/.dsh/dsh-cubox-cache.json；cubox_status 不回显完整 token 与 LLM key。也可在 Web 设置页「Cubox」面板中配置、选择导出目录、编辑 AI 简报 prompt、配置 flomo 标注同步与手动同步。用户提到「cubox / 收藏 / 稍后读 / 收录」时即指本插件，请据此协作。";
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
	let timerGeneration = 0;
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
			const getPicker = () => {
				try {
					return ctx.directoryPicker;
				} catch (error) {
					console.error("[dsh-cubox] directoryPicker access failed:", error);
					return;
				}
			};
			const disposers = makeRoutes({
				store,
				api,
				getPicker
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
		const configuredMinutes = typeof config?.syncMinutes === "number" && config.syncMinutes >= 0 ? Math.floor(config.syncMinutes) : 60;
		/** Minutes the timer is currently armed with (-1 = none). */
		let armedMinutes = -1;
		const armTimer = (minutes) => {
			if (disposeTimer !== void 0) {
				disposeTimer();
				disposeTimer = void 0;
			}
			armedMinutes = minutes;
			if (minutes <= 0) return;
			disposeTimer = ctx.interval(() => {
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
		store.onSaved = (cfg) => {
			if (cfg.syncMinutes !== armedMinutes) armTimer(cfg.syncMinutes);
		};
		timerGeneration += 1;
		const generation = timerGeneration;
		armTimer(configuredMinutes);
		store.load().then((cfg) => {
			if (generation !== timerGeneration) return;
			if (cfg.syncMinutes !== armedMinutes) armTimer(cfg.syncMinutes);
		}).catch(() => {});
	};
	sync();
}
//#endregion
export { CUBOX_API, CUBOX_GUIDANCE, CuboxApi, CuboxApiError, CuboxStore, DEFAULT_DIGEST_WINDOW_DAYS, DEFAULT_EXPORT_PROMPT, DEFAULT_FLOMO_LEDGER_FILE, DEFAULT_FLOMO_TAG, DEFAULT_LLM_PROMPT, FLOMO_CONFIG_FILE, FLOMO_MAX_CHARS, NOTION_API, NOTION_VERSION, annotationHash, annotationsInWindow, apply, buildDigestMarkdown, buildDigestMemos, buildTaggedContent, buildTools, cachePath, chatComplete, chunkText, configPath, cuboxCardsTool, cuboxConfigTool, cuboxFlomoTool, cuboxStatusTool, cuboxSyncTool, defineTool, deliverAnnotationDigest, digestHeader, doSync, exportSyncToMarkdown, exportToNotion, flomoConfigPath, flomoConfigured, flomoLedgerPath, flomoStatus, formatApiTime, formatCollectionForPrompt, inject, llmConfigured, makeRoutes, mask, name, normalizeNotionPageId, parseApiLink, parseCuboxTime, postMemo, readCache, readFlomoCredentials, readFlomoLedger, resolveFlomoUrl, selectUnpushedAnnotations, stripHashTags, testNotion, toNotionBlocks, todayRange, writeCache, writeDailyBrief, writeFlomoCredentials, writeFlomoLedger, ymd };
