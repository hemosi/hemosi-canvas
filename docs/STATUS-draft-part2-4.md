# STATUS（草稿）：第二部分 多模型调度 / 第三部分 Agent / 第四部分 摄像机与灯光

对照 `TASKBOOK-tapnow-2026-11-10.md`。"已做"= 代码已在 main、`bun run build` 通过、`tsc` 只剩基线 1 个错误、单测覆盖；**真实出图/出视频需要 hemosi 填官方 Key 后实测**，本文不把"写了代码"当"已验收"。

## 选型（2026-11-11 查各家官方文档定）

| 类型 | 模型（官方 ID） | 官方接口 | 选它的理由 |
| --- | --- | --- | --- |
| 图像 | `gpt-image-2.6-sunburst`（备选 `gpt-image-2.6-flare`） | OpenAI `/v1/images/generations`、`/v1/images/edits` | OpenAI 当前最新图像模型（2026-11-04 发布）；`gpt-image-1` 已于 10-23 下线 |
| 图像 | `gemini-3-pro-image`（Nano Banana Pro） | Gemini `generateContent` | Google 当前最强图像模型；Imagen 4 已关停，不再接 |
| 图像 | `flux-2-max`（备选 `flux-2-pro-preview`） | BFL `POST /v1/flux-2-max` + `polling_url` | FLUX.2 最高质量档，多参考图（最多 8 张） |
| 视频 | `gemini-omni-1.2-flash` | Gemini Interactions API `POST /v1beta/interactions`（background 轮询） | Veo 3.1 在 Gemini API（API Key）上已于 2026-10-22 关停，官方指定替代是 Omni Flash；3–15 秒、原生音频、首尾帧、最多 6 张参考图 |
| 视频 | `kling-4.0` | 可灵新版 API `POST /{text-to-video\|image-to-video}/kling-4.0`，`GET /tasks?task_ids=` | 可灵最新版（API Key Bearer，3–30 秒，首/中/尾帧） |
| 视频 | `doubao-seedance-2-5-260628` | 火山方舟 `POST /api/v3/contents/generations/tasks` | Seedance 2.5：4–30 秒、最多 50 个多模态参考、首尾帧、原生 `camera_fixed` |
| 视频 | `gen4.5` | Runway `POST /v1/text_to_video`、`/v1/image_to_video`，`GET /v1/tasks/{id}` | Runway 当前旗舰 |
| Agent 文本 | `gpt-5.5` / `claude-opus-5-5` / `gemini-3.8-flash` | OpenAI Responses / Anthropic Messages / Gemini | 用户三选一，填哪家 Key 用哪家 |

不接：Sora 2（OpenAI 已于 2026-09-24 关停 Sora 2 API；原 OpenAI `/videos` 通道代码保留，仅供自有兼容环境）、Luma / Midjourney / Hailuo（本轮未接，见未达标）。**不接任何中转站/返利渠道**：所有预设地址都是厂商官方域名。

## 已做

### 第二部分 多模型调度
- 渠道协议新增 `anthropic`、`bfl`、`kling`、`runway`、`ark`；`gemini` 下 `gemini-omni-*` 自动走 Interactions API。实现：`web/src/services/api/official-providers.ts`（每家一个纯函数拼请求体 + 创建/轮询）、`web/src/services/api/anthropic.ts`。
- 设置→模型渠道→「添加官方渠道」：一键加入 OpenAI / Gemini / Anthropic / BFL / 可灵 / Runway / 火山方舟预设（地址、模型 ID 已填好，只差 Key），渠道编辑器里显示「Key 在哪里拿」。
- 每个节点 / 每个分镜单独选模型（沿用第一部分的节点参数位），分镜的图片模型、视频模型分开选。
- 不静默降级：模型被删、渠道没 Key、没地址时，弹出原因原文（如「渠道『可灵 Kling 官方』还没填 API Key，模型『kling-4.0』不可用…」）并打开设置；协议不支持该能力（例如给视频节点选了 BFL 渠道）直接报错。厂商返回的错误带厂商名和 HTTP 码原样显示，进生成队列可改参重跑。
- 各家参数边界不自动改：时长越界、Runway 提示词超 1000 字、Runway/Omni 不支持的画幅、可灵/Runway 收到"多张参考图（非首尾帧）"都会明确报错让用户改，不偷偷裁剪或换模式。
- 视频任务刷新页面后可续查（`videoTaskProvider` 记录到 kling/runway/ark/omni）。
- 原渠道编辑器与每模型自定义接口脚本保留；单测里用脚本跑了一次 `runModelPlugin`，并确认脚本能拿到新的 `params.camera` / `params.lighting`。

