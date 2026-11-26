// dsh-github-mcp host half.
//
// 0.4.0：
//  1. GITHUB_TOKEN 只走 credentials 模板，插件与模型工具都不读取明文。
//  2. toolsets/readOnly/serverName 走 volatile Config，设置页通过 Settings 原子保存。
//  3. loader/volatile-update 触发串行重注册；token 变化仍由 mcp-client 自行刷新。
//  4. github_token_status 只读本地凭据描述、Config 与 mcpManager.list()。

import Schema from "@deepseek-ai/schemastery";
import {
  DEFAULT_CONFIG,
  TOOLSETS,
  normalizeConfig,
  normalizeReadOnly,
  normalizeServerName,
  normalizeToolsets,
} from "./config.mjs";

const MCP_URL = "https://api.githubcopilot.com/mcp/";
const TOKEN_REF = "GITHUB_TOKEN";
const LEGACY_TOOLSETS_REF = "GITHUB_MCP_TOOLSETS";
const LEGACY_READONLY_REF = "GITHUB_MCP_READONLY";
const Toolset = Schema.union(TOOLSETS.map((item) => item.id));

/** Settings 投影三个用户选项；registrationError 是隐藏的 Host→Client 状态通道。 */
export const Config = Schema.object({
  toolsets: Schema.array(Toolset).min(1).default([...DEFAULT_CONFIG.toolsets]).volatile(),
  readOnly: Schema.boolean().default(DEFAULT_CONFIG.readOnly).volatile(),
  serverName: Schema.string()
    .pattern(/^[A-Za-z0-9_-]{1,32}$/)
    .default(DEFAULT_CONFIG.serverName)
    .volatile(),
  registrationError: Schema.string().default("").hidden().volatile(),
});

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
const REGISTRATION_ERRORS = new Set(["SERVER_NAME_CONFLICT", "REGISTRATION_FAILED"]);

function loggerFor(ctx) {
  return typeof ctx.logger === "function" ? ctx.logger("dsh-github-mcp") : ctx.logger;
}

/** 诊断文本统一脱敏并限长，避免把凭据或请求头发送到日志。 */
function safeDiagnostic(error, max = 500) {
  return String(error?.message ?? error ?? "unknown error")
    .replace(/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, max);
}

function currentConfig(config) {
  return normalizeConfig({
    toolsets: config.toolsets.get(),
    readOnly: config.readOnly.get(),
    serverName: config.serverName.get(),
  });
}

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

function registrationErrorOf(error) {
  const message = String(error?.message ?? error ?? "");
  return /already (?:configured|registered|in use)|already exists/i.test(message)
    ? "SERVER_NAME_CONFLICT"
    : "REGISTRATION_FAILED";
}

function rawEntryConfig(ctx) {
  return ctx.fiber?.entry?.options?.config ?? ctx.fiber?.rawConfig ?? {};
}

async function persistRegistrationError(ctx, code) {
  const entry = ctx.fiber?.entry;
  if (!entry || typeof ctx.configEditor?.edit !== "function") return;
  try {
    await ctx.configEditor.edit(entry, (current) => {
      const previous = REGISTRATION_ERRORS.has(current?.registrationError) ? current.registrationError : "";
      if (previous === code) return current;
      return { ...current, registrationError: code };
    });
  } catch (error) {
    // 状态通道写盘失败不阻断注册；模型侧仍能读到内存中的稳定错误码。
    loggerFor(ctx)?.warn?.("failed to persist GitHub MCP registration state: %s", safeDiagnostic(error));
  }
}

async function resolveLegacy(credentials, ref) {
  if (typeof credentials.resolve !== "function") return undefined;
  const described = await credentials.describe(ref);
  if (described?.configured !== true) return undefined;
  const resolved = await credentials.resolve(ref);
  return resolved === undefined || resolved === null ? undefined : resolved.value;
}

function legacyDiagnostic(error) {
  const message = String(error?.message ?? error ?? "");
  if (message.includes("TOOLSETS_EMPTY")) return "TOOLSETS_EMPTY";
  if (message.includes("TOOLSETS_UNKNOWN")) return "TOOLSETS_UNKNOWN";
  if (message.includes("READONLY_INVALID")) return "READONLY_INVALID";
  return safeDiagnostic(error);
}

/**
 * 把 0.3.x 的两个非密钥凭据引用迁入 Config。只补缺失字段，不 unset 旧引用，
 * 因此回滚到 0.3.x 时仍能恢复原设置。
 */
