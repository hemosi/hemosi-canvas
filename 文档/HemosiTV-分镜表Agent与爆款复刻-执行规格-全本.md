# HemosiTV 执行规格：分镜表节点 Agent + 爆款复刻（全本）

读者：写代码的执行 AI。本文件自包含：产品背景、仓库现状、需求细节、验收标准都在文内。与仓库现状不符时按第 15 节报告。

## 0. 基线与起点

- 仓库：`hemosi/hemosi-canvas`，从最新 `main` 开工。当前 main = `5522725`（v0.21.7）。
- 分镜表与分镜表 Agent **完全重做**：v0.21.7 那套独立页版分镜表的代码一行不沿用，开工前先整套清理（S0，清单见第 12 节）。只保留 `desktop/sidecar-routes.js` 与它在 `desktop/server.js` 里的挂载（本地 ffmpeg 端点，见 9.4）。
- 锚点（anchor）节点整套删除（S0，清单见第 12 节）；参考图一律用画布普通图片节点，用 @ 引用（见 3、5.0）。
- 画布现有的 `canvas-agent-ops.ts` 与镜头（shot）节点相关代码，本次不调用、不修改、不删除；分镜表 Agent 写画布走新代码（见第 4 节）。
- 施工顺序按第 13 节，全部做完一次交付，每阶段自检项在第 13 节。

## 1. 产品与总口径

HemosiTV 是桌面端无限画布软件（Windows，Electron；Web 版同代码），做 AI 视频创作。用户在一张无限画布上摆节点（文本、图片、视频、音频、配置、分组，以及注册节点：镜头 shot、书签、双图对比、爆款复刻 viral-clone、3D 导演工作台），节点连线表示引用与依赖；软件在设置里配好各家生成渠道（地址、Key、模型），在画布上完成从想法到成片的全过程。本次做两件事，共用一条链：

1. **节点里的 Agent**：一个「分镜表」画布节点（10 列标准 AI 短剧分镜表 + 每镜内层折叠图片/视频提示词 + 顶栏可折叠模型提示词规范模板）+ 右侧 Agent 面板。Agent 读当前画布与模型规范模板，一次性产出完整分镜与每镜折叠的图片/视频提示词方案（`Plan`），经用户确认后写进分镜表节点，并在画布左侧建好出场角色/场景/物品参考图片节点、右侧铺好每镜对应的首帧图片节点与视频节点并自动连线；首帧图与视频逐条调已有渠道生成、挑版本，最后合成。
2. **爆款复刻**：导入一条参考原片和用户自己的内容，按原片的整套做法（结构、节奏、人物与说话方式、B-roll、字幕、屏上文字与特效、BGM）用用户的内容重做整条视频，渲染出成片，并能批量出变体。机制对标 Hypit，实现自研（第 11 节）。

总口径（与其它文档冲突时以本节为准）：

- **形态**：分镜表是画布上的 `storyboard` 节点，Agent 面板在右侧；一切读写发生在当前画布项目内，数据存节点 metadata（第 5 节）。
- **生成通道**：文本、图片、视频生成全部调用软件已有的渠道配置（`use-config-store` 的 channels）与 `services/api` 现有函数，按 capability 选模型；界面上选模型就是从已配渠道里选。
- **10 列标准分镜表 + 内层折叠提示词（由 Agent 结合全剧上下文与模型通用规范直接生成）**：分镜表外层是给创作者审阅的 10 列常规分镜表（`镜号｜时长｜景别｜运镜｜画面内容〔静态，给生图〕｜人物动作〔单一动作，给图生视频〕｜台词/旁白｜音效｜出场角色/场景｜转场/备注`）；每行点击镜号（`▸ S01`）可展开/收起内层折叠的 **`图片提示词`** 与 **`视频提示词`**。顶部有折叠的「模型提示词模板（图片生成规范 / 视频生成规范）」，由拥有全剧上下文的导演 Agent 结合模型规范一次性生成 10 列分镜与折叠提示词。分镜表左侧自动连出场角色/场景/物品的画布图片节点（`@图n`），右侧每镜对应一个**首帧图片节点**（吃本镜 `imgPrompt` + 角色/场景参考图）和一个**视频节点**（吃本镜首帧图 + `vidPrompt`）。不再拆分独立的外部提示词文本节点。
- **复刻**：对标 Hypit——gemini 模型看原片拆出整套做法，用户的内容改写脚本，效果挂在台词的字上，生成后按真实语音自动对时，渲染成片，批量出变体。本地不切镜、不出网格图、不装转写（第 11 节）。
- **本地处理**：抽帧、缩略图、拼接、合成走桌面服务内置的 ffmpeg 端点（第 9 节）；Web 版合成位置放顺序预览拼接。爆款复刻不调用本地切镜。
- **确认卡**：每次生成前给用户看三样——做什么、用哪个渠道哪个模型、完整提示词全文（第 8 节）。
- **命名**：节点与界面文案用「分镜表」；右侧面板名「导演 Agent」。
- **完成状态**：检测、验片、合成的状态以真实产物为准——合成有真实 MP4 文件才标完成，检测无结果标「未检测」。

## 2. 仓库现状（写码前按此对一遍目录）

