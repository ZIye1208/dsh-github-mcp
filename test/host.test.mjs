// host half 单测：node test/host.test.mjs
//
// 把 @deepseek-ai/* 的裸导入解析到 desktop profile 的 node_modules
// （工作区里没有 node_modules，也不该有）。没有 DSH 安装时整组跳过——
// config/client 的逻辑测试不依赖它。

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const PROFILE_NODE_MODULES =
  process.env.DSH_NODE_MODULES ?? "C:/Users/Administrator/.dsh/profiles/desktop/node_modules/";
const available = existsSync(PROFILE_NODE_MODULES);
const skip = available ? false : "no DSH installation to resolve @deepseek-ai/* from";

function entryOf(specifier) {
  const dir = PROFILE_NODE_MODULES + specifier + "/";
  const pkg = JSON.parse(readFileSync(dir + "package.json", "utf8"));
  const exported = pkg.exports;
  let rel;
  if (typeof exported === "string") rel = exported;
  else if (exported && typeof exported === "object") {
    const dot = exported["."];
    if (typeof dot === "string") rel = dot;
    else if (dot && typeof dot === "object") rel = dot.import ?? dot.default ?? dot.require;
    else if (exported.import || exported.default) rel = exported.import ?? exported.default;
  }
  rel ??= pkg.module ?? pkg.main ?? "index.js";
  return pathToFileURL(dir + rel).href;
}

if (available) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@deepseek-ai/")) return nextResolve(entryOf(specifier), context);
      return nextResolve(specifier, context);
    },
  });
}

const plugin = available ? (await import("../lib/index.mjs")).default : null;

function makeCtx(seed = {}) {
  const store = new Map(Object.entries(seed));
  const registered = [];
  const ctx = {
    credentials: {
      describe: async (ref) =>
        store.has(ref)
          ? { configured: true, source: "file", writable: true, masked: "masked-value" }
          : { configured: false, writable: true },
      set: async (ref, value) => {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`empty value for ${ref}`);
        }
        store.set(ref, value);
      },
      unset: async (ref) => {
        store.delete(ref);
      },
      resolve: async (ref) => (store.has(ref) ? { value: store.get(ref), source: "file" } : undefined),
    },
    tools: {
      register(definition) {
        registered.push(definition);
      },
    },
    logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
    // 假 ctx 不提供 mcp-manager：registerServer 应降级为一条 warn 而不是抛错。
    get: () => undefined,
    effect: () => {},
  };
  return { ctx, store, registered };
}

test("首次运行补齐两个缺省引用，token 不碰", { skip }, async () => {
  const { ctx, store } = makeCtx();
  await plugin.apply(ctx, {});

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "repos,issues");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "false");
  assert.equal(store.has("GITHUB_TOKEN"), false);
});

test("已有引用不被覆盖（设置页优先）", { skip }, async () => {
  const { ctx, store } = makeCtx({
    GITHUB_MCP_TOOLSETS: "pull_requests,actions",
    GITHUB_MCP_READONLY: "true",
  });
  await plugin.apply(ctx, {});

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "pull_requests,actions");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "true");
});

test("插件 config 只在引用缺失时作为缺省值", { skip }, async () => {
  const { ctx, store } = makeCtx();
  await plugin.apply(ctx, { toolsets: "repos, issues, actions", readOnly: true });

  assert.equal(store.get("GITHUB_MCP_TOOLSETS"), "repos,issues,actions");
  assert.equal(store.get("GITHUB_MCP_READONLY"), "true");
});

test("注册且只注册 github_token_status", { skip }, async () => {
  const { ctx, registered } = makeCtx();
  await plugin.apply(ctx, {});

  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "github_token_status");
  assert.equal(typeof registered[0].execute, "function");
});

test("诊断工具在未配置 token 时给出配置指引", { skip }, async () => {
  const { ctx, registered } = makeCtx();
  await plugin.apply(ctx, {});
  const text = await registered[0].execute();

  assert.match(text, /GitHub token：未配置/);
  assert.match(text, /工具集：repos, issues/);
  assert.match(text, /只读模式：关/);
});

test("诊断工具报告已配置的 token 掩码与工具集", { skip }, async () => {
  const { ctx, registered } = makeCtx({
    GITHUB_TOKEN: "ghp_secret",
    GITHUB_MCP_TOOLSETS: "repos,pull_requests",
    GITHUB_MCP_READONLY: "true",
  });
  await plugin.apply(ctx, {});
  const text = await registered[0].execute();

  assert.match(text, /GitHub token：已配置/);
  assert.ok(!text.includes("ghp_secret"), "plaintext token leaked into diagnostic output");
  assert.match(text, /工具集：repos, pull_requests/);
  assert.match(text, /只读模式：开/);
});

test("凭据服务缺失时 apply 不抛错", { skip }, async () => {
  const registered = [];
  const ctx = {
    credentials: undefined,
    tools: { register: (d) => registered.push(d) },
    logger: () => ({}),
    get: () => undefined,
    effect: () => {},
  };
  await plugin.apply(ctx, {});
  assert.equal(registered.length, 0);
});

test("seed 失败只记日志，不阻断工具注册", { skip }, async () => {
  const registered = [];
  const warnings = [];
  const ctx = {
    credentials: {
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {
        throw new Error("disk full");
      },
      resolve: async () => undefined,
    },
    tools: { register: (d) => registered.push(d) },
    logger: () => ({ info() {}, warn: (...args) => warnings.push(args.join(" ")) }),
    get: () => undefined,
    effect: () => {},
  };
  await plugin.apply(ctx, {});
  assert.equal(registered.length, 1);
  assert.ok(warnings.length >= 1);
});
