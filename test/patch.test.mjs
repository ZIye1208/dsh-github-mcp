// patch / manifest 单测：node test/patch.test.mjs
//
// 校验 cordis.patch.yml、发布清单和 0.4.0 Config/Client 契约。
// 只依赖仓库 devDependency，不读取或跳过本机 DSH profile。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

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

const raw = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const patch = YAML.parse(raw);
const host = readFileSync(new URL("../lib/index.mjs", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("patch 只插本插件一行", () => {
  assert.ok(Array.isArray(patch));
  assert.equal(patch.length, 1);
  const insert = patch[0].insert;
  assert.equal(insert.length, 1);
  assert.equal(insert[0].id, "dsh-github-mcp");
  assert.equal(insert[0].name, "dsh-github-mcp");
});

test("连接交给 mcp-manager，patch 里不再有 mcp-client 或动态求值", () => {
  assert.ok(!raw.includes("dsh-mcp-client"), "patch still inserts mcp-client");
  assert.ok(!raw.includes("!!js"), "patch still uses !!js");
  assert.ok(!raw.includes("process.env"), "patch still reads process.env");
});

test("只有 Authorization 使用凭据模板", () => {
  const authorization = "Bearer ${credential:GITHUB_TOKEN}";
  assertTemplateSyntax(authorization, "headers.Authorization");
  assert.deepEqual(credentialRefsIn(authorization), ["GITHUB_TOKEN"]);
  assert.match(host, /Authorization:\s*`Bearer/);
  assert.ok(host.includes("credential:${TOKEN_REF}"));
  assert.ok(host.includes('"X-MCP-Toolsets": current.toolsets.join(",")'));
  assert.ok(host.includes('"X-MCP-Readonly": String(current.readOnly)'));
});

test("不再把工具集与只读模式当作凭据模板", () => {
  assert.ok(!host.includes("${credential:GITHUB_MCP_TOOLSETS}"));
  assert.ok(!host.includes("${credential:GITHUB_MCP_READONLY}"));
});

test("Client 显式注入 Settings 与 API remotes", () => {
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
  ]);
  assert.equal(pkg.dsh.client.platform, "web");
  assert.ok(pkg.files.includes("lib"));
});

test("主包不再安装 hint 可选依赖", () => {
  assert.equal(pkg.optionalDependencies?.["dsh-github-mcp-hint"], undefined);
  assert.equal(pkg.dependencies?.["dsh-github-mcp-hint"], undefined);
});

test("0.4.0 声明 schemastery 与已核验的 DSH/Node 基线", () => {
  assert.equal(pkg.dependencies?.["@deepseek-ai/schemastery"], "~3.19.0");
  assert.equal(pkg.engines.node, ">=24.9.0");
  assert.equal(pkg.engines.dsh, ">=0.2.2-rc.5 <0.2.3-0");
  assert.match(host, /export const Config\s*=\s*Schema\.object\(/);
});

test("package-lock 与清单版本、依赖一致", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.version, "0.4.0");
  assert.equal(lock.packages[""].dependencies?.["@deepseek-ai/schemastery"], "~3.19.0");
  assert.equal(lock.packages[""].engines?.dsh, ">=0.2.2-rc.5 <0.2.3-0");
  assert.equal(lock.packages[""].optionalDependencies?.["dsh-github-mcp-hint"], undefined);
});
