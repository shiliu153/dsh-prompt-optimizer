# 记录：DSH 提示词优化插件 v0.1.0

- 日期：2026-11-02
- 设计：`docs/specs/2026-11-02-dsh-prompt-optimizer-design.md`
- 计划：`docs/plans/2026-11-02-dsh-prompt-optimizer.md`
- 包：`C:\Users\20157\daily_work\dsh-prompt-optimizer`

## 做了什么

1. 新建 bundle `@dsh-contrib/dsh-prompt-optimizer`（Host + Client 两个半边，无第三方依赖、无构建链）。
2. 按钮挂在 `conversation.input.right`（模型选择器左侧），点击用当前选择的模型改写整段草稿并 `setDraft` 回填。
3. 改写走 `ctx.llm.prepareCall` + `stream`，只取 `text-delta`，按 `finish.reason` 映射错误。
4. 设置页（`settings.section`）可编辑系统提示词，落盘 `$DSH_HOME/prompt-optimizer.json`，每次请求现读，保存即生效。
5. 安装进 `desktop` profile：`package.json` 依赖（`link:`）+ `dsh.profile.bundles`，`pnpm install` 成功。

## 已验证

| 项 | 方法 | 结果 |
|---|---|---|
| 全部源码语法 | `node --check` ×6 | 通过 |
| 单元测试 20 条 | `node --test` | 20 passed |
| bundle patch 可被 DSH 自己的 loader 解析 | `~/.dsh/port/validate_patch.js` | `OK: parsed 1 patch entry`，行 `id=dsh-prompt-optimizer` |
| 包可从 profile 解析 | `node --input-type=module -e "import(...)"`（cwd=profile） | `apply: function`，`name: dsh-prompt-optimizer` |
| Host 半边装配 | stub ctx 跑 `apply` | 注册 4 条路由；`GET /settings` 返回 200 + 内置指令 |
| Client 半边装配 | stub `window.__ModuleLoader__` + stub ctx | 注册 `conversation.input.right`(id `prompt-optimizer`, order 20) 与 `settings.section`(order 60)，locale 字典 zh/en |
| 安装落盘 | profile `node_modules` | 符号链接指向工作区，`client.js` 存在 |

## 未验证（需要重启桌面端）

- 按钮在真实页面中的渲染位置与主题表现；
- 点击后真实模型调用与草稿替换；
- 设置页保存后下一次点击使用新指令；
- 控制台无 `slot entry crashed`。

新装 bundle 的激活取决于宿主是否热加载；当前进程启动时尚未包含该 bundle，**需重启 DSH 桌面端**。重启脚本：`C:\Users\20157\.dsh\restart-dsh.ps1`（等待 30s → 关窗 → 重开）。

## 重启后的核对清单

1. 插件列表出现「提示词优化」，无激活失败诊断；
2. 输入框工具栏、模型选择器左侧出现星芒按钮，hover/focus 与 `+` 按钮一致；
3. 输入一段草稿 → 点击 → 草稿被改写结果替换；
4. 不选模型时点击 → 气泡提示「请先选择模型」；
5. `设置 → 提示词优化` 改指令 → 保存 → 再次点击使用新指令；
6. 控制台无 `slot entry crashed in 'conversation.input.right'`。

## v0.1.1：改写期间的并发输入

**发现（读 `dsh-client-ui-conversation` 源码，非运行时）**：

| 事实 | 出处 |
|---|---|
| `inputActions.setDraft` 直接调 `SessionInputShell.setDraft`，**不检查** `phase`（`adjudicating`/`submitting`）与 `disposed` | `lib/client.js` L14951-14953、L15037-15048 |
| `DraftEditor.setDraft` 用 `tag: "history-merge"` 更新编辑器 → 并入当前历史条目，**不是独立撤销步** | L14686-14696、L7496（`xo = "history-merge"`） |
| 只有 `inputActions.insertText` 走 `insertAsyncText`（`tag: "paste"`），才是独立撤销步，且带 phase + `draftRev` 双守卫 | L14946-14950、L14772-14779 |

后果有两条：**(a)** 原 README 写的「一次可撤销、Ctrl+Z 回到改写前」是错的；**(b)** 改写进行中用户继续输入，`setDraft` 会静默覆盖这些新输入。

**修复**：点击时记下 `draftRev`，返回时版本不一致就不再替换，改为提示「草稿已改动，本次结果未替换」；纯函数 `canApply(clickedRev, currentRev)` 导出到 `__test` 并加单测。没有改用 `insertText`，因为它的 span 走 detect 坐标，带文件引用的草稿上 `detectText` 与 `clipboardText` 长度可能不同，整篇替换用 `setDraft` 才是安全路径。

**仍未运行时验证**：以上结论来自源码与单测，浏览器里的实际观感（气泡位置、按钮状态、真实改写）依旧待人工确认。

## v0.1.2：可取消 + 静默覆盖（用户决定，推翻 v0.1.1 的守卫）

用户 2026-11-02 的决定：改写期间再点一次按钮应**取消**；改写期间草稿被改动就**静默覆盖**，不要报错。v0.1.1 的 `draftRev` 守卫与「草稿已改动」提示因此移除。

**取消链路（源码可证）**：

| 环节 | 依据 |
|---|---|
| 点击时建 `AbortController`，`fetch(..., {signal})`；busy 时再点调 `abort()` | `client.js` `run()` |
| 浏览器断开 → `res.on("close")` 触发 `abort.abort()`，请求带上 `signal: abort.signal` | `dsh-client-connection/lib/index.js` L41-44、L75-87 |
| 我们的路由把 `req.signal` 传进 `optimizeDraft`，再传给 `call.stream({signal})` | `lib/routes.js`、`lib/optimize.js` L104-109 |

所以取消是真的中止 provider 生成，不只是丢掉显示结果。取消时不弹错误：`catch` 里判 `controller.signal.aborted` 直接返回。

**界面**：busy 时按钮不再禁用（否则无法取消），草稿被清空也不影响取消；悬停或键盘聚焦时转圈图标换成叉号，`aria-label` / `title` 变为「取消优化」。

**代价（用户已接受）**：改写期间新输入的文字会被结果覆盖，没有二次确认。

**仍未运行时验证**：同前，浏览器观感与真实取消效果需人工确认。

## 收尾：项目终止

**原因**：用户找到了功能等价的现成插件 `dsh-prompt-optimizer@2.0.3`（npm，bundle 条目同名、同为 Web 客户端插件，自带 SSE 流式与推理展示），本项目不再需要，也不再继续开发。

**处置（2026-11-02）**：

| 项 | 状态 |
|---|---|
| `desktop` profile 的依赖与 bundles 条目 | 已不含 `@dsh-contrib/dsh-prompt-optimizer`；用户改用了 `dsh-prompt-optimizer@^2.0.3` |
| `node_modules/@dsh-contrib/dsh-prompt-optimizer` | 移除后残留的符号链接已删除（确认指向本工作区后仅删链接）；工作区源码未受影响 |
| `~/.dsh/prompt-optimizer.json` | 从未生成（用户没在设置页保存过），无需清理 |
| 临时提取目录 `.tmp-dsh-src/` | 已删除（5.6 MB） |
| 远端仓库 | 保留：`shiliu153/dsh-prompt-optimizer`，master 至 `8f27c3d`，tag `v0.1.0`，release `v0.1.0` |

**未完成项（随终止作废）**：浏览器内的视觉与交互从未人工确认；`0.1.1` / `0.1.2` 只改了代码与文档，没有打 tag，也没有 release。仓库是否归档或删除，留给用户决定。
