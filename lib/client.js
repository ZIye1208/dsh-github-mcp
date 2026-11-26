// dsh-github-mcp client half：设置 → GitHub MCP。
//
// 全部经官方已有的凭据 RPC（ctx.remote.credentials.*），不自定义 RPC、不写 profile：
//   - 填 / 换 / 清 GitHub PAT
//   - 勾选 GitHub MCP 工具集（决定哪些工具进入模型上下文）
//   - 只读开关
//
// 交互约定（v0.3.2）：
//   - 勾选 / 切换只改本地草稿，点「保存」才写凭据中心；
//   - 保存后回读 describe 确认写入，并把「写入时间 + 实际写入值」写在状态行，
//     不再让用户自己去会话里猜有没有生效。
//
// 一个已知限制：credentials.describe 对短值一律全掩，所以「当前工具集/只读」
// 读不回来。权威值始终是 .credentials.yaml；localStorage 只缓存「上次保存成功」的快照，
// 用于计算 dirty 与回显。

window.__ModuleLoader__.load({
  id: 'dsh-github-mcp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-github-mcp';
    const TOKEN_REF = 'GITHUB_TOKEN';
    const TOOLSETS_REF = 'GITHUB_MCP_TOOLSETS';
    const READONLY_REF = 'GITHUB_MCP_READONLY';
    const REFS = [TOKEN_REF, TOOLSETS_REF, READONLY_REF];
    const STORE_TOOLSETS = 'dsh-github-mcp/toolsets';
    const STORE_READONLY = 'dsh-github-mcp/readonly';
    const STORE_SAVED_AT = 'dsh-github-mcp/savedAt';
    const DEFAULT_TOOLSETS = ['repos', 'issues'];

    // count = 2026-11-18 对 api.githubcopilot.com/mcp/ 逐组单独请求（X-MCP-Toolsets: 单值）实测。
    // 各组相加（63）大于全量（46），因为部分工具会同时出现在多个组里；
    // repos(19)+issues(10)=29 正好等于这两组组合后的总数，说明这两组不重叠。
    const TOOLSETS = [
      { id: 'repos', count: 19, detail: '文件、提交、分支、代码搜索' },
      { id: 'issues', count: 10, detail: 'issue、评论、标签' },
      { id: 'pull_requests', count: 10, detail: 'PR、评审、合并' },
      { id: 'actions', count: 4, detail: '工作流运行与日志' },
      { id: 'gists', count: 4, detail: 'gist 读写' },
      { id: 'orgs', count: 1, detail: '组织与成员' },
      { id: 'projects', count: 3, detail: 'Projects v2' },
      { id: 'notifications', count: 6, detail: '通知' },
      { id: 'users', count: 1, detail: '用户资料' },
      { id: 'code_security', count: 2, detail: '代码扫描告警' },
      { id: 'dependabot', count: 3, detail: '依赖更新告警' },
    ];

    const style = {
      section: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 18, color: 'var(--dsw-alias-label-primary)' },
      heading: { margin: 0, fontSize: 18, fontWeight: 600 },
      intro: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '20px' },
      group: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      groupTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
      hint: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '18px' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      input: { flex: '1 1 240px', minWidth: 180, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      count: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', flexShrink: 0 },
      button: { padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
      primary: { borderColor: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 },
      grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' },
      check: {
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        fontSize: 13,
        cursor: 'pointer',
        flexWrap: 'nowrap',
        minWidth: 0,
      },
      name: {
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      checkDetail: {
        fontSize: 12,
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: '1 1 0',
        minWidth: 0,
      },
      error: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      ok: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' },
      dirty: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #b26a00)' },
      warning: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #b26a00)' },
    };

    const zh = {
      nav: 'GitHub MCP',
      title: 'GitHub MCP',
      intro: '这里保存的值直接写入 DSH 凭据中心（.credentials.yaml）。改完连接会自动重连，不需要重启。',
      tokenTitle: 'Personal Access Token',
      tokenHint: '需要 repo 权限；只读场景建议配只读 fine-grained token。',
      tokenPlaceholder: 'ghp_… 或 github_pat_…',
      configured: '已配置',
      unset: '未配置',
      sourceFile: '来自凭据中心',
      sourceEnv: '来自启动环境变量（保存后改用凭据中心）',
      sourceProjectEnv: '来自项目 .env（保存后改用凭据中心）',
      sourceUserEnv: '来自用户 .env（保存后改用凭据中心）',
      sourceUnknown: '来源未知',
      save: '保存',
      clear: '清除',
      cleared: '已清除',
      clearedButFallbackActive: '已删除凭据文件中的值，但环境变量仍生效；删除对应环境变量并重启 DSH 后才会完全失效。',
      tokenClearFailed: '清除失败：凭据文件仍显示已配置。',
      failed: '操作失败，请重试。',
      tokenSaveFailed: 'Token 保存失败，请重试。',
      optionsSaveFailed: '连接选项保存失败，请重试。',
      loadFailed: '读取设置失败，请重试。',
      tokenSaved: '✓ 已写入凭据中心',
      toolsetsTitle: '工具集',
      toolsetsHint: 'GitHub MCP 服务端按此裁剪下发的工具；没勾选的不进入模型上下文。勾选后需点「保存设置」才生效。',
      optionsTitle: '连接选项',
      optionsHint: '工具集与只读模式共用一次保存：写入后 mcp-client 会自动重连。',
      checkedGroupsLabel: '已勾选',
      groupsUnit: '组',
      toolsCountUnit: '个工具',
      groupsSumNote: '各组数字是单独请求该组时下发的工具数；跨组重复的工具会去重，所以相加可能大于总数。',
      optionsSaved: '✓ 已保存',
      savedToolsetsLabel: '工具集',
      savedReadOnlyLabel: '只读',
      readOnlyOn: '开',
      readOnlyOff: '关',
      lastSavedLabel: '上次保存',
      dirtyHint: '有未保存的改动',
      saveOptions: '保存设置',
      reset: '还原',
      readOnlyTitle: '只读模式',
      readOnlyHint: '开启后 GitHub 侧禁用写入类工具（X-MCP-Readonly: true）。',
      loading: '读取中…',
      retry: '重试',
    };

    const en = {
      nav: 'GitHub MCP',
      title: 'GitHub MCP',
      intro: 'Values saved here go into the DSH credential store (.credentials.yaml). The connection reconnects on save — no restart needed.',
      tokenTitle: 'Personal Access Token',
      tokenHint: 'Needs repo scope; use a read-only fine-grained token with read-only mode.',
      tokenPlaceholder: 'ghp_… or github_pat_…',
      configured: 'configured',
      unset: 'not configured',
      sourceFile: 'from the credential store',
      sourceEnv: 'from the launch environment (saving switches to the credential store)',
      sourceProjectEnv: 'from project .env (saving switches to the credential store)',
      sourceUserEnv: 'from user .env (saving switches to the credential store)',
      sourceUnknown: 'unknown source',
      save: 'Save',
      clear: 'Clear',
      cleared: 'Cleared',
      clearedButFallbackActive: 'The credential-file value was removed, but an environment variable is still active. Remove it and restart DSH to fully clear the token.',
      tokenClearFailed: 'Clear failed: the credential file still reports a configured token.',
      failed: 'Operation failed. Please try again.',
      tokenSaveFailed: 'Failed to save the token. Please try again.',
      optionsSaveFailed: 'Failed to save connection options. Please try again.',
      loadFailed: 'Failed to read settings. Please try again.',
      tokenSaved: '✓ Saved to the credential store',
      toolsetsTitle: 'Toolsets',
      toolsetsHint: 'The GitHub MCP server trims its tool list by these; unchecked toolsets never reach the model context. Changes apply after you press Save.',
      optionsTitle: 'Connection options',
      optionsHint: 'Toolsets and read-only mode are saved together; the connection reconnects automatically.',
      checkedGroupsLabel: 'checked',
      groupsUnit: 'groups',
      toolsCountUnit: 'tools',
      groupsSumNote: 'Each count is what that single toolset returns on its own; tools shared across groups are de-duplicated, so the sum can exceed the total.',
      optionsSaved: '✓ Saved',
      savedToolsetsLabel: 'toolsets',
      savedReadOnlyLabel: 'read-only',
      readOnlyOn: 'on',
      readOnlyOff: 'off',
      lastSavedLabel: 'last saved',
      dirtyHint: 'Unsaved changes',
      saveOptions: 'Save settings',
      reset: 'Reset',
      readOnlyTitle: 'Read-only mode',
      readOnlyHint: 'Disables write tools on the GitHub side (X-MCP-Readonly: true).',
      loading: 'Loading…',
      retry: 'Retry',
    };

    function parseToolsets(value) {
      return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    function readStore(key, fallback) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    }

    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // 缓存写不进去不影响正确性：凭据中心才是权威值。
      }
    }

    function sameSet(a, b) {
      return a.length === b.length && a.every((item, index) => item === b[index]);
    }

    function formatTime(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
      } catch {
        return String(iso);
      }
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-github-mcp: dictionaries');

      async function call(promise) {
        const response = await promise;
        if (response === undefined || response === null) throw remoteError('EMPTY_RESPONSE');
        if (response.ok !== true) throw remoteError(response.error?.code ?? 'REMOTE_ERROR');
        return response.value;
      }

      function remoteError(code) {
        const error = new Error(code);
        error.code = code;
        return error;
      }

      function toNotice(error) {
        const key =
          error?.code === 'TOKEN_NOT_CONFIGURED'
            ? 'tokenSaveFailed'
            : error?.code === 'OPTIONS_NOT_CONFIGURED'
              ? 'optionsSaveFailed'
              : 'failed';
        return { kind: 'error', text: t(key) };
      }

      function formatCredentialSource(source) {
        const key = {
          file: 'sourceFile',
          env: 'sourceEnv',
          'project-env': 'sourceProjectEnv',
          'user-env': 'sourceUserEnv',
        }[String(source)];
        return t(key ?? 'sourceUnknown');
      }

      function Section() {
        const [state, setState] = React.useState({ status: 'loading', error: null, data: null });
        const [draft, setDraft] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const busyRef = React.useRef(false);
        const reloadGenerationRef = React.useRef(0);

        // 上次「保存成功」的快照：dirty 与回显都基于它。
        const [savedToolsets, setSavedToolsets] = React.useState(() =>
          parseToolsets(readStore(STORE_TOOLSETS, DEFAULT_TOOLSETS.join(','))),
        );
        const [savedReadOnly, setSavedReadOnly] = React.useState(
          () => readStore(STORE_READONLY, 'false') === 'true',
        );
        const [savedAt, setSavedAt] = React.useState(() => readStore(STORE_SAVED_AT, ''));

        // 草稿：勾选只改这里。
        const [draftToolsets, setDraftToolsets] = React.useState(savedToolsets);
        const [draftReadOnly, setDraftReadOnly] = React.useState(savedReadOnly);

        const reload = React.useCallback(async () => {
          const generation = ++reloadGenerationRef.current;
          try {
            const data = await call(ctx.remote.credentials.describe(REFS));
            if (generation === reloadGenerationRef.current) {
              setState({ status: 'ready', error: null, data: data ?? {} });
            }
            return data ?? {};
          } catch (error) {
            if (generation === reloadGenerationRef.current) {
              setState({ status: 'error', error: t('loadFailed'), data: null });
            }
            throw error;
          }
        }, []);

        React.useEffect(() => {
          reload().catch(() => {});
        }, []);

        const optionsDirty =
          !sameSet(draftToolsets, savedToolsets) || draftReadOnly !== savedReadOnly;

        async function saveToken() {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          const value = draft.trim();
          try {
            await call(ctx.remote.credentials.set(TOKEN_REF, value));
            // 回读：describe 确认真的写进去了，而不是只看 RPC 返回 ok。
            const data = await reload();
            const info = data?.[TOKEN_REF];
            if (!info || info.configured !== true) {
              throw remoteError('TOKEN_NOT_CONFIGED');
            }
            const at = new Date().toISOString();
            setNotice({
              kind: 'ok',
              text: `${t('tokenSaved')}${info.masked ? `（${info.masked}）` : ''} · ${formatTime(at)}`,
            });
            setDraft('');
          } catch (error) {
            setNotice(toNotice(error));
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }

        async function clearToken() {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          try {
            await call(ctx.remote.credentials.unset(TOKEN_REF));
            const data = await reload();
            const info = data?.[TOKEN_REF];
            if (info?.configured && info.source !== 'file') {
              setNotice({
                kind: 'warning',
                text: `${t('clearedButFallbackActive')} ${formatCredentialSource(info.source)}`,
              });
            } else if (info?.configured) {
              setNotice({ kind: 'error', text: t('tokenClearFailed') });
            } else {
              setNotice({ kind: 'ok', text: t('cleared') });
            }
          } catch (error) {
            setNotice(toNotice(error));
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }

        async function saveOptions() {
          if (busyRef.current || draftToolsets.length === 0) return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          const toolsets = [...draftToolsets];
          const readOnly = draftReadOnly;
          try {
            await call(ctx.remote.credentials.set(TOOLSETS_REF, toolsets.join(',')));
            await call(ctx.remote.credentials.set(READONLY_REF, String(readOnly)));

            // 回读两项都必须是「已配置」，否则说明写入没落盘。
            const data = await reload();
            const missing = [TOOLSETS_REF, READONLY_REF].filter(
              (ref) => data?.[ref]?.configured !== true,
            );
            if (missing.length > 0) {
              throw remoteError('OPTIONS_NOT_CONFIGURED');
            }

            const at = new Date().toISOString();
            setSavedToolsets(toolsets);
            setSavedReadOnly(readOnly);
            setSavedAt(at);
            writeStore(STORE_TOOLSETS, toolsets.join(','));
            writeStore(STORE_READONLY, String(readOnly));
            writeStore(STORE_SAVED_AT, at);
            setNotice({
              kind: 'ok',
              text: `${t('optionsSaved')} · ${t('savedToolsetsLabel')} ${toolsets.join(',')} · ${t('savedReadOnlyLabel')} ${
                readOnly ? t('readOnlyOn') : t('readOnlyOff')
              } · ${formatTime(at)}`,
            });
          } catch (error) {
            setNotice(toNotice(error));
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }

        function resetOptions() {
          setDraftToolsets(savedToolsets);
          setDraftReadOnly(savedReadOnly);
          setNotice(null);
        }

        function toggleToolset(id) {
          const next = draftToolsets.includes(id)
            ? draftToolsets.filter((item) => item !== id)
            : [...draftToolsets, id];
          if (next.length === 0) return;
          setDraftToolsets(next);
        }

        if (state.status === 'loading') {
          return h('section', { style: style.section }, h('p', { style: style.hint }, t('loading')));
        }
        if (state.status === 'error') {
          return h(
            'section',
            { style: style.section },
            h('h2', { style: style.heading }, t('title')),
            h('p', { style: style.error }, state.error),
            h('button', { type: 'button', style: style.button, onClick: () => reload().catch(() => {}) }, t('retry')),
          );
        }

        const token = state.data?.[TOKEN_REF];
        const tokenStatus =
          !token || token.configured !== true
            ? t('unset')
            : `${t('configured')}${token.masked ? ` (${token.masked})` : ''} · ${formatCredentialSource(token.source)}`;

        return h(
          'section',
          { style: style.section },
          h('h2', { style: style.heading }, t('title')),
          h('p', { style: style.intro }, t('intro')),

          // —— Token ——
          h(
            'div',
            { style: style.group },
            h('h3', { style: style.groupTitle }, t('tokenTitle')),
            h('p', { style: style.hint }, [h('span', { key: 'status' }, tokenStatus), ' · ', t('tokenHint')]),
            h(
              'div',
              { style: style.row },
              h('input', {
                type: 'password',
                autoComplete: 'off',
                spellCheck: false,
                placeholder: t('tokenPlaceholder'),
                value: draft,
                style: style.input,
                onChange: (event) => setDraft(event.target.value),
              }),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || draft.trim().length === 0,
                  style: { ...style.button, ...style.primary },
                  onClick: saveToken,
                },
                t('save'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || !token || token.configured !== true,
                  style: style.button,
                  onClick: clearToken,
                },
                t('clear'),
              ),
            ),
          ),

          // —— 连接选项：工具集 + 只读，一次保存 ——
          h(
            'div',
            { style: style.group },
            h('h3', { style: style.groupTitle }, t('optionsTitle')),
            h(
              'p',
              { style: style.hint },
              `${t('toolsetsHint')}${
                savedAt ? ` · ${t('lastSavedLabel')} ${formatTime(savedAt)}` : ''
              }`,
            ),
            h(
              'div',
              { style: style.grid },
              TOOLSETS.map((item) =>
                h(
                  'label',
                  { key: item.id, style: style.check },
                  h('input', {
                    type: 'checkbox',
                    checked: draftToolsets.includes(item.id),
                    disabled: busy,
                    onChange: () => toggleToolset(item.id),
                  }),
                  h(
                    'span',
                    { style: style.name },
                    h('span', { style: style.mono }, item.id),
                    h('span', { style: style.count }, `${item.count} ${t('toolsCountUnit')}`),
                  ),
                  h('span', { style: style.checkDetail, title: item.detail }, item.detail),
                ),
              ),
            ),
            h(
              'p',
              { style: style.hint },
              `${t('optionsHint')} ${t('checkedGroupsLabel')} ${draftToolsets.length} ${t('groupsUnit')}。`,
            ),
            h('p', { style: style.hint }, t('groupsSumNote')),
            h(
              'label',
              { style: style.check },
              h('input', {
                type: 'checkbox',
                checked: draftReadOnly,
                disabled: busy,
                onChange: () => setDraftReadOnly(!draftReadOnly),
              }),
              h('span', null, t('readOnlyTitle')),
              h('span', { style: style.checkDetail }, t('readOnlyHint')),
            ),
            optionsDirty
              ? h('p', { style: style.dirty }, t('dirtyHint'))
              : null,
            h(
              'div',
              { style: style.row },
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || !optionsDirty || draftToolsets.length === 0,
                  style: { ...style.button, ...style.primary },
                  onClick: saveOptions,
                },
                t('saveOptions'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || !optionsDirty,
                  style: style.button,
                  onClick: resetOptions,
                },
                t('reset'),
              ),
            ),
          ),

          notice === null
            ? null
            : h('p', {
                style: notice.kind === 'ok' ? style.ok : notice.kind === 'warning' ? style.warning : style.error,
              }, notice.text),
        );
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'github-mcp',
            order: 16,
            label: () => t('nav'),
            locale: NS,
          },
          Section,
        ),
      );
    }

    return { inject: ['slots', 'locale', 'remote', 'remote.credentials'], apply };
  },
});
