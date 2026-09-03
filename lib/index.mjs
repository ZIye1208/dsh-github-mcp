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

function bridgeTokenFromStore() {
  // The launching environment wins; never override it.
  if (process.env.GITHUB_TOKEN) return;
  let home = process.env.DSH_HOME;
  if (!home) {
    try { home = join(homedir(), ".dsh"); } catch (e) { return; }
  }
  try {
    const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
    // Extract a single-line `  GITHUB_TOKEN: <value>` inside the refs section.
    const m = /^\s{2}GITHUB_TOKEN:\s*(.+?)\s*$/m.exec(text);
    if (m) process.env.GITHUB_TOKEN = m[1].replace(/^["']|["']$/g, "");
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
    description: "查看 GitHub token 是否已在 DSH 凭据中心(.credentials.yaml)配置。无参数。",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "string" }, render: function (_a, v) { return [{ type: "text", text: String(v) }]; } },
    async execute() {
      const info = await credentials.describe("GITHUB_TOKEN");
      if (info && info.configured) {
        return `GitHub token：已配置（来源：${info.source || "凭据中心"}，可写：${info.writable ? "是" : "否"}）。`;
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
        return `保存失败：${err && err.message || err}。若 token 来自启动环境变量，需先在启动 shell 中 unset GITHUB_TOKEN，再通过本工具保存到凭据中心。`;
      }
      process.env.GITHUB_TOKEN = token.trim();
      return "已把 GitHub token 保存到 DSH 凭据中心(.credentials.yaml)并更新当前环境。重启 DSH 后 mcp-client 即使用该 token（GitHub 工具以 mcp__github__* 出现）。";
    },
  });
}

export default { inject: ["credentials", "tools"], apply };
