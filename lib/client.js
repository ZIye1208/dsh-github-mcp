// dsh-github-mcp client half：设置 → GitHub MCP。
//
// 0.4.0：
//   - PAT 只经 credentials RPC 写入，不写 localStorage，不回显掩码。
//   - toolsets/readOnly/serverName 的权威值来自 Settings view。
//   - 三个字段通过一次 settings.mutate 原子保存，并携带 expectedRevision。
//   - 连接诊断来自 mcpManager.watch；用户主动 probe 使用公共 manager API。

window.__ModuleLoader__.load({
  id: 'dsh-github-mcp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-github-mcp';
    const TOKEN_REF = 'GITHUB_TOKEN';
    const DEFAULT_TOOLSETS = ['repos', 'issues'];
    const TOOLSET_IDS = new Set([
      'repos',
      'issues',
      'pull_requests',
      'actions',
      'gists',
      'orgs',
      'projects',
      'notifications',
      'users',
      'code_security',
      'dependabot',
    ]);
    const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
    const CONNECTION_STATES = new Set([
      'connecting',
      'connected',
      'waiting-credentials',
      'reconnecting',
      'closed',
      'failed',
      'unknown',
      'not-registered',
      'unavailable',
    ]);

    const TOOLSETS = [
      { id: 'repos', detail: '文件、提交、分支、代码搜索' },
      { id: 'issues', detail: 'issue、评论、标签' },
      { id: 'pull_requests', detail: 'PR、评审、合并' },
      { id: 'actions', detail: '工作流运行与日志' },
      { id: 'gists', detail: 'gist 读写' },
      { id: 'orgs', detail: '组织与成员' },
      { id: 'projects', detail: 'Projects v2' },
      { id: 'notifications', detail: '通知' },
      { id: 'users', detail: '用户资料' },
      { id: 'code_security', detail: '代码扫描告警' },
      { id: 'dependabot', detail: '依赖更新告警' },
    ];

    const style = {
      section: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 18, color: 'var(--dsw-alias-label-primary)' },
      heading: { margin: 0, fontSize: 18, fontWeight: 600 },
      intro: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '20px' },
      group: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      groupTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
      groupHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' },
      hint: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '18px' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      input: { flex: '1 1 240px', minWidth: 180, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      serverNameInput: { width: 240, maxWidth: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      advanced: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', paddingTop: 10 },
      advancedSummary: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      advancedBody: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      button: { padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
      primary: { borderColor: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 },
      grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' },
      check: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, cursor: 'pointer', flexWrap: 'nowrap', minWidth: 0 },
      name: { display: 'flex', gap: 6, alignItems: 'baseline', whiteSpace: 'nowrap', flexShrink: 0 },
      checkDetail: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 0', minWidth: 0 },
      error: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      ok: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' },
      dirty: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #b26a00)' },
      warning: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #b26a00)' },
      status: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
    };

    const zh = {
      nav: 'GitHub MCP',
      title: 'GitHub MCP',
      intro: 'PAT 写入 DSH 凭据中心；工具集、只读与 serverName 由 Settings 保存。修改后自动重连，不需要重启 DSH。',
      tokenTitle: 'Personal Access Token',
      tokenHint: '只读场景建议使用最小权限 fine-grained token，并开启只读模式。',
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
      tokenSaved: '已写入凭据中心',
      toolsetsTitle: '工具集',
      toolsetsHint: 'GitHub MCP 服务端按此裁剪下发的工具；没勾选的不进入模型上下文。勾选后需点「保存设置」才生效。',
      optionsTitle: '连接选项',
      optionsHint: '工具集、只读与 serverName 一次保存；写入后 Host 会串行重注册。',
      optionsSaved: '已保存',
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
      readOnlyRisk: '当前允许写操作。X-MCP-Readonly 不替代 PAT 的最小权限授权。',
      enableReadOnly: '开启只读',
      serverNameTitle: '工具命名空间（高级）',
      serverNameHint: '一般无需修改。仅在连接名冲突或需要多个 GitHub MCP 实例时调整；修改后工具前缀变为 mcp__<serverName>__*，需新开会话。',
      serverNameInvalid: '请输入 1–32 位字母、数字、下划线或连字符。',
      serverNameConflict: '该工具命名空间已被其它 MCP server 占用，请换一个名字。',
      testConnection: '测试连接',
      testing: '测试中…',
      probeSuccess: '连接成功',
      probeFailed: '连接测试失败',
      probeConnectFailed: '连接阶段失败',
      probeListFailed: '工具列表阶段失败',
      probeCleanupWarning: '独立探测连接未确认完全关闭，请稍后重试。',
      connectionConnected: '已连接',
      connectionConnecting: '连接中',
      connectionWaitingCredentials: '等待凭据',
      connectionReconnecting: '重连中',
      connectionClosed: '已关闭',
      connectionFailed: '连接失败',
      connectionNotRegistered: '未注册',
      connectionUnavailable: '状态不可用',
      connectionUnknown: '状态未知',
      toolCountUnit: '个工具',
      settingsConflict: '设置已在其它页面修改。已刷新，请确认后再保存。',
      settingsReadOnly: '当前 profile 不允许写入设置。',
      settingsNamespaceMissing: '设置服务尚未注册本插件，请重试。',
      loading: '读取中…',
      retry: '重试',
    };

    const en = {
      nav: 'GitHub MCP',
      title: 'GitHub MCP',
      intro: 'The PAT goes to DSH credentials; toolsets, read-only mode and serverName are saved through Settings. Changes reconnect automatically without restarting DSH.',
      tokenTitle: 'Personal Access Token',
      tokenHint: 'For read-only use, prefer a least-privilege fine-grained token and enable read-only mode.',
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
      tokenSaved: 'Saved to the credential store',
      toolsetsTitle: 'Toolsets',
      toolsetsHint: 'The GitHub MCP server trims its tool list by these; unchecked toolsets never reach the model context. Changes apply after you press Save.',
      optionsTitle: 'Connection options',
      optionsHint: 'Toolsets, read-only mode and serverName are saved together; the Host then re-registers the server serially.',
      optionsSaved: 'Saved',
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
      readOnlyRisk: 'Write operations are allowed. X-MCP-Readonly does not replace least-privilege PAT authorization.',
      enableReadOnly: 'Enable read-only',
      serverNameTitle: 'Tool namespace (advanced)',
      serverNameHint: 'Usually leave this unchanged. Adjust it only for a name conflict or multiple GitHub MCP instances; the tool prefix becomes mcp__<serverName>__* and requires a new session.',
      serverNameInvalid: 'Use 1–32 letters, digits, underscores or hyphens.',
      serverNameConflict: 'This tool namespace is already used by another MCP server. Choose another name.',
      testConnection: 'Test connection',
      testing: 'Testing…',
      probeSuccess: 'Connection succeeded',
      probeFailed: 'Connection test failed',
      probeConnectFailed: 'Connection stage failed',
      probeListFailed: 'Tool-list stage failed',
      probeCleanupWarning: 'The independent probe transport was not confirmed closed. Try again later.',
      connectionConnected: 'connected',
      connectionConnecting: 'connecting',
      connectionWaitingCredentials: 'waiting for credentials',
      connectionReconnecting: 'reconnecting',
      connectionClosed: 'closed',
      connectionFailed: 'connection failed',
      connectionNotRegistered: 'not registered',
      connectionUnavailable: 'status unavailable',
      connectionUnknown: 'unknown state',
      toolCountUnit: 'tools',
      settingsConflict: 'Settings changed in another page. Refreshed; review before saving again.',
      settingsReadOnly: 'This profile does not allow settings writes.',
      settingsNamespaceMissing: 'Settings has not registered this plugin yet. Please retry.',
      loading: 'Loading…',
      retry: 'Retry',
    };

    function normalizeToolsets(value) {
      const list = Array.isArray(value)
        ? value.map((item) => String(item).trim()).filter(Boolean)
        : String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      const normalized = [...new Set(list)];
      if (normalized.length === 0) throw new Error('TOOLSETS_EMPTY');
      const unknown = normalized.filter((id) => !TOOLSET_IDS.has(id));
      if (unknown.length > 0) throw new Error(`TOOLSETS_UNKNOWN:${unknown.join(',')}`);
      return normalized;
    }

    function sameSet(a, b) {
      return a.length === b.length && a.every((item) => b.includes(item));
    }

    function formatTime(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
      } catch {
        return '';
      }
    }

    function sanitizeConnection(status) {
      if (!CONNECTION_STATES.has(status?.state)) return { state: 'unknown' };
      const result = { state: status.state };
      for (const key of ['toolCount', 'connectedAt']) {
        if (Number.isFinite(status[key])) result[key] = status[key];
      }
      return result;
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

      function isSettingsConflict(error) {
        return error?.code === 'settings/conflict' || error?.code === 'SETTINGS_CONFLICT';
      }

      function toNotice(error) {
        const key =
          error?.code === 'TOKEN_NOT_CONFIGURED'
            ? 'tokenSaveFailed'
            : error?.code === 'OPTIONS_NOT_CONFIGURED'
              ? 'optionsSaveFailed'
              : error?.code === 'SETTINGS_NAMESPACE_MISSING'
                ? 'settingsNamespaceMissing'
                : error?.code === 'SETTINGS_READ_ONLY'
                  ? 'settingsReadOnly'
                  : 'failed';
        return { kind: 'error', text: t(key) };
      }

      function findServerNameConflict(servers, target, current, registrationError) {
        const existing = servers.find((row) => row.name === target);
        if (existing?.configured === true && target !== current) return true;
        return registrationError === 'SERVER_NAME_CONFLICT' && target === current;
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
        const [state, setState] = React.useState({ status: 'loading', view: null, token: null, writable: true, error: null });
        const [draft, setDraft] = React.useState('');
        const [draftToolsets, setDraftToolsets] = React.useState([]);
        const [draftReadOnly, setDraftReadOnly] = React.useState(false);
        const [draftServerName, setDraftServerName] = React.useState('github');
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [connection, setConnection] = React.useState({ state: 'not-registered' });
        const [serversReady, setServersReady] = React.useState(false);
        const [lastSavedAt, setLastSavedAt] = React.useState(null);
        const busyRef = React.useRef(false);
        const settingsGenerationRef = React.useRef(0);
        const tokenGenerationRef = React.useRef(0);
        const activeRef = React.useRef(true);
        const serverNameRef = React.useRef('github');
        const registrationErrorRef = React.useRef('');
        const serversRef = React.useRef([]);
        const serversReadyRef = React.useRef(false);
        const watchFailedRef = React.useRef(false);
        const optionsDirtyRef = React.useRef(false);
        const probeControllerRef = React.useRef(null);

        function syncConnection() {
          if (watchFailedRef.current) {
            setConnection({ state: 'unavailable' });
            return;
          }
          const server = serversRef.current.find((row) => row.name === serverNameRef.current);
          setConnection(server ? sanitizeConnection(server.status) : { state: 'not-registered' });
        }

        function applyView(view, syncDraft = true) {
          serverNameRef.current = view.value.serverName;
          registrationErrorRef.current = view.value.registrationError ?? '';
          setState((previous) => ({ ...previous, status: 'ready', view, error: null }));
          if (syncDraft) {
            setDraftToolsets([...view.value.toolsets]);
            setDraftReadOnly(view.value.readOnly);
            setDraftServerName(view.value.serverName);
          }
        }

        const reloadSettings = React.useCallback(async (syncDraft = true) => {
          const generation = ++settingsGenerationRef.current;
          const described = await call(ctx.remote.settings.describe());
          const view = described.namespaces.find((row) => row.ns === NS);
          if (!view) throw remoteError('SETTINGS_NAMESPACE_MISSING');
          if (generation === settingsGenerationRef.current && activeRef.current) {
            setState((previous) => ({ ...previous, status: 'ready', view, writable: described.writable === true, error: null }));
            if (syncDraft) applyView(view, true);
            syncConnection();
          }
          return view;
        }, []);

        const reloadToken = React.useCallback(async () => {
          const generation = ++tokenGenerationRef.current;
          const data = await call(ctx.remote.credentials.describe([TOKEN_REF]));
          if (generation === tokenGenerationRef.current && activeRef.current) {
            setState((previous) => ({ ...previous, token: data?.[TOKEN_REF] ?? { configured: false, writable: true } }));
          }
          return data?.[TOKEN_REF];
        }, []);

        const reloadAll = React.useCallback(async () => {
          try {
            await reloadSettings(true);
            await reloadToken();
          } catch (error) {
            if (activeRef.current) {
              setState({ status: 'error', view: null, token: null, writable: false, error: t('loadFailed') });
            }
            throw error;
          }
        }, []);

        React.useEffect(() => {
          activeRef.current = true;
          void reloadAll().catch(() => {});

          const stopSettings = ctx.remote.$on?.('settings/document-updated', (ns) => {
            if (ns === NS) void reloadSettings(!optionsDirtyRef.current).catch(() => {});
          });
          const stopCredentials = ctx.remote.$on?.('credentials/reference-updated', (ref) => {
            if (ref === TOKEN_REF) void reloadToken().catch(() => {});
          });

          const controller = new AbortController();
          let stream;
          try {
            stream = ctx.remote.mcpManager.watch(controller.signal);
            void (async () => {
              for await (const servers of stream) {
                if (!activeRef.current) return;
                serversRef.current = servers;
                serversReadyRef.current = true;
                watchFailedRef.current = false;
                setServersReady(true);
                syncConnection();
              }
              if (activeRef.current) {
                serversRef.current = [];
                serversReadyRef.current = false;
                watchFailedRef.current = true;
                setServersReady(false);
                setConnection({ state: 'unavailable' });
              }
            })().catch(() => {
              if (activeRef.current) {
                serversRef.current = [];
                serversReadyRef.current = false;
                watchFailedRef.current = true;
                setServersReady(false);
                setConnection({ state: 'unavailable' });
              }
            });
          } catch {
            serversRef.current = [];
            serversReadyRef.current = false;
            watchFailedRef.current = true;
            setServersReady(false);
            setConnection({ state: 'unavailable' });
          }

          return () => {
            activeRef.current = false;
            serversReadyRef.current = false;
            watchFailedRef.current = false;
            settingsGenerationRef.current += 1;
            tokenGenerationRef.current += 1;
            controller.abort();
            stream?.dispose?.();
            stopSettings?.();
            stopCredentials?.();
            probeControllerRef.current?.abort();
          };
        }, []);

        const optionsDirty =
          state.view !== null &&
          (!sameSet(draftToolsets, state.view.value.toolsets) ||
            draftReadOnly !== state.view.value.readOnly ||
            draftServerName !== state.view.value.serverName);
        optionsDirtyRef.current = optionsDirty;
        const serverNameChanged = state.view !== null && draftServerName !== state.view.value.serverName;

        async function saveToken() {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          const value = draft.trim();
          try {
            await call(ctx.remote.credentials.set(TOKEN_REF, value));
            const info = await reloadToken();
            if (!info || info.configured !== true) throw remoteError('TOKEN_NOT_CONFIGURED');
            setNotice({ kind: 'ok', text: `${t('tokenSaved')} · ${formatTime(new Date().toISOString())}` });
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
            const info = await reloadToken();
            if (info?.configured && info.source !== 'file') {
              setNotice({ kind: 'warning', text: `${t('clearedButFallbackActive')} ${formatCredentialSource(info.source)}` });
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
          if (
            busyRef.current ||
            !state.view ||
            state.writable !== true ||
            draftToolsets.length === 0 ||
            !serversReadyRef.current
          ) return;
          const targetServerName = draftServerName;
          const serverNameConflict = findServerNameConflict(
            serversRef.current,
            targetServerName,
            state.view.value.serverName,
            registrationErrorRef.current,
          );
          if (serverNameConflict) {
            setNotice({ kind: 'error', text: t('serverNameConflict') });
            return;
          }
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          try {
            const toolsets = normalizeToolsets(draftToolsets);
            if (!SERVER_NAME_PATTERN.test(draftServerName)) throw remoteError('SERVER_NAME_INVALID');
            const next = await call(
              ctx.remote.settings.mutate(
                NS,
                [
                  { op: 'set', path: ['toolsets'], value: toolsets },
                  { op: 'set', path: ['readOnly'], value: draftReadOnly === true },
                  { op: 'set', path: ['serverName'], value: draftServerName },
                ],
                state.view.revision,
              ),
            );
            applyView(next, true);
            const at = new Date().toISOString();
            setLastSavedAt(at);
            setNotice({
              kind: 'ok',
              text: `${t('optionsSaved')} · ${t('savedToolsetsLabel')} ${toolsets.join(',')} · ${t('savedReadOnlyLabel')} ${
                draftReadOnly ? t('readOnlyOn') : t('readOnlyOff')
              } · ${formatTime(at)}${serverNameChanged ? ` · ${t('serverNameHint')}` : ''}`,
            });
          } catch (error) {
            if (isSettingsConflict(error)) {
              setNotice({ kind: 'warning', text: t('settingsConflict') });
              await reloadSettings(true).catch(() => {});
            } else if (error?.code === 'SERVER_NAME_INVALID') {
              setNotice({ kind: 'warning', text: t('serverNameInvalid') });
            } else {
              setNotice(toNotice(error));
            }
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }

        function resetOptions() {
          if (!state.view) return;
          setDraftToolsets([...state.view.value.toolsets]);
          setDraftReadOnly(state.view.value.readOnly);
          setDraftServerName(state.view.value.serverName);
          setNotice(null);
        }

        function toggleToolset(id) {
          const next = draftToolsets.includes(id)
            ? draftToolsets.filter((item) => item !== id)
            : [...draftToolsets, id];
          if (next.length > 0) setDraftToolsets(next);
        }

        async function testConnection() {
          if (busyRef.current || !state.view) return;
          busyRef.current = true;
          setBusy(true);
          setNotice(null);
          const controller = new AbortController();
          probeControllerRef.current = controller;
          try {
            const result = await call(ctx.remote.mcpManager.probe(state.view.value.serverName, controller.signal));
            if (result.ok === true) {
              const count = Array.isArray(result.toolNames) ? result.toolNames.length : 0;
              setNotice({
                kind: result.closeConfirmed === true ? 'ok' : 'warning',
                text: `${t('probeSuccess')} · ${result.durationMs} ms · ${count} tools${
                  result.closeConfirmed === true ? '' : ` · ${t('probeCleanupWarning')}`
                }`,
              });
            } else {
              const stage = result.stage === 'list' ? 'probeListFailed' : 'probeConnectFailed';
              setNotice({
                kind: 'warning',
                text: `${t('probeFailed')} · ${t(stage)}${
                  result.closeConfirmed === true ? '' : ` · ${t('probeCleanupWarning')}`
                }`,
              });
            }
          } catch (error) {
            setNotice(toNotice(error));
          } finally {
            probeControllerRef.current = null;
            busyRef.current = false;
            setBusy(false);
          }
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
            h('button', { type: 'button', style: style.button, onClick: () => reloadAll().catch(() => {}) }, t('retry')),
          );
        }

        const token = state.token;
        const tokenStatus =
          !token || token.configured !== true
            ? t('unset')
            : `${t('configured')} · ${formatCredentialSource(token.source)}`;
        const connectionStateText = {
          connecting: t('connectionConnecting'),
          connected: t('connectionConnected'),
          'waiting-credentials': t('connectionWaitingCredentials'),
          reconnecting: t('connectionReconnecting'),
          closed: t('connectionClosed'),
          failed: t('connectionFailed'),
          'not-registered': t('connectionNotRegistered'),
          unavailable: t('connectionUnavailable'),
          unknown: t('connectionUnknown'),
        }[connection.state] ?? t('connectionUnknown');
        const connectionSummary =
          serversReady || connection.state === 'unavailable'
            ? `${connectionStateText}${Number.isFinite(connection.toolCount) ? ` · ${connection.toolCount} ${t('toolCountUnit')}` : ''}`
            : t('loading');
        const serverNameValid = SERVER_NAME_PATTERN.test(draftServerName);
        const serverNameConflict =
          state.view !== null &&
          findServerNameConflict(
            serversRef.current,
            draftServerName,
            state.view.value.serverName,
            registrationErrorRef.current,
          );

        return h(
          'section',
          { style: style.section },
          h('h2', { style: style.heading }, t('title')),
          h('p', { style: style.intro }, t('intro')),

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
                disabled: busy || token?.writable === false,
                onChange: (event) => setDraft(event.target.value),
              }),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || token?.writable === false || draft.trim().length === 0,
                  style: { ...style.button, ...style.primary },
                  onClick: saveToken,
                },
                t('save'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || token?.writable === false || !token || token.configured !== true,
                  style: style.button,
                  onClick: clearToken,
                },
                t('clear'),
              ),
            ),
          ),

          h(
            'div',
            { style: style.group },
            h(
              'div',
              { style: style.groupHeader },
              h('h3', { style: style.groupTitle }, t('optionsTitle')),
              h('span', { style: style.status, 'aria-live': 'polite' }, connectionSummary),
            ),
            h('p', { style: style.hint }, `${t('toolsetsHint')}${lastSavedAt ? ` · ${t('lastSavedLabel')} ${formatTime(lastSavedAt)}` : ''}`),
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
                    disabled: busy || state.writable !== true,
                    onChange: () => toggleToolset(item.id),
                  }),
                  h('span', { style: style.name }, h('span', { style: style.mono }, item.id)),
                  h('span', { style: style.checkDetail, title: item.detail }, item.detail),
                ),
              ),
            ),
            h('p', { style: style.hint }, t('optionsHint')),
            h(
              'label',
              { style: style.check },
              h('input', {
                type: 'checkbox',
                checked: draftReadOnly,
                disabled: busy || state.writable !== true,
                onChange: () => setDraftReadOnly(!draftReadOnly),
              }),
              h('span', null, t('readOnlyTitle')),
              h('span', { style: style.checkDetail }, t('readOnlyHint')),
            ),
            draftReadOnly ? null : h('p', { style: style.warning }, t('readOnlyRisk')),
            h(
              'details',
              { style: style.advanced },
              h(
                'summary',
                { style: style.advancedSummary },
                [t('serverNameTitle'), ' · ', h('span', { style: style.mono }, state.view.value.serverName)],
              ),
              h(
                'div',
                { style: style.advancedBody },
                h('input', {
                  type: 'text',
                  value: draftServerName,
                  style: style.serverNameInput,
                  disabled: busy || state.writable !== true,
                  onChange: (event) => setDraftServerName(event.target.value),
                }),
                h('p', { style: style.hint }, t('serverNameHint')),
                !serverNameValid ? h('p', { style: style.warning }, t('serverNameInvalid')) : null,
                serverNameValid && serverNameConflict ? h('p', { style: style.warning }, t('serverNameConflict')) : null,
              ),
            ),
            optionsDirty ? h('p', { style: style.dirty }, t('dirtyHint')) : null,
            state.writable !== true ? h('p', { style: style.warning }, t('settingsReadOnly')) : null,
            h(
              'div',
              { style: style.row },
              h(
                'button',
                {
                  type: 'button',
                  disabled:
                    busy ||
                    state.writable !== true ||
                    !serversReady ||
                    serverNameConflict ||
                    !optionsDirty ||
                    draftToolsets.length === 0 ||
                    !serverNameValid,
                  style: { ...style.button, ...style.primary },
                  onClick: saveOptions,
                },
                t('saveOptions'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || !optionsDirty || state.writable !== true,
                  style: style.button,
                  onClick: resetOptions,
                },
                t('reset'),
              ),
              !draftReadOnly
                ? h(
                    'button',
                    {
                      type: 'button',
                      disabled: busy || state.writable !== true,
                      style: style.button,
                      onClick: () => setDraftReadOnly(true),
                    },
                    t('enableReadOnly'),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || !state.view,
                  style: style.button,
                  onClick: testConnection,
                },
                t('testConnection'),
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

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'remote.settings', 'remote.mcpManager'],
      apply,
    };
  },
});
