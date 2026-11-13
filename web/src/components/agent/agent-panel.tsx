import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { Hand, Loader2, Send, Sparkles, Square, Video, X } from "lucide-react";
import { motion } from "motion/react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import { previewPlan, requestStoryboardPlan, type AgentHistoryTurn, type Change, type Plan } from "@/lib/canvas/storyboard-plan";
import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import { createEmptyStoryboardData } from "@/lib/canvas/storyboard-utils";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, HemosiNodeType, type CanvasNodeData } from "@/types/canvas";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

type DirectorMessage =
    | { id: string; role: "user"; text: string; mediaLabels?: string[] }
    | { id: string; role: "assistant"; text: string }
    | { id: string; role: "error"; text: string; raw?: string }
    | {
          id: string;
          role: "plan";
          storyboardNodeId: string;
          plan: Plan;
          enabledIds: string[];
          status: "pending" | "applied" | "rejected";
      };

function changeLabel(ch: Change): { badge: string; title: string; detail: string } {
    switch (ch.kind) {
        case "setting.add":
            return { badge: "加设定", title: `${ch.setting.name}`, detail: ch.setting.desc };
        case "setting.update":
            return { badge: "改设定", title: ch.settingId, detail: ch.patch.desc || ch.patch.name || "" };
        case "row.add":
            return {
                badge: "加分镜",
                title: `${ch.row.code || "新镜"} · ${ch.row.shotSize} ${ch.row.move} (${ch.row.duration}s)`,
                detail: `${ch.row.staticScreen}｜${ch.row.action}`,
            };
        case "row.update":
            return {
                badge: "改分镜",
                title: ch.rowId,
                detail: [ch.patch.staticScreen, ch.patch.action, ch.patch.line].filter(Boolean).join(" · "),
            };
        case "row.remove":
            return { badge: "删分镜", title: ch.rowId, detail: "删除该分镜行" };
        case "row.move":
            return { badge: "移分镜", title: ch.rowId, detail: `移动到第 ${ch.to + 1} 位` };
    }
}

