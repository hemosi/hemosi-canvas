import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import localforage from "localforage";
import { Clapperboard, FileText, Hand, Loader2, RotateCcw, Send, Sparkles, Square, Video, X } from "lucide-react";
import { motion } from "motion/react";
import { Streamdown } from "streamdown";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import {
    compactHistoryWithModel,
    compressHistoryTurns,
    getNodeTextContent,
    previewPlan,
    requestStoryboardPlan,
    type AgentHistoryTurn,
    type AgentMode,
    type Change,
    type Plan,
} from "@/lib/canvas/storyboard-plan";
import { syncStoryboardModelRules } from "@/lib/canvas/storyboard-model-rules";
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
    | { id: string; role: "error"; text: string; raw?: string; title?: string }
    | {
          id: string;
          role: "plan";
          storyboardNodeId?: string;
          plan: Plan;
          enabledIds: string[];
          status: "pending" | "applied" | "rejected";
      };

type ScopedMemory = {
    /** Every message stays here for the panel; compaction never deletes them. */
    messages: DirectorMessage[];
    compressedSummary: string;
    /** How many leading messages are folded into compressedSummary and no longer sent verbatim. */
    compactedCount: number;
};

/** Auto compact once the context sent to the model passes ~100k characters. */
const COMPACT_THRESHOLD_CHARS = 100_000;
/** Recent messages always sent verbatim after a compact. */
const COMPACT_KEEP_RECENT = 10;

const emptyMemory = (): ScopedMemory => ({ messages: [], compressedSummary: "", compactedCount: 0 });

/** Conversation memory per canvas/storyboard scope, kept in IndexedDB so it survives a refresh. */
const memoryStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_memory" });
const scopedMemoryStore = new Map<string, ScopedMemory>();
const loadedScopes = new Set<string>();
/** Bumped by 清空; a reply that comes back after its scope was cleared is dropped. */
const scopeEpochs = new Map<string, number>();

function setScopedMemory(key: string, memory: ScopedMemory) {
    scopedMemoryStore.set(key, memory);
    void memoryStorage.setItem(key, memory).catch((err) => console.warn("[agent] 保存对话记录失败", err));
}

async function loadScopedMemory(key: string) {
    if (loadedScopes.has(key)) return;
    loadedScopes.add(key);
    const saved = await memoryStorage.getItem<ScopedMemory>(key).catch(() => null);
    if (!saved) return;
    // Messages written before the load finished go after the saved ones.
    const cur = scopedMemoryStore.get(key);
    scopedMemoryStore.set(key, cur ? { ...saved, messages: [...saved.messages, ...cur.messages] } : { ...emptyMemory(), ...saved });
}

const isStoryboardChange = (c: Change) => !c.kind.startsWith("canvas.");

/**
 * The storyboard a plan applies to, looked up now rather than when the plan was made:
 * its own table if it still exists; for a plan made with no table, the selected or first table on the canvas.
 * `missing` means its table was deleted.
 */
function resolvePlanStoryboard(storyboardNodeId: string | undefined, nodes: CanvasNodeData[], selectedIds: string[]) {
    const tables = nodes.filter((n) => n.type === HemosiNodeType.Storyboard);
    if (storyboardNodeId) {
        const own = tables.find((n) => n.id === storyboardNodeId);
        return { node: own || null, missing: !own };
    }
    return { node: tables.find((n) => selectedIds.includes(n.id)) || tables[0] || null, missing: false };
}

