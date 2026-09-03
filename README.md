# dsh-github-mcp

> 把 GitHub MCP 整体封装成 DSH 插件：接入 GitHub 官方远程 MCP Server，token 存到 DSH 凭据中心（`.credentials.yaml`），可通过模型工具输入，让 `mcp__github__*` 工具可用。

## 功能

- **接入 GitHub MCP**：通过 `@deepseek-ai/dsh-mcp-client` 连接 `https://api.githubcopilot.com/mcp/`，GitHub 工具以 `mcp__github__*` 形式出现（`search_repositories`、`list_pull_requests`、`create_pull_request`、`push_files` 等）。
- **token 存到凭据中心**：token 存在 DSH 的 `.credentials.yaml`（`refs.GITHUB_TOKEN`）。
- **模型工具**：
  - `github_token_status`：查看 token 是否已配置。
  - `github_set_token`：输入/更新 token（写入凭据中心）。
- **自动捆绑安装面板插件 `dsh-github-mcp-hint`**（设置页 UI `设置 → 插件 → GitHub MCP`）。

## 面板插件可独立卸载

安装本插件时会**一并安装** `dsh-github-mcp-hint`（以依赖形式）。**面板插件可随时卸载/禁用，不影响 GitHub MCP 功能**：

1. 从 profile 的 `dsh.profile.bundles` 中移除 `dsh-github-mcp-hint`。
2. 卸载该包：`dsh plugin --profile <profile> remove dsh-github-mcp-hint`。

卸载面板后，GitHub MCP 工具照常可用（`github_token_status` / `github_set_token` 及所有 `mcp__github__*` 不受影响）。若只想临时关掉面板，也可在 `cordis.patch.yml` 里给 `dsh-github-mcp-hint` 设 `disabled: true`。

## 安装

```sh
dsh plugin --profile <profile> add github:ZIye1208/dsh-github-mcp
```

会自动带上依赖的面板插件 `dsh-github-mcp-hint`。

## 使用 token

1. 在对话里说「帮我设置 GitHub token 为 ghp_xxx」，agent 调用 `github_set_token` 写入凭据中心。
2. 或直接编辑 `~/.dsh/.credentials.yaml`，在 `refs:` 下加一行：
   ```yaml
   refs:
     GITHUB_TOKEN: ghp_xxxxxxxx
   ```
3. **重启 DSH**：mcp-client 在启动时读取 token，`mcp__github__*` 工具出现。

> 注意：若你在启动环境里已设 `GITHUB_TOKEN`（环境优先），`github_set_token` 写入凭据中心会被拒绝。请先在启动 shell 中 `unset GITHUB_TOKEN`，再用工具保存到凭据中心。token 修改需 **重启 DSH** 才生效（mcp-client 启动时读取）。

## 与面板插件的关系

- `dsh-github-mcp` = GitHub MCP 连接 + token 凭据中心。
- `dsh-github-mcp-hint` = 面板 UI（独立仓库）。两者独立，可分别卸载。

## 许可

[MIT](./LICENSE)
