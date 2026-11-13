# HemosiTV 分镜表 · 落地实施说明书

给写代码的 AI 看。UI 视觉与交互以 `UI v3` 及确认定稿为准（文中统一命名为「分镜表」，与画布「3D 导演工作台」区分）。

## 0. 前提与边界

- 旧导演循环浮层与旧 Agent 表单代码**删除重做**，包括：canvas-agent-ops、use-agent-bridge、canvas-director、canvas-shot-actions、use-shot-generation、director-loop-overlay、director-loop-runner、use-director-loop-store、hemosi-nodes 里的旧 Shot 节点等。**3D 场景导演工作台与工作区现有的 `viral-clone.ts`（蓝图/切点/SRT/ZIP 核心逻辑）不删除**，前者保持独立，后者收编为 P4 爆款复刻内核。
- **保留自由画布通用能力**：画布现有的自由图片/视频节点、裁剪、蒙版、放大、书签、双图对比、模板库等非分镜表工具必须完整保留，不得破坏。
- 只假设仓库（GitHub 最新 main）里仍有：画布（basketikun/infinite-canvas 二开）的相机变换 `{x, y, k}`、节点外壳、SVG 连线、Zustand、localforage。**第一步先盘点这些是否真的存在**，列出文件清单，缺什么在 P0 补，不要凭记忆写。
- 需新增依赖：immer、zod（仓库目前没有）。测试沿用仓库现有的 bun test，不另装 vitest。
- 本地优先：文本、图片、视频可走远程或本地 API。配音、转写、抽帧/切镜头、合成、缩略图一律走本地接口。本地失败时**不自动降级到付费接口**，只提示用户。
- Agent 只产出方案，不直接改画布，更不会自己触发生成；代码里**严禁写死任何预设案例或固定提示词文案**。

## 1. 架构

UI → Store（Zustand + 历史栈）→ 领域层（纯函数）→ Provider 适配层 → 本地 sidecar。

领域层不依赖 React 和 DOM，全部可单测：`laneLayout`、`previewPlan`、`applyPlan`、`health`、`inputsHash`。

## 2. 数据模型

```ts
type Desk = { id: string; title: string; budgetSec: number; rows: DeskRow[] }
type DeskRow = {
  id: string                       // 稳定 rowId，镜号 = 数组下标 + 1，不再单独存
  desc: string; line: string; dur: number; size: string
  roles: string[]                  // 出镜的锚点 id
  voice: 'native' | 'dub' | 'none'
  mode: 'frame' | 'direct'         // 首帧→视频 / 直出
  cont: boolean                    // 接续上一行末帧
}
type Anchor = { id: string; kind: 'character' | 'scene' | 'style'; name: string; text: string; imageKeys: string[] }   // 画布上显示为设定图节点（UI v3 左侧一列），连线到出镜的行
type Take = { id: string; storageKey: string; inputsHash: string; prompt: string; model: string; createdAt: number }
type RowNode = {
  rowId: string; role: 'frame' | 'video'
  takes: Take[]; pickedTakeId?: string
  run?: { state: 'queued' | 'running' | 'error'; error?: string }
  detached?: boolean; promptOverride?: string
  manual?: { x: number; y: number }   // 用户手动拖过则不再自动排布
}
```

- **状态是派生的，不存储**：`health(node) = error/running > 无 take 为 idle > inputsHash 不一致为 stale > ok`。
- `inputsHash = hash(生效提示词 + 排序后的参考图 key + model + size + 接续时上游 take id)`。改了分镜表文字、重生了上游，下游自动变 stale，无需写传播代码。
- 生效提示词 = `promptOverride ?? compose(row, anchors, activeTemplate)`；支持用户在本地提示词底板库中**自由新建/修改/删减结构化底板**（严禁代码写死固定模板），选定底板时由 `compose()` 动态拼装、`Agent` 仅负责按底板结构填对应变量段落；`detached` 为真时 Agent 和分镜表的改动不覆盖它。
- **全屏预览与外部素材导入**：`RowNode` 与 `Anchor` 节点均支持点击弹出纯无边框全屏图片/视频预览，也支持**直接拖入本地图片或 MP4 文件作为一条 `Take` 写入**（与 API 生成产出的 Take 平级切换），不锁死只能调接口生成。
- 位置由纯函数 `laneLayout(desk, nodes)` 算出：折叠行高 60，选中行高 262，下游节点按 rowId 对齐。只在新建或点「整理」时执行，`manual` 节点保持原位。
- 媒体文件只存 `storageKey`（IndexedDB 或 sidecar 磁盘），state 里不放 base64。持久化带 `schemaVersion`。

## 3. 历史栈（自己掌控，兼顾自由画布）

