// dsh-github-mcp host half.
//
// 三件事：
//  1. cordis.patch.yml 插入一行 @deepseek-ai/dsh-mcp-client 连接 GitHub MCP。
//     三个 header 全部走凭据模板：
//       expandTemplates: true
//       Authorization:    'Bearer ${credential:GITHUB_TOKEN}'
//       X-MCP-Toolsets:   '${credential:GITHUB_MCP_TOOLSETS}'
//       X-MCP-Readonly:   '${credential:GITHUB_MCP_READONLY}'
//     mcp-client 每次展开时向凭据中心取当前值，并在 credentials/reference-updated
//     时重连 —— 设置页改完即生效，不需要重启 DSH。
//  2. 首次安装时给后两个引用补缺省值（repos,issues / false），只在引用不存在时写，
//     之后一律以设置页（即凭据中心）为准。
//  3. 提供只读诊断工具 github_token_status。
//
// 刻意不做的事：
//  - 不读 .credentials.yaml（不手写 YAML 解析，不猜文件格式）
//  - 不写 process.env（模板直接从凭据服务取，绕开 env）
//  - 不提供 github_set_token（token 由设置页写入，不经模型、不进日志）
//  - 不改写 profile patch 里的 header（保持声明式；运行时值由凭据中心提供）

import { credentialDefaults, parseToolsets } from "./config.mjs";

/**
 * 配置面：`apply(ctx, config)` 直接收原始对象，缺省值在 config.mjs 里兜。
 *
 * 刻意不导出 schemastery 的 `Config`：本插件以 link 方式装进 profile 时
 * （node_modules/dsh-github-mcp 是 Junction），Node 会 realpath 回真实目录解析依赖，
 * 那里没有 @deepseek-ai/*，import 会让整个插件加载失败。少一个依赖少一个坑。
 */

/**
 * 给缺失的引用补缺省值。
 *
 * 只在 describe 报告未配置时写：一旦用户在设置页动过，凭据中心就是唯一事实来源，
 * 插件重启也不会把用户的设置覆盖回去。
 */
async function seedCredentialDefaults(ctx, config) {
  const credentials = ctx.credentials;
  if (credentials === undefined || credentials === null) return;

  const log = typeof ctx.logger === "function" ? ctx.logger("dsh-github-mcp") : ctx.logger;
  const wanted = credentialDefaults(config ?? {});

  for (const [ref, value] of Object.entries(wanted)) {
    try {
      const info = await credentials.describe(ref);
      if (info !== undefined && info !== null && info.configured) continue;
      await credentials.set(ref, value);
      log?.info?.("seeded credential %s", ref);
    } catch (error) {
      // 补缺省失败不该阻断插件启动：用户仍可在设置页手动填。
      log?.warn?.("failed to seed credential %s: %s", ref, (error && error.message) || error);
    }
  }
}

/** 读引用的当前值；只在本进程内用于拼诊断文本，不写日志。 */
async function resolveValue(credentials, ref) {
  if (typeof credentials.resolve !== "function") return undefined;
  try {
    const resolved = await credentials.resolve(ref);
    return resolved === undefined || resolved === null ? undefined : resolved.value;
  } catch {
    return undefined;
  }
}

/**
 * 带超时的 fetch；永远返回结构化结果，绝不抛出。
 * 诊断工具不能因为一次网络抖动就让整次调用失败。
 */
async function probe(url, init, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 error 及 cause 链压成一行，诊断时比只看最外层 message 有用得多。
 */
function describeErrorChain(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const message = current && current.message ? current.message : String(current);
    if (message) parts.push(message);
    current = current && current.cause;
  }
  return parts.join(" ← ");
}

/**
 * 把 GitHub MCP 交给官方 mcp-manager。
 *
 * 为什么不用 patch 直接插一行 mcp-client：
 *   - mcp-manager 会 await 它的 handle 并把连接状态写进 list()，失败时看得见；
 *   - 它固定 failOnStartupError: false 且给 startupTimeoutMs 默认 30s，
 *     不会因为 tools/list 慢而让插件 apply 一直悬着（这正是之前"插件活着但没工具"的形态）；
 *   - 插件卸载时管理器会连带卸掉该 server 的工具。
 */
