// 设置页操作单测：node test/client-actions.test.mjs
//
// 用一个最小 Hook 运行时驱动真实 Section 组件，覆盖 Settings 原子保存、
// token 清除语义、事件同步、probe、错误脱敏和同步锁。无需浏览器或 React 依赖。

import test from "node:test";
import assert from "node:assert/strict";

let definition;
let storageCalls = 0;
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      definition = def;
    },
  },
  localStorage: {
    getItem() {
      storageCalls += 1;
      throw new Error("localStorage must not be used");
    },
    setItem() {
      storageCalls += 1;
      throw new Error("localStorage must not be used");
    },
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

function checkbox(tree, label) {
  let found = null;
  walk(tree, (node) => {
    if (found || node.type !== "label" || !collect(node.children).includes(label)) return;
    walk(node, (child) => {
      if (child.type === "input" && child.props?.type === "checkbox") found = child;
    });
  });
  return found;
}

function textInput(tree, value) {
  let found = null;
  walk(tree, (node) => {
    if (node.type === "input" && node.props?.type === "text" && node.props?.value === value) found = node;
  });
  return found;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness(options = {}) {
  const states = [];
  const refs = [];
  const effects = [];
  const pendingEffects = [];
  const listeners = new Map();
  const mutateCalls = [];
  const unsetCalls = [];
  const probeCalls = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectsStarted = false;
  let disposed = false;

  let view = {
    ns: "dsh-github-mcp",
    revision: 1,
    value: {
      toolsets: ["repos", "issues"],
      readOnly: true,
      serverName: "github",
      registrationError: options.registrationError ?? "",
    },
  };
  let token = options.token ?? {
    configured: true,
    source: "file",
    writable: true,
    masked: "ghp_1****abcd",
  };
  const writable = options.writable ?? true;

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

  function makeStream(signal) {
    const queue = [];
    let waiter = null;
    let closed = false;
    const stream = {
      signal,
      disposed: false,
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
        if (closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          waiter = resolve;
        });
      },
      push(value) {
        if (closed) return;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve({ value, done: false });
        } else {
          queue.push(value);
        }
      },
      dispose() {
        if (stream.disposed) return;
        stream.disposed = true;
        closed = true;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve({ value: undefined, done: true });
        }
      },
    };
    const initial = [
      { name: view.value.serverName, configured: true, status: { state: "connected", toolCount: 29 } },
      { name: "other-server", configured: true, status: { state: "connected", toolCount: 99 } },
    ];
    if (options.watchGate) {
      void Promise.resolve(options.watchGate).then(() => stream.push(initial));
    } else {
      stream.push(initial);
    }
    return stream;
  }

  let managerStream = null;
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => {
      const dispose = fn();
      effects.push(dispose);
      return dispose;
    },
    slots: {
      inject: (_name, fn) => fn(),
      register: (_options, component) => {
        ctx.Section = component;
        return () => {};
      },
    },
    remote: {
      $on(event, listener) {
        const rows = listeners.get(event) ?? [];
        rows.push(listener);
        listeners.set(event, rows);
        return () => {
          const current = listeners.get(event) ?? [];
          listeners.set(event, current.filter((row) => row !== listener));
        };
      },
      settings: {
        describe: async () => {
          if (options.settingsGate) await options.settingsGate;
          return {
            ok: true,
            value: { writable, hasDocument: true, namespaces: [structuredClone(view)] },
          };
        },
        mutate: async (...args) => {
          mutateCalls.push(args);
          if (options.mutateGate) await options.mutateGate;
          if (options.mutateError) {
            return { ok: false, error: { code: options.mutateError.code, message: options.mutateError.message } };
          }
          const [, ops] = args;
          const nextValue = { ...view.value };
          for (const op of ops) {
            if (op.op === "set" && op.path?.[0] in nextValue) nextValue[op.path[0]] = op.value;
          }
          view = { ...view, revision: view.revision + 1, value: nextValue };
          return { ok: true, value: structuredClone(view) };
        },
      },
      credentials: {
        describe: async () => {
          if (options.tokenGate) await options.tokenGate;
          return { ok: true, value: { GITHUB_TOKEN: structuredClone(token) } };
        },
        set: async (_ref, value) => {
          token = { configured: true, source: "file", writable: true, masked: "saved" };
          return { ok: true, value };
        },
        unset: async (ref) => {
          unsetCalls.push(ref);
          if (options.unsetGate) await options.unsetGate;
          if (options.unsetError) {
            return { ok: false, error: { code: "write-failed", message: options.unsetError } };
          }
          const fallback = options.fallbackSource ?? null;
          token = fallback
            ? { configured: true, source: fallback, writable: true, masked: "env-token" }
            : { configured: false, writable: true };
          return { ok: true };
        },
      },
      mcpManager: {
        watch(signal) {
          if (options.watchError) throw new Error("watch failed");
          managerStream = makeStream(signal);
          return managerStream;
        },
        probe: async (name, signal) => {
          probeCalls.push({ name, signal });
          if (options.probeGate) await options.probeGate;
          if (options.probeError) {
            return {
              ok: true,
              value: {
                ok: false,
                stage: "connect",
                closeConfirmed: false,
                message: options.probeError,
              },
            };
          }
          return {
            ok: true,
            value: {
              ok: true,
              durationMs: 12,
              toolNames: ["repo_one", "repo_two"],
              closeConfirmed: true,
              message: "Authorization: Bearer ghp_secret",
              cleanupError: "ghp_secret",
            },
          };
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
    for (const effect of pendingEffects) {
      const dispose = effect();
      if (typeof dispose === "function") effects.push(dispose);
    }
    await flush();
    return render();
  }

  async function unmount() {
    if (disposed) return;
    disposed = true;
    for (const dispose of effects.splice(0).reverse()) {
      if (typeof dispose === "function") dispose();
    }
    await flush();
  }

  function fire(event, ...args) {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
  }

  return {
    render,
    start,
    unmount,
    fire,
    mutateCalls,
    unsetCalls,
    probeCalls,
    get managerStream() {
      return managerStream;
    },
    setView(next) {
      view = structuredClone(next);
    },
    getView() {
      return structuredClone(view);
    },
    getState() {
      return structuredClone(states[0]);
    },
    setToken(next) {
      token = structuredClone(next);
    },
  };
}

test("首次加载从 Settings view 初始化且完全不读写 localStorage", async () => {
  const before = storageCalls;
  const harness = createHarness();
  const tree = await harness.start();
  const texts = collect(tree);

  assert.equal(harness.getState().status, "ready");
  assert.equal(storageCalls, before);
  assert.equal(harness.mutateCalls.length, 0);
  await harness.unmount();
});

test("Settings 与 token 的并发刷新不会互相作废", async () => {
  const options = {};
  const harness = createHarness(options);
  await harness.start();

  let releaseSettings;
  let releaseToken;
  options.settingsGate = new Promise((resolve) => {
    releaseSettings = resolve;
  });
  options.tokenGate = new Promise((resolve) => {
    releaseToken = resolve;
  });
  const nextView = {
    ns: "dsh-github-mcp",
    revision: 2,
    value: { toolsets: ["actions"], readOnly: false, serverName: "github" },
  };
  harness.setView(nextView);
  harness.setToken({ configured: true, source: "env", writable: true });

  harness.fire("settings/document-updated", "dsh-github-mcp", 2);
  harness.fire("credentials/reference-updated", "GITHUB_TOKEN");
  releaseToken();
  await flush();
  releaseSettings();
  await flush();

  const state = harness.getState();
  assert.deepEqual(state.view.value, nextView.value);
  assert.equal(state.token.source, "env");
  await harness.unmount();
});

test("保存选项只调用一次 settings.mutate，并一次提交三个字段与 revision", async () => {
  const harness = createHarness();
  let tree = await harness.start();

  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();
  checkbox(tree, "readOnlyTitle").props.onChange({ target: { checked: false } });
  tree = harness.render();
  textInput(tree, "github").props.onChange({ target: { value: "github-work" } });
  tree = harness.render();

  const save = button(tree, "saveOptions");
  assert.equal(save.props.disabled, false);
  await save.props.onClick();
  await flush();

  assert.equal(harness.mutateCalls.length, 1);
  const [ns, ops, revision] = harness.mutateCalls[0];
  assert.equal(ns, "dsh-github-mcp");
  assert.equal(revision, 1);
  assert.deepEqual(ops, [
    { op: "set", path: ["toolsets"], value: ["issues"] },
    { op: "set", path: ["readOnly"], value: false },
    { op: "set", path: ["serverName"], value: "github-work" },
  ]);
  assert.equal(harness.getView().revision, 2);
  await harness.unmount();
});

test("首个 watch 快照到达前禁止保存选项", async () => {
  let releaseWatch;
  const watchGate = new Promise((resolve) => {
    releaseWatch = resolve;
  });
  const harness = createHarness({ watchGate });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();

  assert.equal(button(tree, "saveOptions").props.disabled, true);
  releaseWatch();
  await flush();
  tree = harness.render();
  assert.equal(button(tree, "saveOptions").props.disabled, false);
  await harness.unmount();
});

test("Host 同名注册冲突持续显示并禁止保存", async () => {
  const harness = createHarness({ registrationError: "SERVER_NAME_CONFLICT" });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();

  assert.ok(collect(tree).includes("serverNameConflict"));
  assert.equal(button(tree, "saveOptions").props.disabled, true);
  await harness.unmount();
});

test("本插件正常注册项 configured=true 时仍可保存", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();

  assert.equal(button(tree, "saveOptions").props.disabled, false);
  await button(tree, "saveOptions").props.onClick();
  await flush();
  assert.equal(harness.mutateCalls.length, 1);
  await harness.unmount();
});