- 为分镜表与 `RowNode` 建立基于 immer `produceWithPatches` 的事务历史栈，每次变更是一条事务 `{label, patches, inverse}`，同时与自由画布的撤销/重做入口协调（不破坏普通画布节点的裁剪、拖图等操作），确保在分镜表场景下 Cmd/Ctrl+Z 能一次回退整次事务。
- 用户编辑和 Agent 应用**共用一个栈**。Agent 一次 `applyPlan` = 一条事务，Cmd/Ctrl+Z 一次回退整次。
- 文本连续输入 500ms 内合并为一条。生成结果写入也进栈，但撤销只回退引用，不删媒体文件。

## 4. Agent 协议

```ts
type Change =
  | { id: string; kind: 'row.add'; at?: number; row: Partial<DeskRow> }
  | { id: string; kind: 'row.update'; rowId: string; patch: Partial<DeskRow> }
  | { id: string; kind: 'row.remove'; rowId: string }
  | { id: string; kind: 'row.move'; rowId: string; to: number }
  | { id: string; kind: 'anchor.add'; anchor: Omit<Anchor, 'id' | 'imageKeys'> }
  | { id: string; kind: 'row.roles'; rowId: string; anchorNames: string[] }   // 按名字匹配已有锚点，没有才新建
type Plan = { summary: string; changes: Change[]; suggestRun?: { rowIds: string[]; kind: 'image' | 'video' } }
```

1. **输入给 LLM 的上下文**：分镜表文本快照（行 id、desc、line、dur）、选中行、锚点文本。不传图片，省 token。
2. **输出约束**：用 JSON Schema（Ollama 用 `format`，OpenAI 兼容接口用 `response_format`），再用 zod 校验。失败时把错误信息带回重试，最多 2 次。
3. **`previewPlan(desk, plan, enabledIds) → { next, diff, warnings }`**：纯函数，无副作用。warnings 包括：目标行不存在、接续对象被删、总时长超预算、跳过已脱离节点、删除超过 3 行。
4. **UI**：PlanCard 每条 Change 一个复选框；GhostLayer 用 `diff` 在覆盖层渲染虚线节点，不写 store；勾选变化实时重算。
5. **`applyPlan(enabledIds)`**：悬空引用的变更自动丢弃，然后作为一条事务写入。
6. **生成永远是用户动作**：Agent 最多返回 `suggestRun`，UI 渲染成一个按钮，点击后进入确认卡（模型、渠道、完整提示词）。协议里没有任何「直接生成」的指令。

## 5. 本地接口（统一 Provider）

```ts
interface Provider<I, O> { id: string; kind: string; health(): Promise<'up' | 'down'>; run(input: I, signal: AbortSignal): Promise<O> }
```

| 能力 | 接口 | 默认实现 |
| --- | --- | --- |
| 文本（Agent） | OpenAI 兼容 `/v1/chat/completions` | 可配：DeepSeek、本机 Ollama（Qwen） |
| 图片 / 视频 | submit → poll → fetch，支持取消 | 可配渠道，允许付费 |
| 配音 TTS | OpenAI 兼容 `/v1/audio/speech` | 本机服务（如 127.0.0.1:8880） |
| 转写 | OpenAI 兼容 `/v1/audio/transcriptions` | whisper.cpp / faster-whisper-server |
| 切镜头、抽帧、缩略图、拼接、合成、字幕烧录 | sidecar HTTP | 本机 ffmpeg（Web 版没有 sidecar 时，切镜头用仓库现有的浏览器版「视频拆分镜」） |

sidecar 挂在桌面版现有的本机服务 desktop/server.js 上（已只监听 127.0.0.1），不另起进程，新增 `/health`、`/probe`、`/cut`、`/frames`、`/compose`。前端启动时探测各服务，在设置里显示可用或未启动。Web 版没有 sidecar 时，合成置灰，只保留预览拼接。

## 6. UI 与组件对照（v3 → 代码）

| v3 里的东西 | 组件 | 要点 |
| --- | --- | --- |
| 平移缩放 | `useCamera` | 滚轮平移，Ctrl/⌘+滚轮以光标为中心缩放，适应窗口 |
| 缩放分级 | 根节点 `data-lod` | 用 CSS 控制显示，阈值 0.8 和 0.45，不重渲染节点 |
| 分镜表行 | `DeskNode`、`DeskRow`、`DeskRowExpanded` | 折叠 60 / 展开 262，选中即展开 |
| 行对齐节点 | `RowNode`（compact / expanded） | 展开时 9:16 大预览 |
| 连线 | `Wires` | 预渲染 path，带 `data-row`，悬停只切 class |
| 幽灵层 | `GhostLayer` | 数据来自 `previewPlan`，只在覆盖层 |
| Agent 面板 | `AgentPanel`（导演、属性两页签） | 顶部一行放模型和设置；composer 的 @ 取自选区 |
| 方案卡 | `PlanCard` | 复选框，应用所选，不要 |
| 确认卡 | `GenerateConfirm` | 模型、渠道、完整提示词 |
| 时间条 | `TimelineBar` | 按时长排布，状态色，配音超时标红 |
| 状态 chip | `StatusChip` | 只读 `health()` |

