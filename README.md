# dsh-github-mcp

> 把 GitHub MCP 整体封装成一个 DSH 插件：接入 GitHub 官方远程 MCP Server，token 存到 DSH 凭据中心（`.credentials.yaml`），可通过模型工具输入；GitHub 工具以 `mcp__github__*` 形式可用。自动捆绑安装面板插件 `dsh-github-mcp-hint`（可独立卸载）。

---

## 📚 功能

- **GitHub MCP 连接**：通过 `@deepseek-ai/dsh-mcp-client` 连接 `https://api.githubcopilot.com/mcp/`，GitHub 工具以 `mcp__github__*` 名称出现（`search_repositories`、`list_pull_requests`、`create_pull_request`、`push_files`、`get_file_contents`、`merge_pull_request`、`add_issue_comment` …共 40+ 个）。
- **token 存到凭据中心**：GitHub PAT 存在 DSH 的 `.credentials.yaml`（`refs.GITHUB_TOKEN`），不写入源码、不进日志。
- **模型工具**：
  - `github_token_status` — 查看 token 是否已配置、来源、是否可写。
  - `github_set_token` — 输入/更新 token（写入凭据中心并刷新当前环境）。
- **自动捆绑面板插件 `dsh-github-mcp-hint`**：设置 → 插件 → GitHub MCP 的示例 + 公开仓库统计 UI。

---

## 🚀 快速开始

```sh
# 1. 安装（会一并装上依赖的面板插件 dsh-github-mcp-hint）
dsh plugin --profile web add dsh-github-mcp      # 若已发布到 npm
# —— 或 ——
dsh plugin --profile web add github:ZIye1208/dsh-github-mcp   # 从 GitHub 安装

# 2. 设置 token（对话里说即可）
#    “帮我把 GitHub token 设为 ghp_xxx”

# 3. 重启 DSH，然后问
#    “我的 GitHub token 配好了吗”  （github_token_status）
#    “看看我的仓库有多少星多少下载”（走 mcp__github__* / 面板）
```

---

## ⚙️ 安装

### 方式一：npm（推荐，发布后可用）

```sh
dsh plugin --profile web add dsh-github-mcp
```

会自动携带依赖 `dsh-github-mcp-hint`。

> **关于 npm 发布**：本包已按可发布到 npm 配置（`publishConfig.access: public`、`files` 白名单、`main`/`exports` 正确）。要在 npm 上安装，需先把包发布到 npm registry：在具备 npm 账号（`npm login` / 配好 token）后执行 `npm publish`。当前只发布了 GitHub 版。

### 方式二：GitHub

```sh
dsh plugin --profile web add github:ZIye1208/dsh-github-mcp
```

### 方式三：本地开发

```sh
# 在 profile 的 package.json 用 link 指向本地路径，并加入 dsh.profile.bundles，然后重启 DSH
```

---

## 🔑 前置条件

1. **DSH** 版本 >= 0.1.x（本插件依赖 `@deepseek-ai/dsh-mcp-client`，属 DSH 核心）。
2. **GitHub PAT**：在 GitHub → Settings → Developer settings → Personal access tokens 生成，需作用域 `repo`、`read:org`、`read:packages`（用于 MCP 读写仓库/PR/issue）。

---

## 🔐 设置 token（三选一）

### 方式 A：模型工具（推荐）

在对话里说：

> 帮我把 GitHub token 设为 ghp_xxxxxxxx

agent 调用 `github_set_token`，写入 `~/.dsh/.credentials.yaml` 的 `refs.GITHUB_TOKEN`，并更新当前环境变量。

### 方式 B：直接编辑凭据中心

编辑 `~/.dsh/.credentials.yaml`，在 `refs:` 下加一行：

```yaml
version: 1
refs:
  GITHUB_TOKEN: ghp_xxxxxxxx
# records:
#   ...
```

保存后，下一次 DSH 启动时插件会自动把它桥上到 `process.env.GITHUB_TOKEN`。

### 方式 C：环境变量（传统）

