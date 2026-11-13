import { useRef, useState } from "react";
import { App, Button, Checkbox, Input, Segmented } from "antd";
import { Clapperboard, Film, Flame, Loader2, Play, Square, Undo2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { cameraSummary } from "@/lib/canvas/canvas-cinematography";
import { DIRECTOR_SCOPES, directorSystemPrompt, directorUserPrompt, parseDirectorPlan, planToExecution, scopeAllows, type DirectorExecution, type DirectorPlan, type DirectorScope } from "@/lib/canvas/canvas-director";
import { buildWastelandPresetPlan, stepDirectorProductionLoop } from "@/lib/canvas/director-loop-runner";
import { requestImageQuestion } from "@/services/api/image";
import { useDirectorLoopStore } from "@/stores/canvas/use-director-loop-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { modelNotReadyReason, modelOptionName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Pending = { plan: DirectorPlan; execution: DirectorExecution; scope: DirectorScope };

/**
 * Built-in director Agent: reads the whole canvas (or the selection), plans with the user's own official LLM key,
 * shows the plan as a confirm card, applies it to the canvas, and batch-runs generations through the same
 * generation confirm card as manual runs.
 */
export function DirectorAgentPanel() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvas = useAgentStore((state) => state.canvasContext);
    const projectId = canvas?.snapshot.projectId || "";
    const [instruction, setInstruction] = useState("");
    const [scope, setScope] = useState<DirectorScope>("shots");
    const [onlySelected, setOnlySelected] = useState(false);
    const [textModel, setTextModel] = useState(config.textModel);
    const [imageModel, setImageModel] = useState(config.imageModel);
    const [videoModel, setVideoModel] = useState(config.videoModel);
    const [thinking, setThinking] = useState(false);
    const [streamed, setStreamed] = useState("");
    // 方案按画布独立存
    const [plansByProject, setPlansByProject] = useState<Record<string, Pending | null>>(() => {
        try {
            const raw = localStorage.getItem("hemosi:director-plans");
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    });
    const pending = projectId ? plansByProject[projectId] || null : null;
    const setPending = (p: Pending | null) => {
        if (!projectId) return;
        setPlansByProject((prev) => {
            const next = { ...prev, [projectId]: p };
            localStorage.setItem("hemosi:director-plans", JSON.stringify(next));
            return next;
        });
    };
    const [log, setLog] = useState<string[]>([]);
    const [running, setRunning] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const addLog = (line: string) => setLog((prev) => [...prev, line]);

    const plan = async () => {
        if (!canvas) return message.warning("先打开一张画布");
        if (!instruction.trim()) return message.warning("写一句要 Agent 做什么");
        const reason = modelNotReadyReason(config, textModel);
        if (reason) {
            message.error(`Agent 文本模型不可用：${reason}`);
            return openConfigDialog(true);
        }
        if (onlySelected && !canvas.snapshot.selectedNodeIds.length) return message.warning("没有选中节点；取消「只看选中」或先选中节点");
        const controller = new AbortController();
        abortRef.current = controller;
        setThinking(true);
        setStreamed("");
        setPending(null);
        try {
            const answer = await requestImageQuestion(
                { ...config, model: textModel },
                [
                    { role: "system", content: directorSystemPrompt() },
                    { role: "user", content: directorUserPrompt(instruction.trim(), scope, canvas.snapshot, onlySelected) },
                ],
                (delta) => setStreamed((prev) => prev + delta),
                { signal: controller.signal },
            );
            const parsed = parseDirectorPlan(answer);
            const execution = planToExecution(parsed, canvas.snapshot, scope, { image: imageModel, video: videoModel, seconds: config.videoSeconds });
            setPending({ plan: parsed, execution, scope });
            addLog(`方案已生成（${DIRECTOR_SCOPES.find((item) => item.value === scope)?.label}）：${execution.steps.join("；") || "无改动"}`);
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setThinking(false);
            abortRef.current = null;
        }
    };

    /** Apply the confirmed plan; spending steps each go through the generation confirm card. */
    const execute = async () => {
        const current = useAgentStore.getState().canvasContext;
        if (!pending || !current) return;
        const { execution } = pending;
        setPending(null);
        setRunning(true);
        try {
            const combinedOps = [
                ...execution.ops,
                ...execution.runNodes.map((item) => ({ type: "run_generation" as const, nodeId: item.nodeId, mode: item.mode })),
            ];
            if (combinedOps.length) {
                current.applyOps(combinedOps);
                if (execution.ops.length) {
                    addLog(`已写入画布：${execution.steps.filter((step) => !step.startsWith("批量生成") && !step.startsWith("重新生成")).join("；")}`);
                }
                if (execution.runNodes.length) {
                    addLog(`已发起 ${execution.runNodes.length} 个节点的重新生成（每个都会先弹确认卡）`);
                }
            }
            const runShots = current.runShots;
            if ((execution.runImages.length || execution.runVideos.length) && !runShots) throw new Error("当前画布不支持批量生成分镜");
            if (execution.runImages.length && runShots) {
                addLog(`批量生成 ${execution.runImages.length} 张分镜图：等待确认卡…`);
                const result = await runShots(execution.runImages, "image", "agent");
                addLog(result.canceled ? "分镜图：已取消，未花钱" : `分镜图：成功 ${result.ok}，失败 ${result.failed}`);
                if (result.canceled) return;
            }
            if (execution.runVideos.length && runShots) {
                addLog(`批量生成 ${execution.runVideos.length} 段分镜视频：等待确认卡…`);
                const result = await runShots(execution.runVideos, "video", "agent");
                addLog(result.canceled ? "分镜视频：已取消，未花钱" : `分镜视频：成功 ${result.ok}，失败 ${result.failed}`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setRunning(false);
        }
    };

    const undo = () => {
        const result = useAgentStore.getState().canvasContext?.undoOps();
        addLog(result ? "已撤销 Agent 上一次写入" : "没有可撤销的 Agent 写入");
    };

    const shots = pending?.plan.shots || [];
    const loopState = useDirectorLoopStore((s) => (projectId ? s.byProject[projectId] : undefined));
    const initFromPlan = useDirectorLoopStore((s) => s.initFromPlan);
    const patchLoop = useDirectorLoopStore((s) => s.patchProject);
    const updateSegmentContract = useDirectorLoopStore((s) => s.updateSegmentContract);
    const addLoopLog = useDirectorLoopStore((s) => s.addLog);
    const [panelTab, setPanelTab] = useState<"command" | "todo" | "log">("command");
    const [showInfoLogs, setShowInfoLogs] = useState(false);
    const [loopCmd, setLoopCmd] = useState("");
    const [impactPreview, setImpactPreview] = useState<{
        targetSegIndex: number;
        targetSegId: string;
        cmdText: string;
        downstreamIndices: number[];
        extraClips: number;
    } | null>(null);

    const previewMidLoopCommand = () => {
        if (!loopState || !loopCmd.trim()) return;
        const m = loopCmd.match(/@?第?\s*(\d+)\s*段/);
        const segIdx = m ? Number(m[1]) : 1;
        const seg = loopState.segments.find((s) => s.index === segIdx) || loopState.segments[0];
        if (!seg) return;
        const downstreamIndices: number[] = [];
        let extraClips = seg.drawCount;
        const collect = (pid: string) => {
            loopState.segments.forEach((c) => {
                if (c.dependsOnSegmentId === pid) {
                    downstreamIndices.push(c.index);
                    extraClips += c.drawCount;
                    collect(c.id);
                }
            });
        };
        collect(seg.id);
        setImpactPreview({
            targetSegIndex: seg.index,
            targetSegId: seg.id,
            cmdText: loopCmd.trim(),
            downstreamIndices,
            extraClips,
        });
    };

    const executeImpactPreview = () => {
        if (!impactPreview || !projectId || !loopState) return;
        const seg = loopState.segments.find((s) => s.id === impactPreview.targetSegId);
        if (seg) {
            updateSegmentContract(projectId, seg.id, {
                prompt: `${seg.prompt}（指令修正：${impactPreview.cmdText}）`,
                status: "queued",
            });
            impactPreview.downstreamIndices.forEach((idx) => {
                const ds = loopState.segments.find((s) => s.index === idx);
                if (ds) updateSegmentContract(projectId, ds.id, { status: "blocked" });
            });
            patchLoop(projectId, { stage: "producing" });
            addLoopLog(projectId, "todo", `已执行 @第${seg.index}段 指令并触发重跑：${impactPreview.cmdText}`, seg.index);
            void stepDirectorProductionLoop(projectId);
        }
        setImpactPreview(null);
        setLoopCmd("");
    };

    const launchLoopFromPending = () => {
        if (!pending || !projectId) return;
        const p = pending.plan;
        initFromPlan(projectId, {
            filmTitle: p.sceneTitle || "Agent 导演循环项目",
            idea: {
                protagonist: (p.characters || []).map((c) => `${c.name}（${c.description}）`).join("；") || "待补充主角",
                background: p.sceneTitle || "默认场景",
                theme: p.analysis || "AI 分镜短片",
                story: p.script || instruction.trim(),
            },
            budgetMaxClips: Math.max(8, (p.shots?.length || 3) * 3),
            anchors: [
                ...(p.characters || []).map((c) => ({
                    kind: "character" as const,
                    title: `角色定妆：${c.name}`,
                    description: c.description,
                    voiceNote: "自然角色音（仅文字设定）",
                })),
                {
                    kind: "scene" as const,
                    title: `场景锚点：${p.sceneTitle || "主场景"}`,
                    description: p.analysis || "核心环境与空间结构定妆",
                },
                {
                    kind: "style" as const,
                    title: "风格锚点：全片光学与色调",
                    description: "16:9 720p 电影感统一光学滤镜与色调",
                },
            ],
            segments: (p.shots || []).map((s, idx) => ({
                title: `第 ${idx + 1} 段`,
                summary: s.description,
                prompt: s.prompt || s.description,
                isKey: idx === 0,
                dependsOnIndex: idx > 0 ? idx - 1 : undefined,
                seconds: s.seconds || 10,
                drawCount: 2,
                shotsList: [s.description],
            })),
        });
        setPending(null);
        addLog("已将方案转入画布「导演组（检查点 A）」，请核对左栏锚点并点「确认开跑」");
    };

    const escalatedList = loopState?.segments.filter((s) => s.status === "escalated") || [];
    const todoTotal = escalatedList.length + (loopState?.stage === "await_a" ? 1 : 0);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm" data-canvas-shortcuts-ignore>
            <div className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                不可逆动作归用户：合成、配音、BGM、超分、导出仅在你验收后手动点「合成」才触发，Agent 绝不抢跑。
            </div>
            <Segmented
                size="small"
                block
                value={panelTab}
                onChange={(v) => setPanelTab(v as "command" | "todo" | "log")}
                options={[
                    { value: "command", label: "指令与立项" },
                    { value: "todo", label: `待办 (${todoTotal})` },
                    { value: "log", label: `日志 (${loopState?.logs.length || 0})` },
                ]}
            />
            {panelTab === "todo" ? (
                <div className="space-y-2 text-xs">
                    {loopState?.stage === "await_a" ? (
                        <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            <span>检查点 A：核对左栏锚点并点「确认开跑」</span>
                            <Button size="small" type="primary" onClick={() => patchLoop(projectId, { groupVisible: true })}>
                                去确认
                            </Button>
                        </div>
                    ) : null}
                    {escalatedList.map((s) => (
                        <div key={s.id} className="flex items-center justify-between rounded-lg border border-red-500/50 p-2.5">
                            <span>第 {s.index} 段升级：{s.escalationReason || "两轮失败"}</span>
                            <Button
                                size="small"
                                danger
                                onClick={() => patchLoop(projectId, { groupVisible: true, expandedSegmentId: s.id })}
                            >
                                处置该段
                            </Button>
                        </div>
                    ))}
                    {todoTotal === 0 ? <div className="py-6 text-center opacity-50">当前没有需要人工介入的阻塞项</div> : null}
                </div>
            ) : panelTab === "log" ? (
                <div className="space-y-2 text-xs">
                    <Checkbox checked={showInfoLogs} onChange={(e) => setShowInfoLogs(e.target.checked)}>
                        <span className="text-xs">显示普通系统信息（默认仅显示「需你处理」与「已自动处理」）</span>
                    </Checkbox>
                    <div className="space-y-1.5">
                        {(loopState?.logs || [])
                            .filter((item) => showInfoLogs || item.level !== "info")
                            .map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => {
                                        if (!item.segmentIndex || !loopState) return;
                                        const target = loopState.segments.find((s) => s.index === item.segmentIndex);
                                        if (target) patchLoop(projectId, { groupVisible: true, expandedSegmentId: target.id });
                                    }}
                                    className="cursor-pointer rounded border p-2 hover:bg-black/5 dark:hover:bg-white/5"
                                    style={{ borderColor: theme.node.stroke }}
                                >
                                    <div className="flex items-center justify-between text-[10px] opacity-65">
                                        <span>
                                            [{item.level === "todo" ? "需你处理" : item.level === "auto" ? "已自动处理" : "系统信息"}]
                                            {item.segmentIndex ? ` · 第 ${item.segmentIndex} 段` : ""}
                                        </span>
                                        <span>{item.time}</span>
                                    </div>
                                    <div className="mt-0.5">{item.text}</div>
                                </div>
                            ))}
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex flex-col gap-2 rounded-xl border p-2.5 text-xs" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center justify-between">
                            <span className="font-semibold">导演循环工作台（画布内嵌导演组）</span>
                            {loopState && loopState.stage !== "idle" ? (
                                <Button
                                    size="small"
                                    type="link"
                                    icon={<Film className="size-3.5" />}
                                    onClick={() => patchLoop(projectId, { groupVisible: !loopState.groupVisible })}
                                >
                                    {loopState.groupVisible ? "收起导演组" : "展开导演组"}
                                </Button>
                            ) : null}
                        </div>
                        <div className="opacity-75">
                            按段抽卡选定 ➔ 原地展开定妆图与末帧对照 ➔ 手动触发 NVENC 合成（抽卡条数熔断）。
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <Button
                                size="small"
                                type="primary"
                                icon={<Flame className="size-3.5" />}
                                onClick={() => {
                                    const pid = projectId || "default";
                                    initFromPlan(pid, buildWastelandPresetPlan());
                                    message.success("已载入《废土余烬：机械守望者》导演循环方案（检查点 A）");
                                }}
                            >
                                一键载入废土案例（进入检查点 A）
                            </Button>
                        </div>
                        {loopState && loopState.stage !== "idle" ? (
                            <div className="mt-1 space-y-1.5 border-t pt-2" style={{ borderColor: theme.node.stroke }}>
                                <div className="font-medium">对指定段下指令（支持 @第N段 · 先看影响预览再执行）：</div>
                                <div className="flex gap-1.5">
                                    <Input
                                        size="small"
                                        value={loopCmd}
                                        onChange={(e) => setLoopCmd(e.target.value)}
                                        placeholder="例：@第2段 把机械左臂冷蓝照明光束改得更亮"
                                    />
                                    <Button size="small" onClick={previewMidLoopCommand}>
                                        预览影响
                                    </Button>
                                </div>
                                {impactPreview ? (
                                    <div className="space-y-1 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2 text-[11px]">
                                        <div className="font-semibold text-amber-500">影响预览卡（点执行才生效）：</div>
                                        <div>· 将作废并重跑：第 {impactPreview.targetSegIndex} 段</div>
                                        <div>
                                            · 连带重跑下游接续段：
                                            {impactPreview.downstreamIndices.length
                                                ? impactPreview.downstreamIndices.map((i) => `第 ${i} 段`).join("、")
                                                : "无"}
                                        </div>
                                        <div>· 保留：已锁定的左栏锚点与其余无关片段</div>
                                        <div>· 预计追加抽卡：{impactPreview.extraClips} 条</div>
                                        <div className="flex justify-end gap-1.5 pt-1">
                                            <Button size="small" onClick={() => setImpactPreview(null)}>
                                                取消
                                            </Button>
                                            <Button size="small" type="primary" onClick={executeImpactPreview}>
                                                确认执行
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
            <div className="flex items-center gap-2 text-xs opacity-70">
                <Clapperboard className="size-4" style={{ color: "var(--hemosi-accent)" }} />
                导演 Agent：读画布 → 写脚本 → 拆分镜 → 建图/视频任务 → 批量执行。用你自己的官方 Key（设置→模型渠道）。
            </div>
            <Input.TextArea rows={4} value={instruction} placeholder="例：把这段剧本拆成分镜，每个镜头配好运镜，先生成分镜图；或：把所有 9:16 的图片节点改成 16:9 并重新生成" onChange={(event) => setInstruction(event.target.value)} />
            <Segmented size="small" block value={scope} options={DIRECTOR_SCOPES.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setScope(value as DirectorScope)} />
            <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 text-xs">
                <span className="opacity-60">思考模型</span>
                <ModelPicker config={config} value={textModel} capability="text" onChange={setTextModel} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                {scopeAllows(scope, "tasks") ? (
                    <>
                        <span className="opacity-60">图片模型</span>
                        <ModelPicker config={config} value={imageModel} capability="image" onChange={setImageModel} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                        <span className="opacity-60">视频模型</span>
                        <ModelPicker config={config} value={videoModel} capability="video" onChange={setVideoModel} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                    </>
                ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
                <Checkbox checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)}>
                    <span className="text-xs">只看选中节点（{canvas?.snapshot.selectedNodeIds.length || 0}）</span>
                </Checkbox>
                <div className="flex gap-1">
                    <Button size="small" type="text" icon={<Undo2 className="size-3.5" />} disabled={!canvas?.canUndo || running} onClick={undo}>
                        撤销
                    </Button>
                    {thinking ? (
                        <Button size="small" icon={<Square className="size-3.5" />} onClick={() => abortRef.current?.abort()}>
                            停止
                        </Button>
                    ) : (
                        <Button size="small" type="primary" icon={<Play className="size-3.5" />} disabled={running} onClick={() => void plan()}>
                            出方案
                        </Button>
                    )}
                </div>
            </div>
            {thinking ? (
                <div className="flex items-start gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                    <span className="line-clamp-4 break-all opacity-60">{streamed.slice(-400) || `${modelOptionName(textModel)} 正在读画布…`}</span>
                </div>
            ) : null}
            {pending ? (
                <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--hemosi-accent)" }}>
                    <div className="text-xs font-semibold">确认后才会改画布{pending.execution.runImages.length || pending.execution.runVideos.length || pending.execution.runNodes.length ? "；花钱的生成还会再弹生成确认卡" : ""}</div>
                    {pending.plan.analysis ? <div className="whitespace-pre-wrap text-xs opacity-80">{pending.plan.analysis}</div> : null}
                    {pending.plan.script ? <div className="thin-scrollbar max-h-32 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs" style={{ borderColor: theme.node.stroke }}>{pending.plan.script}</div> : null}
                    {shots.length && scopeAllows(pending.scope, "shots") ? (
                        <ol className="thin-scrollbar max-h-48 list-decimal space-y-1 overflow-auto pl-4 text-xs">
                            {shots.map((shot, index) => (
                                <li key={index}>
                                    {shot.description}
                                    {cameraSummary(shot.camera) ? <span className="opacity-60">（{cameraSummary(shot.camera)}）</span> : null}
                                </li>
                            ))}
                        </ol>
                    ) : null}
                    <ul className="list-disc pl-4 text-xs">
                        {pending.execution.steps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ul>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button size="small" onClick={() => setPending(null)}>
                            放弃
                        </Button>
                        {shots.length > 0 ? (
                            <Button size="small" icon={<Film className="size-3.5" />} onClick={launchLoopFromPending}>
                                转入导演组循环（检查点 A）
                            </Button>
                        ) : null}
                        <Button size="small" type="primary" disabled={!pending.execution.ops.length && !pending.execution.runImages.length && !pending.execution.runVideos.length && !pending.execution.runNodes.length} onClick={() => void execute()}>
                            确认执行
                        </Button>
                    </div>
                </div>
            ) : null}
            {log.length ? (
                <div className="space-y-1 border-t pt-2 text-xs opacity-70" style={{ borderColor: theme.node.stroke }}>
                    {log.map((line, index) => (
                        <div key={index}>· {line}</div>
                    ))}
                </div>
            ) : null}
                </>
            )}
        </div>
    );
}