### 第三部分 Agent（导演 Agent）
- 画布右上 Agent 面板新增「导演 Agent（官方 Key）」页签（原「本地 Agent（Codex / Claude Code）」桥保留为第二个页签）。实现：`web/src/components/agent/director-agent-panel.tsx`、`web/src/lib/canvas/canvas-director.ts`。
- 读画布：整张画布或「只看选中节点」，发给 LLM 的是精简 JSON（节点类型/标题/镜头号/描述/提示词/文本/模型/摄像机/灯光/连线，不发图片）。
- 一句话工作流：写脚本（文本节点）→ 拆分镜（一个分组 + 一排分镜，镜头号顺延）→ 每个分镜写好提示词、摄像机参数、图片模型、视频模型（=图片任务+视频任务）→ 角色锚点（按角色建锚点并连到出场分镜）→ 场景灯光挂在分组上 → 批量执行（先整排出图，再整排出视频，有图的分镜用图做首帧）。
- 编辑已有内容（`edits`，只接受画布里存在的节点 id，不存在的会列出"忽略 N 条"）；批量处理同规格素材（`batch`：按类型/比例/模型/标题筛选后统一改参，可选重新生成）。
- 范围限定：只分析 / 先写脚本 / 先建分镜 / 建图片视频任务 / 全流程并执行；范围之外的内容一律不写。
- 确认点：方案先出确认卡（分析、脚本、分镜列表、步骤清单），点「确认执行」才写画布；花钱的批量生成再走**同一张生成确认卡**（`requestGenerationConfirm`，Agent 来源受「Agent 发起的生成也确认」开关控制，默认开），一批一张卡；取消即不花钱。写入后可「撤销」。
- LLM 走用户在渠道里填的官方 Key：OpenAI（Responses）、Gemini、Anthropic（Messages，浏览器直连头 `anthropic-dangerous-direct-browser-access`）任选，面板里可选思考模型。

### 第四部分 摄像机与灯光
- 摄像机（逐节点）：机型/胶片模拟、镜头类型、焦距、光圈、景别、角度、运镜（推/拉/摇/移/升降/环绕/跟拍/手持/希区柯克变焦）及速度；入口在图片/视频节点参数栏与分镜节点参数栏的🎬按钮。
- 多角度：分镜的摄像机面板里勾选多个角度 → 拆成同内容的多个分镜，每个分镜各用一个角度。
- 灯光：亮度、色温、主光（方向/软硬/强度）、轮廓光（强度/色调）、氛围；可挂在节点、**分组（整场戏）**或**场景锚点**上。生成时按 节点 → 所在分组 → 连入的场景锚点 取一套，同组/同锚点的所有分镜拿到逐字相同的灯光段，跨镜头一致。
- 真实写进请求：`buildNodeGenerationContext` 在图片/视频生成的提示词末尾追加【摄像机 Camera】【灯光 Lighting】英文段；请求配置带 `camera`/`lighting`，火山方舟 Seedance 额外发原生 `camera_fixed`，自定义脚本收到 `params.camera`/`params.lighting`；确认卡新增「摄像机」「灯光」两行并显示完整提示词。
- 单测（`web/tests/part2-4-providers.test.ts`）拦截 axios 检查真实请求体：Seedance 请求体 `content[0].text` 含运镜与色温、`camera_fixed: true`、首帧 role；OpenAI 图片请求体 `prompt` 含焦距与轮廓光；可灵/Runway/Omni/BFL 请求体字段对照官方文档；同组三个分镜灯光段完全相同。

