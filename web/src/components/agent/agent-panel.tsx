import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { Flame, Loader2, Send, Sparkles, Square, X } from "lucide-react";
import { motion } from "motion/react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import { previewPlan, requestStoryboardPlan, type Change, type Plan } from "@/lib/canvas/storyboard-plan";
import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import { createEmptyStoryboardData } from "@/lib/canvas/storyboard-utils";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { HemosiNodeType, type CanvasNodeData } from "@/types/canvas";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

type DirectorMessage =
    | { id: string; role: "user"; text: string }
    | { id: string; role: "error"; text: string; raw?: string }
    | {
          id: string;
          role: "plan";
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

    const pendingPlanMsg = useMemo(
        () => [...messages].reverse().find((m): m is Extract<DirectorMessage, { role: "plan" }> => m.role === "plan" && m.status === "pending") || null,
        [messages],
    );

    const pendingPreview = useMemo(() => {
        if (!pendingPlanMsg || !targetSb) return null;
        const data = targetSb.metadata?.storyboard || createEmptyStoryboardData();
        return previewPlan(data, pendingPlanMsg.plan, new Set(pendingPlanMsg.enabledIds), allNodes, targetSb);
    }, [allNodes, pendingPlanMsg, targetSb]);

    useEffect(() => {
        host?.setStoryboardGhostNodes?.(pendingPreview?.diff.ghostNodes || []);
    }, [host, pendingPreview]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || running) return;
        if (!targetSb) {
            message.warning("请先在画布中添加一个「分镜表」节点");
            return;
        }
        const activeTextModel = textModel || effectiveConfig.textModel || effectiveConfig.model;
        if (!activeTextModel) {
            message.warning("请先在顶部选择一个文本模型");
            return;
        }

        setInput("");
        setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await requestStoryboardPlan({
                config: { ...effectiveConfig, model: activeTextModel, textModel: activeTextModel },
                storyboardNode: targetSb,
                nodes: allNodes,
                instruction: text,
                signal: controller.signal,
            });
            if (res.ok) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `p-${Date.now()}`,
                        role: "plan",
                        plan: res.plan,
                        enabledIds: res.plan.changes.map((c) => c.id),
                        status: "pending",
                    },
                ]);
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
        if (!msg || msg.role !== "plan" || !targetSb || !host?.applyStoryboardPlan) return;
        const result = host.applyStoryboardPlan(targetSb.id, msg.plan, new Set(msg.enabledIds), removeOrphan);
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
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => host?.openViralCloneWorkbench?.("")}
                    >
                        <Flame className="size-3.5 text-amber-500" /> 爆款复刻
                    </button>
                </div>

                {/* Model Selector */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: border }}>
                    <span className="shrink-0 opacity-65">文本模型</span>
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
                            {targetSb
                                ? "输入剧情想法或修改指令，我会生成 10 列分镜与折叠图片/视频提示词方案，勾选确认后再写入画布。"
                                : "请先从左侧工具栏添加一个「分镜表」节点。"}
                        </div>
                    ) : null}

                    {messages.map((m) => {
                        if (m.role === "user") {
                            return (
                                <div key={m.id} className="ml-6 rounded-xl px-3 py-2" style={{ background: theme.toolbar.activeBg }}>
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
                                ) : m.status === "applied" && m.plan.suggestRun && targetSb ? (
                                    <div className="flex items-center gap-2 pt-1">
                                        {m.plan.suggestRun.kind === "image" || m.plan.suggestRun.kind === "both" ? (
                                            <button
                                                type="button"
                                                className="flex-1 rounded-lg border py-1 text-[11px] font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                                                style={{ borderColor: border }}
                                                onClick={() => {
                                                    const rows = targetSb.metadata?.storyboard?.rows || [];
                                                    const wanted = new Set(m.plan.suggestRun!.rowIds);
                                                    const tasks: StoryboardQueueTask[] = rows
                                                        .filter((r) => wanted.size === 0 || wanted.has(r.id) || wanted.has(r.code))
                                                        .map((r) => ({ nodeId: r.imageNodeId, kind: "image", label: `${r.code} · 首帧图`, prompt: r.imgPrompt }));
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
                                                    const rows = targetSb.metadata?.storyboard?.rows || [];
                                                    const wanted = new Set(m.plan.suggestRun!.rowIds);
                                                    const tasks: StoryboardQueueTask[] = rows
                                                        .filter((r) => wanted.size === 0 || wanted.has(r.id) || wanted.has(r.code))
                                                        .map((r) => ({ nodeId: r.videoNodeId, kind: "video", label: `${r.code} · 视频`, prompt: r.vidPrompt }));
                                                    if (tasks.length) void host?.runStoryboardBatch?.(tasks, { title: "生成视频" });
                                                }}
                                            >
                                                生成视频
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    {running ? (
                        <div className="flex items-center gap-2 opacity-70">
                            <Loader2 className="size-3.5 animate-spin" />
                            <span>正在规划分镜与提示词…</span>
                        </div>
                    ) : null}
                </div>

                {/* Composer */}
                <div className="shrink-0 border-t p-3" style={{ borderColor: border }}>
                    {selectedIds.length > 0 ? (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                            {selectedIds.map((id) => {
                                const node = allNodes.find((n) => n.id === id);
                                if (!node) return null;
                                return (
                                    <span
                                        key={id}
                                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                                        style={{ background: theme.toolbar.activeBg }}
                                    >
                                        @{node.metadata?.refId || node.title}
                                    </span>
                                );
                            })}
                        </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                        <textarea
                            rows={2}
                            className="min-w-0 flex-1 resize-none rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none"
                            style={{ borderColor: border }}
                            placeholder="告诉导演你想怎么拍，例如：写 3 镜开场，或改 @S02 动作…"
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
                                disabled={!input.trim()}
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