export function AgentPanel() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);

    const effectiveConfig = useEffectiveConfig();
    const textModel = useConfigStore((s) => s.config.textModel || s.config.model);
    const updateConfig = useConfigStore((s) => s.updateConfig);

    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);
    const [messages, setMessages] = useState<DirectorMessage[]>([]);
    const [removeOrphan, setRemoveOrphan] = useState(true);
    const [mediaPickEnabled, setMediaPickEnabled] = useState(false);
    const [attachedNodeIds, setAttachedNodeIds] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const host = getShotHost();
    const allNodes: CanvasNodeData[] = host?.getAllNodes?.() || [];
    const selectedIds = host?.getSelectedNodeIds?.() || [];
    const storyboardNodes = useMemo(
        () => allNodes.filter((n) => n.type === HemosiNodeType.Storyboard),
        [allNodes],
    );
    const targetSb = useMemo(() => {
        const selected = storyboardNodes.find((n) => selectedIds.includes(n.id));
        return selected || storyboardNodes[0] || null;
    }, [selectedIds, storyboardNodes]);

    useEffect(() => {
        const onDropNodes = (event: Event) => {
            const detail = (event as CustomEvent<{ nodeIds?: string[] }>).detail;
            const ids = detail?.nodeIds || [];
            if (!ids.length) return;
            const validIds = ids.filter((id) => {
                const n = (getShotHost()?.getAllNodes?.() || []).find((item) => item.id === id);
                return (
                    n &&
                    (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) &&
                    Boolean(n.metadata?.content)
                );
            });
            if (!validIds.length) return;
            setAttachedNodeIds((prev) => Array.from(new Set([...prev, ...validIds])));
        };
        window.addEventListener("director-agent-drop-nodes", onDropNodes);
        return () => window.removeEventListener("director-agent-drop-nodes", onDropNodes);
    }, []);

    const attachedNodes = useMemo(
        () =>
            attachedNodeIds
                .map((id) => allNodes.find((n) => n.id === id))
                .filter((n): n is CanvasNodeData => Boolean(n && n.metadata?.content)),
        [allNodes, attachedNodeIds],
    );

    const pendingPlanMsg = useMemo(
        () =>
            [...messages]
                .reverse()
                .find(
                    (m): m is Extract<DirectorMessage, { role: "plan" }> =>
                        m.role === "plan" && m.status === "pending",
                ) || null,
        [messages],
    );

    const pendingPreview = useMemo(() => {
        if (!pendingPlanMsg) return null;
        const planSb = allNodes.find((n) => n.id === pendingPlanMsg.storyboardNodeId);
        if (!planSb) return null;
        const data = planSb.metadata?.storyboard || createEmptyStoryboardData();
        return previewPlan(data, pendingPlanMsg.plan, new Set(pendingPlanMsg.enabledIds), allNodes, planSb);
    }, [allNodes, pendingPlanMsg]);

    useEffect(() => {
        host?.setStoryboardGhostNodes?.(pendingPreview?.diff.ghostNodes || []);
    }, [host, pendingPreview]);

    const handleSend = async () => {
        const text = input.trim();
        if ((!text && attachedNodes.length === 0) || running) return;
        const activeTextModel = textModel || effectiveConfig.textModel || effectiveConfig.model;
        if (!activeTextModel) {
            message.warning("请先在顶部选择一个模型");
            return;
        }

        const sbSnapshot = targetSb;
        const matchedRow = sbSnapshot?.metadata?.storyboard?.rows.find(
            (r) => selectedIds.includes(r.imageNodeId) || selectedIds.includes(r.videoNodeId),
        );

        const currentAttachedIds = [...attachedNodeIds];
        const mediaLabels = attachedNodes.map((n) => `@${n.metadata?.refId || n.title || n.type}`);
        const history: AgentHistoryTurn[] = messages.flatMap((m): AgentHistoryTurn[] => {
            if (m.role === "user") return [{ role: "user", text: m.text }];
            if (m.role === "assistant") return [{ role: "assistant", text: m.text }];
            if (m.role === "plan") return [{ role: "assistant", text: m.plan.summary }];
            return [];
        });

        setInput("");
        setAttachedNodeIds([]);
        setMessages((prev) => [
            ...prev,
            {
                id: `u-${Date.now()}`,
                role: "user",
                text: text || "请看我附上的画布素材",
                mediaLabels: mediaLabels.length ? mediaLabels : undefined,
            },
        ]);
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await requestStoryboardPlan({
                config: { ...effectiveConfig, model: activeTextModel, textModel: activeTextModel },
                storyboardNode: sbSnapshot,
                nodes: allNodes,
                instruction: text || "请分析我拖入的素材",
                selectedRowId: matchedRow?.code || null,
                attachedNodeIds: currentAttachedIds,
                history,
                signal: controller.signal,
            });
            if (res.ok) {
                if (res.plan.changes.length === 0 || !sbSnapshot) {
                    setMessages((prev) => [
                        ...prev,
                        { id: `a-${Date.now()}`, role: "assistant", text: res.plan.summary },
                    ]);
                } else {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `p-${Date.now()}`,
                            role: "plan",
                            storyboardNodeId: sbSnapshot.id,
                            plan: res.plan,
                            enabledIds: res.plan.changes.map((c) => c.id),
                            status: "pending",
                        },
                    ]);
                }
            } else {
                setMessages((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}`, role: "error", text: res.error, raw: res.raw },
                ]);
            }
        } catch (err) {
            if ((err as Error)?.name !== "AbortError") {
                setMessages((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}`, role: "error", text: err instanceof Error ? err.message : String(err) },
                ]);
            }
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const toggleChange = (msgId: string, changeId: string) => {
        setMessages((prev) =>
            prev.map((m) => {
                if (m.id !== msgId || m.role !== "plan" || m.status !== "pending") return m;
                const set = new Set(m.enabledIds);
                if (set.has(changeId)) set.delete(changeId);
                else set.add(changeId);
                return { ...m, enabledIds: [...set] };
            }),
        );
    };

    const handleApplyPlan = (msgId: string) => {
        const msg = messages.find((m) => m.id === msgId);
        if (!msg || msg.role !== "plan" || !host?.applyStoryboardPlan) return;
        const planSb = allNodes.find((n) => n.id === msg.storyboardNodeId);
        if (!planSb) {
            message.warning("原分镜表节点已不存在");
            return;
        }
        const result = host.applyStoryboardPlan(planSb.id, msg.plan, new Set(msg.enabledIds), removeOrphan);
        host.setStoryboardGhostNodes?.([]);
        setMessages((prev) => prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "applied" } : m)));
        if (result?.warnings?.length) {
            message.warning(result.warnings[0]);
        } else {
            message.success("已应用改动并同步画布节点");
        }
    };

    const handleRejectPlan = (msgId: string) => {
        host?.setStoryboardGhostNodes?.([]);
        setMessages((prev) => prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "rejected" } : m)));
    };

    if (!panelMounted) return null;

    const border = theme.node.stroke;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <aside
                className="relative flex h-full shrink-0 flex-col border-l text-xs"
                data-canvas-shortcuts-ignore
                data-director-agent-drop={mediaPickEnabled ? "active" : "off"}
                style={{ width, background: theme.node.panel, borderColor: border, color: theme.node.text }}
            >
                {/* Top Header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: border }}>
                    <div className="flex items-center gap-1.5 font-semibold">
                        <Sparkles className="size-4 text-sky-500" />
                        <span>导演 Agent</span>
                        {targetSb?.metadata?.refId ? (
                            <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg }}>
                                @{targetSb.metadata.refId}
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* Model Selector */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: border }}>
                    <span className="shrink-0 opacity-65">模型</span>
                    <div className="min-w-0 flex-1">
                        <ModelPicker
                            config={effectiveConfig}
                            capability="text"
                            fullWidth
                            value={textModel}
                            onChange={(model) => updateConfig("textModel", model)}
                        />
                    </div>
                </div>

                {/* Message List */}
                <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
                    {messages.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-4 text-center opacity-60" style={{ borderColor: border }}>
                            开启下方「拾取画布素材」开关后，直接把画布上的图片或视频拖进这里（或点击节点），即可边看素材边讨论剧情、生成分镜表。
                        </div>
                    ) : null}

                    {messages.map((m) => {
                        if (m.role === "user") {
                            return (
                                <div key={m.id} className="ml-6 space-y-1 rounded-xl px-3 py-2" style={{ background: theme.toolbar.activeBg }}>
                                    {m.mediaLabels?.length ? (
                                        <div className="flex flex-wrap gap-1">
                                            {m.mediaLabels.map((lb) => (
                                                <span key={lb} className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                                                    {lb}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                    <div className="whitespace-pre-wrap">{m.text}</div>
                                </div>
                            );
                        }
                        if (m.role === "assistant") {
                            return (
                                <div key={m.id} className="mr-4 whitespace-pre-wrap rounded-xl border p-2.5 leading-relaxed" style={{ borderColor: border }}>
                                    {m.text}
                                </div>
                            );
                        }
                        if (m.role === "error") {
                            return (
                                <div key={m.id} className="space-y-1 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-red-400">
                                    <div className="font-semibold">生成失败：{m.text}</div>
                                    {m.raw ? (
                                        <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[10px] opacity-80">{m.raw}</pre>
                                    ) : null}
                                </div>
                            );
                        }
                        return (
                            <div key={m.id} className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: border }}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold">{m.plan.summary}</span>
                                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg }}>
                                        {m.status === "pending" ? "待确认" : m.status === "applied" ? "已应用" : "未采用"}
                                    </span>
                                </div>

                                {m.status === "pending" && pendingPreview?.warnings?.length ? (
                                    <div className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
                                        {pendingPreview.warnings.join("；")}
                                    </div>
                                ) : null}

                                <div className="space-y-1.5">
                                    {m.plan.changes.map((ch) => {
                                        const info = changeLabel(ch);
                                        const checked = m.enabledIds.includes(ch.id);
                                        return (
                                            <label
                                                key={ch.id}
                                                className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                                                style={{ borderColor: border }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="mt-0.5"
                                                    disabled={m.status !== "pending"}
                                                    checked={checked}
                                                    onChange={() => toggleChange(m.id, ch.id)}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="rounded px-1 py-0 text-[10px] font-medium" style={{ background: theme.toolbar.activeBg }}>
                                                            {info.badge}
                                                        </span>
                                                        <span className="truncate font-medium">{info.title}</span>
                                                    </div>
                                                    {info.detail ? <div className="mt-0.5 line-clamp-2 opacity-70">{info.detail}</div> : null}
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>

                                {m.status === "pending" ? (
                                    <div className="space-y-2 pt-1">
                                        {m.plan.changes.some((c) => c.kind === "row.remove") ? (
                                            <label className="flex items-center gap-1.5 text-[11px] opacity-75">
                                                <input
                                                    type="checkbox"
                                                    checked={removeOrphan}
                                                    onChange={(e) => setRemoveOrphan(e.target.checked)}
                                                />
                                                <span>同步删除对应下游节点</span>
                                            </label>
                                        ) : null}
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                className="flex-1 rounded-lg bg-sky-500 py-1.5 font-medium text-white transition hover:bg-sky-600"
                                                onClick={() => handleApplyPlan(m.id)}
                                            >
                                                应用所选
                                            </button>
                                            <button
                                                type="button"
                                                className="rounded-lg border px-3 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/10"
                                                style={{ borderColor: border }}
                                                onClick={() => handleRejectPlan(m.id)}
                                            >
                                                不用
                                            </button>
                                        </div>
                                    </div>
                                ) : m.status === "applied" && m.plan.suggestRun ? (
                                    (() => {
                                        const planSb = allNodes.find((n) => n.id === m.storyboardNodeId);
                                        if (!planSb) return null;
                                        return (
                                            <div className="flex items-center gap-2 pt-1">
                                                {m.plan.suggestRun.kind === "image" || m.plan.suggestRun.kind === "both" ? (
                                                    <button
                                                        type="button"
                                                        className="flex-1 rounded-lg border py-1 text-[11px] font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                                                        style={{ borderColor: border }}
                                                        onClick={() => {
                                                            const rows = planSb.metadata?.storyboard?.rows || [];
                                                            const wanted = new Set(m.plan.suggestRun!.rowIds);
                                                            const tasks: StoryboardQueueTask[] = rows
                                                                .filter((r) => wanted.size === 0 || wanted.has(r.id) || wanted.has(r.code))
                                                                .map((r) => ({
                                                                    nodeId: r.imageNodeId,
                                                                    kind: "image",
                                                                    label: `${r.code} · 首帧图`,
                                                                    prompt: r.imgPrompt,
                                                                }));
                                                            if (tasks.length) void host?.runStoryboardBatch?.(tasks, { title: "生成首帧图" });
                                                        }}
                                                    >
                                                        生成首帧图
                                                    </button>
                                                ) : null}
                                                {m.plan.suggestRun.kind === "video" || m.plan.suggestRun.kind === "both" ? (
                                                    <button
                                                        type="button"
                                                        className="flex-1 rounded-lg bg-sky-500 py-1 text-[11px] font-medium text-white transition hover:bg-sky-600"
                                                        onClick={() => {
                                                            const rows = planSb.metadata?.storyboard?.rows || [];
                                                            const wanted = new Set(m.plan.suggestRun!.rowIds);
                                                            const tasks: StoryboardQueueTask[] = rows
                                                                .filter((r) => wanted.size === 0 || wanted.has(r.id) || wanted.has(r.code))
                                                                .map((r) => ({
                                                                    nodeId: r.videoNodeId,
                                                                    kind: "video",
                                                                    label: `${r.code} · 视频`,
                                                                    prompt: r.vidPrompt,
                                                                }));
                                                            if (tasks.length) void host?.runStoryboardBatch?.(tasks, { title: "生成视频" });
                                                        }}
                                                    >
                                                        生成视频
                                                    </button>
                                                ) : null}
                                            </div>
                                        );
                                    })()
                                ) : null}
                            </div>
                        );
                    })}

                    {running ? (
                        <div className="flex items-center gap-2 opacity-70">
                            <Loader2 className="size-3.5 animate-spin" />
                            <span>正在思考…</span>
                        </div>
                    ) : null}
                </div>

                {/* Composer */}
                <div
                    className={`shrink-0 border-t p-3 transition ${mediaPickEnabled ? "ring-1 ring-inset ring-sky-500/60" : ""}`}
                    style={{ borderColor: border }}
                >
                    {/* Fixed Switch: 拾取画布素材 */}
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                                mediaPickEnabled
                                    ? "bg-sky-500 text-white"
                                    : "hover:bg-black/5 dark:hover:bg-white/10"
                            }`}
                            style={mediaPickEnabled ? undefined : { border: `1px solid ${border}` }}
                            onClick={() => setMediaPickEnabled((v) => !v)}
                        >
                            <Hand className="size-3.5" />
                            <span>{mediaPickEnabled ? "拾取画布素材：已开启（拖入或点选图/视频）" : "拾取画布素材"}</span>
                        </button>
                        {attachedNodes.length > 0 ? (
                            <button
                                type="button"
                                className="text-[11px] opacity-60 hover:opacity-100"
                                onClick={() => setAttachedNodeIds([])}
                            >
                                清空
                            </button>
                        ) : null}
                    </div>

                    {/* Attached Image / Video Thumbnails */}
                    {attachedNodes.length > 0 ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {attachedNodes.map((n) => (
                                <div
                                    key={n.id}
                                    className="group relative flex items-center gap-1.5 rounded-lg border p-1 pr-2"
                                    style={{ borderColor: border, background: theme.toolbar.activeBg }}
                                >
                                    {n.type === CanvasNodeType.Image ? (
                                        <img
                                            src={n.metadata?.content}
                                            alt={n.title}
                                            className="size-9 rounded object-cover"
                                        />
                                    ) : (
                                        <div className="relative grid size-9 place-items-center overflow-hidden rounded bg-black">
                                            <video
                                                src={n.metadata?.content}
                                                className="size-full object-cover"
                                                muted
                                            />
                                            <Video className="pointer-events-none absolute size-3.5 text-white/90" />
                                        </div>
                                    )}
                                    <div className="max-w-[96px] truncate text-[11px]">
                                        <div className="font-semibold">@{n.metadata?.refId || n.type}</div>
                                        <div className="truncate text-[10px] opacity-70">{n.title}</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="ml-1 rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                                        onClick={() => setAttachedNodeIds((prev) => prev.filter((id) => id !== n.id))}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div className="flex items-end gap-2">
                        <textarea
                            rows={2}
                            className="min-w-0 flex-1 resize-none rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none"
                            style={{ borderColor: border }}
                            placeholder="直接聊天讨论素材，或输入指令生成/修改分镜表…"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                        />
                        {running ? (
                            <button
                                type="button"
                                className="grid size-8 shrink-0 place-items-center rounded-lg border text-red-500 hover:bg-red-500/10"
                                style={{ borderColor: border }}
                                title="停止"
                                onClick={() => abortRef.current?.abort()}
                            >
                                <Square className="size-3.5" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-500 text-white transition hover:bg-sky-600 disabled:opacity-40"
                                disabled={!input.trim() && attachedNodes.length === 0}
                                title="发送"
                                onClick={() => void handleSend()}
                            >
                                <Send className="size-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </aside>
        </motion.div>
    );
}
