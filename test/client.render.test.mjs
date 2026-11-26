// client half 的渲染分支单测：node test/client.render.test.mjs
//
// 用假的 createElement 把组件渲染成一棵普通对象树（不依赖真 React），
// 覆盖 ready 态：标题、token 状态行、11 个工具集复选框、只读开关、两个按钮。

import test from "node:test";
import assert from "node:assert/strict";

function collect(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (typeof node === "object" && node.children !== undefined) {
    collect(node.children, out);
  }
  return out;
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== "object") return;
  visit(node);
  if (node.children !== undefined) walk(node.children, visit);
}

test("ready 态能渲染出完整设置表单", async () => {
  let definition;
  globalThis.window = {
    __ModuleLoader__: { load(def) { definition = def; } },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };

  let stateIndex = 0;
  const readyState = {
    status: "ready",
    error: null,
    data: {
      GITHUB_TOKEN: { configured: true, source: "file", writable: true, masked: "ghp_1****abcd" },
      GITHUB_MCP_TOOLSETS: { configured: true, source: "file", writable: true },
      GITHUB_MCP_READONLY: { configured: true, source: "file", writable: true },
    },
  };

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const index = stateIndex++;
      const value = index === 0 ? readyState : typeof initial === "function" ? initial() : initial;
      return [value, () => {}];
    },
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  };

  const require = (name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require("${name}")`);
  };

  await import("../lib/client.js");
  const exports = definition.factory(require);

  const registered = [];
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        registered.push({ options, component });
        return () => {};
      },
    },
  };

  exports.apply(ctx);
  const Section = registered[0].component;

  stateIndex = 0;
  const tree = Section();
  const texts = collect(tree);

  // t() 在测试里被 stub 成「原样返回 key」，所以断言的是 locale key。
  assert.ok(texts.includes("title"), "missing title");
  assert.ok(texts.includes("tokenTitle"), "missing token title");
  assert.ok(texts.includes("optionsTitle"), "missing connection options title");
  assert.ok(texts.includes("readOnlyTitle"), "missing read-only title");
  assert.ok(texts.includes("save"), "missing token save button");
  assert.ok(texts.includes("clear"), "missing token clear button");
  assert.ok(texts.includes("saveOptions"), "missing save-options button");
  assert.ok(texts.includes("reset"), "missing reset button");
  // 初始态草稿与已保存一致，不应出现「未保存改动」提示。
  assert.ok(!texts.includes("dirtyHint"), "unsaved hint should be hidden when nothing changed");
  assert.ok(
    texts.some((text) => text.includes("ghp_1****abcd")),
    "masked token not rendered",
  );
  // 每个工具集都要显示该组工具数，且与名字同处一行（nowrap）。
  for (const count of [19, 10, 10, 4, 4, 1, 3, 6, 1, 2, 3]) {
    assert.ok(
      texts.some((text) => text.trim() === `${count} tools` || text.trim() === `${count} toolsCountUnit`),
      `missing tool count for a toolset (${count})`,
    );
  }

  const checkboxes = [];
  walk(tree, (node) => {
    if (node.type === "input" && node.props?.type === "checkbox") checkboxes.push(node);
  });
  assert.equal(checkboxes.length, 12, "expected 11 toolset checkboxes + 1 read-only switch");
});
