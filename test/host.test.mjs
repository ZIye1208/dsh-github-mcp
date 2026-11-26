// host half 单测：node test/host.test.mjs
//
// 0.3.2 起 host 不再依赖 @deepseek-ai/* 的运行时导入，测试用假服务即可，
// 不需要 DSH 安装目录，也不会在 CI 上整组 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { apply, inject } from "../lib/index.mjs";

function makeCtx(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed));
  const registered = [];
  const registrations = [];
  const resolved = [];
  const warnings = [];
  const effects = [];
  const servers = options.servers ?? [];
  let disposed = 0;

  const ctx = {
    credentials: {
      describe: async (ref) => {
        if (options.describeError?.[ref]) throw options.describeError[ref];
        return store.has(ref)
          ? {
              configured: true,
              source: options.sources?.[ref] ?? "file",
              writable: true,
              masked: "masked-value",
            }
          : { configured: false, writable: true };
      },
      set: async (ref, value) => {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`empty value for ${ref}`);
        }
        store.set(ref, value);
      },
      unset: async (ref) => {
        store.delete(ref);
      },
      resolve: async (ref) => {
        resolved.push(ref);
        return store.has(ref) ? { value: store.get(ref), source: "file" } : undefined;
      },
    },
    tools: {
      register(definition) {
        registered.push(definition);
      },
    },
    mcpManager: {
      register(name, entry) {
        if (options.registerError) throw options.registerError;
        registrations.push({ name, entry });
        return () => {
          disposed += 1;
        };
      },
      list() {
        if (options.listError) throw options.listError;
        return servers;
      },
    },
    logger: () => ({
      info() {},
      warn: (...args) => warnings.push(args.join(" ")),
      error() {},
      debug() {},
    }),
    effect: (fn) => {
      effects.push(fn);
      return fn;
    },
  };

  return {
    ctx,
    store,
    registered,
    registrations,
    resolved,
    warnings,
    effects,
    get disposed() {
      return disposed;
    },
  };
}

test("inject 明确包含 mcpManager", () => {
  assert.deepEqual(inject, ["credentials", "tools", "mcpManager"]);
});

test("源码不再包含 PAT 探活、私有 loader/status 访问或硬编码路径", () => {
  const source = readFileSync(new URL("../lib/index.mjs", import.meta.url), "utf8");
  for (const forbidden of [
    'credentials.resolve("GITHUB_TOKEN")',
    "fetch(",
    "loader.entries",
    "cell.value",
    "file:///H:/",
    "api.github.com/user",
    "tools?.view",
  ]) {
    assert.ok(!source.includes(forbidden), `forbidden diagnostic pattern remains: ${forbidden}`);
  }
});

test("首次运行补齐两个缺省引用，token 不碰", async () => {
  const { ctx, store } = makeCtx();
  await apply(ctx, {});

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "repos,issues");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "false");
  assert.equal(store.has("GITHUB_TOKEN"), false);
});

test("已有引用不被覆盖（设置页优先）", async () => {
  const { ctx, store } = makeCtx({
    GITHUB_MCP_TOOLSETS: "pull_requests,actions",
    GITHUB_MCP_READONLY: "true",
  });
  await apply(ctx, {});

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "pull_requests,actions");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "true");
});

test("插件 config 只在引用缺失时作为缺省值", async () => {
  const { ctx, store } = makeCtx();
  await apply(ctx, { toolsets: "repos, issues, actions", readOnly: true });

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "repos,issues,actions");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "true");
});

test("连接通过 mcpManager 注册，header 保持凭据模板且不传 enabled", async () => {
  const { ctx, registrations } = makeCtx();
  await apply(ctx, {});

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "github");
  assert.deepEqual(registrations[0].entry, {
    transport: "streamable-http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: {
      Authorization: "Bearer ${credential:GITHUB_TOKEN}",
      "X-MCP-Toolsets": "${credential:GITHUB_MCP_TOOLSETS}",
      "X-MCP-Readonly": "${credential:GITHUB_MCP_READONLY}",
    },
  });
  assert.equal(Object.hasOwn(registrations[0].entry, "enabled"), false);
});

test("注册且只注册 github_token_status，输出为结构化对象", async () => {
  const { ctx, registered } = makeCtx();
  await apply(ctx, {});

  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "github_token_status");
  assert.equal(registered[0].output.schema.type, "object");
  assert.equal(typeof registered[0].execute, "function");
});

test("插件卸载时调用 manager 注册 disposer", async () => {
  const harness = makeCtx();
  await apply(harness.ctx, {});
  assert.equal(harness.effects.length, 1);
  const dispose = harness.effects[0]();
  assert.equal(typeof dispose, "function");
  dispose();
  assert.equal(harness.disposed, 1);
});

test("诊断工具在未配置 token 时给出本地状态", async () => {
  const { ctx, registered, resolved } = makeCtx();
  await apply(ctx, {});
  const result = await registered[0].execute();

  assert.deepEqual(result, {
    token: { configured: false, writable: true },
    toolsets: ["repos", "issues"],
    readOnly: false,
    serverName: "github",
    connection: { state: "not-registered" },
  });
  assert.deepEqual(resolved, ["GITHUB_MCP_TOOLSETS", "GITHUB_MCP_READONLY"]);
});