在启动 shell 设 `GITHUB_TOKEN=ghp_xxx` 后启动 DSH。**注意**：一旦环境里已有 `GITHUB_TOKEN`，它优先且只读，`github_set_token` 写入凭据中心会被拒绝——需先 `unset GITHUB_TOKEN` 再用方式 A/B。

> ⚠️ **修改 token 后需重启 DSH 才生效**：`mcp-client` 在启动时读取 token（静态 header），运行中不会重连。

---

## 🧭 使用

- **看 token 状态**：问「我的 GitHub token 配好了吗」→ `github_token_status`。
- **列 PR / 建 PR / 推代码 / 改文件 / 搜代码**：直接用自然语言，模型会调 `mcp__github__*`。示例：
  - “查看仓库 owner/repo 里所有 open 状态的 Pull Request，按更新时间倒序”
  - “在当前分支提交所有改动并推送到 GitHub，提交消息按变更自动生成”
  - “给 owner/repo 的 PR #123 添加一条评论说明测试已通过，并标记 ready for review”
  - “在 owner/repo 里搜索关键词 xxx 的代码文件”
- **面板 UI**：设置 → 插件 → GitHub MCP（由 `dsh-github-mcp-hint` 提供，随机 4/30 条示例、公开仓库统计）。

---

## 🗑️ 卸载 / 禁用

### 卸载整个插件（含面板）

```sh
dsh plugin --profile web remove dsh-github-mcp
```

### 只卸载面板插件（不影响 GitHub MCP）

`dsh-github-mcp` 自动捆绑安装了面板插件 `dsh-github-mcp-hint`（作为依赖）。**可独立卸载**：

1. 从 profile 的 `dsh.profile.bundles` 移除 `dsh-github-mcp-hint`；
2. 卸载该包：`dsh plugin --profile web remove dsh-github-mcp-hint`。

卸载面板后，`github_token_status` / `github_set_token` 及所有 `mcp__github__*` 仍可用。

### 只禁用面板（不卸载）

在 profile 的 `cordis.patch.yml` 给面板行加：

```yaml
- id: dsh-github-mcp-hint
  disabled: true
```

---

## 🧩 架构（为什么这么设计）

```
用户输入 token ──(github_set_token)──► DS H 凭据中心 .credentials.yaml (refs.GITHUB_TOKEN)
                                        │
                                        ▼  启动时插件桥接
                                  process.env.GITHUB_TOKEN
                                        │
                                        ▼  mcp-client 启动读取
                          Authorization: Bearer <token> ──► https://api.githubcopilot.com/mcp/
                                        │
                                        ▼
                           注册 mcp__github__* 工具（模型可调）
```

- `dsh-github-mcp` = GitHub MCP 连接 + token 凭据中心。
- `dsh-github-mcp-hint` = 面板 UI（独立仓库，可卸载）。
- **为什么 token 在凭据中心而不是环境**：DSH 官方凭据存储（`.credentials.yaml`）不会自动注入 `process.env`，所以插件在启动时做一次「凭据中心 → 环境变量」的桥接，让 `mcp-client` 能读到。

---

## ❓ 常见问题

- **`mcp__github__*` 没出现**：多半是 token 未配置或未重启。先 `github_token_status`，再重启 DSH。
- **`github_set_token` 被拒**：启动环境里已有 `GITHUB_TOKEN`（只读）。先 `unset GITHUB_TOKEN`，再用工具保存到凭据中心。
- **`serverName "github" already in use`**：你在 profile 里手动加过 `mcp-github` 行。删掉那行，交给本插件的 `cordis.patch.yml`（含 `mcp-github` 行）管理。
- **token 改了不生效**：重启 DSH（mcp-client 启动时读一次）。

---

## 📄 仓库关系

| 仓库 | 作用 |
|---|---|
| `ZIye1208/dsh-github-mcp` | GitHub MCP 连接 + token 凭据中心（本插件）|
| `ZIye1208/dsh-github-mcp-hint` | 面板 UI（独立、可卸载）|

## 许可

[MIT](./LICENSE)