- 画布项目与状态：`web/src/stores/canvas/use-canvas-store.ts`（zustand persist，`updateProject(id, patch)` 写 nodes/connections/chatSessions 等）；项目里 `nodes: CanvasNodeData[]`、`connections: CanvasConnection[]`。
- 节点类型：`web/src/types/canvas.ts`。内置 `CanvasNodeType` = image / text / config / video / audio / group；注册节点 `HemosiNodeType` = shot / anchor / bookmark / image-compare / viral-clone（anchor 在 S0 删除）。节点注册表在 `web/src/lib/canvas/node-registry.ts`（`getNodeSpec`、`isRegisteredNodeType`），注册节点渲染组件在 `web/src/components/canvas/nodes/hemosi-nodes.tsx`。新节点类型按同一方式注册，标识用 `storyboard`。
- 节点数据：`CanvasNodeData { id, type, title, position, width, height, metadata }`；`CanvasNodeMetadata` 已有 prompt、model、size、seconds、images[]、versions[]（历史版本，含 kind/content/storageKey/prompt/model）、texts[]、anchorKind/anchorText/anchorImages（S0 删除）、shotDescription/shotImage/shotVideo/shotStatus、viralBlueprint/viralSourceNodeId、directorScene 等字段。本次在 metadata 上新增 `storyboard` 字段存分镜表数据（见 5.1）。
- 连线：`CanvasConnection { id, fromNodeId, toNodeId, kind }`，kind = reference / input / continue 三类语义。
- 渠道配置：`web/src/stores/use-config-store.ts` —— `AiConfig.channels: ModelChannel[]`，`ChannelModel` 带 capability（image / video / text / audio）；`ApiCallFormat` = openai / gemini / anthropic / bfl / kling / runway / ark；官方预设 `OFFICIAL_CHANNEL_PRESETS`（DeepSeek、OpenAI、Gemini、Anthropic、BFL、Kling、Runway、火山方舟）。按模型名找渠道有现成函数（同文件内 `findChannel` 一类逻辑）。
- 看视频的缺口：`services/api/image.ts` 里已有 gemini 原生格式（`toGeminiParts`、`GeminiPart` 已带 `inlineData`/`fileData`），但 `AiTextMessage` 的 content 只有 `text` 与 `image_url` 两种，`toGeminiImagePart` 把 fileData 的 mimeType 写死为 `image/png`，也没有 `videoMetadata`（片段起止、帧率）与 File API 上传。第 11 节需要补上，见 11.10。
- 生成调用层：`web/src/services/api/` —— 图片 `image.ts`（`requestGeneration`、`requestEdit`、文本问答 `requestImageQuestion`）、视频 `video.ts`（`createVideoGenerationTask`、`pollVideoGenerationTask`、`waitForVideoGenerationTask`、`storeGeneratedVideo`）、音频 `audio.ts`（`requestAudioGeneration`、`storeGeneratedAudio`）、`anthropic.ts`（`requestAnthropicText`）、`model-plugin.ts`。文本生成走与文本节点相同的现行路径（按 AiConfig + text 能力模型调用）。
- 生成状态与日志：`web/src/stores/canvas/use-generation-log-store.ts`、`web/src/pages/canvas/hooks/use-generation-tracker.ts`。把结果回填节点 metadata 的写法按图片、视频节点现行生成流程（`web/src/components/canvas/canvas-node-generation.ts`）来，不参考镜头节点。
- 爆款复刻现有代码：`web/src/lib/canvas/viral-clone.ts`（`ViralBlueprint` 等类型、`extractLocalVideoCuts`、`parseSubtitlesToCuts`、`buildLocalHeuristicBlueprint`、`analyzeBlueprintWithFreeLlm`、`transcribeVideoWithAdapter`、`synthesizeBeatTtsWithAdapter`、ASR/TTS 的 DEFAULT_*_CONFIG、`buildSrtFromBlueprint`、草稿存取与 zip 导出），被 `canvas-viral-clone-modal.tsx`（v0.21.7 的复刻对话框）与 `hemosi-nodes.tsx` 的 viral-clone 节点（`runBreakdown`，无视频时塞三段假切点）引用。复刻按第 11 节重做：复刻工程取代蓝图类型，只复用其中的 zip 导出工具；其余按第 12 节处理。
- 桌面服务：`desktop/main.js` 用 `desktop/server.js` 的 `createAppServer/listen`，`PREFERRED_PORT = 23230`，只监听 127.0.0.1，带 `/__proxy/` 转发。v0.21.7 的 `desktop/sidecar-routes.js` 已挂进 server.js（`/health /probe /cut /frames /compose`，内部真调 ffmpeg/ffprobe）。Web 版没有桌面服务时这些端点不可达，功能按 9.4 降级。
- 规范：仓库 `AGENTS.md` 全部规则有效（最少行数、不顺手重构、不改无关文件、不写旧数据兼容、业务数据用 localforage、文案全中文、画布 UI 用主题 token、扁平无阴影）。新依赖只许 immer、zod（仓库已有则复用）；测试用仓库现有的 bun test。

## 3. 名词

- **分镜表节点**：画布上 type = `storyboard` 的注册节点，内含设定列表与若干视频行，是 Agent 写分镜的落点。
- **节点 ID**：每个画布节点有一个固定短 ID，显示在节点头上，按类型加前缀计数：图1、视1、文1、音1、表1（分镜表）…；建节点时分配，删除后不复用，排序、移动都不变。所有 @ 引用都用它。
- **分镜行（row / S01…）**：分镜表里的一行 = 一镜（一条视频）：外层展示 10 列常规分镜（`镜号 S01、时长、景别、运镜、画面内容〔静态〕、人物动作〔单一动作〕、台词/旁白、音效、出场角色/场景、转场/备注`）；内层折叠收起该镜的 `imgPrompt`（图片提示词）与 `vidPrompt`（视频提示词）。
- **模型提示词模板**：分镜表顶部折叠栏里的两个通用规范文本框（「图片模型通用规范」「视频模型通用规范」），根据不同图片/视频模型的特性编写，供 Agent 生成每镜折叠提示词时遵循。
- **与画布节点的联动**：
  1. **左侧参考资产图片节点**：设定区里的每个角色（`R1`）、场景（`S1`）、物品（`P1`）绑定画布左侧的一个普通图片节点（`@图1`、`@图2`…）。若先出分镜表时画布上还没有图，`applyPlan` 自动在分镜表左侧创建待生图的图片节点并填入外观生图词。
  2. **右侧每镜首帧图节点 + 视频节点**：每建一镜（如 `S01`），画布右侧自动创建并对齐一对节点——**首帧图片节点（`图n`）**与**视频节点（`视n`）**。
  3. **双向同步与自动连线**：本镜「出场角色/场景」里 `@` 到的左侧参考图片节点自动连入本镜的**首帧图片节点**（以及视频节点）；分镜表行内折叠的 `imgPrompt` 与首帧图片节点的 `prompt` 双向同步，折叠的 `vidPrompt`（含 `@图片` 引用映射）与视频节点的 `prompt` 双向同步，时长 `duration` 与视频节点的 `seconds` 同步。首帧图片节点自动作为首帧连入同行的视频节点。
- **方案（Plan）**：Agent 输出的结构化修改方案（第 7 节），先预览、经用户勾选确认后才写入。
- **复刻工程**：爆款复刻的唯一真相（11.2），包括脚本、人物、挂点、各轨道、样式配方、变量、变体与构建记录，存于 viral-clone 节点。
- **挂点**：台词里某几个字（区间）或某个字的开头或结尾（瞬间），B-roll、屏上文字、组件、音效、字幕高亮都挂在挂点上，不写死秒数。
- **变体**：复刻工程不动，一组变量取值对应一个变体；只重做受影响的段和轨道项，其余复用。

## 4. 总体架构与集成点

分层：画布 UI（分镜表节点 + Agent 面板）→ 画布 store（use-canvas-store，唯一状态源）→ 领域纯函数（previewPlan / applyPlan / 排布 / 状态派生）→ 调用层（已有 services/api + 第 9 节本地处理）。

1. 分镜表数据只存两处：分镜表节点的 `metadata.storyboard`，与下游节点的 metadata（结果、版本、状态）。画布项目本身已持久化，分镜业务数据就随项目走。
2. Agent 改画布走本次新写的纯函数：输入当前项目的 nodes/connections 与勾选的变更，算出新的 nodes/connections，一次 `updateProject` 写入。分镜表内部行编辑走同一项目的 updateProject。
3. 生成走 `web/src/services/api/` 现有函数 + `use-config-store` 的渠道。提示词由提示词文本节点按文本节点现行生成流程产出；视频由视频节点按现行视频生成流程产出。选模型的数据来自 config store 里对应 capability 的已配模型。
4. 界面入口：画布工具栏/右键菜单「新建分镜表」（在画布上落一个分镜表节点）；分镜表节点上的「打开 Agent」；爆款复刻从视频节点右键、画布工具栏、Agent 面板按钮打开复刻工作区（11.7）。

## 5. 数据模型

### 5.0 节点 ID 与 @ 引用

- 节点 ID 存在节点 `metadata.refId`（如 `图3`）；计数器存画布项目上（每种前缀一个，只增不减）。新建、复制、粘贴节点都分配新 ID。
- 前缀：图片 图、视频 视、文本 文、音频 音、分镜表 表；其它注册节点按节点注册表的中文短名取一个字，写进注册表。
- 画布现有提示词框的 @ 不动：它只列连到本节点的输入（`buildNodeMentionReferences` → `getMentionResourceNodes`），编号「图片1、图片2」是按连线顺序排的位置号，发给模型时靠这个位置号对应第几张参考图（`imageReferenceLabel`、`buildImageReferencePromptText`）。refId 只用于显示和分镜表引用，不进模型。
- 分镜表的 @ 候选不受连线限制：列整张画布的图片节点（main 里已有 `buildCanvasResourceReferences(nodes)`，目前没有调用方，接上即可）＋本表设定＋本表视频行 ID。输入组件复用 `CanvasPromptChipInput`（它只吃一个 references 列表，不管来源）。
- @ 到的图片节点自动连到该行的视频节点，连线顺序 = 本行参考图顺序（5.1）；@ 增删时同步增删连线。这样到了视频节点，它们就是「连进来的输入」，节点自己的 @ 照常可用。
- 拼需求文本时，`@图3` 换成它在本行参考图里的位置号（如「图片2」），与视频节点发给模型的编号一致；refId 不写进需求文本。
- 打开项目时，没有 `refId` 的节点按当前节点数组顺序补发一次。
- @ 标记在文本里以 `@` + ID 保存（`@图3`、`@S1`、`@视3`）；被引用的节点删除后，标记变红显示「已删除」，需求文本里原样保留并在确认卡上警告。