async function migrateLegacyOptions(ctx, config, editor) {
  const entry = ctx.fiber?.entry;
  if (!entry || typeof editor?.edit !== "function") return;

  const raw = rawEntryConfig(ctx);
  const patch = {};
  if (!Object.hasOwn(raw, "toolsets")) {
    try {
      const legacy = await resolveLegacy(ctx.credentials, LEGACY_TOOLSETS_REF);
      if (legacy !== undefined) patch.toolsets = normalizeToolsets(legacy);
    } catch (error) {
      loggerFor(ctx)?.warn?.("failed to migrate legacy GitHub MCP toolsets: %s", legacyDiagnostic(error));
    }
  }
  if (!Object.hasOwn(raw, "readOnly")) {
    try {
      const legacy = await resolveLegacy(ctx.credentials, LEGACY_READONLY_REF);
      if (legacy !== undefined) patch.readOnly = normalizeReadOnly(legacy);
    } catch (error) {
      loggerFor(ctx)?.warn?.("failed to migrate legacy GitHub MCP read-only option: %s", legacyDiagnostic(error));
    }
  }

  if (Object.keys(patch).length === 0) return;
  try {
    await editor.edit(entry, (current) => {
      const next = { ...current };
      let changed = false;
      if (!Object.hasOwn(current, "toolsets") && Object.hasOwn(patch, "toolsets")) {
        next.toolsets = patch.toolsets;
        changed = true;
      }
      if (!Object.hasOwn(current, "readOnly") && Object.hasOwn(patch, "readOnly")) {
        next.readOnly = patch.readOnly;
        changed = true;
      }
      return changed ? next : current;
    });
  } catch (error) {
    // 迁移失败不阻断连接：当前 Config 缺省值仍可用，下次启动会再试。
    loggerFor(ctx)?.warn?.("failed to persist migrated GitHub MCP options: %s", safeDiagnostic(error));
  }
}

function registerStatusTool(ctx, config, getRegistrationError) {
  return ctx.tools.register({
    name: "github_token_status",
    description:
      "查看 GitHub MCP 的本地状态：token 是否配置及来源、当前工具集、只读模式、serverName 与连接状态。不读取 PAT，不访问网络，不修改任何东西。无参数。",
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
                enum: [...CONNECTION_STATES, "unknown", "not-registered", "unavailable"],
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
          registrationError: { type: "string", enum: [...REGISTRATION_ERRORS] },
        },
        required: ["token", "toolsets", "readOnly", "serverName", "connection"],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value, null, 2) }];
      },
    },
    async execute() {
      const current = currentConfig(config);
      let token;
      try {
        token = await ctx.credentials.describe(TOKEN_REF);
      } catch {
        token = undefined;
      }

      let connection = { state: "not-registered" };
      try {
        const server = ctx.mcpManager.list().find((entry) => entry.name === current.serverName);
        if (server) connection = sanitizeManagedStatus(server.status);
      } catch {
        connection = { state: "unavailable" };
      }

      const tokenInfo = {
        configured: token?.configured === true,
        writable: token?.writable === true,
      };
      if (token?.configured && TOKEN_SOURCES.has(token.source)) tokenInfo.source = token.source;

      const result = {
        token: tokenInfo,
        toolsets: current.toolsets,
        readOnly: current.readOnly,
        serverName: current.serverName,
        connection,
      };
      const registrationError = getRegistrationError();
      if (REGISTRATION_ERRORS.has(registrationError)) result.registrationError = registrationError;
      return result;
    },
  });
}

export async function apply(ctx, config) {
  if (!ctx.credentials || !ctx.tools || !ctx.mcpManager || !ctx.configEditor || typeof ctx.on !== "function") {
    throw new Error("dsh-github-mcp: required services are unavailable");
  }

  const log = loggerFor(ctx);
  let stop = null;
  let disposed = false;
  let registrationGeneration = 0;
  const initialRegistrationError = rawEntryConfig(ctx).registrationError;
  let registrationError = REGISTRATION_ERRORS.has(initialRegistrationError) ? initialRegistrationError : undefined;
  let registerQueue = Promise.resolve();

  function registerCurrent() {
    registerQueue = registerQueue.then(async () => {
      if (disposed) return;
      try {
        stop?.();
      } catch (error) {
        log?.warn?.("failed to stop previous GitHub MCP registration: %s", safeDiagnostic(error));
      }
      stop = null;
      const generation = ++registrationGeneration;
      const current = currentConfig(config);

      try {
        const candidate = ctx.mcpManager.register(current.serverName, {
          transport: "streamable-http",
          url: MCP_URL,
          headers: {
            Authorization: `Bearer \${credential:${TOKEN_REF}}`,
            "X-MCP-Toolsets": current.toolsets.join(","),
            "X-MCP-Readonly": String(current.readOnly),
          },
        });
        if (disposed || generation !== registrationGeneration) {
          candidate();
          return;
        }
        stop = candidate;
        registrationError = undefined;
        void persistRegistrationError(ctx, "");
      } catch (error) {
        registrationError = registrationErrorOf(error);
        log?.warn?.("failed to register GitHub MCP server %s: %s", current.serverName, safeDiagnostic(error));
        void persistRegistrationError(ctx, registrationError);
      }
    });
    return registerQueue;
  }

  const offVolatile = ctx.on("loader/volatile-update", (paths) => {
    if (Array.isArray(paths) && paths.some((path) => ["toolsets", "readOnly", "serverName"].includes(path[0]))) {
      void registerCurrent();
    }
  });

  const unregisterStatusTool = registerStatusTool(ctx, config, () => registrationError);

  ctx.effect(() => () => {
    disposed = true;
    registrationGeneration += 1;
    offVolatile?.();
    unregisterStatusTool?.();
    try {
      stop?.();
    } catch (error) {
      log?.warn?.("failed to dispose GitHub MCP registration: %s", safeDiagnostic(error));
    }
    stop = null;
  });

  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  void migrateLegacyOptions(ctx, config, ctx.configEditor).catch((error) => {
    log?.warn?.("failed to migrate legacy GitHub MCP options: %s", safeDiagnostic(error));
  });

  await registerCurrent();
}

export const inject = ["credentials", "tools", "mcpManager", "configEditor"];
