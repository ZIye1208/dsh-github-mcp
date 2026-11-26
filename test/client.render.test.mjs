// client half 的渲染分支单测：node test/client.render.test.mjs
// 用假的 createElement 把组件渲染成一棵普通对象树（不依赖真 React）。

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
  if (typeof node === "object" && node.children !== undefined) collect(node.children, out);
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

test("ready 态从 Settings view 渲染完整设置表单", async () => {
  let definition;
  globalThis.window = {
    __ModuleLoader__: { load(def) { definition = def; } },
  };

  const readyState = {
    status: "ready",
    view: {
      ns: "dsh-github-mcp",
      revision: "rev-1",
      value: { toolsets: ["repos", "issues"], readOnly: false, serverName: "github" },
    },
    token: { configured: true, source: "file", writable: true, masked: "ghp_1****abcd" },
    writable: true,
    error: null,
  };
  const values = [
    readyState,
    "",
    ["repos", "issues"],
    false,
    "github",
    false,
    null,
    { state: "connected", toolCount: 29 },
    true,
    null,
  ];
  let stateIndex = 0;

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = stateIndex++;
      return [index in values ? values[index] : typeof initial === "function" ? initial() : initial, () => {}];
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
  let dictionary = null;
  exports.apply({
    locale: {
      bind: () => (key) => dictionary?.[key] ?? key,
      register: (_ns, table) => {
        dictionary = table.zh;
        return () => {};
      },
    },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        registered.push({ options, component });
        return () => {};
      },
    },
  });

  stateIndex = 0;
  const tree = registered[0].component();
  const texts = collect(tree);

  assert.ok(texts.includes("GitHub MCP"));
  assert.ok(texts.includes("Personal Access Token"));
  assert.ok(texts.includes("连接选项"));
  assert.ok(texts.includes("只读模式"));
  assert.ok(texts.includes("保存设置"));
  assert.ok(texts.includes("还原"));
  assert.ok(texts.includes("测试连接"));
  assert.ok(texts.includes("工具命名空间（高级）"));
  assert.ok(texts.some((text) => text.includes("一般无需修改")));
  assert.ok(texts.includes("已连接 · 29 个工具"));
  assert.ok(!texts.some((text) => text.includes("connected") || text.includes("29 tools")), "raw connection state must not render");
  assert.ok(!texts.some((text) => text.includes("ghp_1****abcd")), "masked token must not be rendered");
  assert.ok(!texts.includes("有未保存的改动"));

  const checkboxes = [];
  let serverNameInput = null;
  let namespaceDetails = null;
  let connectionHeader = null;
  walk(tree, (node) => {
    if (node.type === "input" && node.props?.type === "checkbox") checkboxes.push(node);
    if (node.type === "input" && node.props?.type === "text" && node.props?.value === "github") serverNameInput = node;
    if (node.type === "details" && collect(node).includes("工具命名空间（高级）")) namespaceDetails = node;
    if (node.type === "div" && node.props?.style?.justifyContent === "flex-start") {
      const headerText = collect(node);
      if (headerText.includes("连接选项") && headerText.includes("已连接 · 29 个工具")) connectionHeader = node;
    }
  });
  assert.ok(connectionHeader, "connection status must share the Connection options header row");
  assert.equal(checkboxes.length, 12, "expected 11 toolset checkboxes + 1 read-only switch");
  assert.equal(checkboxes.at(-1).props.checked, false, "new installs must not default to read-only");
  assert.ok(serverNameInput, "missing serverName input");
  assert.equal(serverNameInput.props.style.width, 240);
  assert.ok(namespaceDetails, "missing advanced namespace disclosure");
  assert.notEqual(namespaceDetails.props.open, true, "advanced namespace must start collapsed");
});
