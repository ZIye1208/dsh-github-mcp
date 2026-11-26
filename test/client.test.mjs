// client half 的结构单测：node test/client.test.mjs
//
// 不渲染 React，只验证模块契约：
//   - window.__ModuleLoader__.load 被调用、id 正确
//   - exports.inject 含 slots/locale
//   - apply 往 settings.section 注册了一个分区（id/order/label/locale）
//
// 真正的渲染验证需要浏览器环境，见 README「验证」一节。

import test from "node:test";
import assert from "node:assert/strict";

test("client bundle 的模块契约", async () => {
  let definition;
  globalThis.window = {
    __ModuleLoader__: {
      load(def) {
        definition = def;
      },
    },
  };

  const React = {
    createElement: () => null,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  };

  const require = (name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require("${name}")`);
  };

  await import("../lib/client.js");

  assert.ok(definition, "window.__ModuleLoader__.load was not called");
  assert.equal(definition.id, "dsh-github-mcp");
  assert.equal(typeof definition.factory, "function");

  const exports = definition.factory(require);
  assert.deepEqual(exports.inject, ["slots", "locale", "remote", "remote.credentials"]);
  assert.equal(typeof exports.apply, "function");

  const seen = { inject: null, registered: [], effects: 0 };
  const ctx = {
    locale: {
      bind: () => (key) => `T:${key}`,
      register: () => () => {},
    },
    effect: (fn) => {
      seen.effects += 1;
      const dispose = fn();
      assert.equal(typeof dispose, "function");
    },
    slots: {
      inject: (name, fn) => {
        seen.inject = name;
        fn();
      },
      register: (options, component) => {
        seen.registered.push({ options, component });
        return () => {};
      },
    },
  };

  exports.apply(ctx);

  assert.equal(seen.effects, 1, "expected one locale effect");
  assert.equal(seen.inject, "settings.section");
  assert.equal(seen.registered.length, 1);

  const { options, component } = seen.registered[0];
  assert.equal(options.name, "settings.section");
  assert.equal(options.id, "github-mcp");
  assert.equal(options.order, 16);
  assert.equal(options.locale, "dsh-github-mcp");
  assert.equal(typeof options.label, "function");
  assert.equal(options.label(), "T:nav");
  assert.equal(typeof component, "function");
});