test("watch 失败时清空旧列表并禁止保存", async () => {
  const harness = createHarness({ watchError: true });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();

  assert.ok(collect(tree).some((text) => text.includes("connectionUnavailable")));
  assert.equal(button(tree, "saveOptions").props.disabled, true);
  await harness.unmount();
});

test("保存前预检 serverName 重名并提示冲突", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  textInput(tree, "github").props.onChange({ target: { value: "other-server" } });
  tree = harness.render();

  await button(tree, "saveOptions").props.onClick();
  await flush();
  tree = harness.render();

  assert.equal(harness.mutateCalls.length, 0);
  assert.ok(collect(tree).includes("serverNameConflict"));
  await harness.unmount();
});

test("retained runtime record configured=false 不阻止重注册", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  textInput(tree, "github").props.onChange({ target: { value: "retained-server" } });
  tree = harness.render();

  harness.managerStream.push([
    { name: "github", configured: true, status: { state: "connected", toolCount: 29 } },
    { name: "retained-server", configured: false, status: { state: "closed", toolCount: 0 } },
  ]);
  await flush();
  tree = harness.render();
  await button(tree, "saveOptions").props.onClick();
  await flush();

  assert.equal(harness.mutateCalls.length, 1);
  assert.equal(harness.mutateCalls[0][1][2].value, "retained-server");
  await harness.unmount();
});