### 5.1 分镜表（存分镜表节点 metadata.storyboard，采用 AI 短剧共识版 10 列 + 每行内层折叠图片/视频提示词）

```ts
type StoryboardData = {
  schemaVersion: 1;
  imageModelRule: string;             // 图片模型通用规范（适配当前图片模型特性的提示词模板，顶栏折叠编辑）
  videoModelRule: string;             // 视频模型通用规范（适配当前视频模型特性的提示词模板，顶栏折叠编辑）
  settings: SettingItem[];            // 本表出场角色/场景/物品设定，绑定左侧画布图片节点 @图n
  rows: StoryboardRow[];              // 数组顺序 = 成片分镜顺序（S01、S02…）
};
type SettingItem = {
  id: string;                         // 'R1'、'S1'、'P1'…，表内唯一；R = 角色，S = 场景，P = 物品
  kind: 'person' | 'scene' | 'prop';
  name: string;
  desc: string;                       // 外观描述；自动绑定画布图片节点 @图n（无现成图时自动创建待生图占位图片节点）
};
type StoryboardRow = {
  id: string;                         // 内部 id
  code: string;                       // 镜号：'S01'、'S02'…
  duration: number;                   // 时长（秒，如 4、5、6）
  shotSize: string;                   // 景别（全景 / 中近景 / 近景 / 特写 / 远景等）
  move: string;                       // 运镜（固定 / 缓推 / 微推 / 缓摇 / 跟拍等）
  staticScreen: string;               // 画面内容（静态构图，给生图，一个字不提运动）
  action: string;                     // 人物动作（单一动作，给图生视频）
  line: string;                       // 台词 / 旁白（含声线或画外标记，无则「——」）
  sfx: string;                        // 音效（落点音效，无则「——」）
  refs: string;                       // 出场角色 / 场景（可含 @R1、@S1、@图n）
  note: string;                       // 转场 / 备注（如开场定场、反应镜、本场收尾 BGM 渐起）
  imgPrompt: string;                  // 折叠在行内的「图片提示词」（由 Agent 结合全剧上下文 + imageModelRule 直接写出，可展开手改）
  vidPrompt: string;                  // 折叠在行内的「视频提示词」（由 Agent 结合全剧上下文 + videoModelRule 直接写出，可展开手改）
  imageNodeId: string;                // 本镜右侧对应的首帧图片节点 id（图n）
  videoNodeId: string;                // 本镜右侧对应的视频节点 id（视n）
};
```

- **核心填法与 Agent 生成铁律**：
  1. **外层给人审阅（10 列标准 AI 短剧分镜表）**：`镜号｜时长｜景别｜运镜｜画面内容（静态，给生图）｜人物动作（单一动作，给图生视频）｜台词/旁白｜音效｜出场角色/场景｜转场/备注`。画面内容只写静态构图、不提运动；人物动作只写单一连贯动作。
  2. **内层给机器生成（默认折叠在每一镜 `S01` 下方的二级抽屉）**：点击镜号 `▸ S01` 展开本镜的 **`图片提示词`** 与 **`视频提示词`**。这两段提示词不拆去外部独立文本节点，直接由拥有全剧上下文的导演 Agent 结合顶部的 `imageModelRule`（图片模型通用规范）与 `videoModelRule`（视频模型通用规范）一次性生成，平时默认折叠不干扰审稿，抠细节手改时才点开编辑。
  3. **参考图与下游节点自动串联**：设定区新增角色/场景/物品若无现成图片，自动在分镜表左侧创建待生图图片节点（`图n`）；分镜表右侧每镜对应一个首帧图片节点（吃本镜 `imgPrompt` + 出场设定参考图）和一个视频节点（吃本镜首帧图 + `vidPrompt`）。

### 5.2 下游节点字段与联动

| 数据 | 落点 |
| --- | --- |
| 行与节点的对应 | `StoryboardRow.imageNodeId`（本镜首帧图节点） / `videoNodeId`（本镜视频节点） |
| 提示词同步 | 行内折叠的 `imgPrompt` ⇄ 首帧图节点 `metadata.prompt`；行内折叠的 `vidPrompt` ⇄ 视频节点 `metadata.prompt`（将其中的 `@图n` 自动转换为下游节点已连入参考图的 `@[node:id]` 引用） |
| 全部历史版本（takes） | 首帧图节点与视频节点的 `metadata.versions[]`（现成字段：kind/content/storageKey/prompt/model/createdAt） |
| 当前选中版本 | 沿用现行图片节点、视频节点的 `content/storageKey` |
| 运行状态（queued/running/error） | 节点 `metadata.status` 与 `errorDetails`，error 存接口返回原文 |
| 用户手改的提示词 | 用户在折叠区或下游节点手改 `imgPrompt`/`vidPrompt` 后标记 `manualPrompt: true`：改外层 10 列分镜时只提示「分镜已改，提示词未重算」，提供「按本镜分镜重新生成提示词」按钮，不强行覆盖手改词 |
| 用户拖动后的位置 | 节点 `position` 被拖动后在 metadata 记 `manualPos: true`，自动排布跳过它 |

### 5.3 状态派生

节点健康状态派生得出：`health(node) = error > running > 无产物为 idle > inputsHash 不一致为 stale > ok`。
- 首帧图片节点：`inputsHash = hash(imgPrompt + 排序后的角色/场景参考图 key + 图片模型 + 节点参数)`。
- 视频节点：`inputsHash = hash(vidPrompt + 本镜首帧图当前版本 key + 附加参考图/音色 key + 视频模型 + 节点参数)`。
改分镜提示词、或上游参考图/首帧图切换了新版本，下游自动变 stale。

### 5.4 历史与撤销

分镜表编辑与 Agent 应用共用画布项目的撤销体系：一次 applyPlan = 一次 updateProject 写入 = 一个撤销步；用户连续文本输入 500ms 内合并为一步。撤销只回退引用与文本，媒体文件保留。

### 5.5 排布

关联节点位置由纯函数算出：以分镜表节点为锚，左侧排一列角色/场景/物品设定参考图片节点（`图1~图k`），右侧按分镜行顺序排两列（第 1 列：每镜的首帧图片节点；第 2 列：每镜的视频节点），每行一对与该分镜行水平对齐。自动排布只在新建行、应用 Plan、点「整理」时执行；带 `manualPos` 的节点保持原位。

## 6. 分镜表节点 UI 与交互（视觉细节以 UI v6 为准，下面是落地清单）

