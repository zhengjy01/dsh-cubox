# dsh-cubox

> [**English**](README.md) | **中文**

DeepSeek Harness 的 [Cubox](https://cubox.pro)（收藏阅读工具）同步插件：**定时同步**最新收藏、**今日内容总结大纲**、**收录笔记标注汇总**——基于官方 cubox-cli 同一套内部 API（`/c/api/cli/*`）。agent 工具 + Web 设置面板双入口。

## 功能

- **定时同步** — 定时器每隔 N 分钟（默认 60，可配置，0=关闭）自动拉取最新收藏并写入本地缓存（`~/.dsh/dsh-cubox-cache.json`）；也可随时 `cubox_sync` 手动同步。
- **今日总结大纲** — `cubox_today` 把今日收藏渲染成 Markdown 大纲：收藏统计、来源分布，以及每条收藏的标题 / 来源 / 链接 / 描述 / 标签 / 标注摘要。
- **笔记标注汇总** — `cubox_annotations` 跨收藏汇总高亮与笔记（最近 N 天、关键词过滤），按来源收藏分组，含高亮文本、笔记、颜色、时间。
- **查询** — `cubox_cards` 按关键词、时间窗口、是否已标注 / 星标 / 已读过滤。
- **配置与状态** — `cubox_config` / `cubox_status`；凭据持久化到 `~/.dsh/dsh-cubox.json`（权限 0600），不回显密钥。
- **设置面板** — 设置 → Cubox：粘贴 API 扩展链接、设置同步间隔、一键手动同步。

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

之后即可：

```text
同步一下今天的收藏                → cubox_sync (days=1)
今天收藏了什么？给我一个总结大纲  → cubox_today
把这两天的标注和笔记汇总给我      → cubox_annotations (days=2)
查一下收藏里关于 LLM 的文章       → cubox_cards (keyword="LLM")
```

> API 链接是你个人身份的唯一凭证：持有者可以读取（及修改）你的 Cubox 数据。它存放在 `~/.dsh/dsh-cubox.json`（权限 0600）。如需轮换，在 Cubox API 扩展页面点击刷新后重新配置。

## 工具一览

| 工具 | 用途 |
| --- | --- |
| `cubox_status` | 连接与缓存状态 |
| `cubox_config` | 设置 / 清除 `apiLink`、`server`、`token`、`syncMinutes` |
| `cubox_sync` | 拉取最近 N 天（默认今天）到本地缓存 |
| `cubox_today` | 今日收藏总结大纲（Markdown） |
| `cubox_annotations` | 汇总高亮与笔记，按收藏分组 |
| `cubox_cards` | 查询收藏（关键词 / 天数 / 已标注 / 星标 / 已读） |

## 说明

- Cubox 官方「开放 API」只支持收藏写入；读取走内部 `/c/api/cli/*` 端点（与官方 [cubox-cli](https://github.com/OLCUBO/cubox-cli) 相同）。
- 同步缓存为纯 JSON 快照（卡片 + 今日标注，按 id 去重、最新在前），agent 无需额外请求即可回答「我今天收藏了什么」。
- License: MIT
