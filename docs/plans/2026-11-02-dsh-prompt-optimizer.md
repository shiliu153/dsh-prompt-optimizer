# 实现计划：DSH 提示词优化插件

依据：`docs/specs/2026-11-02-dsh-prompt-optimizer-design.md`

## 任务

1. **包骨架** — `package.json`（`dsh.bundle.patch` + `dsh.client`）、`cordis.patch.yml`、`locale/{zh,en}.json`（含 `meta.title`/`meta.description`）、`icon.svg`、`README.md`。
2. **Host 半边** — `index.js`：
   - `apply(ctx)` + `ctx.inject(['connection','llm'], …)`；
   - 设置文件读写（默认值、损坏回退、原子写）；
   - `POST /api/dsh-prompt-optimizer/optimize`（`prepareCall` → `stream` → 拼接 `text-delta`，映射 `finish.reason`）；
   - `GET/PUT /api/dsh-prompt-optimizer/settings`；
   - 纯函数抽出到 `lib/prompt.js`、`lib/settings.js` 以便单测。
3. **客户端半边** — `client.js`：按钮（`conversation.input.right`）+ 设置页（`settings.section`），locale 字典内联，样式只用 `--dsw-alias-*`。
4. **单测** — `test/*.test.js`（`node --test`）：路由四条路径（stub ctx.llm）、设置文件读写、请求校验、客户端 `__test` 纯函数。
5. **安装与验证** — profile `package.json` + `pnpm install` + 观察激活；浏览器验证按钮位置、点击、设置页保存。

## 验收

- `node --test` 全绿；
- 插件行 `active`，控制台无 `slot entry crashed`；
- 点击按钮 → 草稿被当前模型改写的结果替换；
- 设置页改提示词 → 下一次点击使用新指令。