- 节点头：`refId`（如 `表1`）、标题（默认「分镜表」，可改名）、「N 镜 · 总时长」chip、「已出 x/y」chip、按钮：`提示词模板 ▾`、`＋ 分镜`、`重生过期`（有 stale 时出现）、模式选择与出片按钮（手动/半自动/全自动，见第 10 节）。
- 提示词模板折叠栏（位于表头下方，默认折叠）：展开后左右并排两个多行编辑框——`图片模板` 与 `视频模板`。
- 设定区：一行编号 chip（如 `R1 〈角色 1〉`、`S1 〈场景 1〉`、`P1 〈物品 1〉`），点开编辑名称与描述（描述绑 `@图n` 图片节点）；`＋ 角色`、`＋ 场景`、`＋ 物品`。
- 10 列主分镜表：列头固定为简洁短词 `镜号｜时长｜景别｜运镜｜画面内容｜人物动作｜台词｜音效｜角色 / 场景｜备注`（严禁在列头和界面上堆砌括号注释），每格均为多行无截断可编辑文本框，支持 `@` 引用设定与图片节点。
- 行内二级折叠提示词抽屉（默认折叠收起）：点击每行第一列的镜号徽章（`▸ S01` / `▾ S01`），在该行正下方展开/收起双栏卡片——左栏标题仅写 `图片提示词`（配「生成图片」按钮），右栏标题仅写 `视频提示词`（配「生成视频」按钮）。正式代码中严禁写死任何剧情案例。
- 连线与高亮：分镜表节点与模板节点、下游节点的连线用画布现有连线渲染；悬停某行时只高亮该行相关的节点与连线（其余降透明），实现上切 class/样式。
- 时间条：一段 = 一条视频，按视频节点时长排布，段上写「@视n · k 镜 · 时长」，段状态色与行状态一致；点击段跳到对应行展开。
- 全屏预览与拖入：下游图片/视频节点沿用画布现行无边框全屏预览；支持直接拖入本地图片/MP4 作为该节点的一个版本（与 API 生成的版本平级切换）。
- 缩放：分镜表节点沿用画布现行 LOD 行为，节点内部使用画布现有相机变换。
- Agent 面板：右侧面板两页签（导演 / 属性），面板顶部有「爆款复刻」按钮，打开复刻工作区（第 11 节）；顶部一行放模型选择（数据来自 config store）与设置入口；composer 的 @ 引用取自当前选区（选中行/节点自动成为引用，可手加）；面板其余规范见第 7 节。

## 7. Agent 协议（Plan 同时产出 10 列分镜 + 每镜折叠的图片/视频提示词，并与画布节点联动）

```ts
type RowInput = {
  code?: string;          // 'S01'、'S02'…
  duration: number;       // 时长（秒，如 4、5、6）
  shotSize: string;       // 景别
  move: string;           // 运镜
  staticScreen: string;   // 画面内容（静态，给生图，一个字不提运动）
  action: string;         // 人物动作（单一动作，给图生视频）
  line: string;           // 台词 / 旁白（无则「——」）
  sfx: string;            // 音效（无则「——」）
  refs: string;           // 出场角色 / 场景（含 @R1、@S1、@图n）
  note: string;           // 转场 / 备注
  imgPrompt: string;      // Agent 按 imageModelRule + 全剧上下文直接写好的本镜图片提示词（折叠在行内）
  vidPrompt: string;      // Agent 按 videoModelRule + 全剧上下文直接写好的本镜视频提示词（折叠在行内）
};

type Change =
  | { id: string; kind: 'row.add'; at?: number; row: RowInput }                        // 应用时同时在右侧新建首帧图片节点与视频节点并连线
  | { id: string; kind: 'row.update'; rowId: string; patch: Partial<RowInput> }        // 同步更新分镜列、折叠提示词与对应节点
  | { id: string; kind: 'row.remove'; rowId: string }
  | { id: string; kind: 'row.move'; rowId: string; to: number }
  | { id: string; kind: 'setting.add'; setting: Omit<SettingItem, 'id'> }              // 若无现成 @图n，自动在左侧建待生图图片节点
  | { id: string; kind: 'setting.update'; settingId: string; patch: Partial<Pick<SettingItem, 'name' | 'desc'>> }
type Plan = { summary: string; changes: Change[]; suggestRun?: { rowIds: string[]; kind: 'image' | 'video' | 'both' } }
```

1. **输入上下文**：分镜表完整快照（设定列表 `R1/S1/P1`；每镜 `S01…` 的 10 列内容 + 折叠的 `imgPrompt` / `vidPrompt`；画布上已有图片节点的 `@图n` 与标题）、当前选中行、以及分镜表顶栏配置的 **`imageModelRule`（图片模型通用规范）** 与 **`videoModelRule`（视频模型通用规范）**。因为 Agent 自身处于同一条文本 AI 上下文链路中，拥有全剧完整上下文，所以由 Agent 一次性写出**外层 10 列分镜**与**内层折叠的图片提示词、视频提示词**，保证前后剧情、人物服饰、光影与镜头衔接完全一致。
2. **输出约束**：用 JSON Schema 约束输出（渠道走 OpenAI 兼容形状时用 `response_format`；其它渠道格式按该渠道现行文本调用的约束方式），再用 zod 校验。校验失败时把错误信息带回重试，最多 2 次；仍失败则把原始输出与错误一并展示给用户。
3. **previewPlan**：纯函数。输入当前分镜表数据 + Plan + 勾选的 enabledIds，输出 `{ next, diff, warnings }`。warnings 包括：目标行不存在、引用了不存在的设定编号、跳过已手改提示词的字段、删除超过 3 行。
4. **UI**：PlanCard 每条 Change 一个复选框；GhostLayer 用 diff 在画布覆盖层渲染虚线幽灵（幽灵画分镜表行变化、左侧将新增的待生图设定节点、右侧将新增的首帧图节点与视频节点位置）；勾选变化实时重算预览。
5. **applyPlan（分镜表与画布节点全自动联动）**：
   - `setting.add`：若 `desc` 中没有现成 `@图n`，自动在分镜表左侧新建待生图的画布图片节点（分配固定 `refId` 如 `图1`，将设定外观描述写入其 `metadata.prompt`），并把 `@图1` 自动填入该设定的 `desc`。
   - `row.add`：在分镜表新增一行 `S0k`（含 10 列与折叠的 `imgPrompt`、`vidPrompt`），同时在分镜表右侧新建一对画布节点——**首帧图片节点（`图m`）**与**视频节点（`视k`）**：
     - 将 `imgPrompt` 写入首帧图片节点的 `metadata.prompt`；
     - 将 `vidPrompt` 写入视频节点的 `metadata.prompt`，并将 `duration` 写入视频节点的 `metadata.seconds`；
     - 自动建立连线：`本镜 refs 引用的左侧角色/场景图片节点 ➔ 首帧图片节点`（作为生图参考），`首帧图片节点 ➔ 视频节点`（作为首帧 `imageRole: 'firstFrame'`），以及附加参考图连入视频节点。
   - `row.update`：更新分镜表对应行的 10 列及折叠的 `imgPrompt`/`vidPrompt`（若用户已手改提示词则保留手改版并提示），同步更新右侧首帧图节点与视频节点的 `prompt`、`seconds` 及参考图连线。
   - `row.remove`：对应的首帧图片节点与视频节点按 PlanCard 选项删除或保留为普通节点。整体作为一条事务一次 `updateProject` 写入（见 5.4）。
6. **生成的触发**：Agent 返回 `suggestRun`，UI 渲染成按钮，用户点击后进入生成确认卡（生首帧图时：图片模型、渠道、`imgPrompt` 全文与参考图；生视频时：视频模型、渠道、`vidPrompt` 全文与首帧图/参考图）。半自动/全自动档位按第 10 节。
7. **模型来源**：Agent 的文本模型从 config store 按 text 能力选（面板顶部选择器），调用走现行文本生成路径。

## 8. 生成与队列

