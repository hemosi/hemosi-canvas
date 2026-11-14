import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { Clapperboard, FileText, Hand, Loader2, RotateCcw, Send, Sparkles, Square, Video, X } from "lucide-react";
import { motion } from "motion/react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import {
    compressHistoryTurns,
    getNodeTextContent,
    previewPlan,
    requestStoryboardPlan,
    type AgentHistoryTurn,
    type AgentMode,
    type Change,
    type Plan,
} from "@/lib/canvas/storyboard-plan";
import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import { createEmptyStoryboardData, type StoryboardModelPresets } from "@/lib/canvas/storyboard-utils";
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
          storyboardNodeId?: string;
          plan: Plan;
          enabledIds: string[];
          status: "pending" | "applied" | "rejected";
      };

type ScopedMemory = {
    messages: DirectorMessage[];
    compressedSummary: string;
};

const scopedMemoryStore = new Map<string, ScopedMemory>();

function messageToTurn(m: DirectorMessage): AgentHistoryTurn | null {
    if (m.role === "user") return { role: "user", text: m.text };
    if (m.role === "assistant") return { role: "assistant", text: m.text };
    if (m.role === "plan") return { role: "assistant", text: m.plan.summary };
    return null;
}

function autoCompressMemory(mem: ScopedMemory): ScopedMemory {
    const turns = mem.messages.map(messageToTurn).filter((t): t is AgentHistoryTurn => Boolean(t));
    const totalChars = turns.reduce((acc, t) => acc + t.text.length, 0);
    if (mem.messages.length <= 6 && totalChars <= 1800) {
        return mem;
    }
    const cutoff = Math.max(0, mem.messages.length - 4);
    const olderMessages = mem.messages.slice(0, cutoff);
    const recentMessages = mem.messages.slice(cutoff);
    const olderTurns = olderMessages.map(messageToTurn).filter((t): t is AgentHistoryTurn => Boolean(t));
    if (!olderTurns.length) return mem;
    return {
        messages: recentMessages,
        compressedSummary: compressHistoryTurns(mem.compressedSummary, olderTurns),
    };
}

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
        case "canvas.text.add":
            return { badge: "建文本", title: ch.title || "文本节点", detail: ch.content };
        case "canvas.image.add":
            return {
                badge: "建图片",
                title: `${ch.title || "图片节点"}${ch.size ? ` (${ch.size})` : ""}${ch.refs ? ` · 参考 ${ch.refs}` : ""}`,
                detail: ch.prompt,
            };
        case "canvas.video.add":
            return {
                badge: "建视频",
                title: `${ch.title || "视频节点"} (${ch.duration}s · ${ch.size || "16:9"})${ch.refs ? ` · 参考 ${ch.refs}` : ""}`,
                detail: ch.prompt,
            };
    }
}

function planNeedsImagePreset(changes: Change[]): boolean {
    return changes.some(
        (c) => c.kind === "canvas.image.add" || c.kind === "setting.add" || c.kind === "row.add" || c.kind === "row.update",
    );
}

function planNeedsVideoPreset(changes: Change[]): boolean {
    return changes.some((c) => c.kind === "canvas.video.add" || c.kind === "row.add" || c.kind === "row.update");
}

