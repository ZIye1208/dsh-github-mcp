// 纯逻辑单测：node test/config.test.mjs
// （本机沙箱里 `node --test` 会 spawn EPERM，直接跑文件即可。）

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  TOOLSETS,
  credentialDefaults,
  normalizeToolsets,
  parseToolsets,
} from "../lib/config.mjs";

test("parseToolsets 去空、去重、保序", () => {
  assert.deepEqual(parseToolsets("repos, issues ,repos,,actions"), ["repos", "issues", "actions"]);
  assert.deepEqual(parseToolsets(""), []);
  assert.deepEqual(parseToolsets(undefined), []);
});

test("normalizeToolsets 空值回落到缺省", () => {
  assert.equal(normalizeToolsets(""), DEFAULT_CONFIG.toolsets);
  assert.equal(normalizeToolsets("  ,  "), DEFAULT_CONFIG.toolsets);
  assert.equal(normalizeToolsets("repos,issues"), "repos,issues");
  assert.equal(normalizeToolsets("repos, issues, repos"), "repos,issues");
});

test("credentialDefaults 输出类型固定的两个引用", () => {
  assert.deepEqual(credentialDefaults(), {
    GITHUB_MCP_TOOLSETS: "repos,issues",
    GITHUB_MCP_READONLY: "false",
  });
});

test("credentialDefaults 尊重入参", () => {
  assert.deepEqual(credentialDefaults({ toolsets: "repos,pull_requests", readOnly: true }), {
    GITHUB_MCP_TOOLSETS: "repos,pull_requests",
    GITHUB_MCP_READONLY: "true",
  });
});

test("credentialDefaults 对空 toolsets 回落", () => {
  assert.equal(credentialDefaults({ toolsets: " , " }).GITHUB_MCP_TOOLSETS, "repos,issues");
});

test("TOOLSETS 表：11 项、id 唯一、全小写标识符", () => {
  assert.equal(TOOLSETS.length, 11);
  const ids = TOOLSETS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z_]+$/);
});

test("TOOLSETS 覆盖 GitHub 官方工具集", () => {
  const ids = new Set(TOOLSETS.map((item) => item.id));
  for (const expected of [
    "repos",
    "issues",
    "pull_requests",
    "actions",
    "gists",
    "orgs",
    "projects",
    "notifications",
    "users",
    "code_security",
    "dependabot",
  ]) {
    assert.ok(ids.has(expected), `missing toolset ${expected}`);
  }
});