test("revision 冲突时刷新 Settings 并提示，不盲目重放旧草稿", async () => {
  const harness = createHarness({
    mutateError: { code: "settings/conflict", message: "Bearer ghp_secret" },
  });
  harness.setView({
    ns: "dsh-github-mcp",
    revision: 7,
    value: { toolsets: ["pull_requests"], readOnly: false, serverName: "github-alt" },
  });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();
  await button(tree, "saveOptions").props.onClick();
  await flush();
  tree = harness.render();

  const serialized = JSON.stringify(tree);
  assert.ok(collect(tree).includes("settingsConflict"));
  assert.ok(!serialized.includes("ghp_secret"));
  assert.equal(harness.mutateCalls.length, 1);
  assert.ok(textInput(tree, "github-alt"));
  await harness.unmount();
});

test("writable=false 时禁用保存与重置", async () => {
  const harness = createHarness({ writable: false });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();

  assert.equal(button(tree, "saveOptions").props.disabled, true);
  assert.equal(button(tree, "reset").props.disabled, true);
  await harness.unmount();
});

test("清除文件 token 且无 fallback 时显示已清除", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  await button(tree, "clear").props.onClick();
  await flush();
  tree = harness.render();

  assert.ok(collect(tree).includes("cleared"));
  assert.deepEqual(harness.unsetCalls, ["GITHUB_TOKEN"]);
  await harness.unmount();
});

for (const source of ["env", "project-env", "user-env"]) {
  test(`清除后 ${source} fallback 仍生效时显示警告`, async () => {
    const harness = createHarness({ fallbackSource: source });
    let tree = await harness.start();
    await button(tree, "clear").props.onClick();
    await flush();
    tree = harness.render();
    const texts = collect(tree);

    assert.ok(texts.some((text) => text.includes("clearedButFallbackActive")));
    assert.ok(!texts.includes("cleared"));
    await harness.unmount();
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
  await harness.unmount();
});

test("busyRef 同步锁阻止重复清除", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({ unsetGate: gate });
  const tree = await harness.start();
  const clear = button(tree, "clear").props.onClick;

  const first = clear();
  const second = clear();
  assert.equal(harness.unsetCalls.length, 1);
  release();
  await Promise.all([first, second]);
  await harness.unmount();
});

