// Host half 单测：node test/host.test.mjs
// 全部使用假服务与真实 Schemastery Config，不依赖本机 DSH 安装目录。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { apply, Config, inject } from "../lib/index.mjs";

const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function updateConfig(config, patch) {
  for (const [key, value] of Object.entries(patch)) config[key][VOLATILE_WRITE](value);
}

function makeCtx(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed));
  const registered = [];
  const registrations = [];
  const resolved = [];
  const warnings = [];
  const effects = [];
  const listeners = new Map();
  const edits = [];
  const settingsConfigured = [];
  const servers = options.servers ?? [];
  let disposed = 0;
  let toolDisposed = 0;
  let rawConfig = options.rawConfig ?? {};

  const ctx = {
    credentials: {
      describe: async (ref) => {
        if (options.describeError?.[ref]) throw options.describeError[ref];
        return store.has(ref)
          ? { configured: true, source: options.sources?.[ref] ?? "file", writable: true, masked: "masked-value" }
          : { configured: false, writable: true };
      },
      set: async (ref, value) => {
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
        return () => {
          toolDisposed += 1;
        };
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
      const dispose = fn();
      effects.push(dispose);
      return dispose;
    },
    on(event, listener) {
      const rows = listeners.get(event) ?? [];
      rows.push(listener);
      listeners.set(event, rows);
      return () => {
        const index = rows.indexOf(listener);
        if (index >= 0) rows.splice(index, 1);
      };
    },
    inject(names, callback) {
      if (names.includes("settings")) {
        callback({
          settings: {
            configure(presentation, owner) {
              settingsConfigured.push({ presentation, owner });
              return () => {};
            },
          },
          effect: (fn) => fn(),
        });
      }
    },
    configEditor: {
      async edit(entry, change) {
        if (options.editError) throw options.editError;
        if (options.beforeEdit) await options.beforeEdit();
        const current = ctx.fiber.rawConfig ?? rawConfig;
        const next = change(current, {});
        if (next !== current) {
          rawConfig = next;
          ctx.fiber.rawConfig = next;
          entry.options.config = next;
          edits.push(next);
        }
        return next;
      },
    },
    fiber: {
      rawConfig,
      entry: { options: { config: rawConfig } },
    },
  };

  return {
    ctx,
    config: options.config ?? Config(rawConfig),
    store,
    registered,
    registrations,
    resolved,
    warnings,
    effects,
    edits,
    settingsConfigured,
    get disposed() {
      return disposed;
    },
    get toolDisposed() {
      return toolDisposed;
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

test("inject 明确包含 credentials/tools/mcpManager/configEditor", () => {
  assert.deepEqual(inject, ["credentials", "tools", "mcpManager", "configEditor"]);
});

test("Config 导出存在且选项与隐藏状态字段都是 volatile 引用", () => {
  const config = Config({});
  for (const key of ["toolsets", "readOnly", "serverName", "registrationError"]) {
    assert.equal(typeof config[key].get, "function", `${key} must be volatile`);
  }
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

test("首次注册使用 Config 缺省值，header 只有 token 走凭据模板", async () => {
  const { ctx, config, registrations } = makeCtx();
  await apply(ctx, config);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "github");
  assert.deepEqual(registrations[0].entry, {
    transport: "streamable-http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: {
      Authorization: "Bearer ${credential:GITHUB_TOKEN}",
      "X-MCP-Toolsets": "repos,issues",
      "X-MCP-Readonly": "false",
    },
  });
  assert.equal(Object.hasOwn(registrations[0].entry, "enabled"), false);
});

test("设置页策略使用插件自己的 fiber 注册", async () => {
  const { ctx, config, settingsConfigured } = makeCtx();
  await apply(ctx, config);
  assert.equal(settingsConfigured.length, 1);
  assert.deepEqual(settingsConfigured[0].presentation, { auto: false });
  assert.equal(settingsConfigured[0].owner, ctx.fiber);
});

test("状态工具返回 Config 与本地 token 描述，不 resolve PAT", async () => {
  const { ctx, config, registered, resolved } = makeCtx({ GITHUB_TOKEN: "ghp_secret" });
  await apply(ctx, config);
  const result = await registered[0].execute();

  assert.deepEqual(result, {
    token: { configured: true, source: "file", writable: true },
    toolsets: ["repos", "issues"],
    readOnly: false,
    serverName: "github",
    connection: { state: "not-registered" },
  });
  assert.deepEqual(resolved, []);
  assert.ok(!JSON.stringify(result).includes("ghp_secret"));
  assert.ok(!JSON.stringify(result).includes("masked-value"));
});

test("状态工具使用自定义 serverName 与实时 Config", async () => {
  const { ctx, config, registered } = makeCtx(
    {},
    { config: Config({ toolsets: ["actions"], readOnly: false, serverName: "work" }) },
  );
  await apply(ctx, config);
  const result = await registered[0].execute();
  assert.deepEqual(result.toolsets, ["actions"]);
  assert.equal(result.readOnly, false);
  assert.equal(result.serverName, "work");
});

test("诊断工具不输出其它 server、全局工具或原始错误", async () => {
  const { ctx, config, registered } = makeCtx(
    {},
    {
      servers: [
        { name: "other", status: { state: "connected", lastError: "other-secret" } },
        { name: "github", status: { state: "connected", toolCount: 29, connectedAt: 123, lastError: "ghp_secret" } },
      ],
    },
  );
  await apply(ctx, config);
  const result = await registered[0].execute();
  const serialized = JSON.stringify(result);
  assert.deepEqual(result.connection, { state: "connected", toolCount: 29, connectedAt: 123 });
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("other-secret"));
  assert.ok(!serialized.includes("other"));
});

test("连接状态只保留白名单字段与稳定枚举", async () => {
  const { ctx, config, registered } = makeCtx(
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
  await apply(ctx, config);
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
  const { ctx, config, registered } = makeCtx(
    { GITHUB_TOKEN: "ghp_secret" },
    {
      sources: { GITHUB_TOKEN: "future-source" },
      servers: [{ name: "github", status: { state: "future-state", reason: "future-reason", lastError: "ghp_secret" } }],
    },
  );
  await apply(ctx, config);
  const result = await registered[0].execute();
  assert.equal(Object.hasOwn(result.token, "source"), false);
  assert.deepEqual(result.connection, { state: "unknown" });
  assert.ok(!JSON.stringify(result).includes("future-source"));
  assert.ok(!JSON.stringify(result).includes("future-reason"));
});

test("credentials.describe 失败时只返回未配置状态", async () => {
  const { ctx, config, registered } = makeCtx(
    {},
    { describeError: { GITHUB_TOKEN: new Error("Authorization: Bearer ghp_secret") } },
  );
  await apply(ctx, config);
  const result = await registered[0].execute();
  assert.deepEqual(result.token, { configured: false, writable: false });
  assert.ok(!JSON.stringify(result).includes("ghp_secret"));
});

test("manager.list 失败时只报告 unavailable", async () => {
  const { ctx, config, registered } = makeCtx({}, { listError: new Error("private detail") });
  await apply(ctx, config);
  assert.deepEqual((await registered[0].execute()).connection, { state: "unavailable" });
});

test("缺少必需服务时明确失败", async () => {
  const { ctx, config } = makeCtx();
  delete ctx.mcpManager;
  await assert.rejects(apply(ctx, config), /required services are unavailable/);
});

test("同名注册冲突返回稳定错误码、写入 Settings 状态且不泄漏原始消息", async () => {
  const { ctx, config, registered, warnings, edits } = makeCtx(
    {},
    { registerError: new Error('server "github" already exists: Bearer ghp_secret') },
  );
  await apply(ctx, config);
  await flush();
  const result = await registered[0].execute();
  assert.equal(result.registrationError, "SERVER_NAME_CONFLICT");
  assert.equal(edits.at(-1)?.registrationError, "SERVER_NAME_CONFLICT");
  assert.ok(!JSON.stringify(result).includes("ghp_secret"));
  assert.ok(!warnings.join("\n").includes("ghp_secret"));
});

test("成功注册清除旧冲突状态，registrationError 更新不触发重注册", async () => {
  const harness = makeCtx({}, { rawConfig: { registrationError: "SERVER_NAME_CONFLICT" } });
  await apply(harness.ctx, harness.config);
  await flush();
  assert.equal(harness.edits.at(-1)?.registrationError, "");
  harness.emit("loader/volatile-update", [["registrationError"]]);
  await flush();
  assert.equal(harness.registrations.length, 1);
});

test("插件卸载时停止监听并调用 manager disposer", async () => {
  const harness = makeCtx();
  await apply(harness.ctx, harness.config);
  assert.equal(harness.effects.length, 1);
  assert.equal(typeof harness.effects[0], "function");
  harness.effects[0]();
  assert.equal(harness.disposed, 1);
  assert.equal(harness.toolDisposed, 1);
});

test("volatile-update 触发旧 disposer 与新注册", async () => {
  const harness = makeCtx();
  await apply(harness.ctx, harness.config);
  updateConfig(harness.config, { toolsets: ["actions"], readOnly: false, serverName: "work" });
  harness.emit("loader/volatile-update", [["toolsets"], ["readOnly"], ["serverName"]]);
  await flush();

  assert.equal(harness.disposed, 1);
  assert.equal(harness.registrations.length, 2);
  assert.equal(harness.registrations[1].name, "work");
  assert.equal(harness.registrations[1].entry.headers["X-MCP-Toolsets"], "actions");
  assert.equal(harness.registrations[1].entry.headers["X-MCP-Readonly"], "false");
});

test("快速多次 volatile-update 通过串行队列重注册", async () => {
  const harness = makeCtx();
  await apply(harness.ctx, harness.config);
  updateConfig(harness.config, { toolsets: ["actions"] });
  harness.emit("loader/volatile-update", [["toolsets"]]);
  updateConfig(harness.config, { readOnly: false });
  harness.emit("loader/volatile-update", [["readOnly"]]);
  updateConfig(harness.config, { serverName: "work" });
  harness.emit("loader/volatile-update", [["serverName"]]);
  await flush();

  assert.equal(harness.registrations.length, 4);
  assert.equal(harness.disposed, 3);
  assert.equal(harness.registrations[3].name, "work");
  assert.equal(harness.registrations[3].entry.headers["X-MCP-Toolsets"], "actions");
  assert.equal(harness.registrations[3].entry.headers["X-MCP-Readonly"], "false");
});

test("迁移旧凭据到 Config，但不 unset 旧引用", async () => {
  const { ctx, config, edits, resolved, store } = makeCtx({
    GITHUB_MCP_TOOLSETS: "pull_requests,actions",
    GITHUB_MCP_READONLY: "false",
  });
  await apply(ctx, config);
  await flush();

  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], { toolsets: ["pull_requests", "actions"], readOnly: false });
  assert.deepEqual(resolved, ["GITHUB_MCP_TOOLSETS", "GITHUB_MCP_READONLY"]);
  assert.equal(store.has("GITHUB_MCP_TOOLSETS"), true);
  assert.equal(store.has("GITHUB_MCP_READONLY"), true);
});

test("已有 Config 字段优先于旧凭据", async () => {
  const rawConfig = { toolsets: ["gists"], readOnly: true };
  const { ctx, config, edits } = makeCtx(
    { GITHUB_MCP_TOOLSETS: "actions", GITHUB_MCP_READONLY: "false" },
    { rawConfig },
  );
  await apply(ctx, config);
  await flush();
  assert.equal(edits.length, 0);
});

test("迁移等待期间用户写入 Config 时，以最新值为准", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = makeCtx(
    { GITHUB_MCP_TOOLSETS: "actions", GITHUB_MCP_READONLY: "false" },
    { rawConfig: {}, beforeEdit: () => gate },
  );
  await apply(harness.ctx, harness.config);
  await flush();

  const latest = { toolsets: ["gists"], readOnly: true };
  harness.ctx.fiber.rawConfig = latest;
  harness.ctx.fiber.entry.options.config = latest;
  release();
  await flush();

  assert.deepEqual(harness.ctx.fiber.rawConfig, latest);
  assert.deepEqual(harness.edits, []);
});

