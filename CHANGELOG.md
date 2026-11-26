# Changelog

## [0.3.2] - 2026-11-26

P0 安全止血：不迁移配置存储，不改变 `mcp__github__*` 工具名与连接方式。本版只创建 `v0.3.2` tag，不创建 GitHub Release；正式发行版随 `0.4.0` 发布。

### 安全

- `github_token_status` 不再 `resolve()` PAT，不再请求 `/user` 或 MCP `initialize`，改为纯本地结构化状态查询。
- 状态结果不再包含 token 掩码、其它 server 名、全局工具名或原始连接错误；只保留 `github` 当前连接状态的白名单字段与稳定枚举，`credentials.describe()` 失败时只返回未配置状态。
- 删除 loader 私有 fiber 扫描、硬编码 `file:///H:/...` 导入与 `cell.value` 私有访问。
- `inject` 明确包含 `mcpManager`；缺少必需服务时启动失败，不再静默降级。
- `mcpManager.register()` 不再传公共类型之外的 `enabled`。
- 插件日志统一脱敏并限长。
- 设置页清除 token 后回读 `describe()`：env/project-env/user-env fallback 仍生效时显示警告；文件值仍在时显示失败。
- 设置页不再回显远端 `error.message`；未知错误只显示通用失败提示。
- 保存/清除操作增加同步 `busyRef` 锁，避免快速重复点击产生并发写。

### 测试

- 本地语法检查通过。
- 38 个 `node:test` 用例通过：config 7 / host 18 / client 1 / render 1 / client-actions 6 / patch 5。
- host 用例改为假服务，不再依赖本机 DSH 安装目录。

## [0.3.1] - 2026-11-18

完整发布版。npm 上的 `0.3.0` 是在 `v0.3.0` tag 之后、后续 6 个提交之前打包的，缺 `screenshots.json`、`engines` 和修正后的 peer 声明。本版只补齐这些发布元数据，**功能代码与 0.3.0 完全一致**（同一次真机验证），大更新说明见下方 `0.3.0` 节。

### 修复

- **`peerDependencies["@deepseek-ai/cordis"]` 过窄**：`^4.0.2` → `>=4.0.1 <5.0.0`。原写法会静默排除 `4.1.0-rc` 一类的预发布构建（node-semver 只在同 major.minor.patch 元组的比较符自带预发布标签时放行），且本机 29 个同类插件中无此先例。
- **仓库与 npm 内容不一致**：修掉后 `github:ZIye1208/dsh-github-mcp` 安装与 npm 安装拿到同一份元数据。

### 新增

- `engines.node: ">=20"`、`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`。DSH 那条只声明实测过的 0.2.2 线：`>=0.2.0-rc.1 <0.3.0-0` 经 node-semver 实测**兜不住 `0.2.2-rc.3`**（`0.2.0` 与 `0.2.2` 属不同元组）。
- `screenshots.json`：声明市场详情页使用的截图（`docs/settings.png`），替代从 README 抓图的启发式。

### 测试

沿用 0.3.0 的 22 个用例（config 7 / host 8 / client 1 / render 1 / patch 5），本版改动仅限 `package.json` 与文档，全部通过。

## [0.3.0] - 2026-11-18

以 **DSH 0.2.2-rc.3 桌面端**为基线重写。核心变化：把「插件自己桥接 token」换成宿主原生的凭据模板 + `mcpManager`，并把配置搬到设置页。

### 破坏性变更

- 移除 `github_set_token` 工具。写入凭据改由设置页完成，模型不再经手明文 PAT。
- 不再读取/写入 `process.env.GITHUB_TOKEN`。token 只从 DSH 凭据中心按 `${credential:GITHUB_TOKEN}` 展开。
- `cordis.patch.yml` 只剩一行 `insert`（`id: dsh-github-mcp`），不再手插 `@deepseek-ai/dsh-mcp-client` 行。
- 新增两个凭据引用 `GITHUB_MCP_TOOLSETS`、`GITHUB_MCP_READONLY`（值形如 `repos,issues` / `false`，不是密钥）。

### 修复

- **token 缺失时静默 401**：旧 `cordis.patch.yml` 的 `!!js` 表达式无条件求值，没有 token 时会发出 `Authorization: Bearer undefined`，配合 `failOnStartupError: false` 只表现为「工具不见了」。现在缺凭据时 mcp-client 进入 `waiting-credentials` 状态，设置页能直接看到。
- **改 token 必须重启**：旧实现把 token 写进 `process.env` 后需要重启；现在写凭据即触发 `credentials/reference-updated` → 重连。
- **工具不注册且状态不可见**：在 patch 里直接手插 `dsh-mcp-client` 时，`tools/list` 耗时会挂住 apply（实测 GitHub 首次 `tools/list` 约 18 秒），且状态读不到。改为经 `mcpManager.register()` 挂载后，有 30 秒启动预算，状态可通过 `manager.list()` 读取。
- **README 事实性错误**：旧文档写「环境变量优先且只读、`set` 会被拒、改 token 必须重启」。实际 `dsh-credentials-local` 是文件优先，`set` 无 env 检查且会 `notifyUpdated`。

### 新增

- 「设置 → GitHub MCP」设置页（`lib/client.js`）：
  - token 输入（`type=password`，提交后清空，只回显掩码）、保存、清除
  - 11 个工具集复选框，每组标注该组单独下发时的工具数
  - 只读模式开关（`X-MCP-Readonly`）
  - 勾选只改草稿，**「保存设置」才写入**；保存后回读 `describe()` 校验 `configured === true`，失败即报错，不静默
  - 保存成功显示带时间戳的状态（`✓ 已保存 · 工具集 repos,issues · 只读 关 · 23:58:31`）
  - 每行名字与工具数 `nowrap`，描述超宽省略并悬停显示全文
- `lib/config.mjs`：零依赖纯逻辑（工具集解析、默认值、草稿比较）
- `github_token_status`：报告 token 来源、掩码、当前工具集与只读状态；附带 `manager.list()` 的连接状态

### 测试

从 0 个用例到 22 个（`node:test`，无第三方断言库）：

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `test/config.test.mjs` | 7 | 工具集解析、去空去重保序、草稿比较 |
| `test/host.test.mjs` | 8 | `seedCredentialDefaults` 只补缺省；`mcpManager` 缺失时降级 |
| `test/client.test.mjs` | 1 | 模块加载契约（`inject` 声明、slot 注册） |
| `test/client.render.test.mjs` | 1 | 假 React 渲染整屏：工具数文案、按钮、掩码回显 |
| `test/patch.test.mjs` | 5 | patch 仅一行 insert，且不含 `!!js` / `process.env` |

单测期间抓到并修掉的真 bug：`wantedHeaders` 只 trim 整体、未处理逗号内部空格，导致 `repos, issues` 与 `repos,issues` 被判为不同值而反复重写。

## 上游历史

0.2.0 及更早的作者版本没有 CHANGELOG。仓库首个提交 `d36675d` 是 0.2.0 的文档修正。

[0.3.2]: https://github.com/ZIye1208/dsh-github-mcp/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ZIye1208/dsh-github-mcp/releases/tag/v0.3.1
[0.3.0]: https://github.com/ZIye1208/dsh-github-mcp/releases/tag/v0.3.0