### 冒烟（无头 Chromium）
- `web/tests/e2e/smoke-canvas.py`（Playwright 1.49 + 自带 chromium headless shell，无需系统库）：打开 /canvas → 新建画布 → 加分镜 → 摄像机面板选 35mm + 推镜 → 无 Key 点「生成图片」→ 打开 Agent 面板。**控制台 0 报错**，无 Key 时提示原因原文。沙箱里要给浏览器配出网代理并忽略代理证书，脚本已处理。

## 未做 / 未达标

1. **真实调用未实测**：所有厂商接口按 2026-11 官方文档实现并有请求体单测，但没有 Key，未真正出过一张图/一段视频。BFL 交付链接、Runway/可灵/Omni 的浏览器 CORS 未验证——若浏览器直连被 CORS 拦，需打开设置里的「本地代理」（桌面版自带转发代理）。
2. Luma、Midjourney（无官方公开 API）、Hailuo/MiniMax 未接；可用「自定义接口脚本」临时接。
3. Veo 3.1 GA（`veo-3.1-generate-001`）只在 Google Cloud Agent Platform（需 GCP 项目 + OAuth 访问令牌），没接；Gemini API Key 只能用 Omni。
4. Gemini Omni 的多轮编辑/视频延长（`previous_interaction_id`）、Seedance 的视频编辑/延长、可灵 Omni 参考生视频未接（属第六部分续作类）。
5. 可灵 4.0 与 Runway 不接受"多张普通参考图"，会报错让用户换模型或改首尾帧，而不是自动转换。
6. 导演 Agent 是"一次规划 → 确认 → 执行"，不是多轮工具调用循环；执行中途不会根据生成结果再自我修正。本地 Codex 桥（`canvas-agent/`）本轮未改、未验通。
7. 摄像机参数除 Seedance `camera_fixed` 外都是提示词注入（各家官方当前没有更细的原生运镜参数；可灵旧版 `camera_control` 在 4.0 新接口里没有）。
8. 3D 导演台（第五部分）由同事在 `feat/director-3d` 分支做，本轮未碰。

## Key 清单（开哪个官方账号、填在哪）

所有 Key 填在：**设置 → 模型渠道 → 添加官方渠道 → 选厂商 → API Key 一栏**（只存本机浏览器，前端直连官方接口）。开通、充值、绑卡由 hemosi 本人操作。

| 厂商 | 开哪个账号 / 在哪拿 Key | 渠道里的模型 | 备注 |
| --- | --- | --- | --- |
| OpenAI | platform.openai.com → API keys | gpt-image-2.6-sunburst / -flare，gpt-5.5（Agent） | 图像模型可能要求组织验证 |
| Google Gemini | aistudio.google.com → Get API key（需开结算） | gemini-3-pro-image，gemini-omni-1.2-flash，gemini-3.8-flash（Agent） | 一个 Key 同时管图、视频、Agent |
| Anthropic | console.anthropic.com → API Keys | claude-opus-5-5 / claude-sonnet-5-5（Agent） | 只用于 Agent 文本 |
| Black Forest Labs | dashboard.bfl.ai → API Keys | flux-2-max / flux-2-pro-preview | 请求头 x-key |
| 可灵 Kling | kling.ai 开发者控制台 → API Key | kling-4.0 | 海外地址 api-singapore.klingai.com；国内账号把渠道地址改为 https://api-beijing.klingai.com |
| Runway | dev.runwayml.com → API Keys（需购买 credits） | gen4.5 | |
| 火山方舟 | console.volcengine.com/ark → API Key 管理；「开通管理」里开通 Seedance 2.5（账户余额需 >200 元或购买资源包） | doubao-seedance-2-5-260628 | 中国大陆账号，需实名 |

## 下一步
1. hemosi 填至少一个图像 Key + 一个视频 Key + 一个 Agent Key，按验收清单第 10 条实测；把实测报错原文反馈过来逐个修。
2. 若浏览器直连被 CORS 拦：用桌面版自带代理或设置里的本地代理。
3. 第六部分续作类（Omni 多轮编辑、Seedance 延长）可在本文件的 official-providers 上扩展。