function messageToTurn(m: DirectorMessage): AgentHistoryTurn | null {
    if (m.role === "user") {
        const labels = m.mediaLabels?.length ? `【附带素材】${m.mediaLabels.join("、")}\n` : "";
        return { role: "user", text: `${labels}${m.text}` };
    }
    if (m.role === "assistant") return { role: "assistant", text: m.text };
    if (m.role === "plan") {
        const enabled = new Set(m.enabledIds);
        const status = m.status === "applied" ? "用户已应用" : m.status === "rejected" ? "用户未采用" : "待用户确认";
        const lines = m.plan.changes.map((ch) => {
            const info = changeLabel(ch);
            const picked = m.status === "applied" ? (enabled.has(ch.id) ? "（已应用）" : "（用户取消勾选）") : "";
            return `- [${ch.id}] ${info.badge} ${info.title}${picked}：${info.detail}`;
        });
        return { role: "assistant", text: `${m.plan.summary}\n【改动计划 · ${status}】\n${lines.join("\n")}` };
    }
    return null;
}

function turnsChars(summary: string, turns: AgentHistoryTurn[]) {
    return summary.length + turns.reduce((acc, t) => acc + t.text.length, 0);
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

function AgentMarkdown({ text }: { text: string }) {
    return (
        <Streamdown className="agent-streamdown" mode="static" lineNumbers={false} controls={{ code: { copy: true, download: false }, table: false }}>
            {text}
        </Streamdown>
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
    const [canvasTick, setCanvasTick] = useState(0);

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

    // Re-render when the selection or the storyboard tables change on the canvas (not on every drag frame).
    useEffect(() => {
        let raf = 0;
        let lastSelection = "";
        let lastCount = -1;
        let lastTables: unknown[] = [];
        const check = () => {
            const h = getShotHost();
            const nodes = h?.getAllNodes?.() || [];
            const selection = (h?.getSelectedNodeIds?.() || []).join(",");
            const tables = nodes.filter((n) => n.type === HemosiNodeType.Storyboard).map((n) => n.metadata);
            const changed =
                selection !== lastSelection ||
                nodes.length !== lastCount ||
                tables.length !== lastTables.length ||
                tables.some((t, i) => t !== lastTables[i]);
            if (!changed) return;
            lastSelection = selection;
            lastCount = nodes.length;
            lastTables = tables;
            setCanvasTick((t) => t + 1);
        };
        const off = onCanvasEvent("canvas:changed", () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(check);
        });
        return () => {
            off();
            cancelAnimationFrame(raf);
        };
    }, []);

    useEffect(() => {
        if (configImageModel && !presetImageModel) setPresetImageModel(configImageModel);
    }, [configImageModel, presetImageModel]);

    useEffect(() => {
        if (configVideoModel && !presetVideoModel) setPresetVideoModel(configVideoModel);
    }, [configVideoModel, presetVideoModel]);

    const host = getShotHost();
    const projectId = host?.getProjectId?.() || "default";
    // canvasTick forces a fresh read after a relevant canvas change.
    const allNodes: CanvasNodeData[] = useMemo(() => (void canvasTick, host?.getAllNodes?.() || []), [canvasTick, host]);
    const selectedIds = useMemo(() => (void canvasTick, host?.getSelectedNodeIds?.() || []), [canvasTick, host]);
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

    useEffect(() => {
        if (loadedScopes.has(scopeKey)) return;
        let alive = true;
        void loadScopedMemory(scopeKey).then(() => {
            if (alive) setMemoryTick((t) => t + 1);
        });
        return () => {
            alive = false;
        };
    }, [scopeKey]);

    // The panel's model presets follow the bound storyboard's own models.
    useEffect(() => {
        const data = targetSb?.metadata?.storyboard;
        if (agentMode !== "storyboard" || !data) return;
        if (data.imageModel) setPresetImageModel(data.imageModel);
        if (data.videoModel) setPresetVideoModel(data.videoModel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentMode, targetSb?.id]);

    /** Record the storyboard's models and switch its unedited prompt templates to those models' presets. */
    const syncStoryboardTemplates = (sb: CanvasNodeData | null, imageModel?: string, videoModel?: string) => {
        const data = sb?.metadata?.storyboard;
        if (!sb || !data) return sb;
        const next = syncStoryboardModelRules(data, { imageModel, videoModel });
        if (!next) return sb;
        host?.updateMetadata(sb.id, { storyboard: next });
        return { ...sb, metadata: { ...sb.metadata, storyboard: next } };
    };

    const currentMemory = useMemo<ScopedMemory>(() => {
        void memoryTick;
        return scopedMemoryStore.get(scopeKey) || emptyMemory();
    }, [memoryTick, scopeKey]);

    const messages = currentMemory.messages;
    const compressedSummary = currentMemory.compressedSummary;
    const compactedCount = currentMemory.compactedCount || 0;
    const [compacting, setCompacting] = useState(false);

    const updateScopedMessages = (updater: (prev: DirectorMessage[]) => DirectorMessage[], key = scopeKey) => {
        const cur = scopedMemoryStore.get(key) || emptyMemory();
        setScopedMemory(key, { ...cur, messages: updater(cur.messages) });
        setMemoryTick((t) => t + 1);
    };

    const clearCurrentScope = () => {
        // Stop the reply in flight and make sure a late one is not written back.
        abortRef.current?.abort();
        abortRef.current = null;
        setRunning(false);
        setCompacting(false);
        scopeEpochs.set(scopeKey, (scopeEpochs.get(scopeKey) || 0) + 1);
        host?.setStoryboardGhostNodes?.([]);
        setScopedMemory(scopeKey, emptyMemory());
        setMemoryTick((t) => t + 1);
        message.success("已清空当前对话");
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
        if (!pendingPlanMsg || !pendingPlanMsg.plan.changes.some(isStoryboardChange)) return null;
        const planSb = resolvePlanStoryboard(pendingPlanMsg.storyboardNodeId, allNodes, selectedIds).node;
        if (!planSb) return null;
        const data = planSb.metadata?.storyboard || createEmptyStoryboardData();
        return previewPlan(data, pendingPlanMsg.plan, new Set(pendingPlanMsg.enabledIds), allNodes, planSb);
    }, [allNodes, pendingPlanMsg, selectedIds]);

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

        // The agent reads the storyboard's prompt templates, so bring them in line with the chosen models first.
        const sbSnapshot =
            agentMode === "storyboard"
                ? syncStoryboardTemplates(targetSb, presetImageModel || configImageModel, presetVideoModel || configVideoModel)
                : null;
        const matchedRow = sbSnapshot?.metadata?.storyboard?.rows.find(
            (r) => selectedIds.includes(r.imageNodeId) || selectedIds.includes(r.videoNodeId),
        );

        const currentAttachedIds = [...attachedNodeIds];
        const mediaLabels = attachedNodes.map((n) => `@${n.metadata?.refId || n.title || n.type}`);
        const sendScopeKey = scopeKey;
        const sendEpoch = scopeEpochs.get(sendScopeKey) || 0;

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
        /** False once the user stopped this reply or cleared its conversation; then nothing is written back. */
        const stillWanted = () => !controller.signal.aborted && (scopeEpochs.get(sendScopeKey) || 0) === sendEpoch;
        const writeBack = (updater: (prev: DirectorMessage[]) => DirectorMessage[]) => {
            if (stillWanted()) updateScopedMessages(updater, sendScopeKey);
        };

        try {
            // Auto compact: only when what we would send passes the threshold; the panel keeps every message.
            let summaryForSend = compressedSummary;
            let foldedCount = compactedCount;
            const toTurns = (list: DirectorMessage[]) => list.map(messageToTurn).filter((t): t is AgentHistoryTurn => Boolean(t));
            const pending = messages.slice(foldedCount);
            if (turnsChars(summaryForSend, toTurns(pending)) + text.length > COMPACT_THRESHOLD_CHARS && pending.length > COMPACT_KEEP_RECENT) {
                const foldUntil = messages.length - COMPACT_KEEP_RECENT;
                const foldTurns = toTurns(messages.slice(foldedCount, foldUntil));
                setCompacting(true);
                try {
                    summaryForSend = await compactHistoryWithModel({
                        config: { ...effectiveConfig, model: activeTextModel, textModel: activeTextModel },
                        existingSummary: summaryForSend,
                        turns: foldTurns,
                        signal: controller.signal,
                    });
                } catch (err) {
                    if ((err as Error)?.name === "AbortError") throw err;
                    summaryForSend = compressHistoryTurns(summaryForSend, foldTurns);
                    message.warning("模型压缩失败，已改用截取方式压缩早期对话");
                } finally {
                    setCompacting(false);
                }
                foldedCount = foldUntil;
                if (!stillWanted()) return;
                const cur = scopedMemoryStore.get(sendScopeKey) || emptyMemory();
                setScopedMemory(sendScopeKey, { ...cur, compressedSummary: summaryForSend, compactedCount: foldedCount });
                setMemoryTick((t) => t + 1);
            }
            const history = toTurns(messages.slice(foldedCount));

            const res = await requestStoryboardPlan({
                config: { ...effectiveConfig, model: activeTextModel, textModel: activeTextModel },
                storyboardNode: sbSnapshot,
                nodes: allNodes,
                instruction: text || "请分析我附上的画布素材",
                agentMode,
                selectedRowId: matchedRow?.code || null,
                attachedNodeIds: currentAttachedIds,
                history,
                compressedSummary: summaryForSend,
                signal: controller.signal,
            });
            if (!stillWanted()) return;
            if (res.mediaFailures.length) {
                writeBack((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}-m`, role: "error", title: "有素材没能读取，未发给模型", text: res.mediaFailures.join("；") },
                ]);
            }
            if (res.ok) {
                const hasChanges = res.plan.changes.length > 0;
                const firstImgChange = res.plan.changes.find((c) => c.kind === "canvas.image.add");
                if (firstImgChange && firstImgChange.kind === "canvas.image.add" && firstImgChange.size) {
                    setPresetImageSize(firstImgChange.size);
                }
                if (!hasChanges) {
                    writeBack((prev) => [
                        ...prev,
                        { id: `a-${Date.now()}`, role: "assistant", text: res.plan.summary },
                    ]);
                } else {
                    writeBack((prev) => [
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
                writeBack((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}`, role: "error", title: "回复格式没能解析成改动计划", text: res.error, raw: res.raw },
                ]);
            }
        } catch (err) {
            if ((err as Error)?.name !== "AbortError") {
                writeBack((prev) => [
                    ...prev,
                    { id: `e-${Date.now()}`, role: "error", title: "请求出错", text: err instanceof Error ? err.message : String(err) },
                ]);
            }
        } finally {
            if (abortRef.current === controller) {
                setRunning(false);
                setCompacting(false);
                abortRef.current = null;
            }
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
        if (!msg || msg.role !== "plan" || !host) return;

        // Presets only go onto the nodes this plan creates; the global image/video model settings stay as they are.
        const modelPresets: StoryboardModelPresets = {
            imageModel: presetImageModel || configImageModel,
            imageSize: presetImageSize,
            videoModel: presetVideoModel || configVideoModel,
            videoSize: presetVideoSize,
        };

        const enabledSet = new Set(msg.enabledIds);
        const enabledChanges = msg.plan.changes.filter((c) => enabledSet.has(c.id));
        if (!enabledChanges.length) {
            message.info("没有勾选任何改动");
            return;
        }

        let createdTasks: StoryboardQueueTask[] = [];
        let appliedStoryboardId = msg.storyboardNodeId;

        if (!enabledChanges.some(isStoryboardChange)) {
            if (!host.applyCanvasAgentPlan) return;
            const res = host.applyCanvasAgentPlan(msg.plan, enabledSet, modelPresets);
            if (!res) {
                message.error("画布未就绪，改动没有应用");
                return;
            }
            createdTasks = res.createdTasks;
            message.success(`已在画布上生成 ${enabledChanges.length} 个节点`);
        } else {
            if (!host.applyStoryboardPlan) return;
            // Resolve the table now, so a plan card made before the table existed still works.
            let { node: sb } = resolvePlanStoryboard(msg.storyboardNodeId, host.getAllNodes?.() || [], host.getSelectedNodeIds?.() || []);
            let createdTable = false;
            if (!sb) {
                const newId = host.createStoryboardNode?.();
                sb = (host.getAllNodes?.() || []).find((n) => n.id === newId) || null;
                createdTable = Boolean(sb);
            }
            if (!sb) {
                message.error("没能创建分镜表，改动没有应用");
                return;
            }
            const result = host.applyStoryboardPlan(sb.id, msg.plan, enabledSet, removeOrphan, modelPresets);
            host.setStoryboardGhostNodes?.([]);
            if (!result || result.applied === 0) {
                message.warning(result?.warnings?.[0] || "这份计划里没有能应用到分镜表的改动");
                return;
            }
            createdTasks = result.createdTasks || [];
            appliedStoryboardId = sb.id;
            const tableNote = createdTable ? `，已自动新建分镜表${sb.metadata?.refId ? ` @${sb.metadata.refId}` : ""}` : "";
            if (result.warnings.length) message.warning(`已应用 ${result.applied} 项改动${tableNote}；${result.warnings[0]}`);
            else message.success(`已应用 ${result.applied} 项改动${tableNote}`);
        }

        updateScopedMessages((prev) =>
            prev.map((m) => (m.id === msgId && m.role === "plan" ? { ...m, status: "applied", storyboardNodeId: appliedStoryboardId } : m)),
        );
        // A conversation held before any table existed moves onto the table it just filled, so it stays in view.
        const tableScopeKey = `${projectId}:sb:${appliedStoryboardId}`;
        if (appliedStoryboardId && scopeKey === `${projectId}:sb:none` && !scopedMemoryStore.get(tableScopeKey)?.messages.length) {
            setScopedMemory(tableScopeKey, scopedMemoryStore.get(scopeKey) || emptyMemory());
            setScopedMemory(scopeKey, emptyMemory());
            loadedScopes.add(tableScopeKey);
            setMemoryTick((t) => t + 1);
        }
        // Runs go through the normal confirm card; images finish before videos start.
        if (autoRun && createdTasks.length) {
            void host.runStoryboardBatch?.(createdTasks, { title: "生成节点内容" });
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
                            title="清空当前画布/分镜表的对话记录（生成中会先停止）"
                            onClick={clearCurrentScope}
                        >
                            <RotateCcw className="size-3" />
                            <span>清空</span>
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
                            已自动压缩前 {compactedCount} 条对话（记录仍保留，只是不再逐字发给模型；悬停查看摘要）
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
                                <div key={m.id} className="mr-4 rounded-xl border p-2.5 leading-relaxed" style={{ borderColor: border }}>
                                    <AgentMarkdown text={m.text} />
                                </div>
                            );
                        }
                        if (m.role === "error") {
                            return (
                                <div key={m.id} className="space-y-1 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-red-400">
                                    <div className="font-semibold">{m.title || "出错了"}</div>
                                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
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
                                    <div className="min-w-0 flex-1 leading-relaxed">
                                        <AgentMarkdown text={m.plan.summary} />
                                    </div>
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
                                                                onChange={(val) => {
                                                                    setPresetImageModel(val);
                                                                    if (agentMode === "storyboard") syncStoryboardTemplates(targetSb, val, undefined);
                                                                }}
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
                                                                onChange={(val) => {
                                                                    setPresetVideoModel(val);
                                                                    if (agentMode === "storyboard") syncStoryboardTemplates(targetSb, undefined, val);
                                                                }}
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
                                        const planSb = resolvePlanStoryboard(m.storyboardNodeId, allNodes, selectedIds).node;
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
                            <span>{compacting ? "正在压缩早期对话…" : "正在思考…"}</span>
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
                                // Enter while a Chinese IME is composing picks the candidate; it must not send.
                                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
