# dsh-plugin-token-usage

DeepSeek Harness 的 Token 用量仪表盘插件（深色 TraeCode 风格，浅色主题自动适配）：活跃度热力图、关键指标、最佳拍档 / 模型调用偏好、编程时段曲线。

零侵入：不改 `deepseek-harness` 任何文件；交付纯 JS（不依赖 TS 编译）；不引图表库（内联 SVG/样式）；数据桥仅绑定 `127.0.0.1`。

## 安装

TL；DR：先把 `plugin/token-usage` 里 `npm install`（依赖 `@deepseek-ai/schemastery`，仅 host 半的 Config 校验用）。

三选一（至少支持一种即视为已安装）：

1. CLI（推荐）：`pnpm dsh plugin --profile web add dsh-plugin-token-usage`（或本包 tgz / 绝对路径）。
2. 开发 file 行：在 `~/.dsh/profiles/web/cordis.patch.yml` 里 `insert: [{ id: token-usage, name: 'file:///<本插件仓库绝对路径>/plugin/token-usage/lib/index.js' }]`（client 半由 `dsh-client-modules` 按最近 `package.json` 自动发现）。
3. 桌面端开发模式：在 `apps/desktop/.desktop-build/development/project/cordis.patch.yml` 中补写同名配置行（该文件每次启动重建，需 watcher 重建后补写）。

## 配置

`cordis.patch.yml` 的 `config:` 下可设：

- `sessionTab: boolean`（默认 `true`）。是否在**会话视图**注册 "Token 用量" 标签页。它是实时的、逐回合精确的（从 `useChat` 直接读 `TurnTokenUsage`），与宿主的跨会话聚合互为补充；`false` 则不注册（避免占用工作区）。
- `dashboard.http`: 本机数据桥配置
  - `enabled: boolean`（默认 `true`）：host 半起 `127.0.0.1` 上的一个小 JSON 端点，供浏览器渲染器跨进程读取聚合结果。
  - `host`: 默认 `127.0.0.1`（不改）。
  - `port`: 默认 `47820`；若与您机器上其它进程冲突可改。**改端口时浏览器侧的 `USAGE_URL` 会随 Config 同步**。

```yaml
- insert:
    - id: token-usage
      name: 'dsh-plugin-token-usage'
      config:
        sessionTab: true
        # dashboard:
        #   http:
        #     enabled: true
        #     port: 47820
```

## 架构：host 聚合 + 127.0.0.1 桥（桌面端主路径）

- **host 半**（`lib/index.js`）：`inject: ['sessionQuery']`，读取 DSH 宿主机上的会话语料（SQLite FTS 索引）。对每个会话 `listSessions()` → `readSession(id).events`，按与官方 `deriveTurnTokenUsage` 一致的字段复算每回合用量（`assistant/message` 事件的 `data.stream` 最后一个 `{type:'usage', usage}` 与 `data.source.{provider,model}`），聚合出**跨会话/跨目录**的按日、按时、按模型统计与最早使用时间。随后把聚合 JSON 经 `127.0.0.1:<port>/api/usage` 暴露给渲染器（可 `Access-Control-Allow-Origin: *`）。所有资源经 `ctx.effect` disposer 释放（卸载即关端口）。
- **browser 半**（`lib/client.js`）：主面板轮询 `/api/usage`（2s；host 端带 5s TTL 缓存，避免每次轮询全量重算会话语料），优先展示宿主聚合的历史仪表盘；桥不可用或为空时回退到会话标签实时流；再不行展示「暂无可用用量数据 + 数据探针」。热力图色板由 `apply()` 注入的 `<style>`（HEAT_CSS，`color-mix()` 按当前主题卡片底色解析，不支持时回退固定深色色阶）提供，浅色/深色下空格子与数据色阶均可见。

> 桌面端是宿主与渲染同机，故 host 能读到完整历史；纯浏览器（web）形态下 host 进程同样存在，本桥依然成立。数据**全部来自 DSH 自身持久化日志**，不伪造、不硬编码。

## 界面落点（两个/三个）

- 侧边栏入口 `sidebar.panellist`（id `token-usage`，order 0）——图标，点击切换主面板。
- 主区面板 `main`（key `token-usage`，`conversation` 为官方占用 key，未使用）——展示宿主聚合的**历史仪表盘**（含 52 周活跃度热力图）。
- 【仅 `sessionTab:true`】会话视图标签 `conversation.view`（id `token-usage`），与 Chat / Trajectory 并列——实时精细的逐回合用量（**不含问候区与活跃度热力图**，两者只保留在主区面板，避免会话级数据撑起一张跨 52 周的稀疏网格）。

