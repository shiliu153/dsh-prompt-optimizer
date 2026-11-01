# DSH 提示词优化插件 — 设计文档

- 日期：2026-11-02
- 状态：设计已获用户确认（位置 / 落地方式 / 可编辑指令 / 作用范围）
- 产物：`C:\Users\20157\daily_work\dsh-prompt-optimizer`（包名 `@dsh-contrib/dsh-prompt-optimizer`）
- 目标版本：`0.1.0`

## 1. 目标

在 Web GUI 的对话框输入区，模型选择器**左侧紧邻**加一个按钮：点击后用**当前选择的模型**把输入框草稿改写成更清晰的提示词，并直接替换回输入框。改写指令本身在设置页可编辑。

成功标准：

1. 按钮出现在模型选择器左侧，视觉与宿主工具栏一致（主题 token、14px 图标、hover/focus 与 `+` 按钮同构）；
2. 点击后请求走当前模型（provider/model 严格取自选择器），返回文本替换整段草稿，一次可撤销；
3. 未选模型、模型报错、返回空文本、超时、草稿超长都有明确提示且**不破坏草稿**；
4. 设置页可编辑系统提示词、可恢复默认，保存后立即对下一次点击生效，无需重启。

## 2. 非目标（YAGNI）

1. 不做选区局部优化（用户已确认：始终整段）；
2. 不做对比预览 / diff（用户已确认：直接替换）；
3. 不做流式渲染到输入框（一次性替换，避免编辑冲突）；
4. 不做多套预设、历史记录、快捷键绑定；
5. 不引入构建链（无 TSX/tsdown），不引入任何第三方运行时依赖。

## 3. 环境事实（本次实测所得）

| 事实 | 出处 |
|---|---|
| 输入工具栏结构：`tools`（左，含 `+`、permission、plan、`conversation.input.left`）／`trailing`（右，含 `standardControls` = `conversation.input.right` + `conversation.input.model`，再是 activity、发送键） | `dsh-client-ui-conversation/lib/client.js` L19235-19286 |
| `conversation.input.right` 是 list 槽、scope `session`、标准 props 含 `useInput`、`inputActions`、`sessionId` | 同文件 L20116；slot catalog（`dsh-cordis-client-runner/lib/client.js`）`key: "conversation.input.right"` |
| `InputActions` = `captureInsertion()` / `insertText(text, span)` / `setDraft(text)` / `persistDraft()` / `submit()` | 同文件 L14940-14967 |
| `InputState` 快照 = `{draft, attachmentIds, draftRev, phase, claim?, occurrences, queue}` | 同文件 L15714-15725 |
| 当前模型选择读自 `ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current` → `{provider, model, reasoningEffort?}` | `dsh-client-ui-model-selection/lib/client.js` L1025-1041、L871、L1889 |
| 模型调用唯一入口 `ctx.llm.prepareCall(config, signal, configure)` → `{config, stream(options)}`；`stream` 产出 `text-delta`（`chunk.text`）与终止 `finish`（`chunk.reason.kind` = `stop`/`error`/`aborted`，`reason.failure` = `{code,message,status?}`） | `dsh-llm/README.md`；`lib/index.js` L2220-2261、L2402-2414 |
| `messages` 只需 `{role:'user', content:[{type:'text', text}]}`，非 assistant 消息被原样透传 | `lib/index.js` L2268-2289 |
| 面板路由用 `ctx.connection.registerFetchRoute(ctx, {path, methods, requestBody, fetch})`，路径必须在 `/api` 之下，复用 harness 的四项来源检查与浏览器会话认证 | `dsh-mcp-manager/lib/server.js` L1-7、L389-416 |
| 客户端半边是单文件 `window.__ModuleLoader__.load({id, factory})`，由 `/plugins/<id>/client.js` 直接服务；禁止 `require('@deepseek-ai/dsh-client-ui-primitives')`，样式只用 `--dsw-alias-*` | `cordis-plugin-development/references/ui-plugin.md`、`practices.md` L35 |
| 设置页扩展点：`settings.section`（`{name,id,order,label}`） | `dsh-client-ui-settings-models/lib/client.js` L4485-4501 |

## 4. 架构

