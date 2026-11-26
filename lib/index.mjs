// dsh-github-mcp host half.
//
// 三件事：
//  1. 首次安装时给两个非密钥引用补缺省值（repos,issues / false），只在引用不存在时写。
//  2. 把 GitHub 官方 MCP server 交给 mcpManager；Authorization 走凭据模板，
//     工具集与只读开关也走凭据模板，凭据变化由 mcp-client 自动刷新连接。
//  3. 提供纯本地只读诊断工具 github_token_status。
//
// 刻意不做的事：
//  - 不读 .credentials.yaml（不手写 YAML 解析器）
//  - 不写 process.env
//  - 不提供 github_set_token
//  - 不让模型工具 resolve PAT 或主动访问 GitHub
//  - 不扫描 loader 私有 fiber，也不读取 mcp-client 私有 status cell

import { credentialDefaults, parseToolsets } from "./config.mjs";

const OPTION_REFS = new Set(["GITHUB_MCP_TOOLSETS", "GITHUB_MCP_READONLY"]);

function loggerFor(ctx) {
  return typeof ctx.logger === "function" ? ctx.logger("dsh-github-mcp") : ctx.logger;
}

/** 诊断文本统一脱敏并限长，避免把凭据或请求头发送到日志。 */
function safeDiagnostic(error, max = 500) {
  const text = String(error?.message ?? error ?? "unknown error")
    .replace(/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  return text.slice(0, max);
}

/** 给缺失的非密钥引用补缺省值；token 不碰。 */
async function seedCredentialDefaults(ctx, config) {
  const credentials = ctx.credentials;
  const log = loggerFor(ctx);
  const wanted = credentialDefaults(config ?? {});

  for (const [ref, value] of Object.entries(wanted)) {
    try {
      const info = await credentials.describe(ref);
      if (info !== undefined && info !== null && info.configured) continue;
      await credentials.set(ref, value);
      log?.info?.("seeded credential %s", ref);
    } catch (error) {
      // 补缺省失败不该阻断插件启动：用户仍可在设置页手动填。
      log?.warn?.("failed to seed credential %s: %s", ref, safeDiagnostic(error));
    }
  }
}

/**
 * P0 阶段仍需读取两个非密钥选项。白名单确保这个 helper 永远不能读取 PAT。
 */
async function resolveOption(credentials, ref) {
  if (!OPTION_REFS.has(ref) || typeof credentials.resolve !== "function") return undefined;
  try {
    const resolved = await credentials.resolve(ref);
    return resolved === undefined || resolved === null ? undefined : resolved.value;
  } catch {
    return undefined;
  }
}

const CONNECTION_STATES = new Set([
  "connecting",
  "connected",
  "waiting-credentials",
  "reconnecting",
  "closed",
  "failed",
]);
const CONNECTION_REASONS = new Set([
  "unclosed-generation",
  "reconnect-disabled",
  "gave-up",
]);
const TOKEN_SOURCES = new Set(["file", "env", "project-env", "user-env"]);

/** 只保留稳定枚举与数值字段，避免把宿主未来的自由文本带进模型上下文。 */
function sanitizeManagedStatus(status) {
  const result = {
    state: CONNECTION_STATES.has(status?.state) ? status.state : "unknown",
  };
  for (const key of ["toolCount", "connectedAt", "attempt", "maxAttempts", "nextRetryAtMs"]) {
    if (Number.isFinite(status?.[key])) result[key] = status[key];
  }
  if (CONNECTION_REASONS.has(status?.reason)) result.reason = status.reason;
  return result;
}

/** 把 GitHub MCP 交给官方 mcp-manager。 */
function registerServer(ctx) {
  const manager = ctx.mcpManager;
  const log = loggerFor(ctx);
  const headers = {
    Authorization: "Bearer ${credential:GITHUB_TOKEN}",
    "X-MCP-Toolsets": "${credential:GITHUB_MCP_TOOLSETS}",
    "X-MCP-Readonly": "${credential:GITHUB_MCP_READONLY}",
  };

  try {
    const stop = manager.register("github", {
      transport: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/",
      headers,
    });
    ctx.effect(() => stop);
  } catch (error) {
    const diagnostic = safeDiagnostic(error);
    log?.error?.("failed to register GitHub MCP: %s", diagnostic);
    throw new Error(`dsh-github-mcp: failed to register GitHub MCP: ${diagnostic}`);
  }
}

async function apply(ctx, config) {
  if (!ctx.credentials || !ctx.tools || !ctx.mcpManager) {
    throw new Error("dsh-github-mcp: required services are unavailable");
  }

  await seedCredentialDefaults(ctx, config);
  registerServer(ctx);

  ctx.tools.register({
    name: "github_token_status",
    description:
      "查看 GitHub MCP 的本地状态：token 是否配置及来源、当前工具集、只读模式和 github server 连接状态。不读取 PAT，不访问网络，不修改任何东西。无参数。",
    parameters: { type: "object", properties: {} },
    output: {
      schema: {
        type: "object",
        properties: {
          token: {
            type: "object",
            properties: {
              configured: { type: "boolean" },
              source: { type: "string", enum: [...TOKEN_SOURCES] },
              writable: { type: "boolean" },
            },
            required: ["configured", "writable"],
            additionalProperties: false,
          },
          toolsets: { type: "array", items: { type: "string" } },
          readOnly: { type: "boolean" },
          serverName: { type: "string" },
          connection: {
            type: "object",
            properties: {
              state: {
                type: "string",
                enum: [
                  ...CONNECTION_STATES,
                  "unknown",
                  "not-registered",
                  "unavailable",
                ],
              },
              toolCount: { type: "number" },
              connectedAt: { type: "number" },
              attempt: { type: "number" },
              maxAttempts: { type: "number" },
              nextRetryAtMs: { type: "number" },
              reason: { type: "string", enum: [...CONNECTION_REASONS] },
            },
            required: ["state"],
            additionalProperties: false,
          },
        },
        required: ["token", "toolsets", "readOnly", "serverName", "connection"],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value, null, 2) }];
      },
    },
    async execute() {
      let token;
      try {
        token = await ctx.credentials.describe("GITHUB_TOKEN");
      } catch {
        token = undefined;
      }
      const toolsets = parseToolsets(
        await resolveOption(ctx.credentials, "GITHUB_MCP_TOOLSETS"),
      );
      const readonlyValue = await resolveOption(ctx.credentials, "GITHUB_MCP_READONLY");

      let connection = { state: "not-registered" };
      try {
        const github = ctx.mcpManager.list().find((entry) => entry.name === "github");
        if (github) connection = sanitizeManagedStatus(github.status);
      } catch {
        connection = { state: "unavailable" };
      }

      const tokenInfo = {
        configured: token?.configured === true,
        writable: token?.writable === true,
      };
      if (token?.configured && TOKEN_SOURCES.has(token.source)) tokenInfo.source = token.source;

      return {
        token: tokenInfo,
        toolsets,
        readOnly: readonlyValue === "true",
        serverName: "github",
        connection,
      };
    },
  });
}

export const inject = ["credentials", "tools", "mcpManager"];
export { apply };
