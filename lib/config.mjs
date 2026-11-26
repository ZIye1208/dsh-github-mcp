// dsh-github-mcp 的纯逻辑，零依赖，便于单测。
//
// 配置的运行时载体是「凭据中心的三个引用」：
//   GITHUB_TOKEN          —— PAT（用户填）
//   GITHUB_MCP_TOOLSETS   —— 逗号分隔的工具集（设置页写，缺省由本插件补 repos,issues）
//   GITHUB_MCP_READONLY   —— "true" / "false"（同上）
//
// 为什么走凭据中心而不是插件 config：mcp-client 展开 ${credential:REF} 时向
// 凭据服务取当前值，并监听 credentials/reference-updated 自动重连 —— 改设置页
// 即生效，不需要重启，也不需要第三方插件额外维护一套写盘/重载逻辑。

/** mcp-client 那一行在 profile patch 里的 id。 */
export const MCP_ROW_ID = "mcp-github";

/** 插件 config 的缺省值；只在对应引用尚未存在时用它补一次。 */
export const DEFAULT_CONFIG = Object.freeze({
  toolsets: "repos,issues",
  readOnly: false,
});

/** GitHub 远程 MCP 支持的全部工具集（顺序与官方文档一致）。 */
export const TOOLSETS = Object.freeze([
  { id: "repos", label: "仓库", detail: "文件、提交、分支、搜索（19 个工具）" },
  { id: "issues", label: "Issue", detail: "读写 issue、评论、标签（10 个工具）" },
  { id: "pull_requests", label: "Pull Request", detail: "PR、评审、合并" },
  { id: "actions", label: "Actions", detail: "工作流运行与日志" },
  { id: "gists", label: "Gist", detail: "创建与查看 gist" },
  { id: "orgs", label: "组织", detail: "组织与成员信息" },
  { id: "projects", label: "项目", detail: "Projects v2 与字段" },
  { id: "notifications", label: "通知", detail: "列出与标记通知" },
  { id: "users", label: "用户", detail: "用户资料与关注" },
  { id: "code_security", label: "代码安全", detail: "Code scanning、Dependabot 告警" },
  { id: "dependabot", label: "Dependabot", detail: "依赖更新告警" },
]);

/** toolsets 字符串 → 去空去重的数组。 */
export function parseToolsets(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item, index, all) => all.indexOf(item) === index);
}

/** 把 user 勾选/输入的工具集规整成 GitHub 认的逗号串；至少保留一项。 */
export function normalizeToolsets(value) {
  const parsed = parseToolsets(value);
  if (parsed.length === 0) return DEFAULT_CONFIG.toolsets;
  return parsed.join(",");
}

/** 配置 → 需要写进凭据中心的引用（仅用于补缺省，不覆盖用户设置）。 */
export function credentialDefaults(config = {}) {
  return {
    GITHUB_MCP_TOOLSETS: normalizeToolsets(config.toolsets ?? DEFAULT_CONFIG.toolsets),
    GITHUB_MCP_READONLY: String((config.readOnly ?? DEFAULT_CONFIG.readOnly) === true),
  };
}
