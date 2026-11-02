# @dsh-contrib/dsh-prompt-optimizer

[English](README.en.md) | 中文

在 DSH Web 的对话框输入区、模型选择器**左侧紧邻**加一个按钮：点击后用**当前选择的模型**把输入框草稿改写成更清晰的提示词，并直接替换回输入框。改写指令本身在设置页可编辑。

## 概述

写提示词的成本主要不在"想说什么"，而在"把话说完整"：目标、上下文、约束、期望的输出格式，少一项就多一轮返工。这个按钮把这一步收敛为一次点击——它读的是**你此刻在模型选择器里选中的那个模型**，不是插件自带的某个固定模型，所以改写质量与你在会话里看到的模型一致。

改写结果直接替换草稿，是一次可撤销编辑：不满意就 Ctrl+Z，或再点一次。插件不新增会话事件、不写入会话日志，也不改变发送流程——它只动输入框里的那段文本。

本包零第三方依赖：Host 半边只用 Node 内置模块，浏览器半边不导入任何 Harness Client 包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [失败行为](#failure-behavior)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装

标准方式：在 DSH Web 侧边栏打开 **插件**，点 **添加插件**，把仓库地址填进包名字段：

```
https://github.com/shiliu153/dsh-prompt-optimizer
```

装完后点 **立即启用**。插件页会先让 Host 读一遍这个 spec、再跑 pnpm，并把包加进当前 profile 的 bundles——这一步不要手工改 profile 的 `package.json`。

如果这个插件此前是以本地目录链接（`link:`）方式装进来的，先在该插件卡片上 **移除**，再按上面的地址重装：同一个 profile 里对已存在的包再次安装会被直接拒绝。

Agent 侧等价调用（仅在启用了 `plugin_manager` 工具的 profile 里可用；Desktop 默认关闭该工具）：

```
plugin_manager install_bundle https://github.com/shiliu153/dsh-prompt-optimizer
```

开发中的本地目录安装（改动代码需要重启才生效）：

```
plugin_manager install_bundle C:\Users\20157\daily_work\dsh-prompt-optimizer
```

安装后按钮出现在输入框工具栏、模型选择器左侧。**该按钮可见即表示插件已挂载**；看不到按钮说明 bundle 未激活，而不是模型不可用。

### 按钮

| 操作 | 结果 |
|---|---|
| 草稿为空时 | 按钮禁用，悬停提示先输入内容 |
| 点击（已选模型） | 用该模型改写整段草稿，成功后替换输入框内容 |
| 点击（未选模型） | 不发请求，按钮上方气泡提示「请先选择模型」 |
| 请求进行中 | 图标转为转圈；再点一次取消优化（悬停时图标变叉） |
| 改写失败 | 草稿保持原样，气泡显示失败原因（8 秒后自动消失） |

替换是一次整段写入，编辑器把它并入当前的历史记录而不是单独压一个撤销步；改写期间如果你继续输入，结果返回时会覆盖这些新内容——点击就是授权，插件不会因此报错。不想要这个结果就点取消。

### 设置

`设置 → 提示词优化` 可编辑发给模型的系统提示词，支持「保存」与「恢复默认」。

- 存储位置：`$DSH_HOME/prompt-optimizer.json`（默认 `~/.dsh/prompt-optimizer.json`），形如 `{ "systemPrompt": "…" }`。
- 每次请求现读文件，因此保存后**下一次点击立即生效**，不需要重启。
- 文件缺失或损坏时回退内置指令，按钮照常可用。
- 长度上限 8000 字符；空内容视为非法，用「恢复默认」回到内置指令。

### HTTP 接口

四个精确路径路由，挂在 harness 自己的 `/api` 通道上（`ctx.connection.registerFetchRoute`），因此同源检查与浏览器会话认证在进入处理函数之前就已完成。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/dsh-prompt-optimizer/optimize` | `{provider, model, text}` | `{text}` |
| GET | `/api/dsh-prompt-optimizer/settings` | — | `{systemPrompt, custom, defaultPrompt, maxChars, file}` |
| POST | `/api/dsh-prompt-optimizer/settings/save` | `{systemPrompt}` | 同上 |
| POST | `/api/dsh-prompt-optimizer/settings/reset` | — | 同上 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 数据流

```
浏览器 client.js
  ├─ slots → conversation.input.right   按钮（模型选择器左侧）
  └─ slots → settings.section           设置页
        │ fetch('/api/dsh-prompt-optimizer/…')   同源 + 会话 cookie
        ▼
Harness /api 路由（dsh-client-connection 的 admit 栅栏）
        ▼
Host index.js → lib/optimize.js
        ├─ validateRequest      空草稿 / 超长 / 缺模型 在触达 provider 之前拒绝
        ├─ ctx.llm.prepareCall  绑定 provider + model + maxTokens，取最低推理档
        └─ call.stream          只累加 text-delta，按 finish.reason 判定终止
        ▼
当前选择的 provider/model（任意已注册 adapter）
```

三个决定值得单独说明：

1. **模型由选择器决定，不由插件决定。** 点击瞬间读 `ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current`，所以菜单里刚切换的模型就是下一次点击使用的模型；插件没有自己的模型配置。
2. **只取最低推理档。** 改写是短输出任务，用模型广告的最低档显著降低延迟；模型本身不降级。
3. **不流式写入输入框。** 改写结果一次性替换，避免边生成边改编辑器造成的撤销栈与光标位置混乱。

### 项目结构

```
index.js            Host 半边：apply + ctx.inject(['connection','llm'])
lib/defaults.js     内置指令、长度与超时上限
lib/settings.js     设置文件读写（原子写、损坏回退）
lib/optimize.js     校验 + prepareCall/stream + finish 映射
lib/routes.js       四条 Fetch 路由
client.js           浏览器半边：按钮 + 设置页（无 Harness Client 包依赖）
locale/             插件元数据（en / zh 的 meta.title、meta.description）
scripts/            check-bundle.mjs：bundle 合规自检
test/               node --test
docs/               specs / plans / records
cordis.patch.yml    本包自身的 patch，注册 dsh-prompt-optimizer
```

`lib/` 保持零外部依赖：`test/esm-hygiene.test.mjs` 会断言 Host 源码既不调用 `require()`，也只导入 `node:` 内置模块与相对路径。

-----

<a id="further-exploration"></a>
## 进一步探索

- 设计与取舍——`docs/specs/2026-11-02-dsh-prompt-optimizer-design.md`
- 实施计划——`docs/plans/2026-11-02-dsh-prompt-optimizer.md`
- 实测记录（已验证 / 未验证清单）——`docs/records/2026-11-02-dsh-prompt-optimizer.md`

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **改写是一次整段写入，不保证一步撤销**。`inputActions.setDraft` 走的是编辑器的整篇替换路径，历史记录按 `history-merge` 合并，所以 Ctrl+Z 未必能精确回到改写前的文本。需要可靠回退的话，先自己复制一份原文。
- **改写期间继续输入会被覆盖**。点击时记下的草稿就是这次改写的输入；返回时无论输入框里此刻是什么，都会被结果替换。不想要就中途点取消。
- **只优化整段草稿**，不支持"选中一段只改这一段"。选区路径需要把结果插回原位置，失败分支明显更多，当前版本不做。
- **没有对比预览**。改写直接替换，靠撤销回退；如果你想要 diff 式确认，需要额外的浮层与二次确认流程。
- **不流式呈现**。模型生成过程中输入框不变，只有完成或失败两种状态。
- **推理档固定为最低档**，不可在设置里调整。改写任务基本不需要深推理，但这是当前实现的选择，不是模型能力限制。
- **草稿超过 20000 字符会被拒绝**（413）。上限写在 `lib/defaults.js`，改动需要改代码而不是改设置。
- **本包代码更新需要重启进程**才能加载新的 JavaScript 模块版本；HMR 只覆盖配置重载。
- **改写不进入会话日志**。它是输入框编辑，不是一次模型回合，因此刷新页面后不会留下这次改写的记录（草稿本身由 DSH 自己持久化）。

-----

<a id="failure-behavior"></a>
## 失败行为

失败一律发生在替换之前：草稿保持原样，错误显示在按钮上方的气泡里。

| 情形 | 处理方式 |
|---|---|
| 草稿为空 | 按钮禁用，不发请求 |
| 未选模型 | 不发请求，提示「请先选择模型」 |
| 草稿超过 20000 字符 | 服务端 413 `too_long` |
| provider 未注册 | 400 `NO_ADAPTER`，消息来自 LLM 服务 |
| 凭证缺失 / 限流 / 上下文超限 | 502，透传 provider 中性错误码与消息 |
| 模型返回空文本 | 502 `empty_response`，不替换草稿 |
| 120 秒未完成 | 504 `timeout` |
| 请求途中切换会话 | 结果丢弃，不写入其他会话 |
| 请求途中取消 | 中止请求，草稿不变，不报错 |
| 请求体不是 JSON | 400 `bad_request` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

```sh
node --test "test/*.test.mjs"        # 22 个测试，零依赖
node scripts/check-bundle.mjs .      # bundle 合规自检，失败时退出码非零
```

装进某个 profile 一律走标准通道：**插件页 → 添加插件**（Host 读 spec、跑 pnpm、选中 bundle，一次做完）。不要手写 profile 的 `package.json` 或 `dsh.profile.bundles`，也不要自己在 profile 目录里跑 pnpm——那正是插件页替你做的三件事，手工做会漏掉校验与选中步骤。

改完代码需要重启 DSH 桌面端才会加载新的模块版本。

</details>
