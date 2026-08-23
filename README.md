# dsh-cubox

> **English** | [**中文**](README.zh.md)

Cubox sync for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): scheduled sync of your Cubox collection, a daily outline of what you saved, and aggregated annotations/notes — via the same `/c/api/cli` endpoints the official cubox-cli uses. Agent tools plus a web settings panel.

## Features

- **Scheduled sync** — a timer pulls your latest bookmarks into a local cache (`~/.dsh/dsh-cubox-cache.json`) every N minutes (default 60, configurable; 0 disables the timer). Manual sync anytime with `cubox_sync`.
- **Markdown export** — set `outputDir` (via `cubox_config` or the settings panel) and every sync writes today's collection to that folder: one markdown file per card (frontmatter + title + description + Cubox/original links + annotations, same layout as the official Cubox Obsidian plugin) plus a daily outline file.
- **Today's outline** — `cubox_today` renders a markdown outline of today's collection: overview stats, source distribution, then per-card title / source / link / description / tags / annotation snippets.
- **Annotations & notes** — `cubox_annotations` aggregates highlights and notes across your collection (last N days, keyword filter), grouped by source card with highlight text, note, color, and time.
- **Query** — `cubox_cards` filters by keyword, time window, annotated/starred/read status.
- **Config & status** — `cubox_config` / `cubox_status`; credentials persist to `~/.dsh/dsh-cubox.json` (mode 0600), secrets never echoed.
- **Settings panel** — Settings → Cubox: paste the API-extension link, set the sync interval, pick the local export folder (OS folder chooser), trigger manual syncs.

## Install

```sh
# after publishing to GitHub (repo tagged with the `dsh-plugin` topic)
dsh plugin --profile web add github:zhengjy01/dsh-cubox

# local development
dsh plugin --profile web add link:/path/to/dsh-cubox
```

Restart `dsh web`. The plugin ships pre-built — `lib/index.js` is plain ESM.

## Configure

1. Open Cubox preferences → Extensions & Automation → API Extension → enable it and copy your unique link (e.g. `https://cubox.pro/c/api/save/abcd12345`).
2. Give the link to the plugin — either in the settings panel (Settings → Cubox), or just ask the agent:

   ```text
   帮我配置 Cubox，API 链接是 https://cubox.pro/c/api/save/abcd12345
   ```

   The agent calls `cubox_config` to persist it. `cubox.pro` is the default server; `cubox.cc` is the international instance (auto-detected from the link).

Then:

```text
同步一下今天的收藏                → cubox_sync (days=1)
今天收藏了什么？给我一个总结大纲  → cubox_today
把这两天的标注和笔记汇总给我      → cubox_annotations (days=2)
查一下收藏里关于 LLM 的文章       → cubox_cards (keyword="LLM")
```

> The API link is your personal identity credential — anyone holding it can read (and modify) your Cubox data. It is stored in `~/.dsh/dsh-cubox.json` (mode 0600). To rotate, click refresh in the Cubox API-extension page, then re-configure.

## Tools

| Tool | Purpose |
| --- | --- |
| `cubox_status` | Connection & cache status |
| `cubox_config` | Set / clear `apiLink`, `server`, `token`, `syncMinutes` |
| `cubox_sync` | Pull the last N days (default today) into the local cache |
| `cubox_today` | Today's collection outline (markdown) |
| `cubox_annotations` | Aggregate highlights/notes, grouped by card |
| `cubox_cards` | Query the collection (keyword / days / annotated / starred / read) |

## Notes

- The public Cubox "open API" only accepts saves; reads go through the internal `/c/api/cli/*` family (same endpoints as the official [cubox-cli](https://github.com/OLCUBO/cubox-cli)).
- The sync cache is a plain JSON snapshot (cards + today's annotations, deduped by id, newest first) — agents can answer "what did I save" without extra round trips.
- License: MIT
