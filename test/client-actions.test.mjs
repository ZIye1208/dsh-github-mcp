// 设置页操作单测：node test/client-actions.test.mjs
//
// 用一个最小 Hook 运行时驱动真实 Section 组件，覆盖 0.3.2 的清除语义、
// 错误脱敏和同步锁。无需浏览器或 React 依赖。

import test from "node:test";
import assert from "node:assert/strict";

let definition;
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      definition = def;
    },
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
};
await import("../lib/client.js");

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

function button(tree, label) {
  let found = null;
  walk(tree, (node) => {
    if (node.type === "button" && collect(node.children).includes(label)) found = node;
  });
  return found;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness({ source = "file", unsetError = null, unsetGate = null } = {}) {
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectsStarted = false;
  const pendingEffects = [];
  let unsetCalls = 0;

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] = typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      if (!effectsStarted) pendingEffects.push(fn);
    },
  };

  const require = (name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require("${name}")`);
  };

  let fileConfigured = true;
  const data = () => ({
    GITHUB_TOKEN:
      fileConfigured || source
        ? {
            configured: true,
            source: fileConfigured ? "file" : source,
            writable: true,
            masked: "ghp_1****abcd",
          }
        : { configured: false, writable: true },
    GITHUB_MCP_TOOLSETS: { configured: true, source: "file", writable: true },
    GITHUB_MCP_READONLY: { configured: true, source: "file", writable: true },
  });

  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (_options, component) => {
        ctx.Section = component;
        return () => {};
      },
    },
    remote: {
      credentials: {
        describe: async () => ({ ok: true, value: data() }),
        unset: async () => {
          unsetCalls += 1;
          if (unsetGate) await unsetGate;
          if (unsetError) return { ok: false, error: { message: unsetError } };
          fileConfigured = false;
          return { ok: true };
        },
      },
    },
  };

  const exports = definition.factory(require);
  exports.apply(ctx);

  function render() {
    stateIndex = 0;
    refIndex = 0;
    return ctx.Section();
  }

  async function start() {
    render();
    effectsStarted = true;
    for (const effect of pendingEffects) effect();
    await flush();
    return render();
  }

  return { render, start, get unsetCalls() { return unsetCalls; } };
}

test("清除文件 token 且无 fallback 时显示已清除", async () => {
  const harness = createHarness({ source: null });
  let tree = await harness.start();
  await button(tree, "clear").props.onClick();
  await flush();
  tree = harness.render();

  assert.ok(collect(tree).includes("cleared"));
  assert.equal(harness.unsetCalls, 1);
});

for (const source of ["env", "project-env", "user-env"]) {
  test(`清除后 ${source} fallback 仍生效时显示警告`, async () => {
    const harness = createHarness({ source });
    let tree = await harness.start();
    await button(tree, "clear").props.onClick();
    await flush();
    tree = harness.render();
    const texts = collect(tree);

    assert.ok(texts.some((text) => text.includes("clearedButFallbackActive")));
    assert.ok(!texts.includes("cleared"));
  });
}

test("远端错误消息不会回显到 UI", async () => {
  const harness = createHarness({ unsetError: "Authorization: Bearer ghp_secret" });
  let tree = await harness.start();
  await button(tree, "clear").props.onClick();
  await flush();
  tree = harness.render();
  const serialized = JSON.stringify(tree);

  assert.ok(collect(tree).includes("failed"));
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("Authorization"));
});

test("busyRef 同步锁阻止重复清除", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({ source: null, unsetGate: gate });
  const tree = await harness.start();
  const clear = button(tree, "clear").props.onClick;

  const first = clear();
  const second = clear();
  assert.equal(harness.unsetCalls, 1);
  release();
  await Promise.all([first, second]);
});