function registerServer(ctx, config) {
  const manager = ctx.get("mcpManager");
  if (manager === undefined || manager === null || typeof manager.register !== "function") {
    const log = typeof ctx.logger === "function" ? ctx.logger("dsh-github-mcp") : ctx.logger;
    log?.warn?.("mcp-manager is unavailable; GitHub MCP was not mounted");
    return;
  }

  const wanted = credentialDefaults(config ?? {});
  const headers = {
    Authorization: "Bearer ${credential:GITHUB_TOKEN}",
    "X-MCP-Toolsets": "${credential:GITHUB_MCP_TOOLSETS}",
    "X-MCP-Readonly": "${credential:GITHUB_MCP_READONLY}",
  };
  // config 里的工具集只作为缺省值参与 seed；运行时一律以凭据中心为准。
  void wanted;

  try {
    const stop = manager.register("github", {
      transport: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/",
      headers,
      enabled: true,
    });
    ctx.effect(() => stop);
  } catch (error) {
    const log = typeof ctx.logger === "function" ? ctx.logger("dsh-github-mcp") : ctx.logger;
    log?.error?.("failed to register GitHub MCP: %s", (error && error.message) || error);
  }
}

async function apply(ctx, config) {
  await seedCredentialDefaults(ctx, config);
  registerServer(ctx, config);

  const credentials = ctx.credentials;
  const tools = ctx.tools;

  if (credentials === undefined || credentials === null || tools === undefined) return;

  tools.register({
    name: "github_token_status",
    description:
      "查看 GitHub MCP 的凭据与工具集配置：token 是否已配置、当前工具集与只读模式、值来自哪里。只读诊断，不修改任何东西。无参数。",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "string" },
      render(_args, value) {
        return [{ type: "text", text: String(value) }];
      },
    },
    async execute() {
      const lines = [];

      const token = await credentials.describe("GITHUB_TOKEN");
      if (token === undefined || token === null || token.configured !== true) {
        lines.push("GitHub token：未配置。");
        lines.push("在「设置 → GitHub MCP」里填写，或写入 .credentials.yaml 的 refs.GITHUB_TOKEN。");
      } else if (String(token.source) === "env") {
        lines.push("GitHub token：来自环境变量 GITHUB_TOKEN，凭据中心未配置。");
        lines.push("注意：凭据中心的值优先于环境变量，在设置页保存后会立刻改用凭据中心的值。");
      } else {
        const masked = token.masked ? `（${token.masked}）` : "";
        lines.push(`GitHub token：已配置${masked}（来源：凭据中心）。`);
      }

      const toolsets = parseToolsets(await resolveValue(credentials, "GITHUB_MCP_TOOLSETS"));
      lines.push(
        `工具集：${toolsets.length > 0 ? toolsets.join(", ") : "（未设置，缺省 repos,issues）"}`,
      );

      const readonlyValue = await resolveValue(credentials, "GITHUB_MCP_READONLY");
      lines.push(`只读模式：${readonlyValue === "true" ? "开" : "关"}`);

      // 运行时连接状态：mcp-manager 是唯一权威来源（state / toolCount / lastError 都在这里）。
      try {
        const manager = ctx.get("mcpManager");
        if (manager && typeof manager.list === "function") {
          const servers = manager.list();
          const github = servers.find((entry) => entry.name === "github");
          const others = servers
            .filter((entry) => entry.name !== "github")
            .map((entry) => `${entry.name}=${entry.status?.state ?? "?"}`);
          lines.push(
            `mcp-manager 中的 github：${
              github ? JSON.stringify(github.status) : "（未注册 —— registerServer 没有生效）"
            }`,
          );
          if (others.length > 0) lines.push(`mcp-manager 其它 server：${others.join(", ")}`);
        } else {
          lines.push("mcp-manager 中的 github：（取不到 mcpManager service）");
        }
      } catch (error) {
        lines.push(`mcp-manager 读取失败：${(error && error.message) || error}`);
      }

      // 活体检查：只把结果写进本次返回值，token 本身不出现在任何输出里。
      const tokenValue = await resolveValue(credentials, "GITHUB_TOKEN");
      if (tokenValue) {
        const user = await probe("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokenValue}`,
            "User-Agent": "dsh-github-mcp-diagnostic",
            Accept: "application/vnd.github+json",
          },
        });
        if (user.status === 200) {
          let login = "";
          try {
            login = JSON.parse(user.text).login ?? "";
          } catch {
            login = "";
          }
          lines.push(`token 活体检查：HTTP 200（登录名 ${login || "未知"}）`);
        } else {
          lines.push(`token 活体检查：HTTP ${user.status || "无响应"} — ${user.text.slice(0, 160)}`);
        }

        const mcp = await probe("https://api.githubcopilot.com/mcp/", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenValue}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-MCP-Toolsets": toolsets.length > 0 ? toolsets.join(",") : "repos,issues",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "dsh-github-mcp", version: "0.3.0" },
            },
          }),
        });
        lines.push(
          `MCP 端点：HTTP ${mcp.status || "无响应"} — ${mcp.text.replace(/\s+/g, " ").slice(0, 200)}`,
        );
      }

      // 运行时检查：mcp-client 那一行到底有没有挂进 loader，以及它的 fiber 状态。
      try {
        const loader = ctx.get("loader") ?? ctx.root?.get?.("loader");
        if (loader && typeof loader.entries === "function") {
          const found = [];
          const details = [];
          for (const entry of loader.entries()) {
            const options = entry?.options ?? {};
            const id = String(options.id ?? "");
            const name = String(options.name ?? "");
            if (!id.includes("mcp") && !name.includes("mcp")) continue;
            found.push(`${id || "?"} → ${name || "?"}`);
            if (name.includes("dsh-mcp-client")) {
              try {
                const fiber = entry?.ctx?.fiber;
                const state = fiber?.state ?? "?";
                const entryConfig = entry?.options?.config ?? {};
                const headerKeys = Object.keys(entryConfig.headers ?? {});
                const templated = headerKeys.filter((key) =>
                  String(entryConfig.headers[key]).includes("${credential:"),
                );
                let statusText = "（未读取）";
                try {
                  const mcpModule = await import(
                    "file:///H:/DEEPSEEK/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js"
                  );
                  const cell = mcpModule.connectionStatusOf(fiber);
                  statusText = cell ? JSON.stringify(cell.value) : "（无 status cell）";
                } catch (error) {
                  statusText = `（import 失败：${describeErrorChain(error)}）`;
                }
                const parentId =
                  entry?.parent?.tree?.ctx?.fiber?.entry?.id ?? entry?.parent?.id ?? "?";
                details.push(
                  `${id}: state=${state} parent=${parentId} failOnStartup=${entryConfig.failOnStartupError === true} expand=${entryConfig.expandTemplates === true} headers=${headerKeys.join("/") || "（无）"} templated=${templated.join("/") || "（无）"} status=${statusText}`,
                );
              } catch (error) {
                details.push(`${id}: 读取 fiber 失败 ${(error && error.message) || error}`);
              }
            }
          }
          lines.push(`loader 中的 MCP 条目：${found.length > 0 ? found.join("; ") : "（无）"}`);
          lines.push(`mcp-client 实例状态：${details.length > 0 ? details.join(" | ") : "（无）"}`);
        } else {
          lines.push("loader 中的 MCP 条目：（取不到 loader service）");
        }
      } catch (error) {
        lines.push(`loader 中的 MCP 条目：（检查失败：${(error && error.message) || error}）`);
      }

      // 工具注册面：global layer 里到底有没有 mcp__ 前缀的工具。
      try {
        const view = ctx.tools?.view?.(undefined);
        const allKnown = view?.knownNames ? [...view.knownNames] : [];
        const mcpKnown = allKnown.filter((n) => n.startsWith("mcp__"));
        const suspicious = allKnown.filter(
          (n) =>
            !n.startsWith("mcp__") &&
            (n.includes("github") || n.includes("issue") || n.includes("repo") || n.includes("branch")),
        );
        lines.push(`全局 known 工具总数：${allKnown.length}`);
        lines.push(`mcp__ 开头的：${mcpKnown.length} 个 — ${mcpKnown.join(", ") || "（无）"}`);
        lines.push(`名字里带 github/issue/repo/branch 的其它工具：${suspicious.join(", ") || "（无）"}`);
      } catch (error) {
        lines.push(`工具视图检查失败：${(error && error.message) || error}`);
      }

      return lines.join("\n");
    },
  });
}

export default { inject: ["credentials", "tools"], apply };
