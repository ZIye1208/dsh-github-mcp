# dsh-github-mcp

给 DSH 接入 **GitHub 官方 MCP 服务器**。token 存进 DSH 凭据中心，工具集、只读模式和 `serverName` 由「设置 → GitHub MCP」管理；保存后自动重连，不需要手改 `cordis.patch.yml`，也不需要把 token 桥进 `process.env`。

![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.5-blue)
![npm](https://img.shields.io/npm/v/dsh-github-mcp)
![license](https://img.shields.io/badge/license-MIT-green)

![设置页：连接选项](docs/settings.png)

## 它解决的问题

| | 手工桥接（0.2.0） | 本版本（0.4.0） |
|---|---|---|
| token 从哪来 | 插件自己 parse YAML 文件 | 宿主 `credentials` 服务的 `${credential:GITHUB_TOKEN}` 模板 |
| 改 token 后 | 必须重启 DSH | 写进凭据中心，mcp-client 自动重连 |
| 模型能看到明文吗 | 能——`github_set_token` 让模型经手 PAT | 不能——设置页直写凭据中心，模型侧只有本地状态工具 |
| 工具集怎么调 | 手改 patch 里的 header | 设置页勾选，Settings 原子保存 |
| 配置存在哪 | 凭据文件 + `localStorage` 猜当前值 | 非密钥配置存插件 volatile Config，Secret 仍存 credentials |
| 出问题怎么查 | 看日志，或者猜 | 设置页状态 + 用户主动「测试连接」+ 纯本地 `github_token_status` |

## 安装

**前置**：

- DSH 桌面端声明兼容 `>=0.2.2-rc.5 <0.2.3-0`；本地验证基线是 `0.2.2-rc.5`。
- Node `>=24.9.0`。
- 宿主提供 `credentials`、`tools`、`mcpManager` 与 Settings 客户端能力。

### 方式一：npm（推荐）

```powershell
dsh plugin --profile desktop add dsh-github-mcp
```

钉住版本：

```powershell
dsh plugin --profile desktop add dsh-github-mcp@0.4.0 --save-exact
```

### 方式二：插件页添加

1. DSH 桌面端 → 左下角**设置** → **插件**
2. 右上角**添加**，填：
   - npm：`dsh-github-mcp`
   - GitHub：`github:ZIye1208/dsh-github-mcp`
   - 本地目录：`H:/path/to/dsh-github-mcp`
3. **完全退出 DSH 再打开**。

> 从本地目录/link/Junction 安装时，先在源码仓库执行 `npm ci`。插件现在依赖 `@deepseek-ai/schemastery`，realpath 回到源码目录后必须能解析自己的 `node_modules`。

### 方式三：命令行

```powershell
# npm
dsh plugin --profile desktop add dsh-github-mcp@0.4.0 --save-exact

# 本地目录
dsh plugin --profile desktop add H:/path/to/dsh-github-mcp

# GitHub
dsh plugin --profile desktop add github:ZIye1208/dsh-github-mcp
```

装完同样要**完全退出 DSH 再打开**。

### 验证装上了

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern "dsh-github-mcp"
```

`dependencies` 和 `dsh.profile.bundles` 两处都要出现。

## 用法

设置 → **GitHub MCP**。

### 1. Personal Access Token

- 输入框是 `type=password`，提交后立即清空；状态工具和设置页都不返回 token 掩码。
- 「保存」写入 credentials；「清除」删除凭据文件中的覆盖值。
- 如果启动环境变量、项目 `.env` 或用户 `.env` 中还有 `GITHUB_TOKEN`，清除后它会重新生效。设置页会显示 fallback 警告；要彻底清除，需删除对应变量并重启 DSH。
- 状态行显示 `已配置/未配置` 与来源，不显示 PAT。
- 建议使用最小权限 fine-grained PAT，并开启只读模式。只读模式不是 PAT 权限的替代品。

### 2. 工具集与只读模式

- 11 个工具集可多选；至少保留一个。
- 新安装默认关闭只读模式；需要限制写操作时可手动开启。
- 勾选只改草稿，点「保存设置」才写入。
- `toolsets`、`readOnly`、`serverName` 通过一次 `settings.mutate()` 原子保存，带 `expectedRevision` 防止跨标签页覆盖。
- 保存后 Host 监听 `loader/volatile-update`，串行停止旧注册并注册新连接。
- 页面在「连接选项」标题旁显示中文连接状态与真实 `toolCount`，不再硬编码每组工具数。

改了工具集或只读模式后，已经开着的会话要**新开一个**才能看到新的工具清单。

### 3. 工具命名空间（高级）

- 默认 `github`，对应工具命名空间 `mcp__github__*`。
- 设置页将其放在默认折叠的「工具命名空间（高级）」中，输入栏宽 `240px`，避免误改。
- 只允许 `1–32` 位字母、数字、下划线或连字符。
- 一般无需修改；仅在已有同名 MCP server 或需要多个 GitHub MCP 实例时调整。修改后工具命名空间变化，必须新开会话。
- 插件不会静默改名，也不会覆盖其它 MCP server。

### 4. 测试连接

「测试连接」是用户主动操作，调用公共 `mcpManager.probe(serverName)`：独立完成 MCP 协商、列出工具并关闭连接，不触碰正在使用的 live 连接。

- 成功显示耗时、工具数与是否确认关闭。
- 失败只显示阶段和通用提示，不回显原始 `message` / `cleanupError`。
- 该操作不暴露为模型工具。

## 工作原理

```text
设置页
  ├─ token ──▶ ctx.remote.credentials.set/unset
  │              └─ credentials/reference-updated ──▶ mcp-client 重连
  └─ options ─▶ ctx.remote.settings.mutate(ns, ops, expectedRevision)
                 └─ loader/volatile-update(paths)
                      └─ Host 串行 registerCurrent()
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

两个关键点：

1. **Secret 与非密钥配置分离**：只有 token 走 credentials；工具集、只读和 `serverName` 走 volatile Config + Settings。
2. **连接交给 `mcpManager`**：不在 patch 里手插 mcp-client，使用 30 秒启动预算、公共状态列表与公共 probe。

`cordis.patch.yml` 只插入插件自身：

```yaml
- insert:
    - id: dsh-github-mcp
      name: 'dsh-github-mcp'
```

## 从旧版本迁移

- `0.3.x` 的 `GITHUB_MCP_TOOLSETS` / `GITHUB_MCP_READONLY` 会在首次启动 `0.4.0` 时严格校验并迁入 Config。
- 已有 Config 字段优先；非法旧值忽略并使用产品默认值。
- 旧凭据引用和旧 `localStorage` 键不会自动删除，方便回滚到 `0.3.x`。
- 新安装默认 `readOnly: false`；已有用户的旧值（包括 `true`）会保留，设置页在允许写操作时显示风险提示。
- **新安装 `0.4.0` 后不建议回滚到 `0.3.x`**：旧版本没有新 Config，可能重新 seed 默认值并丢失只读设置。

## 安全模型

| 问题 | 答案 |
|---|---|
| token 存在哪 | `~/.dsh/.credentials.yaml`。POSIX 上宿主以 `0600` 文件、`0700` 目录创建；Windows 依赖 ACL，不能承诺等同于 POSIX 权限。磁盘上是明文 YAML |
| 谁能读到 | 同机、同用户身份运行的程序通常可读，这是本地凭据的固有限制 |
| 模型能看到 token 吗 | 不能。`github_token_status` 只调用 `describe()`，不 `resolve()` PAT，不返回掩码，不访问网络 |
| 日志和 UI 错误里会有 token 吗 | 插件日志脱敏并限长；UI 不回显远端 `error.message`；probe 只显示白名单结果 |
| 会外联到哪 | 主插件只连接 `https://api.githubcopilot.com/mcp/`；状态工具不联网，测试连接也复用 manager 的同一注册配置 |
| 主包还安装 hint 吗 | 不安装。`dsh-github-mcp-hint` 已从主包移除，避免旧的环境变量 token 链路和额外前端直连 |

## 兼容性

- DSH：`>=0.2.2-rc.5 <0.2.3-0`；`0.3.0` 未核验前继续拒绝。
- Node：`>=24.9.0`。
- Cordis peer：`>=4.0.1 <5.0.0`。
- 默认工具名为 `mcp__github__<raw_name>`；自定义 `serverName` 后变为 `mcp__<serverName>__<raw_name>`。
- Windows 与 Ubuntu CI 使用 Node `24.9.0`，执行 `npm ci`、语法检查、`node --test` 和 `npm pack --dry-run`。

## 开发

无构建步骤：`lib/client.js` 是手写的 `__ModuleLoader__` 工厂，`lib/index.mjs` 是纯 ESM。

```powershell
npm ci
node --check lib/index.mjs
node --check lib/client.js
node --check lib/config.mjs
node --test
npm pack --dry-run
```

| 测试 | 跑什么 |
|---|---|
| `test/config.test.mjs` | 严格工具集/布尔/serverName 校验、Config schema 与 volatile 引用 |
| `test/host.test.mjs` | 注册契约、状态诊断、volatile 重注册、串行队列、迁移、冲突、disposer、零网络 |
| `test/client.test.mjs` | 模块加载契约、slot 注册与显式 remote 注入 |
| `test/client.render.test.mjs` | Settings view 渲染、真实 toolCount、serverName、测试连接按钮、无掩码 |
| `test/client-actions.test.mjs` | 原子保存、revision 冲突、writable、token fallback、错误脱敏、同步锁、probe、watch/事件清理 |
| `test/patch.test.mjs` | patch 结构、模板边界、manifest/lockfile、hint 移除与 Config 导出 |

测试不依赖本机 DSH profile，也不会因缺少 DSH 而跳过核心契约用例。

## License

MIT