1. 每个分镜行分两步，直接驱动右侧对应的画布节点生成：
   - **生成首帧图**：本镜右侧的首帧图片节点以行内折叠的 `imgPrompt` 为提示词、所连的左侧角色/场景图片节点为参考图，走 `requestGeneration` / `requestEdit` 出图，结果写回该首帧图片节点（并在分镜表第 1 列左圆点标绿）。
   - **生成视频**：本镜右侧的视频节点以行内折叠的 `vidPrompt` 为提示词、本镜已生成的首帧图片节点为首帧（外加所连参考图），走 `createVideoGenerationTask` + 轮询 + `storeGeneratedVideo`，结果写回该视频节点（并在分镜表第 1 列右圆点标绿）。
   - **生成设定参考图（可选）**：左侧处于「待生图」的角色/场景/物品图片节点，可直接按其 `prompt` 一键生图或拖入本地图。
   分镜表行内折叠区的「生成图片 / 生成视频」按钮、下游节点自身的生成按钮、Agent 的 suggestRun，都先出确认卡（模型、渠道、完整提示词全文与参考图）→ 用户确认 → 调用 → 结果回填节点 metadata（产物 + versions 追加 + 状态更新）。
2. 队列：统一队列，支持取消；并发：远程渠道 3，本机渠道（渠道地址指向本机/局域网的）串行 1。各条视频互不依赖，各自生成；连贯只靠需求文本里的【衔接】一行。不做尾帧接首帧。
3. 多版本：每次生成往节点 versions 追加一条；用户切换选中版本即换主版本，下游 inputsHash 随之变化、自动 stale。
4. 失败处理：节点状态置 error，存接口返回的原文原因，提供「改参数重跑」；模型不可用时报现行 `modelNotReadyReason` 一类明确原因。
5. 确认卡内容：做什么（哪几条视频、写提示词还是出视频）、用哪个渠道哪个模型、完整输入全文（需求文本或提示词）与参考图。

## 9. 本地处理能力

处理能力统一走下面的 Provider 形状（内部抽象）：

```ts
interface Provider<I, O> { id: string; kind: string; health(): Promise<'up' | 'down'>; run(input: I, signal: AbortSignal): Promise<O> }
```

| 能力 | 接口 | 来源 |
| --- | --- | --- |
| 文本（Agent、写提示词） | 走已有渠道的文本调用 | config store 按 text 能力选 |
| 图片 / 视频 | submit → poll → fetch（services 层已实现） | config store 渠道 |
| 抽帧、缩略图、拼接、合成、字幕烧录 | 桌面 sidecar HTTP（9.4） | 本机 ffmpeg；Web 版合成位置放顺序预览拼接 |

9.1 健康探测：前端启动时探测 sidecar 与各处理能力，在设置/面板对应位置显示「可用 / 未启动」；探测失败只提示，其它功能照常可用。

9.2 台词与时间信息：参考原片的分段、时间码、台词由 gemini 看原片产出；复刻成片的逐词时间由 gemini 对每段生成结果做对齐（11.6），挂点、字幕、SRT 都按对齐后的时间。手工分镜的台词由用户或 Agent 写进需求，再由文本生成写进视频提示词。

9.3 时长口径：每条视频的时长以视频节点的时长参数与生成产物的实际时长为准。

9.4 Sidecar：端点实现沿用 v0.21.7 的 `desktop/sidecar-routes.js`（`/health /probe /cut /frames /compose`，内部真调 ffmpeg/ffprobe；`/compose` 返回真实 MP4 文件，状态才标完成）。它挂在桌面版现有服务 `desktop/server.js` 上（监听 127.0.0.1:23230）；前端用桌面服务的同源地址调用（Web 版同源探测不到即视为无 sidecar）。合成编码优先 h264_nvenc（桌面机为 N 卡），不可用时回退 CPU 编码并在结果里注明。顺序预览拼接（Web 版）是预览，界面标注写「预览拼接」。

9.5 字幕烧录与画面层渲染：合成时字幕/图形层走本地渲染——ffmpeg 字幕滤镜能满足的用 ffmpeg；需要富动效组件的走无头 Chromium 渲染带透明通道的画面层，再与视频合成。两者同入健康探测清单。

## 10. 自动模式（一键出片）

- 三档：**手动**（默认，Agent 只出方案、生成逐批确认）、**半自动**（Agent 方案自动采纳，生成按批确认）、**全自动**（一次确认后从剧本到合成全部自动跑，只在出现例外时打断）。
- 全自动的确认卡只在开始时出现一次，内容：视频条数、所用文本与视频模型和渠道、重试上限（与第 8 节确认卡同格式）。
- 流水线是可暂停、可取消、可断点续跑的状态机：写 Plan → 自动采纳全部 → 设定图（只补缺图且连了设定图模板的设定）→ 各条提示词 → 各条视频→ 预览拼接 → 合成。暂停/取消后不再提交新任务；续跑按已完成状态接着跑，界面显示「已完成 x/y 条，继续」。
- 自动质检（可开关）：用已有渠道的视觉模型对照该行需求文本给每个产出打分，低于阈值自动重生，每条最多 3 次，自动选分最高的一版；分数同时展示给用户，用户可改选。没有配视觉模型时此开关置灰，选版由用户肉眼完成。
- 例外处理：内容审核失败时，让提示词文本节点按原需求重新生成提示词并重试 1 次；仍失败就标记该条失败，继续其余视频。
- 终点汇总一次：如「完成 4/5 条，@视4 失败」，有问题的那条点进去单独重生。
- autopilot 是调度器，复用 previewPlan/applyPlan、已有生成调用与队列。

## 11. 爆款复刻（对标 Hypit：用户的内容重做整条视频，产出成片）

### 11.1 目标与产出

输入一条参考原片和用户的内容（话题或产品、人设、手头素材、要保留与要改的部分），产出一条**渲染好的成片 MP4**，外加一份可继续编辑、可批量出变体的**复刻工程**。复刻不止拆脚本，对标的是原片的整套做法：开场钩子、段落结构、语速与节奏、人物与说话方式、B-roll 插入的位置、字幕版式与逐词高亮、屏上文字与贴纸、转场与特效、BGM 与音效。

全程六步，都在复刻工作区（11.7）里完成：

1. **拆解**：gemini 模型看原片，产出复刻工程草稿和拆解笔记（11.3）。
2. **改写**：按用户的内容改写脚本，保留结构、节奏和效果挂点（11.4）。
3. **素材**：每段的主画面、B-roll、人物，可以生成，也可以用用户的素材（11.5）。
4. **卡位**：字幕、B-roll、屏上文字、贴纸、音效全部挂在台词的字上，生成完按真实语音自动对上时间（11.6）。
5. **渲染**：所有轨道合成一条成片（11.8）。
6. **变体**：换钩子、人设、卖点、语言、素材，批量出多条；没改的部分直接复用，不重新生成（11.9）。

实现原则：只借鉴 Hypit 的机制，代码全部自己写。Hypit 的源码、SVML 语法、CLI、凭据不进本仓库，也不打进安装包；付费聚合服务不接入。

### 11.2 复刻工程（唯一真相，zod 定义并校验，带 schemaVersion）

复刻工程存在画布上 viral-clone 节点的 `metadata.cloneProject` 里，随画布项目保存。画布展开、成片和变体都由它派生。

