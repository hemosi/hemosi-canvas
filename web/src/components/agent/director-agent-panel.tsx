import { useRef, useState } from "react";
import { App, Button, Checkbox, Input, Segmented } from "antd";
import { Clapperboard, Loader2, Play, Square, Undo2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { cameraSummary } from "@/lib/canvas/canvas-cinematography";
import { DIRECTOR_SCOPES, directorSystemPrompt, directorUserPrompt, parseDirectorPlan, planToExecution, scopeAllows, type DirectorExecution, type DirectorPlan, type DirectorScope } from "@/lib/canvas/canvas-director";
import { requestImageQuestion } from "@/services/api/image";
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
            if (execution.ops.length) {
                current.applyOps(execution.ops);
                addLog(`已写入画布：${execution.steps.filter((step) => !step.startsWith("批量生成") && !step.startsWith("重新生成")).join("；")}`);
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
            if (execution.runNodes.length) {
                useAgentStore.getState().canvasContext?.applyOps(execution.runNodes.map((item) => ({ type: "run_generation" as const, nodeId: item.nodeId, mode: item.mode })));
                addLog(`已发起 ${execution.runNodes.length} 个节点的重新生成（每个都会先弹确认卡）`);
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
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm" data-canvas-shortcuts-ignore>
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
                    <div className="flex justify-end gap-2">
                        <Button size="small" onClick={() => setPending(null)}>
                            放弃
                        </Button>
                        <Button size="small" type="primary" disabled={!pending.execution.ops.length && !pending.execution.runImages.length && !pending.execution.runNodes.length} onClick={() => void execute()}>
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
        </div>
    );
}