```
浏览器 client.js
  ├─ slots → conversation.input.right   （按钮，紧贴模型选择器左侧）
  └─ slots → settings.section           （「提示词优化」设置页）
        │ fetch('/api/dsh-prompt-optimizer/…')   同源 + 会话 cookie
        ▼
Harness /api 路由（dsh-client-connection 的 admit 栅栏）
        ▼
Host index.js
  ├─ GET  /settings       读 $DSH_HOME/prompt-optimizer.json
  ├─ PUT  /settings       校验后原子写回
  └─ POST /optimize       ctx.llm.prepareCall → stream → 拼接 text-delta
        ▼
当前选择的 provider/model（DeepSeek 账号、wb-pool、pi-ai…任意已注册 adapter）
```

### 4.1 按钮

- 槽位 `conversation.input.right`，`order: 20`（在模型座位之前），`id: 'prompt-optimizer'`。
- 图标：手绘 14px 星芒 SVG（`aria-hidden`），按钮 `aria-label` + 原生 `title` 提示。
- 状态机：`idle → running → idle`，失败时进入 `error` 并弹出 8 秒自动消失的错误气泡（绝对定位在按钮上方，不挤压工具栏布局）。
- 禁用条件：草稿 trim 为空、或请求进行中。
- 成功：`inputActions.setDraft(result.text)`；不追加、不保留原文。
- 失败：草稿保持不变。

### 4.2 模型选择

点击瞬间读取 `directoryFor(sessionId).store.getSnapshot().current`：

- 取到 → 把 `provider` / `model` 放进请求体；
- 取不到（无会话 scope / 目录未就绪）→ 直接提示「请先选择模型」，不发请求。

服务端不信任客户端传来的其它字段，只接受 `provider`/`model` 两个字符串，并交给 `prepareCall` 校验（未注册 adapter → `NO_ADAPTER`）。

### 4.3 推理档

`configure` 回调取该模型 `reasoning.efforts[0]`（最低档）作为 `reasoningEffort`：改写任务不需要深推理，最低档显著降低延迟。模型本身严格跟随选择器。无推理元数据的 adapter 不传该字段。

### 4.4 设置页

- 存储：`$DSH_HOME/prompt-optimizer.json`（默认 `~/.dsh/prompt-optimizer.json`），形如 `{ "systemPrompt": "…" }`。
- 读取：每次请求现读文件，缺失/损坏回退内置默认值；写入用「临时文件 + rename」原子替换。
- 页面：说明文字 + 多行文本框（等宽、可缩放）+ 「保存」「恢复默认」+ 保存中/成功/失败状态 + 当前生效值来源（自定义 / 内置默认）。
- 校验：非空、≤ 8000 字符；空值视为非法并提示可用「恢复默认」。

### 4.5 默认系统提示词

内置一段中文指令，要求：只输出改写后的提示词本身；保持原文语言与真实意图；补全目标、上下文、约束、输出格式；不解释、不加前后缀、不编造事实。

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| 草稿为空 | 按钮禁用（tooltip 说明） |
| 未选模型 | 前端拦截，提示「请先选择模型」 |
| `text` 超 20000 字符 | 前端拦截 + 服务端 413 |
| provider 未注册 | 502 + `NO_ADAPTER` 文案 |
| 凭证缺失 / 限流 / 上下文超限 | 透传 `failure.code` + `failure.message` |
| 模型返回空文本 | 502 `empty_response`，不替换 |
| 120s 超时 | 499 `aborted` |
| 请求途中切换会话 / 组件卸载 | 结果丢弃，不写入 |

## 6. 测试

- `node --test`：请求体构造、响应解析、错误映射、长度边界、默认值回退（Host 纯函数 + 客户端 `__test` 导出）。
- Host 路由：stub `ctx.llm`（正常 / 空文本 / error finish / 抛异常）四条路径。
- 安装后：确认 `application: applied`、浏览器控制台无 `slot entry crashed`、按钮位置与主题一致。

## 7. 安装

1. 包目录：`C:\Users\20157\daily_work\dsh-prompt-optimizer`；
2. 加入 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`（`link:` 本地目录）与 `dsh.profile.bundles`；
3. 在 profile 目录执行一次 `pnpm install`；
4. 新装 bundle 可经 HMR 激活；若宿主未热加载，重启桌面端后生效。