| 字段 | 内容 |
| --- | --- |
| `meta` | 标题、画幅、帧率、语言、体裁；参考原片只存哈希与时长，不存原片 |
| `characters[]` | `id`、称呼、定位（主持 / 嘉宾等）、外形设定、声线描述、关联图片节点 id（定妆图）；是否来自原片真人（来自原片真人时默认不把其人脸当生成参考） |
| `script.segments[]` | 段：`id`、序号、角色（钩子 / 铺垫 / 论证 / 转折 / 兑现 / 行动号召）、参考原片里对应的起止时间、预估时长、主画面来源（生成 / 用户素材 / 纯图形）、主画面提示词、锁定标记；每段可以单独生成、单独验收、单独重做 |
| `script.segments[].lines[]` | 台词行：说话人（character id）、显示文字与念出文字（两者可以不同，例如字幕显示「9:30」、实际念「九点半」）、行内挂点标记 |
| `hooks[]` | 挂点：`id`；类型为区间（从某个字开始、到某个字结束）或瞬间（某个字的开头或结尾）；也可以挂在段的开头或结尾；区间允许嵌套与交叉 |
| `tracks.broll[]` | B-roll：挂到哪个区间挂点、来源（生成图片或视频 / 用户素材）、提示词、在画面里的位置、填充方式、进出场动效、层级 |
| `tracks.text[]` | 屏上文字：内容、挂到哪个挂点、版式样式、位置、层级 |
| `tracks.components[]` | 组件：贴纸、评论卡、排行榜、卡片堆叠等，`组件类型 + 参数`，挂到挂点；原片里有但组件库还做不出来的，标「不可复现」 |
| `tracks.audio[]` | BGM 与音效：来源（用户素材 / 本地素材库）、挂点或整片、音量、淡入淡出；各段生成视频自带的原生音频作为人声轨 |
| `styles` | 样式配方：字幕（位置、字号、字重、描边、阴影、底框、最多几行、每行最多几个词、逐词高亮方式「关 / 当前词 / 已读拖尾」、高亮色、进场动效）、屏上文字、B-roll 画面处理、整片（画幅、底色） |
| `variables[]` | 变量：键、标签、类型（文本 / 图片 / 枚举 / 语言）、默认值、作用范围（哪些段、哪些轨道项） |
| `runs[]` | 变体：一组变量取值对应一个变体，各自记录产物 |
| `builds[]` | 构建记录：构建号、时间、每一项是复用还是新生成、产物文件、失败原因 |
| `notes` | 拆解笔记：按段落记录，可以直接改；改笔记不用重新跑拆解 |
| `provenance` | 拆解用的模型与渠道、应用版本、`schemaVersion` |

### 11.3 拆解：gemini 看原片

- **入口**：三处入口打开同一个复刻工作区：视频节点右键「复刻这条视频」、画布工具栏的「爆款复刻」、Agent 面板的「爆款复刻」按钮。打开时在画布上建一个 viral-clone 节点，与原视频节点连线。
- **确认卡**：开始前列出要发送的内容（原片文件名、时长、大小）、所用模型与渠道。点取消不发任何请求。第一次使用时提示一句：原片会发给你配置的那个 gemini 渠道；如果用的是免费层，按 Google 条款，内容可能被用于改进其产品。
- **渠道要求**：只能用 apiFormat 为 gemini、且能读视频的已配模型。没有这样的模型时，拆解按钮置灰并写明原因，不换别的模型，也不退回本地启发式。
- **第一遍，看整片**：gemini 读整条原片（画面 + 原声），产出：
  - 分段与每段起止时间、全片台词与说话人、钩子类型、结构、语速（每段字数 ÷ 时长）；
  - 字幕样式：位置、字号感、描边或底框、是否逐词高亮、高亮色、每行字数；
  - B-roll 出现在哪几句话、哪几个字上，以及画面内容和位置；
  - 屏上文字、贴纸与图形出现在哪个字上，写的是什么；
  - 转场、BGM 情绪、音效出现在哪个字上。
- **第二遍，逐段补细节**：每段只送这一段的原片区间（`videoMetadata` 起止偏移），连同第一遍对这一段的结论，补全镜头、屏上文字、处理方式，并标出拿不准的地方。
- **重看**：笔记里标了「不确定」的条目，或用户在笔记上点「重看此段」时，只送该段区间，并调高采样帧率。
- **产出**：复刻工程草稿与拆解笔记。原片里的台词与样式只用来参考结构；成片里的台词、人物、素材都来自用户的内容。
- **校验**：拆解结果必须过 zod 校验，且时间码不越出原片时长、相邻段不重叠。不通过时把错误回喂给模型重试一次；仍不通过就保留原始输出，让用户手改。
- **原片处理**：本地不切镜、不出网格图、不单独抽音频。原片超过 gemini 内联上限时，走 File API 上传后再引用，上限以 Google 官方文档为准，代码里不另设。全流程可以取消，并显示进度。

### 11.4 改写：换成用户的内容

- **用户的输入**：工作区左上的「我的内容」栏，填写话题或产品、目标人群、人设、要保留的部分（如只要开场、只要字幕风格）、要改的部分；可附上图片或视频素材，素材直接成为该工程的可用素材。
- **改写**：由导演 Agent（右侧面板选定的文本模型）逐段改写台词，保留每段的角色、句数、语速、钩子类型。同时把挂点迁到新台词里语义对应的字上，例如原片「二十块」上的价格贴纸，迁到新台词的价格词上。
- **方案卡**：改写以方案卡形式出现，逐段对照原文与新文，挂点迁移的位置高亮。用户勾选后才写入，可以一次撤销，规则同第 7 节。
- **预估时长**：每段按「新台词字数 ÷ 参考语速」算出预估时长。超过所选视频模型单次可生成的最长时长时，提示把该段拆成两段，由用户确认。
- **实时预览**：生成之前，工作区预览就能按预估时长播放：主画面用占位色块，字幕、屏上文字、贴纸按挂点出现，用来先看节奏与版式。

### 11.5 素材与生成

- **主画面**：每段一条，可选三种来源。
  - 生成：调已配渠道的视频模型，台词写进提示词，由视频原生音频念出；出镜人物连到对应的图片节点作参考，保证各段人物一致。
  - 用户素材：上传视频或图片。
  - 纯图形：不生成，只用组件、文字与 B-roll。
- **B-roll**：生成图片或视频、上传素材，二选一。
- **人物**：`characters` 每人对应一个画布图片节点（定妆图）。默认不把参考原片里真人的人脸当生成参考；只有勾选「我拥有其肖像权」后才可以选用。不提供换脸、克隆声音的预设。
- **生成计划**：生成前先出计划，逐项列出这次要「新生成 / 复用 / 用素材」的内容，以及每项用的渠道、模型、完整提示词，确认后才提交，规则同第 8 节确认卡。
- **画布节点**：生成结果都落在画布节点上。每段主画面、每条 B-roll 各对应一个视频或图片节点，由 viral-clone 节点连出，走第 8 节的队列，版本、状态、重做与分镜表下游节点一致。
- **锁定与复用**：已验收的段可以锁定；之后无论改写还是出变体，锁定段和输入没变的项都直接复用，不重新生成。

### 11.6 卡位：挂在字上，自动对时

- **时间轴**：由各段主画面的实际时长依次排出；还没生成的段用预估时长。
- **对齐**：每段主画面生成后，送 gemini 按该段的念出文字返回每个词的起止时间（中文按词，无法分词时按字）。校验规则：时间单调递增、不越出片段。不通过时，该段退回整句时间，字幕按整句显示、不做逐词高亮，并在该段上标明。
- **落位**：挂点按对齐结果换算成整片上的绝对时间，B-roll、屏上文字、贴纸、音效、字幕逐词高亮都按这个时间落位。改台词、换素材之后自动重新换算，不用手动拖。
- **段边界**：挂在段开头或结尾的挂点，用片段边界时间，不用首字或末字的时间。

