# dsh-github-mcp

Connect DSH to the **official GitHub MCP server**. The token stays in DSH credentials; toolsets, read-only mode and `serverName` are managed in **Settings → GitHub MCP**. Changes reconnect automatically without editing `cordis.patch.yml` or bridging the token into `process.env`.

![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.5-blue)
![npm](https://img.shields.io/npm/v/dsh-github-mcp)
![license](https://img.shields.io/badge/license-MIT-green)

![Settings: connection options](docs/settings.png)

## What it fixes

| | Manual bridge (0.2.0) | This version (0.4.0) |
|---|---|---|
| Token source | plugin parses YAML itself | host `credentials` via `${credential:GITHUB_TOKEN}` |
| After changing the token | restart DSH | mcp-client reconnects automatically |
| Can the model see plaintext | yes — `github_set_token` handed the PAT to the model | no — the form writes credentials directly; the model only gets local status |
| Changing toolsets | edit patch headers | tick boxes and atomically save through Settings |
| Configuration storage | credential file + `localStorage` guesswork | volatile Config for non-secrets; credentials for the token |
| Diagnosis | logs or guesswork | settings status + user-triggered connection probe + local `github_token_status` |

## Install

**Requires**:

- DSH desktop with declared compatibility `>=0.2.2-rc.5 <0.2.3-0`; local verification baseline `0.2.2-rc.5`.
- Node `>=24.9.0`.
- Host services `credentials`, `tools`, `mcpManager`, and the Settings client capability.

### Option 1: npm (recommended)

```powershell
dsh plugin --profile desktop add dsh-github-mcp
```

Pin the version:

```powershell
dsh plugin --profile desktop add dsh-github-mcp@0.4.0 --save-exact
```

### Option 2: the Plugins page

1. DSH desktop → **Settings** → **Plugins**
2. **Add**, then enter one of:
   - npm: `dsh-github-mcp`
   - GitHub: `github:ZIye1208/dsh-github-mcp`
   - local directory: `H:/path/to/dsh-github-mcp`
3. **Fully quit DSH and start it again**.

> For local-directory/link/Junction installs, run `npm ci` in the source repository first. The plugin now depends on `@deepseek-ai/schemastery`; after realpath resolution it must be able to resolve its own `node_modules`.

### Option 3: command line

```powershell
# npm
dsh plugin --profile desktop add dsh-github-mcp@0.4.0 --save-exact

# local directory
dsh plugin --profile desktop add H:/path/to/dsh-github-mcp

# GitHub
dsh plugin --profile desktop add github:ZIye1208/dsh-github-mcp
```

Then quit and restart DSH.

### Verify

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern "dsh-github-mcp"
```

Both `dependencies` and `dsh.profile.bundles` must list it.

## Usage

Settings → **GitHub MCP**.

### 1. Personal Access Token

- The input is `type=password` and is cleared on submit. Neither the settings page nor the status tool returns a token mask.
- **Save** writes credentials; **Clear** removes the credential-file override.
- If `GITHUB_TOKEN` also exists in the launch environment, project `.env`, or user `.env`, it becomes active again after Clear. The page shows a fallback warning; remove the variable and restart DSH to fully clear it.
- The status line reports configured/unconfigured and the source, never the PAT.
- Use a least-privilege fine-grained PAT and enable read-only mode. Read-only mode is not a substitute for PAT permissions.

### 2. Toolsets and read-only mode

- Eleven toolsets are available; at least one must remain selected.
- New installs leave read-only mode off; enable it manually when write operations should be restricted.
- Ticking changes only a draft. **Save settings** writes it.
- `toolsets`, `readOnly`, and `serverName` are saved in one `settings.mutate()` call with `expectedRevision`, preventing cross-tab overwrites.
- Host handles `loader/volatile-update` and serially stops the old registration before registering the new connection.
- The localized connection state and the manager's real `toolCount` appear next to the Connection options title; per-toolset counts are no longer hard-coded.

After changing toolsets or read-only mode, **open a new session** to see the new tool list.

### 3. Tool namespace (advanced)

- Default: `github`, producing `mcp__github__*`.
- The settings page places it under a collapsed **Tool namespace (advanced)** disclosure with a `240px` input to reduce accidental edits.
- Allowed: 1–32 letters, digits, underscores, or hyphens.
- Usually leave it unchanged. Adjust it only for an existing MCP server with the same name or multiple GitHub MCP instances. The tool namespace changes, so open a new session.
- The plugin never silently renames itself or overwrites another MCP server.

### 4. Test connection

**Test connection** is a user action that calls public `mcpManager.probe(serverName)`. It performs MCP negotiation, lists tools, and closes an independent connection without touching the live connection.

- Success shows duration, tool count, and whether closure was confirmed.
- Failure shows only a stage and generic text, never raw `message` / `cleanupError`.
- It is not exposed as a model tool.

## How it works

```text
Settings UI
  ├─ token ──▶ ctx.remote.credentials.set/unset
  │              └─ credentials/reference-updated ──▶ mcp-client reconnect
  └─ options ─▶ ctx.remote.settings.mutate(ns, ops, expectedRevision)
                 └─ loader/volatile-update(paths)
                      └─ Host serial registerCurrent()
                           └─ mcpManager.register(serverName, {
                                transport: 'streamable-http',
                                url: 'https://api.githubcopilot.com/mcp/',
                                headers: {
                                  Authorization: 'Bearer ${credential:GITHUB_TOKEN}',
                                  'X-MCP-Toolsets': toolsets.join(','),
                                  'X-MCP-Readonly': String(readOnly),
                                },
                              })
```

Two design points:

1. **Secrets and ordinary configuration are separated**: only the token uses credentials; toolsets, read-only mode, and `serverName` use volatile Config + Settings.
2. **The connection goes through `mcpManager`**: no hand-inserted mcp-client row, a 30-second startup budget, public status, and public probe.

`cordis.patch.yml` only inserts the plugin itself:

```yaml
- insert:
    - id: dsh-github-mcp
      name: 'dsh-github-mcp'
```

## Migration

- On first `0.4.0` startup, legacy `GITHUB_MCP_TOOLSETS` / `GITHUB_MCP_READONLY` values are strictly validated and migrated into Config.
- Existing Config fields win; invalid legacy values are ignored in favor of product defaults.
- Legacy credential refs and `localStorage` keys are not deleted automatically, so rollback to `0.3.x` remains possible.
- New installs default to `readOnly: false`; an existing user's legacy value (including `true`) is preserved, and the page shows a risk notice while writes are allowed.
- **Rolling back a new `0.4.0` install to `0.3.x` is not recommended**: the old version does not know the new Config and may reseed defaults, losing the read-only setting.

## Security model

| Question | Answer |
|---|---|
| Where is the token stored | `~/.dsh/.credentials.yaml`. On POSIX the host creates mode `0600` with directory `0700`; Windows depends on ACLs and is not equivalent to POSIX permissions. The file is plaintext YAML |
| Who can read it | Usually any local program running as your user; this is inherent to local credentials |
| Can the model see the token | No. `github_token_status` only calls `describe()`, never resolves the PAT, never returns a mask, and never accesses the network |
| Can logs or UI errors contain it | Logs are redacted and bounded; UI never echoes remote `error.message`; probe output is allow-listed |
| Network destinations | The main plugin only connects to `https://api.githubcopilot.com/mcp/`; the status tool is offline and the probe reuses the same registered configuration |
| Is hint still installed | No. `dsh-github-mcp-hint` was removed from the main package to avoid its legacy environment-variable token path and extra direct browser API calls |

## Compatibility

- DSH: `>=0.2.2-rc.5 <0.2.3-0`; `0.3.0` remains rejected until verified.
- Node: `>=24.9.0`.
- Cordis peer: `>=4.0.1 <5.0.0`.
- Default tool names are `mcp__github__<raw_name>`; a custom `serverName` produces `mcp__<serverName>__<raw_name>`.
- Windows and Ubuntu CI use Node `24.9.0` and run `npm ci`, syntax checks, `node --test`, and `npm pack --dry-run`.

## Development

No build step: `lib/client.js` is a hand-written `__ModuleLoader__` factory and `lib/index.mjs` is plain ESM.

```powershell
npm ci
node --check lib/index.mjs
node --check lib/client.js
node --check lib/config.mjs
node --test
npm pack --dry-run
```

| Test | Coverage |
|---|---|
| `test/config.test.mjs` | strict toolsets/boolean/serverName validation, Config schema, volatile refs |
| `test/host.test.mjs` | registration contract, local diagnostics, volatile re-registration, serial queue, migration, conflicts, disposer, zero network |
| `test/client.test.mjs` | module contract, slot registration, explicit remote injection |
| `test/client.render.test.mjs` | Settings view, real toolCount, serverName, probe button, no mask |
| `test/client-actions.test.mjs` | atomic save, revision conflict, writable, token fallback, error redaction, sync lock, probe, watch/event cleanup |
| `test/patch.test.mjs` | patch structure, template boundary, manifest/lockfile, hint removal, Config export |

Tests do not depend on a local DSH profile and do not skip core contract cases when DSH is absent.

## License

MIT
