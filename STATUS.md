# STATUS：hemosi-canvas（对照 TASKBOOK-tapnow-2026-11-10.md）

更新：2026-11-11 16:30 CST。「已做」= 代码在 main、`bun run build` 通过、`tsc --noEmit` 只剩基线 1 个错误（`model-script-editor.tsx:58` TS2353，上游存量）。**没填官方 Key 前，所有真实出图/出视频都未实测**，这里不把写了代码当成已验收。

## 总览

| 部分 | 状态 | 提交 |
| --- | --- | --- |
| 一 基础节点与画布 | 已做（待 Muse 实测） | 08a33b3 2c1832d 0dbc8f3 31bb663 908de9b 0e9bfdd 5cf5c21 03dc33f 1ef8b11 |
| 二 多模型调度 | 已做，未用真 Key 实测 | 9b0ddb3 |
| 三 Agent | 已做（单轮规划→确认→执行） | cd3f5fa fc8876e |
| 四 摄像机与灯光 | 已做，参数进请求有单测 | 9b0ddb3 cd3f5fa |
| 五 3D 导演台 | **还没合进 main**：在 `feat/director-3d` 分支（2831af7、1a063a8） | — |
| 六 分镜与续作进阶 | 视频拆分镜已做；draw-to-video 在 3D 分支；重拍/续作/历史还原已做 | 3de44fa 及前任提交 |
| 七 模板（自用版） | 已做；公开社区按要求不做 | 322950d 及前任模板库 |

第二到四部分的选型、实现位置、Key 清单详见 `docs/STATUS-draft-part2-4.md`（本文件为总口径）。

## 关键选型
- 基底：basketikun/infinite-canvas v0.20.0（MIT）二开。
- 模型：图像 gpt-image-2.6 / Nano Banana Pro / FLUX.2；视频 Gemini Omni Flash / 可灵 4.0 / Seedance 2.5 / Runway gen4.5；Agent 文本 OpenAI / Anthropic / Gemini 三选一。全部官方域名，无中转站。
- 3D 导演台：选「在本仓库二开」（three.js / R3F 自建 3D 场景节点），不整段移植 tigerowo，理由是两边数据结构不同，移植要重写节点和存储层。实现在 `feat/director-3d` 分支。
- 视频拆分镜：浏览器内按帧差检测镜头切换（不调用模型、不花钱），每个镜头一个分镜节点，填时间段，中间帧作参考图和预览图。

## 未达标清单（逐项如实）
1. **真实生成未实测**：所有厂商接口按官方文档实现并有请求体单测，没有 Key，没出过一张真图或真视频。浏览器直连可能被 CORS 拦，需开桌面版自带的本地代理。
2. **第五部分未合入 main**：3D 导演台和 draw-to-video 在 `feat/director-3d` 分支，合并、构建、冒烟后才算交付。
3. 视频拆分镜只按画面切换拆，**不写画面描述**（描述栏是时间段）。要自动写描述得接视觉模型，会花钱，没做。长镜头内的运镜变化不会被拆开。
4. Luma、Midjourney（无公开官方 API）、Hailuo 未接；可用自定义接口脚本临时接。
5. Veo 3.1 只在 Google Cloud（需 GCP 项目 + OAuth），没接；Gemini Key 只能走 Omni。
6. 续作类受官方能力限制：Omni 多轮编辑、Seedance 视频延长、可灵 Omni 参考生视频未接；现有「续作」是末帧作首帧再生成，不是模型原生延长。
7. 可灵 4.0、Runway 不接受多张普通参考图，会报错让用户改，不自动转换。
8. 导演 Agent 是一次规划→确认→执行，不根据生成结果自我修正；本地 Codex 桥（`canvas-agent/`）未验通。
9. 摄像机参数除 Seedance `camera_fixed` 外都是写进提示词（各家没有更细的原生运镜参数）。
10. 300 节点性能、项目包导出导入、11 项验收清单：有单测和无头冒烟，**未在 Windows 真机逐项跑过**。
11. 公开模板社区：按 hemosi 要求不做，等拍板。

## Key / 花钱清单
见 `docs/STATUS-draft-part2-4.md` 的「Key 清单」：OpenAI、Google Gemini、Anthropic、BFL、可灵、Runway、火山方舟。全部填在 设置 → 模型渠道 → 添加官方渠道 → API Key。开账号、充值、绑卡由 hemosi 本人做。最少起步：一个图像 Key + 一个视频 Key + 一个 Agent Key。

## 许可证
本项目基于 basketikun/infinite-canvas（MIT License）二次开发，原版权声明保留在 `LICENSE`。新增代码同样以 MIT 发布。不使用 TapNow 的品牌、界面素材或受版权保护的内容。

## 下一步
1. 把 `feat/director-3d` 合进 main，构建 + 冒烟。
2. hemosi 填 Key，按验收清单第 10 条实测，报错原文反馈逐个修。
3. 打正式 tag（`v0.21.0`）出正式 Release；当前 `v0.21.0-rc.1` 是预发布。