### 11.7 复刻工作区（画布里的全屏浮层，不新增路由和页面）

从 viral-clone 节点或三处入口打开，关闭后回到画布，进度保留。

- **顶栏**：步骤条（拆解 → 改写 → 素材 → 卡位 → 渲染 → 变体）、「生成计划…」「渲染…」「对照原片」开关。
- **左栏 · 脚本**：
  - 按段列出台词，每段显示角色、预估或实际时长、主画面状态；
  - 说话人用彩色标签；
  - 显示文字与念出文字不同的地方，用双行显示；
  - 挂点在字上高亮，并标出挂了什么；
  - 选中几个字后可以「挂一个效果」，选 B-roll、屏上文字、贴纸或音效。
- **中间 · 预览**：
  - 竖屏播放器，实时合成预览：主画面、B-roll、字幕逐词高亮、屏上文字、贴纸按时间叠在一起；
  - 打开「对照原片」后，并排显示参考原片，两边按段同步跳转；
  - 下方是轨道时间轴：主画面、B-roll、字幕、屏上文字、组件、音频各一轨；每个块标出它挂的字，点块跳到那里并选中。
- **右栏 · 属性**：显示当前选中项的属性：段、B-roll、字幕样式、文字、组件、音频。改样式配方即时反映到预览。拆解笔记也在这一栏，作为一个页签。
- **底栏 · 变体**：变量表，行是变体、列是变量，有「批量出片」按钮。

### 11.8 渲染

- **桌面版**：
  - 字幕、屏上文字、组件这些图形层，用无头 Chromium 渲染成带透明通道的画面层；
  - 再由 sidecar 用 ffmpeg 把各段主画面、B-roll、图形层合成，并混音（人声轨 + BGM + 音效），输出 MP4；编码规则见 9.4。
  - 每次渲染有独立构建号，记录「复用 N 项、新生成 M 项」与产物文件。失败时保留现场，方便查看。
  - 渲染出真实 MP4 文件才标完成。
- **Web 版**：只有浏览器内的实时合成预览，界面标明「预览」；可以导出复刻工程包。
- **成片落点**：成片落到画布上一个新的视频节点，由 viral-clone 节点连出。

### 11.9 变体

- **变量**：钩子写法、人设或主持人、卖点、语言、B-roll 素材，都可以设成变量。
- **变体表**：每行一个变体。改值后，预览和提示词即时更新，不重跑拆解、不发请求。
- **批量出片**：先出一张总生成计划，列出每个变体新生成和复用的项数、所用模型，确认一次。之后各变体只重做受变量影响的段和轨道项，其余全部复用。
- **失败隔离**：单个变体失败时显示原文原因，可以单独重跑，其余不受影响。各变体的成片与版本互不覆盖。

### 11.10 给 gemini 渠道补视频输入（services/api 内，最少改动）

1. `AiTextMessage` 的 content 增加视频项：视频来源（data URL，或 File API 返回的 fileUri）、mimeType、可选的片段参数（起止秒、采样帧率）。
2. 在 gemini 原生格式下，把视频项转成 `inlineData` 或 `fileData`，mimeType 用视频的真实类型，片段参数写进该 part 的 `videoMetadata`。`toGeminiImagePart` 原有的图片分支不动，只新增视频分支。
3. 新增 File API 上传函数：用该渠道的地址与 Key 上传原片，返回 fileUri，文件处理完成前轮询其状态。
4. 非 gemini 格式（openai、anthropic 等）遇到视频项时，直接报「该渠道格式不支持视频输入」，不能丢掉视频、静默只发文字。
5. 模型名和地址都从渠道配置读取，不写死。

### 11.11 导出复刻工程包

导出一个 zip，包含：

- `project.json`：复刻工程本体；
- `shots/`：各段主画面与 B-roll，按段号命名；
- `captions.srt`：用对齐后的时间；没对齐的段用整句时间，并在 README 里注明是哪几段；
- `final.mp4`：有渲染产物时才包含；
- `README.txt`：记录变量取值、所用模型与渠道。

打包用仓库已有的 zip 库。

## 12. 删除与保留清单（以最新 main 为起点逐项执行）

删除（S0 先做，删完 tsc 通过再开始 S1）：
- `web/src/pages/storyboard/`（整个目录）与 `web/src/router.tsx` 里的 `/storyboard` 路由及 import。
- `web/src/components/storyboard/`（整个目录：AgentPanel、AnchorNode、CommandPalette、DeskNode、DeskRow、DeskRowExpanded、GenerateConfirmModal、GhostLayer、MediaPreviewModal、MiniMap、PlanCard、PreviewStitchModal、RowNode、StoryboardStage、ViralCloneTab、Wires、use-camera）。
- `web/src/lib/storyboard/`（整个目录，含 `__tests__/`：agent-provider、autopilot、history、layout、local-services、media-provider、media-store、plan-schema、plan、queue-runner、queue、types、viral-bridge）。
- `web/src/stores/storyboard/`（use-storyboard-store、use-storyboard-settings-store）。
- 左侧导航的分镜表入口：`web/src/constant/navigation-tools.ts`、`web/src/components/layout/app-sidebar.tsx` 中相关项，以及 i18n 里只给它用的文案。
- `web/src/components/agent/agent-panel.tsx` 里「导演 Agent 已升级为独立分镜表 / 前往分镜表 (/storyboard)」那块。
- 锚点（anchor）节点整套：`HemosiNodeType.Anchor` 与节点注册、`hemosi-nodes.tsx` 里的锚点节点渲染、`CanvasAnchorKind` 与 metadata 上的 anchorKind / anchorText / anchorImages / anchorSlots / anchorVoice，以及以下文件里只为锚点服务的分支：`canvas-node-generation.ts`（`anchorPromptBlock` 一段）、`canvas-reference-roles.ts`、`canvas-node-reference-bar.tsx`、`canvas-resource-references.ts`、`canvas-connection-kind.ts`、`canvas-generation-helpers.ts`、`canvas-layout.ts`、`canvas-node-ops.ts`、`canvas-cinematography.ts`、`pages/canvas/project.tsx`、`pages/projects/detail/index.tsx`。删前全仓搜 `Anchor`、`anchor`，图片节点的参考图功能必须照常可用。
- 不删：`canvas-templates.ts` 的「分镜四宫格」模板（原有功能，与本次无关）。
- 保留文件（`viral-clone.ts` 等）里写死的默认值：写死的 baseUrl、作为默认值的模型名（tts-1、whisper-1、gpt-image-1、video-gen-1、deepseek-chat 等）、音色、端口号（17890、8880、8000 等）。接口路径段（/v1/audio/speech 一类）是形状，可以保留。
- Ollama 分支与本地模型预设代码。
- 价格/时长预估、预算、熔断相关字段与 UI。
- `canvas-viral-clone-modal.tsx` 整个文件；viral-clone 节点的 `runBreakdown` 与三段假切点；`viral-clone.ts` 里除 zip 导出工具以外的复刻代码（`ViralBlueprint` 等类型、`extractLocalVideoCuts` 的复刻调用、`buildLocalHeuristicBlueprint`、`analyzeBlueprintWithFreeLlm`、`transcribeVideoWithAdapter`、`synthesizeBeatTtsWithAdapter`、ASR/TTS 默认配置），删前全仓搜引用，别处还在用的只删复刻调用并在交付说明里列出。

新增：节点 refId 与计数器、分镜表的全画布 @ 候选（5.0）；11.10 的 gemini 视频输入；第 11 节复刻工程、复刻工作区、对齐与渲染。