## 7. 分期（每期做完、验收通过才进入下一期）

**P0 骨架**：盘点分支现状；数据模型、`laneLayout`、历史栈；`DeskNode` 折叠展开；相机；连线与悬停高亮。验收：5 镜能展开、拖动排序、悬停高亮，刷新后数据还在，撤销可用。

**P1 Agent**：设置页（文本模型）；Provider；Plan schema 与校验重试；`previewPlan`；GhostLayer；PlanCard；事务撤销。验收（单测 + 手测）：

- 三个固定提示词能产出合法 Plan：写 5 镜短片；改镜 2 台词；在最后加一镜。
- 取消勾选某条，幽灵预览和应用结果一致。
- 一次 Cmd+Z 回退整次应用。
- 目标行不存在时给出 warning，而不是报错。

**P2 生成与状态**：图片、视频 Provider；确认卡；队列（可取消；并发：远程渠道 3，本机图片/视频模型 1，8G 显存一次只开一个模型）；takes 与版本切换；`health` 与「重生过期」；接续镜头等上游出片再提交。

**P3 本地能力**：sidecar；TTS，用实测时长替换字数估算；预览拼接；合成。

**P4 爆款复刻（收编 `viral-clone.ts` 并直连分镜表）**：
- 统一三个轻量入口（画布视频节点右键/工具条、左侧工具栏按钮、Agent 面板「爆款复刻」页签），唤起轻量化复刻面板，不另建独立大页面或重复生成队列。
- 本地预处理：有 sidecar 走 ffmpeg 抽帧切点，无 sidecar 走浏览器端抽帧；将关键帧拼成带时间码的 4×3 关键帧网格图喂给多模态模型；可选对接本地 Whisper 转写（未配置时可手动输入台词或跳过）。
- 拆解输出含语义响应点、镜头脚本与 `{{变量}}` 多版本替换表的蓝图；点击「生成到画布」后自动收起复刻面板，通过 `applyPlan` 直接在画布长出 1 张或多张「分镜表」与行对齐节点，后续生成、拖入本地素材、全屏预览、配音合成全部复用分镜表体系；保留分镜素材包（片段 + SRT + 蓝图）导出。

**P5 体验**：小地图、多选、Cmd+K、缩放分级细化。

## 8. 工作规则

- 每期开工前先输出「要改的文件清单 + 测试清单」，确认后再写。
- 领域层全部纯函数并配 bun test 单测，UI 不写业务判断。
- 不引入付费接口，除了文本、图片、视频 Provider。
- 看不到的东西不要猜：不确定分支里有什么，就先列目录和类型，再问。

## 9. 可直接粘贴给写代码 AI 的提示词

> 阅读本文档，只做 P0。先不要写代码：1）列出当前分支里和画布、节点、连线、相机、持久化相关的现有文件及导出；2）对照第 2、3 节说明哪些要新建、哪些复用；3）给出 P0 的文件清单和 bun test 测试清单。等我确认后再实现。

## 10. 自动模式（一键出片，P2 完成后再做）

- 三档：**手动**（现在的默认）、**半自动**（Agent 方案自动采纳，生成按批确认）、**全自动**（一次确认后，从剧本到合成全部自动跑，只在出现例外时打断）。
- 与第 4 节第 6 条不冲突：点击「一键出片」本身就是用户动作，确认卡只出现一次，显示镜数和重试上限。
- 流水线是一个可暂停、可取消、可断点续跑的状态机：写 Plan → 自动采纳全部 → 锚点图 → 首帧（按依赖顺序，接续镜等上一镜出片）→ 视频 → TTS → 预览拼接 → 合成。
- 自动质检（可开关）：用视觉模型对照镜头描述给每个产出打分，低于阈值自动重生，每镜最多 3 次，自动选分最高的 take。
- 例外处理：内容审核失败时，让 LLM 改写提示词重试 1 次；仍失败就标记该镜失败，继续其余镜头，整体不卡死。
- 随时可暂停或取消，取消后不再提交新任务。
- 验收只在终点做一次：汇总「完成 4/5 镜，镜 04 失败」，有问题的镜头点进去单独重生。
- 实现上 `autopilot(deskId, opts)` 只是调度器，复用 `previewPlan` / `applyPlan`、Provider、队列和 `health`，不新增任何直接写画布的路径。
- 验收：中途断网或手动取消后能续跑；取消后不再提交新任务。