test("非法旧值忽略并记录脱敏警告", async () => {
  const { ctx, config, edits, warnings } = makeCtx({
    GITHUB_MCP_TOOLSETS: "not-a-toolset",
    GITHUB_MCP_READONLY: "yes",
  });
  await apply(ctx, config);
  await flush();
  assert.equal(edits.length, 0);
  assert.ok(warnings.length >= 1);
  assert.ok(!warnings.join("\n").includes("not-a-toolset"));
});

test("部分旧值非法时仍迁移合法字段", async () => {
  const { ctx, config, edits, warnings } = makeCtx({
    GITHUB_MCP_TOOLSETS: "actions",
    GITHUB_MCP_READONLY: "yes",
  });
  await apply(ctx, config);
  await flush();
  assert.deepEqual(edits, [{ toolsets: ["actions"] }]);
  assert.ok(warnings.length >= 1);
  assert.ok(!warnings.join("\n").includes("yes"));
});

test("迁移写盘失败不阻断初始连接", async () => {
  const { ctx, config, registrations, warnings } = makeCtx(
    { GITHUB_MCP_TOOLSETS: "actions", GITHUB_MCP_READONLY: "true" },
    { editError: new Error("disk full for ghp_secret") },
  );
  await apply(ctx, config);
  await flush();
  assert.equal(registrations.length, 1);
  assert.ok(warnings.length >= 1);
  assert.ok(!warnings.join("\n").includes("ghp_secret"));
});

test("新安装没有旧凭据时不写 Config", async () => {
  const { ctx, config, edits } = makeCtx();
  await apply(ctx, config);
  await flush();
  assert.equal(edits.length, 0);
});

test("诊断工具完全不发网络请求", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network must not be used");
  };
  try {
    const { ctx, config, registered } = makeCtx({ GITHUB_TOKEN: "ghp_secret" });
    await apply(ctx, config);
    await registered[0].execute();
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
