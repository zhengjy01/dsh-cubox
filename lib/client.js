window.__ModuleLoader__.load({
	id: "dsh-cubox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** Error carrying the route's JSON error message. */
		var CuboxApiError = class extends Error {
			constructor(message) {
				super(message);
				this.name = "CuboxApiError";
			}
		};
		/** Parse a JSON response or throw a CuboxApiError. */
		async function readJson(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new CuboxApiError(`HTTP ${response.status}: invalid JSON response`);
			}
			if (!response.ok) throw new CuboxApiError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
			return body;
		}
		/** Plain fetch helper with an error wrapper. */
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new CuboxApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		/** The cubox panel API. */
		var CuboxApi = class {
			async getConfig() {
				return request("/api/dsh-cubox/config");
			}
			async setConfig(patch) {
				return request("/api/dsh-cubox/config", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patch)
				});
			}
			async getStatus() {
				return request("/api/dsh-cubox/status");
			}
			async sync(days = 1) {
				return request("/api/dsh-cubox/sync", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ days })
				});
			}
			/** Open the host OS folder chooser; resolves with the picked path. */
			async pickDir() {
				return request("/api/dsh-cubox/pick-dir", { method: "POST" });
			}
			/** Push the annotation digest to flomo (respects the dedup ledger). */
			async pushFlomo(body = {}) {
				return request("/api/dsh-cubox/flomo", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body)
				});
			}
			/** Push the annotation digest to the configured destination. */
			async pushDigest(body = {}) {
				return request("/api/dsh-cubox/digest", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body)
				});
			}
			/** Send a test memo to verify the flomo credential. */
			async testFlomo() {
				return request("/api/dsh-cubox/test-flomo", { method: "POST" });
			}
			/** Verify the Notion token + target page. */
			async testNotion() {
				return request("/api/dsh-cubox/test-notion", { method: "POST" });
			}
		};
		//#endregion
		//#region src/client/CuboxSettingsPanel.tsx
		/**
		* Cubox settings panel — rendered inside the web settings page
		* (settings.section entry). Connection setup (API extension link, server,
		* sync interval), a manual sync button with result summary, the current
		* cache/status, AI brief options, and the flomo annotation-digest section
		* (enable / destination / tag / min age / prompt / credentials). Plain React,
		* inline styles only.
		*/
		/** Module-level API client (stateless; the component closes over it). */
		const api = new CuboxApi();
		/** One shared style sheet (kept tiny and theme-agnostic). */
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "620px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: {
				fontWeight: 600,
				fontSize: "13px",
				margin: 0
			},
			status: {
				fontSize: "12px",
				opacity: .85
			},
			statusWarn: {
				fontSize: "12px",
				opacity: .9,
				color: "#c9763a"
			},
			row: {
				display: "flex",
				gap: "6px",
				alignItems: "center"
			},
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px"
			},
			select: {
				padding: "4px 6px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px"
			},
			flex: { flex: 1 },
			button: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(128,128,128,0.4)",
				background: "rgba(128,128,128,0.14)",
				color: "inherit",
				fontSize: "12px",
				whiteSpace: "nowrap"
			},
			msg: {
				fontSize: "12px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				opacity: .9
			},
			hint: {
				fontSize: "11px",
				opacity: .75,
				lineHeight: 1.6
			},
			section: {
				fontWeight: 600,
				fontSize: "12px",
				margin: "6px 0 0",
				opacity: .9
			},
			textarea: {
				width: "100%",
				boxSizing: "border-box",
				padding: "6px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px",
				fontFamily: "inherit",
				minHeight: "120px",
				resize: "vertical",
				lineHeight: 1.5
			},
			checkRow: {
				display: "flex",
				gap: "6px",
				alignItems: "center",
				fontSize: "12px"
			}
		};
		/** Status line for the current config view. */
		function statusText(view) {
			if (view === null) return "加载中…";
			if (!view.configured) return "未配置 — 打开 Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接（形如 https://cubox.pro/c/api/save/xxxx），粘贴到上方输入框。";
			return "已配置 · 服务器 " + view.server + " · token " + view.tokenMasked + " · 定时同步每 " + view.syncMinutes + " 分钟 · 最近同步 " + (view.lastSyncAt !== "" ? view.lastSyncAt : "从未") + " · 缓存卡片 " + view.cachedCards + " 条 / 标注 " + view.cachedAnnotations + " 条 · 导出目录 " + (view.outputDir !== "" ? view.outputDir : "未设置") + " · 卡片导出 " + (view.exportCards ? "开" : "关") + " · AI 简报 " + (view.llmKeyMasked !== "" ? "已配置" : "未配置");
		}
		/** Status line for the flomo annotation-digest block. */
		function digestStatusText(view) {
			if (view === null) return "加载中…";
			const destLabel = view.exportDest === "local" ? "本地文件" : view.exportDest === "notion" ? "Notion" : "flomo";
			return (view.flomoEnabled ? "已开启" : "未开启") + " · 目标 " + destLabel + " · 标签 #" + view.flomoTag + " · 最短等待 " + view.flomoMinAgeMinutes + " 分钟" + (view.usePrompt ? " · LLM 整理" : "") + " · flomo 凭据 " + (view.flomoConfigured ? "已配置 " + view.flomoSource + " " + view.flomoMasked : "未配置") + " · 已推送标注 " + view.sentAnnotationCount + " 条";
		}
		/** The Cubox settings panel component. */
		function CuboxSettingsPanel() {
			const [view, setView] = (0, react.useState)(null);
			const [apiLink, setApiLink] = (0, react.useState)("");
			const [server, setServer] = (0, react.useState)("cubox.pro");
			const [syncMinutes, setSyncMinutes] = (0, react.useState)("60");
			const [outputDir, setOutputDir] = (0, react.useState)("");
			const [exportCards, setExportCards] = (0, react.useState)(true);
			const [llmBaseUrl, setLlmBaseUrl] = (0, react.useState)("https://api.deepseek.com/v1");
			const [llmApiKey, setLlmApiKey] = (0, react.useState)("");
			const [llmModel, setLlmModel] = (0, react.useState)("deepseek-chat");
			const [llmPrompt, setLlmPrompt] = (0, react.useState)("");
			const [flomoEnabled, setFlomoEnabled] = (0, react.useState)(false);
			const [exportDest, setExportDest] = (0, react.useState)("flomo");
			const [flomoTag, setFlomoTag] = (0, react.useState)("AI/cubox");
			const [flomoMinAgeMinutes, setFlomoMinAgeMinutes] = (0, react.useState)("60");
			const [usePrompt, setUsePrompt] = (0, react.useState)(false);
			const [exportPrompt, setExportPrompt] = (0, react.useState)("");
			const [flomoWebhookUrl, setFlomoWebhookUrl] = (0, react.useState)("");
			const [flomoApiKey, setFlomoApiKey] = (0, react.useState)("");
			const [notionToken, setNotionToken] = (0, react.useState)("");
			const [notionTargetPageId, setNotionTargetPageId] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const refresh = (0, react.useCallback)(async () => {
				try {
					const next = await api.getStatus();
					setView(next);
					if (next.outputDir !== "") setOutputDir(next.outputDir);
					setExportCards(next.exportCards);
					setLlmBaseUrl(next.llmBaseUrl);
					setLlmModel(next.llmModel);
					setLlmPrompt(next.llmPrompt);
					if (next.llmKeyMasked === "") setLlmApiKey("");
					setFlomoEnabled(next.flomoEnabled);
					setExportDest(next.exportDest);
					setFlomoTag(next.flomoTag);
					setFlomoMinAgeMinutes(String(next.flomoMinAgeMinutes));
					setUsePrompt(next.usePrompt);
					setExportPrompt(next.exportPrompt);
					setNotionTargetPageId(next.notionTargetPageId);
					if (!next.notionConfigured) setNotionToken("");
				} catch (error) {
					setMessage("状态读取失败: " + String(error instanceof Error ? error.message : error));
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			/** Fields shared by save / test, including optional credentials. */
			const configPatch = () => {
				const patch = {
					server,
					syncMinutes: Number(syncMinutes) || 0,
					outputDir: outputDir.trim(),
					exportCards,
					llmBaseUrl: llmBaseUrl.trim(),
					llmModel: llmModel.trim(),
					llmPrompt,
					flomoEnabled,
					exportDest,
					flomoTag: flomoTag.trim(),
					flomoMinAgeMinutes: Number(flomoMinAgeMinutes) || 0,
					usePrompt,
					exportPrompt,
					notionTargetPageId: notionTargetPageId.trim()
				};
				if (apiLink.trim() !== "") patch.apiLink = apiLink.trim();
				if (llmApiKey.trim() !== "") patch.llmApiKey = llmApiKey.trim();
				if (flomoWebhookUrl.trim() !== "") patch.flomoWebhookUrl = flomoWebhookUrl.trim();
				if (flomoApiKey.trim() !== "") patch.flomoApiKey = flomoApiKey.trim();
				if (notionToken.trim() !== "") patch.notionToken = notionToken.trim();
				return patch;
			};
			const saveConfig = async () => {
				setBusy(true);
				setMessage("");
				try {
					const next = await api.setConfig(configPatch());
					setView({
						...next,
						cachedCards: view?.cachedCards ?? 0,
						cachedAnnotations: view?.cachedAnnotations ?? 0,
						cacheUpdatedAt: view?.cacheUpdatedAt ?? "",
						flomoConfigured: view?.flomoConfigured ?? false,
						flomoSource: view?.flomoSource ?? "",
						flomoMasked: view?.flomoMasked ?? "",
						flomoConfigPath: view?.flomoConfigPath ?? "",
						sentAnnotationCount: view?.sentAnnotationCount ?? 0
					});
					setMessage(next.configured ? "配置已保存。" : "配置未保存完整：缺少 token。");
					setApiLink("");
					if (next.llmKeyMasked !== "") setLlmApiKey("");
					if (next.notionConfigured) setNotionToken("");
					setFlomoWebhookUrl("");
					setFlomoApiKey("");
					await refresh();
				} catch (error) {
					setMessage("保存失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			const clearConfig = async () => {
				setBusy(true);
				setMessage("");
				try {
					const next = await api.setConfig({ reset: true });
					setView({
						...next,
						cachedCards: 0,
						cachedAnnotations: 0,
						cacheUpdatedAt: "",
						flomoConfigured: false,
						flomoSource: "",
						flomoMasked: "",
						flomoConfigPath: "",
						sentAnnotationCount: 0
					});
					setOutputDir("");
					setLlmApiKey("");
					setNotionToken("");
					setMessage("已清除配置。");
				} catch (error) {
					setMessage("清除失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			const runSync = async (days) => {
				setBusy(true);
				setMessage("同步中…");
				try {
					const result = await api.sync(days);
					setMessage(result.ok ? result.message : "同步失败: " + result.message);
					await refresh();
				} catch (error) {
					setMessage("同步失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			/** Push the annotation digest to flomo now (respects the dedup ledger). */
			const pushFlomoNow = async () => {
				setBusy(true);
				setMessage("推送标注中…");
				try {
					const result = await api.pushFlomo();
					setMessage(result.message);
					await refresh();
				} catch (error) {
					setMessage("推送失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			/** Save the current flomo fields (if filled), then send a test memo. */
			const testFlomoConfig = async () => {
				setBusy(true);
				setMessage("测试中…（会向 flomo 发送一条测试 MEMO）");
				try {
					if (flomoWebhookUrl.trim() !== "" || flomoApiKey.trim() !== "") await api.setConfig(configPatch());
					const result = await api.testFlomo();
					setMessage(result.message);
					setFlomoWebhookUrl("");
					setFlomoApiKey("");
					await refresh();
				} catch (error) {
					setMessage("测试失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			/** Save the Notion fields (if filled), then verify the token + page. */
			const testNotionConfig = async () => {
				setBusy(true);
				setMessage("测试中…");
				try {
					if (notionToken.trim() !== "" || notionTargetPageId.trim() !== "") await api.setConfig(configPatch());
					const result = await api.testNotion();
					setMessage(result.message);
					if (result.ok) setNotionToken("");
					await refresh();
				} catch (error) {
					setMessage("测试失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			/** Open the host OS folder chooser and apply the picked path. */
			const pickFolder = async () => {
				setBusy(true);
				setMessage("");
				try {
					const result = await api.pickDir();
					if (result.ok && result.path !== void 0) {
						setOutputDir(result.path);
						setMessage("已选择文件夹：" + result.path + "（保存配置后生效）");
					} else if (result.cancelled === true) setMessage("已取消选择。");
					else setMessage(result.message ?? "无法弹出文件夹选择（当前环境不支持），请手动输入路径。");
				} catch (error) {
					setMessage("选择文件夹失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: s.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: s.title,
						children: "Cubox 收藏同步"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.status,
						children: statusText(view)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							placeholder: "API 扩展链接（https://cubox.pro/c/api/save/xxxx）",
							value: apiLink,
							onChange: (e) => setApiLink(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								style: s.select,
								value: server,
								onChange: (e) => setServer(e.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "cubox.pro",
									children: "cubox.pro（国内）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "cubox.cc",
									children: "cubox.cc（国际版）"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: {
									...s.input,
									width: "120px"
								},
								placeholder: "同步间隔(分钟)",
								value: syncMinutes,
								onChange: (e) => setSyncMinutes(e.target.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: s.flex }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: () => void saveConfig(),
								disabled: busy,
								children: "保存配置"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: () => void clearConfig(),
								disabled: busy,
								children: "清除"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							placeholder: "本地导出目录（同步时写入 Markdown，留空=不导出）",
							value: outputDir,
							onChange: (e) => setOutputDir(e.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: () => void pickFolder(),
							disabled: busy,
							children: "选择文件夹…"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.checkRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							id: "cubox-export-cards",
							checked: exportCards,
							onChange: (e) => setExportCards(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "cubox-export-cards",
							children: "每张收藏导出一个 md 文件（关闭后只生成 AI 简报）"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						style: s.section,
						children: "AI 简报（按提示词生成今日收藏简报）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							placeholder: "LLM Base URL（OpenAI 兼容）",
							value: llmBaseUrl,
							onChange: (e) => setLlmBaseUrl(e.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: {
								...s.input,
								width: "150px"
							},
							placeholder: "模型",
							value: llmModel,
							onChange: (e) => setLlmModel(e.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							placeholder: "LLM API Key" + (view !== null && view.llmKeyMasked !== "" ? "（已保存 " + view.llmKeyMasked + "，留空保持不变）" : ""),
							type: "password",
							value: llmApiKey,
							onChange: (e) => setLlmApiKey(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						style: s.textarea,
						placeholder: "提示词模板：{collection} 会被替换为今日收藏列表",
						value: llmPrompt,
						onChange: (e) => setLlmPrompt(e.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						style: s.section,
						children: "flomo 标注同步（新增/变更标注 → 每日 digest）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: view !== null && !view.flomoConfigured && flomoEnabled ? s.statusWarn : s.status,
						children: digestStatusText(view)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.checkRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							id: "cubox-flomo-enabled",
							checked: flomoEnabled,
							onChange: (e) => setFlomoEnabled(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "cubox-flomo-enabled",
							children: "同步后自动推送新增/变更标注（本地去重账本，不重复推送）"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								style: s.select,
								value: exportDest,
								onChange: (e) => setExportDest(e.target.value),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "flomo",
										children: "flomo"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "local",
										children: "本地 Markdown"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "notion",
										children: "Notion"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: {
									...s.input,
									width: "150px"
								},
								placeholder: "flomo 标签",
								value: flomoTag,
								onChange: (e) => setFlomoTag(e.target.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: {
									...s.input,
									width: "120px"
								},
								placeholder: "最短等待(分钟)",
								value: flomoMinAgeMinutes,
								onChange: (e) => setFlomoMinAgeMinutes(e.target.value)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.checkRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							id: "cubox-use-prompt",
							checked: usePrompt,
							onChange: (e) => setUsePrompt(e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "cubox-use-prompt",
							children: "推送前用 LLM 按提示词整理 digest"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						style: s.textarea,
						placeholder: "digest 整理提示词：{digest} 会被替换为原始标注列表",
						value: exportPrompt,
						onChange: (e) => setExportPrompt(e.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							type: "password",
							placeholder: view !== null && view.flomoConfigured ? "flomo API URL（已配置 " + view.flomoSource + " " + view.flomoMasked + "，留空保持不变）" : "flomo API URL（https://flomoapp.com/iwh/xxxx）",
							value: flomoWebhookUrl,
							onChange: (e) => setFlomoWebhookUrl(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							type: "password",
							placeholder: "或 flomo API Key（新版，与 URL 二选一）",
							value: flomoApiKey,
							onChange: (e) => setFlomoApiKey(e.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: () => void testFlomoConfig(),
							disabled: busy,
							children: "测试 flomo"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							type: "password",
							placeholder: view !== null && view.notionConfigured ? "Notion Token（已保存，留空保持不变）" : "Notion Integration Token（目标=Notion 时填）",
							value: notionToken,
							onChange: (e) => setNotionToken(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: s.input,
							placeholder: "Notion 目标父页面 URL 或 ID",
							value: notionTargetPageId,
							onChange: (e) => setNotionTargetPageId(e.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: () => void testNotionConfig(),
							disabled: busy,
							children: "测试 Notion"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: () => void runSync(1),
								disabled: busy,
								children: "同步今天"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: () => void runSync(7),
								disabled: busy,
								children: "同步最近 7 天"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: () => void pushFlomoNow(),
								disabled: busy,
								children: "推送标注到 flomo"
							})
						]
					}),
					message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.msg,
						children: message
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							"API 扩展链接获取：Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接。链接是个人身份凭证，请勿泄露。 token 与同步快照分别存于 ~/.dsh/dsh-cubox.json 与 ~/.dsh/dsh-cubox-cache.json（权限 0600）；flomo 凭据与「Flomo」面板共享（~/.dsh/dsh-flomo.json，0600）。 配置导出目录后，每次同步会按上方设置写入：勾选卡片时每张收藏一个 md；配置了 AI Key 时按提示词生成「今日收藏简报-日期.md」（",
							"{collection}",
							" 替换为今日收藏列表，未包含则自动追加）。 标注 digest：只推创建满「最短等待」分钟的新增/变更标注，正文自动去 #（flomo 会把 #词 当标签），只保留配置标签，超长自动拆条；flomo 是追加式镜像，Cubox 里改动/删除标注不会回写 flomo。去重账本 ~/.dsh/.cubox-flomo-annotations-sent 记录已推送标注，删除后可能重复推送。"
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots"];
		/**
		* Register the Cubox settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "cubox",
					order: 315,
					label: () => "Cubox"
				}, CuboxSettingsPanel));
			} catch (error) {
				console.warn("[dsh-cubox] settings panel registration failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map