# dsh-github-mcp

> Wraps GitHub MCP as a DSH plugin: connects to GitHub's official remote MCP Server, stores the token in the DSH credential center (`.credentials.yaml`), lets the token be set through model tools, and exposes the `mcp__github__*` tools.

## Features

- **GitHub MCP connection**: via `@deepseek-ai/dsh-mcp-client` to `https://api.githubcopilot.com/mcp/`; GitHub tools appear as `mcp__github__*` (`search_repositories`, `list_pull_requests`, `create_pull_request`, `push_files`, …).
- **Token in the credential center**: stored in DSH's `.credentials.yaml` (`refs.GITHUB_TOKEN`).
- **Model tools**:
  - `github_token_status` — check whether the token is configured.
  - `github_set_token` — set/update the token (writes to the credential center).
- **Bundles the panel plugin `dsh-github-mcp-hint`** (the `Settings → Plugins → GitHub MCP` UI).

## The panel plugin is separately uninstallable

Installing this plugin **also installs** `dsh-github-mcp-hint` (as a dependency). **The panel can be uninstalled/disabled at any time without affecting GitHub MCP**:

1. Remove `dsh-github-mcp-hint` from the profile's `dsh.profile.bundles`.
2. Uninstall the package: `dsh plugin --profile <profile> remove dsh-github-mcp-hint`.

After removing the panel, GitHub MCP tools keep working (`github_token_status` / `github_set_token` and every `mcp__github__*` are unaffected). To only disable the panel temporarily, set `disabled: true` for `dsh-github-mcp-hint` in `cordis.patch.yml`.

## Install

```sh
dsh plugin --profile <profile> add github:ZIye1208/dsh-github-mcp
```

This pulls in the `dsh-github-mcp-hint` dependency automatically.

## Use the token

1. Say in the chat "set my GitHub token to ghp_xxx"; the agent calls `github_set_token`.
2. Or edit `~/.dsh/.credentials.yaml` directly, adding under `refs:`:
   ```yaml
   refs:
     GITHUB_TOKEN: ghp_xxxxxxxx
   ```
3. **Restart DSH** — the mcp-client reads the token at startup and the `mcp__github__*` tools appear.

> Note: if `GITHUB_TOKEN` is already in your launching environment (env wins), `github_set_token` is refused. Unset `GITHUB_TOKEN` in the launching shell first, then save to the credential center. A token change takes effect after **restarting DSH** (the mcp-client reads it at startup).

## Relation to the panel plugin

- `dsh-github-mcp` = GitHub MCP connection + token credential center.
- `dsh-github-mcp-hint` = panel UI (separate repo). Both are independent and can be uninstalled separately.

## License

[MIT](./LICENSE)
