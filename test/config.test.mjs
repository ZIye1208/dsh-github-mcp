// 纯逻辑与 Config schema 单测：node test/config.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  TOOLSETS,
  normalizeConfig,
  normalizeReadOnly,
  normalizeServerName,
  normalizeToolsets,
} from "../lib/config.mjs";
import { Config } from "../lib/index.mjs";

test("DEFAULT_CONFIG 使用产品缺省值", () => {
  assert.deepEqual(DEFAULT_CONFIG.toolsets, ["repos", "issues"]);
  assert.equal(DEFAULT_CONFIG.readOnly, false);
  assert.equal(DEFAULT_CONFIG.serverName, "github");
});

test("normalizeToolsets 接受数组与逗号串，去空去重保序", () => {
  assert.deepEqual(normalizeToolsets("repos, issues ,repos,,actions"), ["repos", "issues", "actions"]);
  assert.deepEqual(normalizeToolsets(["repos", " issues ", "repos"]), ["repos", "issues"]);
});

test("normalizeToolsets 拒绝空集合", () => {
  assert.throws(() => normalizeToolsets(""), /TOOLSETS_EMPTY/);
  assert.throws(() => normalizeToolsets([]), /TOOLSETS_EMPTY/);
  assert.throws(() => normalizeToolsets(" , "), /TOOLSETS_EMPTY/);
});

test("normalizeToolsets 拒绝未知工具集", () => {
  assert.throws(() => normalizeToolsets("repos,not-a-toolset"), /TOOLSETS_UNKNOWN:not-a-toolset/);
});

test("normalizeReadOnly 只接受布尔或严格字符串", () => {
  assert.equal(normalizeReadOnly(true), true);
  assert.equal(normalizeReadOnly(false), false);
  assert.equal(normalizeReadOnly("true"), true);
  assert.equal(normalizeReadOnly("false"), false);
  for (const value of [1, 0, "TRUE", "yes", null, undefined]) {
    assert.throws(() => normalizeReadOnly(value), /READONLY_INVALID/);
  }
});

test("normalizeServerName 覆盖 1–32 位边界", () => {
  assert.equal(normalizeServerName("a"), "a");
  assert.equal(normalizeServerName("A_2-b"), "A_2-b");
  assert.equal(normalizeServerName("x".repeat(32)), "x".repeat(32));
  for (const value of ["", "x".repeat(33), "has space", "slash/name", "中文"]) {
    assert.throws(() => normalizeServerName(value), /SERVER_NAME_INVALID/);
  }
});

test("normalizeConfig 返回完整严格配置", () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({ toolsets: "actions,gists", readOnly: "false", serverName: "work-github" }),
    { toolsets: ["actions", "gists"], readOnly: false, serverName: "work-github" },
  );
});

test("TOOLSETS 表：11 项、id 唯一、全小写标识符", () => {
  assert.equal(TOOLSETS.length, 11);
  const ids = TOOLSETS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z_]+$/);
});

test("Config 导出 volatile 引用且缺省值可读", () => {
  const config = Config({});
  assert.equal(typeof config.toolsets.get, "function");
  assert.equal(typeof config.readOnly.get, "function");
  assert.equal(typeof config.serverName.get, "function");
  assert.equal(typeof config.registrationError.get, "function");
  assert.deepEqual(config.toolsets.get(), ["repos", "issues"]);
  assert.equal(config.readOnly.get(), false);
  assert.equal(config.serverName.get(), "github");
  assert.equal(config.registrationError.get(), "");
});

test("Config schema 拒绝非法工具集、readOnly 与 serverName", () => {
  assert.throws(() => Config({ toolsets: [] }));
  assert.throws(() => Config({ toolsets: ["not-a-toolset"] }));
  assert.throws(() => Config({ readOnly: "true" }));
  assert.throws(() => Config({ serverName: "bad name" }));
});