function isCanvasOnlyPlan(changes: Change[]): boolean {
    return (
        changes.length > 0 &&
        changes.every((c) => c.kind === "canvas.text.add" || c.kind === "canvas.image.add" || c.kind === "canvas.video.add")
    );
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
    const configImageModel = useConfigStore((s) => s.config.imageModel || s.config.model);
    const configVideoModel = useConfigStore((s) => s.config.videoModel || s.config.model);
    const updateConfig = useConfigStore((s) => s.updateConfig);

    const [agentMode, setAgentMode] = useState<AgentMode>("canvas");
    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);
    const [removeOrphan, setRemoveOrphan] = useState(true);
    const [mediaPickEnabled, setMediaPickEnabled] = useState(false);
    const [attachedNodeIds, setAttachedNodeIds] = useState<string[]>([]);
    const [presetImageModel, setPresetImageModel] = useState<string>(configImageModel || "");
    const [presetImageSize, setPresetImageSize] = useState<string>("9:16");
    const [presetVideoModel, setPresetVideoModel] = useState<string>(configVideoModel || "");
    const [presetVideoSize, setPresetVideoSize] = useState<string>("16:9");
    const [memoryTick, setMemoryTick] = useState(0);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (configImageModel && !presetImageModel) setPresetImageModel(configImageModel);
    }, [configImageModel, presetImageModel]);

    useEffect(() => {
        if (configVideoModel && !presetVideoModel) setPresetVideoModel(configVideoModel);
    }, [configVideoModel, presetVideoModel]);

    const host = getShotHost();
    const projectId = host?.getProjectId?.() || "default";
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

    const scopeKey = useMemo(() => {
        if (agentMode === "storyboard") {
            return `${projectId}:sb:${targetSb?.id || "none"}`;
        }
        return `${projectId}:canvas`;
    }, [agentMode, projectId, targetSb?.id]);

    const currentMemory = useMemo<ScopedMemory>(() => {
        void memoryTick;
        return scopedMemoryStore.get(scopeKey) || { messages: [], compressedSummary: "" };
    }, [memoryTick, scopeKey]);

    const messages = currentMemory.messages;
    const compressedSummary = currentMemory.compressedSummary;

    const updateScopedMessages = (updater: (prev: DirectorMessage[]) => DirectorMessage[]) => {
        const cur = scopedMemoryStore.get(scopeKey) || { messages: [], compressedSummary: "" };
        const nextMsgs = updater(cur.messages);
        const nextMem = autoCompressMemory({ ...cur, messages: nextMsgs });
        scopedMemoryStore.set(scopeKey, nextMem);
        setMemoryTick((t) => t + 1);
    };

    const clearCurrentScope = () => {
        host?.setStoryboardGhostNodes?.([]);
        scopedMemoryStore.set(scopeKey, { messages: [], compressedSummary: "" });
        setMemoryTick((t) => t + 1);
        message.success("已清空当前上下文");
    };

    useEffect(() => {
        const onDropNodes = (event: Event) => {
            const detail = (event as CustomEvent<{ nodeIds?: string[] }>).detail;
            const ids = detail?.nodeIds || [];
            if (!ids.length) return;
            const validIds = ids.filter((id) => {
                const n = (getShotHost()?.getAllNodes?.() || []).find((item) => item.id === id);
                if (!n) return false;
                if (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) {
                    return Boolean(n.metadata?.content);
                }
                if (n.type === CanvasNodeType.Text) {
                    return Boolean(getNodeTextContent(n));
                }
                return false;
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
                .filter((n): n is CanvasNodeData => {
                    if (!n) return false;
                    if (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) {
                        return Boolean(n.metadata?.content);
                    }
                    if (n.type === CanvasNodeType.Text) {
                        return Boolean(getNodeTextContent(n));
                    }
                    return false;
                }),
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
        if (!pendingPlanMsg || !pendingPlanMsg.storyboardNodeId) return null;
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

        const sbSnapshot = agentMode === "storyboard" ? targetSb : null;
        const matchedRow = sbSnapshot?.metadata?.storyboard?.rows.find(
            (r) => selectedIds.includes(r.imageNodeId) || selectedIds.includes(r.videoNodeId),
        );

        const currentAttachedIds = [...attachedNodeIds];
        const mediaLabels = attachedNodes.map((n) => `@${n.metadata?.refId || n.title || n.type}`);
        const history: AgentHistoryTurn[] = messages
            .map(messageToTurn)
            .filter((t): t is AgentHistoryTurn => Boolean(t));

        setInput("");
        setAttachedNodeIds([]);
        updateScopedMessages((prev) => [
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
                instruction: text || "请分析我附上的画布素材",
                agentMode,
                selectedRowId: matchedRow?.code || null,
                attachedNodeIds: currentAttachedIds,
                history,
                compressedSummary,
                signal: controller.signal,
            });
            if (res.ok) {
                const hasChanges = res.plan.changes.length > 0;
                const firstImgChange = res.plan.changes.find((c) => c.kind === "canvas.image.add");
                if (firstImgChange && firstImgChange.kind === "canvas.image.add" && firstImgChange.size) {
                    setPresetImageSize(firstImgChange.size);
                }
                if (!hasChanges) {
                    updateScopedMessages((prev) => [
                        ...prev,
                        { id: `a-${Date.now()}`, role: "assistant", text: res.plan.summary },
                    ]);
                } else {
                    updateScopedMessages((prev) => [
                        ...prev,
                        {
                            id: `p-${Date.now()}`,
                            role: "plan",
                            storyboardNodeId: sbSnapshot?.id,
                            plan: res.plan,
                            enabledIds: res.plan.changes.map((c) => c.id),
                            status: "pending",
                        },
                    ]);
                }
            } else {
                updateScopedMessages((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}`, role: "error", text: res.error, raw: res.raw },
                ]);
            }
        } catch (err) {
            if ((err as Error)?.name !== "AbortError") {
                updateScopedMessages((prev) => [
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
        updateScopedMessages((prev) =>
            prev.map((m) => {
                if (m.id !== msgId || m.role !== "plan" || m.status !== "pending") return m;
                const set = new Set(m.enabledIds);
                if (set.has(changeId)) set.delete(changeId);
                else set.add(changeId);
                return { ...m, enabledIds: [...set] };
            }),
        );
    };

    const handleApplyPlan = (msgId: string, autoRun = false) => {
        const msg = messages.find((m) => m.id === msgId);
        if (!msg || msg.role !== "plan") return;

        const modelPresets: StoryboardModelPresets = {
            imageModel: presetImageModel || configImageModel,
            imageSize: presetImageSize,
            videoModel: presetVideoModel || configVideoModel,
            videoSize: presetVideoSize,
        };
        if (modelPresets.imageModel) updateConfig("imageModel", modelPresets.imageModel);
        if (modelPresets.videoModel) updateConfig("videoModel", modelPresets.videoModel);

        const enabledSet = new Set(msg.enabledIds);
        const canvasOnly = isCanvasOnlyPlan(msg.plan.changes) || !msg.storyboardNodeId;

        if (canvasOnly) {
            if (!host?.applyCanvasAgentPlan) return;
            const res = host.applyCanvasAgentPlan(msg.plan, enabledSet, modelPresets);
            updateScopedMessages((prev) =>
                prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "applied" } : m)),
            );
            message.success("已在画布上生成节点");
            if (autoRun && res?.createdTasks?.length) {
                void host.runStoryboardBatch?.(res.createdTasks, { skipConfirm: true, title: "生成节点内容" });
            }
            return;
        }

        if (!host?.applyStoryboardPlan) return;
        const planSb = allNodes.find((n) => n.id === msg.storyboardNodeId);
        if (!planSb) {
            message.warning("原分镜表节点已不存在，请先在画布创建分镜表或切换到画布助手模式");
            return;
        }
        const result = host.applyStoryboardPlan(planSb.id, msg.plan, enabledSet, removeOrphan, modelPresets);
        host.setStoryboardGhostNodes?.([]);
        updateScopedMessages((prev) =>
            prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "applied" } : m)),
        );
        if (result?.warnings?.length) {
            message.warning(result.warnings[0]);
        } else {
            message.success("已应用改动并绑定模型预设");
        }
        if (autoRun && result?.createdTasks?.length) {
            void host.runStoryboardBatch?.(result.createdTasks, { skipConfirm: true, title: "生成节点内容" });
        }
    };

    const handleRejectPlan = (msgId: string) => {
        host?.setStoryboardGhostNodes?.([]);
        updateScopedMessages((prev) =>
            prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "rejected" } : m)),
        );
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
                {/* Top Header: Mode Switch + Clear */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: border }}>
                    <div className="flex min-w-0 items-center gap-1.5 font-semibold">
                        <Sparkles className="size-4 shrink-0 text-sky-500" />
                        <span className="truncate">{agentMode === "storyboard" ? "分镜 Agent" : "画布助手"}</span>
                        {agentMode === "storyboard" && targetSb?.metadata?.refId ? (
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg }}>
                                @{targetSb.metadata.refId}
                            </span>
                        ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                                agentMode === "storyboard"
                                    ? "bg-sky-500 text-white"
                                    : "hover:bg-black/5 dark:hover:bg-white/10"
                            }`}
                            style={agentMode === "storyboard" ? undefined : { border: `1px solid ${border}` }}
                            title="开启后专注绑定当前分镜表；关闭时为通用画布助手（可自由生成文本/图片/视频节点）"
                            onClick={() => setAgentMode((m) => (m === "storyboard" ? "canvas" : "storyboard"))}
                        >
                            <Clapperboard className="size-3" />
                            <span>分镜模式</span>
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                            style={{ border: `1px solid ${border}` }}
                            title="清空当前画布/分镜表的对话上下文（Clear）"
                            onClick={clearCurrentScope}
                        >
                            <RotateCcw className="size-3" />
                            <span>Clear</span>
                        </button>
                    </div>
                </div>

                {/* Chat Model Selector */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: border }}>
                    <span className="shrink-0 opacity-65">对话模型</span>
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
                    {compressedSummary ? (
                        <div
                            className="rounded-lg border px-2.5 py-1.5 text-[11px] opacity-75"
                            style={{ borderColor: border, background: theme.toolbar.activeBg }}
                            title={compressedSummary}
                        >
                            已自动压缩早期上下文（悬停可查看摘要，点顶部 Clear 可清空）
                        </div>
                    ) : null}

                    {messages.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-4 text-center opacity-60" style={{ borderColor: border }}>
                            {agentMode === "storyboard"
                                ? `当前为「分镜模式」（已隔离绑定 ${targetSb?.metadata?.refId ? `@${targetSb.metadata.refId}` : "分镜表"} 记忆）。可拾取素材讨论并生成 10 列分镜表。`
                                : "当前为「画布助手」模式（已按当前画布隔离记忆）。可自由聊天分析素材，或直接让助手在画布上生成文本、图片（含角色卡）、视频节点。"}
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

                        const showImgPreset = planNeedsImagePreset(m.plan.changes);
                        const showVidPreset = planNeedsVideoPreset(m.plan.changes);
                        const hasDirectMediaAdd = m.plan.changes.some(
                            (c) => c.kind === "canvas.image.add" || c.kind === "canvas.video.add",
                        );

                        return (
                            <div key={m.id} className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: border }}>
                                <div className="flex items-start justify-between gap-2">
                                    <span className="whitespace-pre-wrap font-semibold leading-relaxed">{m.plan.summary}</span>
                                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg }}>
                                        {m.status === "pending" ? "待确认" : m.status === "applied" ? "已生成" : "未采用"}
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
                                    <div className="space-y-2 rounded-lg border p-2" style={{ borderColor: border, background: theme.toolbar.activeBg }}>
                                        {(showImgPreset || showVidPreset) ? (
                                            <div className="space-y-1.5">
                                                <div className="text-[11px] font-medium opacity-80">生成节点模型预设</div>
                                                {showImgPreset ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="w-12 shrink-0 text-[11px] opacity-70">图片模型</span>
                                                        <div className="min-w-0 flex-1">
                                                            <ModelPicker
                                                                config={effectiveConfig}
                                                                capability="image"
                                                                fullWidth
                                                                value={presetImageModel}
                                                                onChange={(val) => setPresetImageModel(val)}
                                                            />
                                                        </div>
                                                        <select
                                                            className="rounded border px-1.5 py-1 text-[11px] outline-none"
                                                            style={{ borderColor: border, background: theme.node.panel, color: theme.node.text }}
                                                            value={presetImageSize}
                                                            onChange={(e) => setPresetImageSize(e.target.value)}
                                                        >
                                                            {["9:16", "16:9", "1:1", "4:3", "3:4"].map((ratio) => (
                                                                <option key={ratio} value={ratio} style={{ background: theme.node.panel, color: theme.node.text }}>
                                                                    {ratio}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ) : null}
                                                {showVidPreset ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="w-12 shrink-0 text-[11px] opacity-70">视频模型</span>
                                                        <div className="min-w-0 flex-1">
                                                            <ModelPicker
                                                                config={effectiveConfig}
                                                                capability="video"
                                                                fullWidth
                                                                value={presetVideoModel}
                                                                onChange={(val) => setPresetVideoModel(val)}
                                                            />
                                                        </div>
                                                        <select
                                                            className="rounded border px-1.5 py-1 text-[11px] outline-none"
                                                            style={{ borderColor: border, background: theme.node.panel, color: theme.node.text }}
                                                            value={presetVideoSize}
                                                            onChange={(e) => setPresetVideoSize(e.target.value)}
                                                        >
                                                            {["16:9", "9:16"].map((ratio) => (
                                                                <option key={ratio} value={ratio} style={{ background: theme.node.panel, color: theme.node.text }}>
                                                                    {ratio}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

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

                                        <div className="flex items-center gap-1.5 pt-0.5">
                                            <button
                                                type="button"
                                                className="flex-1 rounded-lg bg-sky-500 py-1.5 font-medium text-white transition hover:bg-sky-600"
                                                onClick={() => handleApplyPlan(m.id, false)}
                                            >
                                                确认生成节点
                                            </button>
                                            {hasDirectMediaAdd ? (
                                                <button
                                                    type="button"
                                                    className="flex-1 rounded-lg bg-emerald-500 py-1.5 font-medium text-white transition hover:bg-emerald-600"
                                                    onClick={() => handleApplyPlan(m.id, true)}
                                                >
                                                    生成节点并立即运行
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                className="rounded-lg border px-2.5 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/10"
                                                style={{ borderColor: border }}
                                                onClick={() => handleRejectPlan(m.id)}
                                            >
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : m.status === "applied" && m.plan.suggestRun && m.storyboardNodeId ? (
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
                            <span>{mediaPickEnabled ? "拾取画布素材：已开启（单击图/视频/文本）" : "拾取画布素材"}</span>
                        </button>
                        {attachedNodes.length > 0 ? (
                            <button
                                type="button"
                                className="text-[11px] opacity-60 hover:opacity-100"
                                onClick={() => setAttachedNodeIds([])}
                            >
                                清空素材
                            </button>
                        ) : null}
                    </div>

                    {/* Attached Image / Video / Text Thumbnails */}
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
                                    ) : n.type === CanvasNodeType.Video ? (
                                        <div className="relative grid size-9 place-items-center overflow-hidden rounded bg-black">
                                            <video
                                                src={n.metadata?.content}
                                                className="size-full object-cover"
                                                muted
                                            />
                                            <Video className="pointer-events-none absolute size-3.5 text-white/90" />
                                        </div>
                                    ) : (
                                        <div className="grid size-9 place-items-center rounded">
                                            <FileText className="size-4 opacity-80" />
                                        </div>
                                    )}
                                    <div className="max-w-[110px] truncate text-[11px]">
                                        <div className="font-semibold">@{n.metadata?.refId || n.type}</div>
                                        <div className="truncate text-[10px] opacity-70">
                                            {n.type === CanvasNodeType.Text ? getNodeTextContent(n).slice(0, 24) || n.title : n.title}
                                        </div>
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
                            placeholder={
                                agentMode === "storyboard"
                                    ? "讨论剧情或输入指令生成/修改当前分镜表…"
                                    : "自由聊天，或让助手直接在画布生成文本/图片/视频节点…"
                            }
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