test("诊断工具不 resolve PAT、不回显掩码、不输出其它 server", async () => {
  const { ctx, registered, resolved } = makeCtx(
    {
      GITHUB_TOKEN: "ghp_secret",
      GITHUB_MCP_TOOLSETS: "repos,pull_requests",
      GITHUB_MCP_READONLY: "true",
    },
    {
      servers: [
        { name: "other", status: { state: "connected", lastError: "other-secret" } },
        {
          name: "github",
          status: { state: "connected", toolCount: 29, connectedAt: 123, lastError: "ghp_secret" },
        },
      ],
    },
  );
  await apply(ctx, {});
  const result = await registered[0].execute();
  const serialized = JSON.stringify(result);

  assert.equal(result.token.configured, true);
  assert.equal(result.token.source, "file");
  assert.equal(Object.hasOwn(result.token, "masked"), false);
  assert.deepEqual(result.toolsets, ["repos", "pull_requests"]);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.connection, { state: "connected", toolCount: 29, connectedAt: 123 });
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("other-secret"));
  assert.ok(!serialized.includes("other"));
  assert.deepEqual(resolved, ["GITHUB_MCP_TOOLSETS", "GITHUB_MCP_READONLY"]);
});

test("诊断工具完全不发网络请求", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network must not be used");
  };
  try {
    const { ctx, registered } = makeCtx({ GITHUB_TOKEN: "ghp_secret" });
    await apply(ctx, {});
    await registered[0].execute();
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("连接状态只保留白名单字段并丢弃原始错误", async () => {
  const { ctx, registered } = makeCtx(
    {},
    {
      servers: [
        {
          name: "github",
          status: {
            state: "failed",
            reason: "gave-up",
            attempt: 2,
            maxAttempts: 5,
            nextRetryAtMs: 999,
            lastError: "Authorization: Bearer ghp_secret",
            internal: "do-not-leak",
          },
        },
      ],
    },
  );
  await apply(ctx, {});
  const result = await registered[0].execute();

  assert.deepEqual(result.connection, {
    state: "failed",
    reason: "gave-up",
    attempt: 2,
    maxAttempts: 5,
    nextRetryAtMs: 999,
  });
});

test("未知 token 来源与连接枚举不会进入诊断结果", async () => {
  const { ctx, registered } = makeCtx(
    { GITHUB_TOKEN: "ghp_secret" },
    {
      sources: { GITHUB_TOKEN: "future-source" },
      servers: [
        {
          name: "github",
          status: {
            state: "future-state",
            reason: "future-reason",
            lastError: "ghp_secret",
          },
        },
      ],
    },
  );
  await apply(ctx, {});
  const result = await registered[0].execute();
  const serialized = JSON.stringify(result);

  assert.equal(Object.hasOwn(result.token, "source"), false);
  assert.deepEqual(result.connection, { state: "unknown" });
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("future-source"));
  assert.ok(!serialized.includes("future-reason"));
});

test("credentials.describe 失败时只返回未配置状态", async () => {
  const { ctx, registered } = makeCtx(
    {},
    { describeError: { GITHUB_TOKEN: new Error("Authorization: Bearer ghp_secret") } },
  );
  await apply(ctx, {});
  const result = await registered[0].execute();
  const serialized = JSON.stringify(result);

  assert.deepEqual(result.token, { configured: false, writable: false });
  assert.ok(!serialized.includes("ghp_secret"));
});

test("manager.list 失败时只报告 unavailable", async () => {
  const { ctx, registered } = makeCtx({}, { listError: new Error("private detail") });
  await apply(ctx, {});
  const result = await registered[0].execute();
  assert.deepEqual(result.connection, { state: "unavailable" });
});

test("缺少必需服务时明确失败", async () => {
  const { ctx } = makeCtx();
  delete ctx.mcpManager;
  await assert.rejects(apply(ctx, {}), /required services are unavailable/);
});

test("seed 失败只记脱敏日志，不阻断注册", async () => {
  const registered = [];
  const registrations = [];
  const warnings = [];
  const ctx = {
    credentials: {
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {
        throw new Error("disk full for ghp_secret");
      },
      resolve: async () => undefined,
    },
    tools: { register: (definition) => registered.push(definition) },
    mcpManager: {
      register: (name, entry) => {
        registrations.push({ name, entry });
        return () => {};
      },
      list: () => [],
    },
    logger: () => ({ info() {}, warn: (...args) => warnings.push(args.join(" ")) }),
    effect: () => {},
  };

  await apply(ctx, {});
  assert.equal(registrations.length, 1);
  assert.equal(registered.length, 1);
  assert.ok(warnings.length >= 1);
  assert.ok(!warnings.join("\n").includes("ghp_secret"));
});

test("同名注册冲突明确抛错且不泄漏原始错误", async () => {
  const { ctx } = makeCtx(
    {},
    { registerError: new Error('server "github" already exists: Bearer ghp_secret') },
  );
  await assert.rejects(apply(ctx, {}), (error) => {
    assert.match(error.message, /already exists/);
    assert.ok(!error.message.includes("ghp_secret"));
    return true;
  });
});