test("busyRef 同步锁阻止重复保存", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({ mutateGate: gate });
  let tree = await harness.start();
  checkbox(tree, "repos").props.onChange({ target: { checked: false } });
  tree = harness.render();
  const save = button(tree, "saveOptions").props.onClick;

  const first = save();
  const second = save();
  assert.equal(harness.mutateCalls.length, 1);
  release();
  await Promise.all([first, second]);
  await harness.unmount();
});

test("测试连接使用 manager probe，只展示白名单结果", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  await button(tree, "testConnection").props.onClick();
  await flush();
  tree = harness.render();

  assert.equal(harness.probeCalls.length, 1);
  assert.equal(harness.probeCalls[0].name, "github");
  assert.ok(harness.probeCalls[0].signal instanceof AbortSignal);
  const serialized = JSON.stringify(tree);
  assert.ok(collect(tree).some((text) => text.includes("probeSuccess")));
  assert.ok(serialized.includes("12 ms"));
  assert.ok(serialized.includes("2 tools"));
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("cleanupError"));
  await harness.unmount();
});

test("probe 失败不显示原始 message", async () => {
  const harness = createHarness({ probeError: "Authorization: Bearer ghp_secret" });
  let tree = await harness.start();
  await button(tree, "testConnection").props.onClick();
  await flush();
  tree = harness.render();

  const serialized = JSON.stringify(tree);
  assert.ok(collect(tree).some((text) => text.includes("probeFailed")));
  assert.ok(!serialized.includes("ghp_secret"));
  assert.ok(!serialized.includes("Authorization"));
  await harness.unmount();
});

test("watch、Settings 事件与凭据事件同步，卸载时清理订阅", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  assert.ok(harness.managerStream);

  harness.managerStream.push([
    { name: "github", status: { state: "connected", toolCount: 41 } },
  ]);
  await flush();
  tree = harness.render();
  assert.ok(collect(tree).some((text) => text.includes("41") && text.includes("toolCountUnit")));

  harness.setView({
    ns: "dsh-github-mcp",
    revision: 3,
    value: { toolsets: ["repos"], readOnly: true, serverName: "github-next" },
  });
  harness.fire("settings/document-updated", "dsh-github-mcp", 3);
  await flush();
  tree = harness.render();
  assert.ok(textInput(tree, "github-next"));

  harness.setToken({ configured: true, source: "env", writable: true, masked: "env-token" });
  harness.fire("credentials/reference-updated", "GITHUB_TOKEN");
  await flush();
  tree = harness.render();
  assert.ok(collect(tree).some((text) => text.includes("sourceEnv")));

  const stream = harness.managerStream;
  await harness.unmount();
  assert.equal(stream.signal.aborted, true);
  assert.equal(stream.disposed, true);
});

test("外部 Settings 更新不覆盖未保存草稿", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  checkbox(tree, "readOnlyTitle").props.onChange({ target: { checked: false } });
  tree = harness.render();
  assert.equal(checkbox(tree, "readOnlyTitle").props.checked, false);

  harness.setView({
    ns: "dsh-github-mcp",
    revision: 4,
    value: { toolsets: ["repos"], readOnly: true, serverName: "github-next" },
  });
  harness.fire("settings/document-updated", "dsh-github-mcp", 4);
  await flush();
  tree = harness.render();

  assert.equal(checkbox(tree, "readOnlyTitle").props.checked, false);
  assert.equal(textInput(tree, "github-next"), null);
  assert.ok(collect(tree).some((text) => text.includes("dirtyHint")));
  await harness.unmount();
});

test("开启只读快捷操作只改草稿，不直接写配置", async () => {
  const harness = createHarness();
  let tree = await harness.start();
  checkbox(tree, "readOnlyTitle").props.onChange({ target: { checked: false } });
  tree = harness.render();
  assert.ok(button(tree, "enableReadOnly"));

  await button(tree, "enableReadOnly").props.onClick();
  tree = harness.render();
  assert.equal(harness.mutateCalls.length, 0);
  assert.equal(checkbox(tree, "readOnlyTitle").props.checked, true);
  await harness.unmount();
});
