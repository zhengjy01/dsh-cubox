# dsh-cubox

> **English** | [**中文**](README.zh.md)

Cubox sync for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): scheduled sync of your Cubox collection, with an **AI daily brief** generated from your own prompt template and written straight into Obsidian — via the same `/c/api/cli` endpoints the official cubox-cli uses. Agent tools plus a web settings panel.

## Features

- **Scheduled sync** — a timer pulls your latest bookmarks into a local cache (`~/.dsh/dsh-cubox-cache.json`) every N minutes (default 60, configurable; 0 disables the timer). Manual sync anytime with `cubox_sync`.
- **AI daily brief** — write your own prompt template (e.g. "今日收藏简报", `{collection}` is replaced with the formatted collection for the sync window: title / source / summary / annotations). When an LLM key is configured, every sync generates a brief into the output dir — `今日收藏简报-YYYY-MM-DD.md` for a 1-day sync, `最近N日收藏简报-YYYY-MM-DD.md` for wider windows (each window gets its own file).
- **Markdown export** — set `outputDir` and optionally keep one markdown file per card (frontmatter + title + description + Cubox/original links + annotations, same layout as the official Cubox Obsidian plugin). Toggle `exportCards` off to write only the AI brief.
- **Query** — `cubox_cards` filters by keyword, time window, annotated/starred/read status.
- **flomo annotation sync** — after each sync, newly created / changed annotations (highlights + thoughts) are pushed to [flomo](https://flomoapp.com) as a daily digest (card title + link + annotations). It reuses the `~/.dsh/dsh-flomo.json` credentials (no new secret), keeps a **local dedup ledger** (`~/.dsh/.cubox-flomo-annotations-sent`) so nothing is pushed twice, only pushes annotations older than N minutes (default 60) to avoid half-typed notes, replaces every ASCII `#` in the body with the full-width `＃` (`#123` still reads as `＃123`; flomo only turns an ASCII `#word` into a tag) and appends only the configured tag, auto-splits long digests across memos, and can target `flomo` / local markdown / Notion with an optional LLM rewrite (`{digest}` prompt).
- **Config & status** — `cubox_config` / `cubox_status` / `cubox_flomo`; credentials persist to `~/.dsh/dsh-cubox.json` (mode 0600), secrets never echoed.
- **Settings panel** — Settings → Cubox: paste the API-extension link, set the sync interval, pick the local export folder (OS folder chooser), toggle per-card export, edit the AI brief prompt and LLM settings (OpenAI-compatible, defaults to DeepSeek), and configure / manually push the flomo annotation digest.

## Install

```sh
# after publishing to GitHub (repo tagged with the `dsh-plugin` topic)
dsh plugin --profile web add github:zhengjy01/dsh-cubox

# local development
dsh plugin --profile web add link:/path/to/dsh-cubox
```

Restart `dsh web`. The plugin ships pre-built — `lib/index.js` is plain ESM.

Current release: **v0.2.0** ([Releases](https://github.com/zhengjy01/dsh-cubox/releases) · [npm](https://www.npmjs.com/package/dsh-cubox)).

## Configure

1. Open Cubox preferences → Extensions & Automation → API Extension → enable it and copy your unique link (e.g. `https://cubox.pro/c/api/save/abcd12345`).
2. Give the link to the plugin — either in the settings panel (Settings → Cubox), or just ask the agent:

   ```text
   帮我配置 Cubox，API 链接是 https://cubox.pro/c/api/save/abcd12345
   ```

   The agent calls `cubox_config` to persist it. `cubox.pro` is the default server; `cubox.cc` is the international instance (auto-detected from the link).
3. (Optional) Set the export dir + AI brief: choose the local folder, paste an OpenAI-compatible API key (DeepSeek by default), and edit the prompt template. `{collection}` is replaced with today's collection list.

Then:

```text
同步一下今天的收藏                → cubox_sync (days=1)
查一下收藏里关于 LLM 的文章       → cubox_cards (keyword="LLM")
```

> The API link and the LLM key are credentials — anyone holding them can read (and modify) your Cubox data or spend your LLM quota. They are stored in `~/.dsh/dsh-cubox.json` (mode 0600). To rotate, refresh in the Cubox API-extension page, then re-configure.

## Tools

| Tool | Purpose |
| --- | --- |
| `cubox_status` | Connection & cache status |
| `cubox_config` | Set / clear `apiLink`, `server`, `token`, `syncMinutes`, `outputDir`, `exportCards`, `llm*`, plus the digest options `flomoEnabled` / `exportDest` / `flomoTag` / `flomoMinAgeMinutes` / `usePrompt` / `exportPrompt` / `notion*` |
| `cubox_sync` | Pull the last N days (default today) into the local cache + export markdown + AI brief + digest push |
| `cubox_cards` | Query the collection (keyword / days / annotated / starred / read) |
| `cubox_flomo` | Push new / changed annotations to flomo now (`days` window / `force` bypass min age / `tag` override) |

## Notes

- The public Cubox "open API" only accepts saves; reads go through the internal `/c/api/cli/*` family (same endpoints as the official [cubox-cli](https://github.com/OLCUBO/cubox-cli)).
- The sync cache is a plain JSON snapshot (cards + today's annotations, deduped by id, newest first) — agents can answer "what did I save" without extra round trips.
- License: MIT
