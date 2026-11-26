// dsh-github-mcp 的纯逻辑，零第三方依赖，便于单测。
//
// 0.4.0 起非密钥配置由插件 volatile Config 承载：
//   toolsets   —— GitHub MCP 工具集数组
//   readOnly   —— 是否只读
//   serverName —— mcpManager 注册名 / 工具命名空间
//
// GITHUB_TOKEN 仍只存 DSH credentials；模型工具不读取它。

/** 新安装缺省值。已有 0.3.x 用户通过迁移保留旧值。 */
export const DEFAULT_CONFIG = Object.freeze({
  toolsets: Object.freeze(["repos", "issues"]),
  readOnly: false,
  serverName: "github",
});

/** GitHub 远程 MCP 支持的全部工具集（顺序与官方文档一致）。 */
export const TOOLSETS = Object.freeze([
  { id: "repos", label: "仓库", detail: "文件、提交、分支、代码搜索" },
  { id: "issues", label: "Issue", detail: "读写 issue、评论、标签" },
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

const TOOLSET_IDS = new Set(TOOLSETS.map((item) => item.id));
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 严格解析工具集：去空、去重、保序，拒绝空集合与未知值。 */
export function normalizeToolsets(value) {
  const list = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const normalized = [...new Set(list)];
  if (normalized.length === 0) throw new TypeError("TOOLSETS_EMPTY");
  const unknown = normalized.filter((id) => !TOOLSET_IDS.has(id));
  if (unknown.length > 0) throw new TypeError(`TOOLSETS_UNKNOWN:${unknown.join(",")}`);
  return normalized;
}

/** 只读开关只接受布尔或严格的 "true"/"false"。 */
export function normalizeReadOnly(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError("READONLY_INVALID");
}

/** mcp server 名同时是工具命名空间，必须与 mcp-client 的规则一致。 */
export function normalizeServerName(value) {
  const name = String(value ?? "").trim();
  if (!SERVER_NAME_PATTERN.test(name)) throw new TypeError("SERVER_NAME_INVALID");
  return name;
}

/** 迁移与测试共用的严格配置解析。 */
export function normalizeConfig(value = {}) {
  return {
    toolsets: normalizeToolsets(value.toolsets ?? DEFAULT_CONFIG.toolsets),
    readOnly: normalizeReadOnly(value.readOnly ?? DEFAULT_CONFIG.readOnly),
    serverName: normalizeServerName(value.serverName ?? DEFAULT_CONFIG.serverName),
  };
}