保留并复用：画布本体与节点体系、渠道配置（use-config-store）、生成调用层（services/api）、viral-clone.ts 的 zip 导出工具、desktop/server.js 与 sidecar-routes.js 的端点实现、3D 导演工作台。不调用也不改动：canvas-agent-ops、镜头节点。

## 13. 施工顺序与阶段自检（全部做完一次交付）

- **S0 清理旧分镜表与锚点节点**：按第 12 节删除清单删干净，全仓搜 `storyboard` 只剩本次无关的「分镜四宫格」模板及其文案，搜 `HemosiNodeType.Anchor` 为零；tsc 通过；画布、复刻以外的功能照常。再按第 2 节逐项核对仓库，与本规格不一致处先报告。
- **S1 分镜表节点**：注册 storyboard 节点类型；metadata.storyboard 数据模型；设定区、模板位、行折叠/展开、拖拽排序、行内镜头增删与时间、悬停连线高亮、时间条；`buildRequirement`；下游提示词节点与视频节点创建/连线/排布；撤销统一。自检：建 3 条视频，每条画布上各有一对提示词节点与视频节点；某条加到 3 个镜头后需求文本含 3 个镜头且时间首尾相接；镜头合计与视频节点时长不等时有提示；能展开、拖动排序、悬停高亮；画面里 @S1 后需求文本展开为设定描述、设定描述里 @ 的图片节点自动连到视频节点；删掉一个图片节点后其它节点的 ID 不变；拖动排序后 @视n 不变；刷新后数据还在，撤销可用。
- **S2 Agent**：Plan schema 与校验重试、previewPlan、GhostLayer、PlanCard、applyPlan（翻译成 metadata 修改 + 节点与连线增改）、suggestRun 确认卡。自检（单测 + 手测）：三个固定指令能产出合法 Plan——写 3 条 10 秒的视频；改 @视2 的镜头1 画面；在最后加一条。取消勾选某条，幽灵预览与应用结果一致；一次撤销回退整次应用；目标行不存在时给出 warning；应用后下游节点按 5.2 正确增减与连线。
- **S3 生成与队列**：确认卡、队列与并发、versions 多版本切换、health/stale 派生、失败原文与重跑。自检：真渠道跑通一条「需求 → 提示词 → 视频」并回填到画布节点；改分镜表文字后提示词节点与视频节点依次变 stale；手改过的提示词节点不被覆盖。
- **S4 本地处理与合成**：健康探测、sidecar 同源调用与真合成、预览拼接。自检：桌面版一键合成出真实 MP4（文件哈希与任一段素材不同）；断开 sidecar 时合成置灰且原因明确。
- **S5 爆款复刻**：gemini 视频输入（11.10）、复刻工程模型与校验、拆解（两遍 + 重看）、改写方案卡、素材与生成计划、对齐与挂点落位、复刻工作区（脚本 / 实时预览 / 轨道 / 属性）、渲染（Chromium 图形层 + ffmpeg 合成混音）、变体批量、工程包导出。自检按第 14 节复刻部分。
- **S6 一键出片**：三档模式与状态机、暂停/取消/续跑、自动质检开关、终点汇总。自检按第 14 节。
- 每阶段结束跑 `tsc` 与相关 `bun test`，输出原文附在交付说明里；跑不了的项写明原因。

## 14. 总验收清单（Muse 实测 + 他本人真机终验）

分镜表与 Agent：
1. 在任意画布项目里新建分镜表节点，连上自己的视频模板文本节点，写 3 条 10 秒的视频、每条几个镜头：行展开/折叠、拖拽排序、镜头增删与时间、@ 引用节点与设定并正确展开、节点 ID 删改后不变、悬停连线高亮、刷新重开数据完整。
2. 对 Agent 说「写 3 条 10 秒的视频 / 改 @视2 的镜头1 画面 / 在最后加一条」三种指令：Plan 合法、PlanCard 勾选与幽灵预览一致、应用后画布上分镜表与下游节点同步变化、一次撤销全退。
3. 任一条先写提示词、再出视频：确认卡的模型、渠道、完整输入与实际调用一致；提示词节点的产物按所连模板的结构写出；视频结果回填到画布节点、versions 多一版；模型不可用时报明确原因。
4. 改分镜表文字、改模板或换上游选中版本：下游节点变 stale；重生后恢复 ok；手改过的提示词节点保持手改版且有明示。
5. 全仓搜索核对：写死的模型名/地址/端口不作为默认值出现；无 Ollama 字样；无金额/耗时预估 UI；左侧导航无分镜表项；无 /storyboard 路由；无锚点节点。

爆款复刻：
6. 视频节点右键「复刻这条视频」：确认卡列明送出的原片、模型、渠道；点取消则零网络请求。未配 gemini 渠道时按钮置灰且写明原因；把渠道换成 openai 格式时报「该渠道格式不支持视频输入」，没有发出只含文字的请求。
7. 拆解完成：复刻工程过 zod 校验；分段与人工分段偏差 ≤ 1；钩子被识别；字幕样式、B-roll 位置、屏上文字各抽查 3 处，与原片对得上，且挂在正确的字上。对一段点「重看此段」：抓请求核对只带该段区间与调高的帧率，只有该段笔记更新。
8. 填入「我的内容」并改写：方案卡逐段对照新旧台词；挂点迁到新台词的对应字上；勾选应用后一次撤销全退。生成之前预览就能按预估时长播放，字幕与屏上文字按挂点出现。
9. 生成计划列出每项「新生成 / 复用 / 用素材」与完整提示词；确认后各段主画面与 B-roll 落到画布节点上；人物在各段一致（连同一个定妆图片节点）；原片真人人脸默认不可选为参考。
10. 对齐：每段生成后逐词高亮与说话同步（抽查 5 处）；改一句台词并重生该段后，挂在其它段的效果位置不变，挂在该段的效果自动随新语音移动；对齐不通过的段整句显示并有标注。
11. 渲染（桌面版）：得到真实 MP4，包含主画面、B-roll、字幕逐词高亮、屏上文字、贴纸、人声与 BGM；构建记录写明复用与新生成项数；成片落到画布新视频节点。Web 版只有预览且标明。
12. 变体：变量表加 3 行（换钩子、换人设、换语言）批量出片：总计划只确认一次；未受影响的段显示为复用、没有重新生成；故意让一个变体失败，其余照常出片，失败的可单独重跑。导出工程包内容完整。

合成与真机终验：
13. 桌面版合成出的 MP4 为真实 ffmpeg 产物（时长 ≈ 各段之和、哈希不同于任一单段）；Web 版只有预览拼接且界面标注为预览。
14. 他本人真机、用真实渠道、在真实画布项目里完整跑通一次「想法 → 分镜 → 生成 → 合成」与一次「原片 → 拆解 → 改写成自己的内容 → 生成 → 卡位 → 渲染成片 → 变体」，签字才算交付。控制台零报错；新增 UI 文案全中文；浅/深主题都正常。

## 15. 禁止与缺失处理

禁止（只此一处汇总）：自创默认值（地址、端口、模型、音色、阈值）；示例值写成默认；失败后悄悄换模型；假验片、假合成、假状态；为本功能新建设置页、store、路由、导航项；顺手重构无关文件；拷贝 Hypit 代码；接付费聚合。

缺失处理：规格没写清、仓库现状与第 2 节不符、需要新增边界值（超时、重试、大小、并发的改动）时，停下按下面格式报告，继续做不受影响的部分：
「缺失/冲突：<是什么>｜影响：<哪一节做不了>｜我的建议：<一句>｜需要你定：<具体问题>」
