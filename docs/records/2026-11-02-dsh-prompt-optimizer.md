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
3. 输入一段草稿 → 点击 → 草稿被改写结果替换（一次可撤销）；
4. 不选模型时点击 → 气泡提示「请先选择模型」；
5. `设置 → 提示词优化` 改指令 → 保存 → 再次点击使用新指令；
6. 控制台无 `slot entry crashed in 'conversation.input.right'`。
