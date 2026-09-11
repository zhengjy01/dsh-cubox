# dsh-cubox

> [**English**](README.md) | **中文**

DeepSeek Harness 的 [Cubox](https://cubox.pro)（收藏阅读工具）同步插件：**定时同步**最新收藏，并按你自己的 **prompt 提示词**用 LLM 生成「今日收藏简报」直接写入 Obsidian——基于官方 cubox-cli 同一套内部 API（`/c/api/cli/*`）。agent 工具 + Web 设置面板双入口。

## 功能

- **定时同步** — 定时器每隔 N 分钟（默认 60，可配置，0=关闭）自动拉取最新收藏并写入本地缓存（`~/.dsh/dsh-cubox-cache.json`）；也可随时 `cubox_sync` 手动同步。
- **AI 每日简报** — 填写你自己的 prompt 模板（如「今日收藏简报」，`{collection}` 会被替换为**同步窗口内**的收藏列表：标题 / 来源 / 摘要 / 标注）。配置 LLM key 后，每次同步按窗口生成简报到导出目录：1 天 → `今日收藏简报-YYYY-MM-DD.md`；多天（如 7 天）→ `最近N日收藏简报-YYYY-MM-DD.md`，**每个窗口独立文件，不互相覆盖**。
- **Markdown 导出** — 配置 `outputDir` 后，可勾选「每张收藏一个 md 文件」（frontmatter + 标题 + 描述 + Cubox/原文链接 + 标注，与官方 Cubox Obsidian 插件同款格式）；**取消勾选则只写 AI 简报**，Obsidian 顶部不会堆卡片。
- **查询** — `cubox_cards` 按关键词、时间窗口、是否已标注 / 星标 / 已读过滤。
- **flomo 标注同步** — 同步后把**新增 / 变更的标注**（划线 + 想法）以每日 digest（卡片标题 + 链接 + 标注）推送到 [flomo](https://flomoapp.com)。要点：复用 `~/.dsh/dsh-flomo.json` 凭据（与「Flomo」面板共享，不新增密钥）；**本地去重账本**（`~/.dsh/.cubox-flomo-annotations-sent`）保证同一标注不重复推送；只推创建满 N 分钟（默认 60）的标注，避免半截内容；正文自动去除 `#`（flomo 会把 `#词` 抓成标签），只保留配置标签；超长自动拆成多条 MEMO；目标可选 `flomo` / 本地 Markdown / Notion，可用 LLM 按 `{digest}` prompt 先整理。
- **配置与状态** — `cubox_config` / `cubox_status` / `cubox_flomo`；凭据持久化到 `~/.dsh/dsh-cubox.json`（权限 0600），不回显密钥。
- **设置面板** — 设置 → Cubox：粘贴 API 扩展链接、设置同步间隔、选择本地导出文件夹（系统目录选择器）、开关卡片导出、**编辑 AI 简报 prompt 与 LLM 配置**（OpenAI 兼容，默认 DeepSeek）、**配置 flomo 标注同步并手动推送**。

## 安装

```sh
# 发布到 GitHub 后（仓库打上 `dsh-plugin` topic）
dsh plugin --profile web add github:zhengjy01/dsh-cubox

# 本地开发
dsh plugin --profile web add link:/path/to/dsh-cubox
```

重启 `dsh web`。插件无需构建步骤——`lib/index.js` 是纯 ESM。

## 配置

1. 打开 Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制你的专属链接（形如 `https://cubox.pro/c/api/save/abcd12345`）。
2. 把链接交给插件，可在设置面板（设置 → Cubox）粘贴，或直接让 agent 配置：

   ```text
   帮我配置 Cubox，API 链接是 https://cubox.pro/c/api/save/abcd12345
   ```

   agent 会调用 `cubox_config` 持久化。默认服务器 `cubox.pro`（国内）；国际版 `cubox.cc`（链接自动识别）。
3. （可选）配置导出目录与 AI 简报：选择本地文件夹、粘贴 OpenAI 兼容的 API Key（默认 DeepSeek）、编辑 prompt 模板。`{collection}` 会被替换为今日收藏列表。

之后即可：

```text
同步一下今天的收藏                → cubox_sync (days=1)
查一下收藏里关于 LLM 的文章       → cubox_cards (keyword="LLM")
```

> API 链接与 LLM key 都是凭据：持有者可以读取（及修改）你的 Cubox 数据、消耗你的 LLM 额度。它们存放在 `~/.dsh/dsh-cubox.json`（权限 0600）。如需轮换，在 Cubox API 扩展页面点击刷新后重新配置。

## 工具一览

| 工具 | 用途 |
| --- | --- |
| `cubox_status` | 连接与缓存状态 |
| `cubox_config` | 设置 / 清除 `apiLink`、`server`、`token`、`syncMinutes`、`outputDir`、`exportCards`、`llm*`，以及标注 digest 的 `flomoEnabled` / `exportDest` / `flomoTag` / `flomoMinAgeMinutes` / `usePrompt` / `exportPrompt` / `notion*` |
| `cubox_sync` | 拉取最近 N 天（默认今天）到本地缓存 + 导出 Markdown + AI 简报 + 标注 digest 推送 |
| `cubox_cards` | 查询收藏（关键词 / 天数 / 已标注 / 星标 / 已读） |
| `cubox_flomo` | 把新增 / 变更标注立即推送到 flomo（`days` 窗口 / `force` 忽略最短等待 / `tag` 覆盖标签） |

## 说明

- Cubox 官方「开放 API」只支持收藏写入；读取走内部 `/c/api/cli/*` 端点（与官方 [cubox-cli](https://github.com/OLCUBO/cubox-cli) 相同）。
- 同步缓存为纯 JSON 快照（卡片 + 今日标注，按 id 去重、最新在前），agent 无需额外请求即可回答「我今天收藏了什么」。
- License: MIT
