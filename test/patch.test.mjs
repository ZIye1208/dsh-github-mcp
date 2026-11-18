// patch 单测：node test/patch.test.mjs
//
// 校验 cordis.patch.yml 的结构与凭据模板语法。
// 模板规则与 @deepseek-ai/dsh-mcp-client 的 lib/types/templates.js 保持一致
// （TOKEN / TOKEN_EXACT / SUSPECT 三个正则逐字对齐），这样测试不依赖 DSH 安装目录。
//
// YAML 解析器优先从 DSH profile 的 node_modules 借；本机没有就跳过（CI 里装 devDependency 可跑）。

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const PROFILE_NODE_MODULES =
  process.env.DSH_NODE_MODULES ?? "C:/Users/Administrator/.dsh/profiles/desktop/node_modules/";
const profileAvailable = existsSync(PROFILE_NODE_MODULES);

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

if (profileAvailable) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("node:") || specifier.startsWith(".") || specifier.startsWith("file:")) {
        return nextResolve(specifier, context);
      }
      try {
        return nextResolve(entryOf(specifier), context);
      } catch {
        return nextResolve(specifier, context);
      }
    },
  });
}

let YAML = null;
try {
  YAML = (await import("yaml")).default;
} catch {
  YAML = null;
}
const skip = YAML === null ? "no yaml parser available (install devDependency `yaml`)" : false;

const TOKEN = /\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const TOKEN_EXACT = /^\$\{credential:[A-Za-z_][A-Za-z0-9_]*\}$/;
const SUSPECT = /\$\{[^}]*\}/g;

function assertTemplateSyntax(value, where) {
  for (const occurrence of value.matchAll(SUSPECT)) {
    assert.ok(TOKEN_EXACT.test(occurrence[0]), `${where}: "${occurrence[0]}" is not a template token`);
  }
}

function credentialRefsIn(value) {
  return [...value.matchAll(TOKEN)].map((token) => token[1]);
}

const patchUrl = new URL("../cordis.patch.yml", import.meta.url);
const raw = readFileSync(patchUrl, "utf8");
const patch = YAML === null ? null : YAML.parse(raw);

test("patch 只插本插件一行", { skip }, () => {
  assert.ok(Array.isArray(patch));
  assert.equal(patch.length, 1);
  const insert = patch[0].insert;
  assert.equal(insert.length, 1);
  assert.equal(insert[0].id, "dsh-github-mcp");
  assert.equal(insert[0].name, "dsh-github-mcp");
});

test("连接交给 mcp-manager，patch 里不再有 mcp-client 行", () => {
  assert.ok(!raw.includes("dsh-mcp-client"), "patch still inserts mcp-client");
  assert.ok(!raw.includes("!!js"), "patch still uses !!js");
  assert.ok(!raw.includes("process.env"), "patch still reads process.env");
});

test("三个 header 都是合法凭据模板，且引用名正确", () => {
  const host = readFileSync(new URL("../lib/index.mjs", import.meta.url), "utf8");
  const headers = {
    Authorization: "Bearer ${credential:GITHUB_TOKEN}",
    "X-MCP-Toolsets": "${credential:GITHUB_MCP_TOOLSETS}",
    "X-MCP-Readonly": "${credential:GITHUB_MCP_READONLY}",
  };
  for (const [key, value] of Object.entries(headers)) {
    assertTemplateSyntax(value, `headers.${key}`);
    assert.ok(host.includes(value), `lib/index.mjs is missing the ${key} template`);
  }
  assert.deepEqual(credentialRefsIn(headers.Authorization), ["GITHUB_TOKEN"]);
  assert.deepEqual(credentialRefsIn(headers["X-MCP-Toolsets"]), ["GITHUB_MCP_TOOLSETS"]);
  assert.deepEqual(credentialRefsIn(headers["X-MCP-Readonly"]), ["GITHUB_MCP_READONLY"]);
});

test("没有残留的 !!js 求值（token 不再经 process.env）", () => {
  assert.ok(!raw.includes("!!js"), "patch still uses !!js");
  assert.ok(!raw.includes("process.env"), "patch still reads process.env");
});

test("插件清单声明的 client 入口存在", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.deepEqual(pkg.dsh.client.inject, ["@deepseek-ai/dsh-client-ui-settings"]);
  assert.equal(pkg.dsh.client.platform, "web");
  assert.ok(pkg.files.includes("lib"));
});
