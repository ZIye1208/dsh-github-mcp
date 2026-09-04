# dsh-github-mcp

> Wraps GitHub MCP as a DSH plugin: connects to GitHub's official remote MCP Server, stores the token in the DSH credential center (`.credentials.yaml`), lets the token be set through model tools, and exposes the `mcp__github__*` tools. Automatically bundles the panel plugin `dsh-github-mcp-hint` (separately uninstallable).

---

## 📚 Features

- **GitHub MCP connection**: via `@deepseek-ai/dsh-mcp-client` to `https://api.githubcopilot.com/mcp/`; GitHub tools appear as `mcp__github__*` (`search_repositories`, `list_pull_requests`, `create_pull_request`, `push_files`, `get_file_contents`, `merge_pull_request`, `add_issue_comment`, … 40+ tools).
- **Token in the credential center**: the GitHub PAT lives in DSH's `.credentials.yaml` (`refs.GITHUB_TOKEN`), never in source or logs.
- **Model tools**:
  - `github_token_status` — check whether the token is configured, its source, and writability.
  - `github_set_token` — set/update the token (writes to the credential center and refreshes the current environment).
- **Bundles the panel plugin `dsh-github-mcp-hint`**: the `Settings → Plugins → GitHub MCP` UI (examples + public repo stats).

---

## 🚀 Quick start

```sh
# 1. Install (also pulls the panel dependency dsh-github-mcp-hint)
dsh plugin --profile <profile> add dsh-github-mcp        # once published to npm
# — or —
dsh plugin --profile web add github:ZIye1208/dsh-github-mcp   # from GitHub

# 2. Set the token (just ask in chat)
#    "set my GitHub token to ghp_xxx"

# 3. Restart DSH, then ask
#    "is my GitHub token configured?"   (github_token_status)
#    "how many stars/downloads do my repos have"  (mcp__github__* / panel)
```

---

## ⚙️ Install

### npm (recommended, once published)

```sh
dsh plugin --profile <profile> add dsh-github-mcp
```

Pulls in `dsh-github-mcp-hint` automatically.

> **About npm publishing**: the package is npm-ready (`publishConfig.access: public`, a `files` whitelist, correct `main`/`exports`). To install from npm it must be published to a registry first: with an npm account/token, run `npm publish`. Currently only the GitHub version is published.

### GitHub

```sh
dsh plugin --profile web add github:ZIye1208/dsh-github-mcp
```

### Local dev

Link the local path in the profile's `package.json`, add it to `dsh.profile.bundles`, then restart DSH.

---

## 🔑 Prerequisites

1. **DSH** >= 0.1.x (uses the core `@deepseek-ai/dsh-mcp-client`).
2. **GitHub PAT**: create at GitHub → Settings → Developer settings → Personal access tokens, with scopes `repo`, `read:org`, `read:packages`.

---

## 🔐 Set the token (three ways)

### A. Model tool (recommended)
Say: "set my GitHub token to ghp_xxxxxxxx" → the agent calls `github_set_token`, writing `~/.dsh/.credentials.yaml` → `refs.GITHUB_TOKEN`.

### B. Edit the credential center
Add to `~/.dsh/.credentials.yaml`:
```yaml
version: 1
refs:
  GITHUB_TOKEN: ghp_xxxxxxxx
```
On the next DSH start the plugin bridges it into `process.env.GITHUB_TOKEN`.

### C. Environment variable (legacy)
`GITHUB_TOKEN=ghp_xxx` in the launching shell. Note: if `GITHUB_TOKEN` is already in the environment it wins and is read-only — `github_set_token` will be refused. `unset GITHUB_TOKEN` first to use A/B.

> ⚠️ **A token change needs a DSH restart** — the mcp-client reads the token at startup (static header) and does not reconnect mid-run.

---

## 🧭 Usage

- **Token status**: ask "is my GitHub token configured?" → `github_token_status`.
- **List/create PRs, push code, edit files, search code**: use natural language; the model calls `mcp__github__*`. Examples: "list all open PRs in owner/repo sorted by updated", "commit and push all changes on the current branch", "add a comment to owner/repo PR #123 and mark it ready for review", "search for keyword xxx in owner/repo".
- **Panel UI**: Settings → Plugins → GitHub MCP (from `dsh-github-mcp-hint`: random 4 of 30 examples, public repo stats).

---

## 🗑️ Uninstall / disable

### Uninstall the whole plugin (incl. panel)
```sh
dsh plugin --profile <profile> remove dsh-github-mcp
```

### Uninstall only the panel (GitHub MCP unaffected)
`dsh-github-mcp` bundles `dsh-github-mcp-hint` (as a dependency). It is **independently uninstallable**:
1. remove `dsh-github-mcp-hint` from the profile's `dsh.profile.bundles`;
2. `dsh plugin --profile <profile> remove dsh-github-mcp-hint`.

After that, `github_token_status` / `github_set_token` and every `mcp__github__*` keep working.

### Disable only the panel (keep installed)
In `cordis.patch.yml`:
```yaml
- id: dsh-github-mcp-hint
  disabled: true
```

---

## 🧩 Architecture

```
token input ──(github_set_token)──► .credentials.yaml (refs.GITHUB_TOKEN)
                                     │
                                     ▼  bridged at startup
                              process.env.GITHUB_TOKEN
                                     │
                                     ▼  mcp-client reads at startup
                           Authorization: Bearer <token> ──► api.githubcopilot.com/mcp/
                                     │
                                     ▼
                          registers mcp__github__* tools
```

- `dsh-github-mcp` = GitHub MCP connection + token credential center.
- `dsh-github-mcp-hint` = panel UI (separate repo, uninstallable).
- **Why the bridge**: DSH's credential store is never materialized into `process.env`, so the plugin bridges it at startup for the mcp-client.

---

## ❓ Troubleshooting

- **No `mcp__github__*`**: the token is unset or DSH wasn't restarted. Run `github_token_status`, then restart.
- **`github_set_token` refused**: `GITHUB_TOKEN` is in the launching env (read-only). `unset GITHUB_TOKEN` first.
- **`serverName "github" already in use`**: you added a manual `mcp-github` row. Remove it; this plugin's `cordis.patch.yml` owns that row.
- **Token change not taking effect**: restart DSH.

---

## 📄 Repo relation

| Repo | Role |
|---|---|
| `ZIye1208/dsh-github-mcp` | GitHub MCP connection + token credential center (this plugin) |
| `ZIye1208/dsh-github-mcp-hint` | Panel UI (independent, uninstallable) |

## License

[MIT](./LICENSE)
