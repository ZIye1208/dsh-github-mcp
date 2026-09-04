// dsh-github-mcp host half.
//
// What it does:
//  1. Bridges the GitHub token from DSH's credential store (.credentials.yaml)
//     into process.env.GITHUB_TOKEN, BEFORE the mcp-client row's config is
//     loaded. The mcp-client reads `process.env.GITHUB_TOKEN` at startup, and
//     DSH never materializes the credential store into the environment, so this
//     bridge is the only way the credential reaches the mcp-client. The
//     launching environment still wins: if GITHUB_TOKEN is already in the
//     environment we do not override it.
//  2. Registers model tools to view/set the token through the credential center:
//     `github_token_status` (describe) and `github_set_token` (store).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Extract `GITHUB_TOKEN: <value>` from the `refs:` section of the credentials
// YAML WITHOUT a YAML library (keeps the plugin zero-dependency). More robust
// than a single naive regex: scans the refs block only, tolerates arbitrary
// indentation, optional surrounding quotes, and trailing `# comments`.
function extractTokenFromStore(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inRefs = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^refs:\s*$/i.test(trimmed)) { inRefs = true; continue; }
    if (inRefs) {
      // A top-level key (no leading whitespace) ends the refs block.
      if (trimmed !== "" && !/^\s/.test(line) && inRefs) inRefs = false;
      if (!inRefs) continue;
      const m = /^GITHUB_TOKEN:\s*(.+?)\s*$/i.exec(trimmed);
      if (m) {
        let val = m[1].replace(/\s+#.*$/, "").trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) val = val.slice(1, -1);
        return val || null;
      }
    }
    if (!inRefs) continue;
  }
  return null;
}

function bridgeTokenFromStore() {
  // The launching environment wins; never override it.
  if (process.env.GITHUB_TOKEN) return;
  let home = process.env.DSH_HOME;
  if (!home) {
    try { home = join(homedir(), ".dsh"); } catch (e) { return; }
  }
  try {
    const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
    const token = extractTokenFromStore(text);
    if (token) process.env.GITHUB_TOKEN = token;
  } catch (e) {
    // No store / unreadable: leave env as-is; the mcp-client just won't connect.
  }
}
bridgeTokenFromStore();

function apply(ctx) {
  const credentials = ctx.get("credentials");
  const tools = ctx.get("tools");
  if (credentials === undefined || tools === undefined) return;

  // Re-bridge when the stored reference changes (so a later restart picks it up
  // and future resolves see it). The mcp-client header is fixed at startup, so a
  // live change needs a restart to take effect.
  ctx.on("credentials/reference-updated", () => { bridgeTokenFromStore(); });

  tools.register({
    name: "github_token_status",
    description: "查看 GitHub token 是否已在 DSH 凭据中心(.credentials.yaml)配置，提示环境变量遮蔽等问题。无参数。",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "string" }, render: function (_a, v) { return [{ type: "text", text: String(v) }]; } },
    async execute() {
      const envToken = process.env.GITHUB_TOKEN;
      const info = await credentials.describe("GITHUB_TOKEN");
      if (info && info.configured) {
        const src = String(info.source || "凭据中心");
        // Environment-provided tokens are read-only and shadow the credential store.
        if (/^env$/i.test(src) || /environment/i.test(src)) {
          return "GitHub token：已配置（来源：环境变量，只读）。注意：启动环境里的 GITHUB_TOKEN 优先且只读，会遮蔽凭据中心的值，github_set_token 写入会被拒绝。若要改存到凭据中心，请先在启动 DSH 的 shell 里 `unset GITHUB_TOKEN`，再调用 github_set_token。";
        }
        return `GitHub token：已配置（来源：${src}，可写：${info.writable ? "是" : "否"}）。`;
      }
      if (envToken) {
        return "GitHub token：环境变量 GITHUB_TOKEN 已设置（凭据中心未登记）。当前 mcp 使用该 env 值；若要改为凭据中心管理，请先 unset GITHUB_TOKEN，再用 github_set_token 保存。";
      }
      return "GitHub token：未配置。可通过「帮我设置 GitHub token 为 ghp_xxx」或直接编辑 .credentials.yaml 设置。";
    },
  });

  tools.register({
    name: "github_set_token",
    description: "把 GitHub PAT（Personal Access Token）存入 DSH 凭据中心(.credentials.yaml)，供 GitHub MCP 使用。参数 token 为 PAT 值（ghp_ 开头）。",
    parameters: {
      type: "object",
      properties: {
        token: { type: "string", description: "GitHub PAT，ghp_ 开头" }
      },
      required: ["token"]
    },
    output: { schema: { type: "string" }, render: function (_a, v) { return [{ type: "text", text: String(v) }]; } },
    async execute(args) {
      const token = args && args.token;
      if (typeof token !== "string" || token.trim() === "") {
        return "请提供 GitHub PAT。用法：把 GitHub token 设为 ghp_xxxx。";
      }
      try {
        await credentials.set("GITHUB_TOKEN", token.trim());
      } catch (err) {
        return `保存失败：${err && err.message || err}。若 token 来自启动环境变量（优先且只读），会遮蔽凭据中心的值——请先在启动 shell 中 unset GITHUB_TOKEN，再通过本工具保存到凭据中心。`;
      }
      process.env.GITHUB_TOKEN = token.trim();
      return "已把 GitHub token 保存到 DSH 凭据中心(.credentials.yaml)并更新当前环境。重启 DSH 后 mcp-client 即使用该 token（GitHub 工具以 mcp__github__* 出现）。";
    },
  });
}

export default { inject: ["credentials", "tools"], apply };