> 若启用后显示位置 / 表现与预期不符（位置随 DSH 版本与形态而定），请先向开发者确认，不要擅自假设。

## 数据来源映射（每个 UI 模块）

主路径为 **host 半聚合**（从 `sessionQuery` 会话语料复算，覆盖全部历史会话）；`sessionTab:true` 时另有实时的 `useChat` 逐回合流作为精细补全。聚合口径对齐官方 `deriveTurnTokenUsage`：

| UI 模块 | 数据来源 | 拿不到时的表现 |
|---|---|---|
| 问候区 "Hello!"（仅主区面板） | 无用户名源 | 用户名隐藏；"使用第 N 天"由最早 usage 事件时间推算（有则显示，无则隐藏） |
| 活跃度热力图（仅主区面板） | host 按 `days` 聚合（事件时间→本地日；52 周窗口按周一起始对齐，列=周一..周日） | 显示空时间窗 + "暂无 Token 用量数据" |
| Token 消耗 / 回合数 | host `totalTokens` 与 `turns`（`turn/end` 计数；副标题为"共 N 个回合"） | 显示 "—"，不显示 0 |
| 对话次数 | host `turns`（回合数，与"共 N 个回合"同口径） | 显示 "—" |
| 最佳拍档 | 按模型 `modelTokens` 排序 Top1（`data.source.{provider,model}`；"N 次模型调用"是 `assistant/message` 计数，与回合数不同口径） | 显示灰色 Zz 空态 |
| 模型调用偏好 | 同上的模型分组横条排行 | 显示灰色 Zz 空态 |
| 编程时段曲线 | host `hours`（24 桶，06:00→次日 06:00 的真实数据平滑曲线 + 面积填充，颜色走主题 token） | 空态提示"暂无时段数据" |
| 底部说明 | 常量文案（本地约每 5s 刷新） | — |

## 无法拿到 / 已降级（诚实声明，不伪造）

1. **用户名 / 成就标签**：会话语料与 root 组合均未暴露浏览器插件可见的用户名/身份徽章。→ 仅显示 "Hello!"；"使用第 N 天"可与最早 usage 时间一起诚实推算。
2. **桥不可用**（`dashboard.http.enabled:false` 或端口被占/聚合抛错）：host 不产数据 → 浏览器回退到 `sessionTab` 实时流；若也空 → 展示「暂无可用用量数据 + 数据探针」（含 `usageBridge:` 状态）。
3. **模型归因缺失**：某 usage 事件若没有 `data.source.{provider,model}`，该次不计入模型排行（但仍计入总量/热力图/时段）——保证模型偏好绝不虚报。
4. 无数据之处统一显示 "暂无数据"/"—"/空态，**绝不用随机数或占位假数据**。

### 运行时数据探针（Debug）

`main` 面板在无数据时展示一段由 `apply()` 在运行时捕获的可用性报告，并 `console.log("[token-usage] data probe: …")`：列出 `ctx` 的 key、是否注入 `locale`/`slots`/`sessionQuery`/`chat`/`sessions`/`webServer`，以及 `usageBridge:` 的最近一次轮询状态。若 DSH 后续版本或您的环境暴露了更多可注入服务，能从该输出确认并扩展，无需猜字段。

## 卸载 / 恢复

删掉对应 patch 行（或 `dsh plugin remove`）即可；重启后无残留（host 半的资源——包括 `127.0.0.1` 数据桥与聚合定时——全部经 `ctx.effect` disposer 释放，卸载即关端口；client 半所有注册挂在 `ctx.slots` / `ctx.locale` / 会话作用域下，随卸载自动清理；浏览器轮询定时器在 effect 卸载时 `clearInterval`）。

## 边界用例（手动验证）

- 新开空会话打开面板：问候 "Hello!"、"—"、热力图空态、Zz 空态，无 0 值无假数据。
- 跑一两个回合后回到面板：热力图出现当天格子、指标为真实合计、曲线出现实心节点。
- 切换 `sessionTab:false` 重启：会话区不再出现 Token 标签，main 面板仍可用（暂无数据）。
- 卸载插件并重启：UI 无残留，无报错日志。

## 约定说明

- 不持久化原始用量数据；仅模块内存内共享（存 `lib/client.js` 的模块级 emitter），刷新/重启清零，天然贴合"不持久化"约束。
- React 由宿主注入（`require("react")`）；除 `@deepseek-ai/schemastery`（host Config 用）外无其它运行时依赖。
- 日志用 `console.log/error`（默认组合无 console backend，见 reference 插件注释）。