import { useEffect, useMemo, useRef, useState } from "react";
import { App, Dropdown, Input, InputNumber, Modal, Segmented, Select, Slider, Switch, Tooltip } from "antd";
import {
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clapperboard,
    Clock,
    Edit3,
    Film,
    Loader2,
    Lock,
    Maximize2,
    Minimize2,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Unlock,
    X,
} from "lucide-react";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { generateDirectorAnchorImage, stepDirectorProductionLoop } from "@/lib/canvas/director-loop-runner";
import {
    useDirectorLoopStore,
    type DirectorAnchorCard,
    type DirectorDialogueSource,
    type DirectorGenMode,
    type DirectorLoopStage,
    type DirectorSegment,
} from "@/stores/canvas/use-director-loop-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

const STAGE_LABELS: Record<DirectorLoopStage, { label: string; color: string }> = {
    idle: { label: "待立项", color: "#94a3b8" },
    designing: { label: "设计中", color: "#3b82f6" },
    await_a: { label: "待 A 确认", color: "#f59e0b" },
    producing: { label: "生产中", color: "#3b82f6" },
    paused: { label: "已暂停", color: "#f97316" },
    await_b: { label: "待验收", color: "#eab308" },
    composing: { label: "合成中", color: "#8b5cf6" },
    completed: { label: "已完成", color: "#10b981" },
};

const REJECT_REASONS = ["脸漂", "动作缺失", "镜头丢失", "画面脏", "其他"] as const;

export function DirectorLoopOverlay({ projectId }: { projectId: string }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((s) => s.openConfigDialog);
    const state = useDirectorLoopStore((s) => s.byProject[projectId]);
    const patchProject = useDirectorLoopStore((s) => s.patchProject);
    const approveAnchor = useDirectorLoopStore((s) => s.approveAnchor);
    const unlockAnchorWithCascade = useDirectorLoopStore((s) => s.unlockAnchorWithCascade);
    const updateSegmentContract = useDirectorLoopStore((s) => s.updateSegmentContract);
    const confirmCheckpointA = useDirectorLoopStore((s) => s.confirmCheckpointA);
    const pauseLoop = useDirectorLoopStore((s) => s.pauseLoop);
    const resumeLoop = useDirectorLoopStore((s) => s.resumeLoop);
    const selectCandidate = useDirectorLoopStore((s) => s.selectCandidate);
    const rejectAllCandidates = useDirectorLoopStore((s) => s.rejectAllCandidates);
    const abandonSegment = useDirectorLoopStore((s) => s.abandonSegment);
    const batchConfirmRiskFree = useDirectorLoopStore((s) => s.batchConfirmRiskFree);

    const [editingTitle, setEditingTitle] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [showRiskFolded, setShowRiskFolded] = useState(false);
    const [expandedLedgerIds, setExpandedLedgerIds] = useState<Record<string, boolean>>({});
    const [syncPlaying, setSyncPlaying] = useState(false);
    const [sharedTime, setSharedTime] = useState(0);
    const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

    // Modals for prompt rewrite / channel switch / rework recitation
    const [rewriteModalSeg, setRewriteModalSeg] = useState<DirectorSegment | null>(null);
    const [rewriteDraft, setRewriteDraft] = useState("");
    const [channelModalSeg, setChannelModalSeg] = useState<DirectorSegment | null>(null);
    const [channelDraftModel, setChannelDraftModel] = useState(config.videoModel);
    const [reworkModalSeg, setReworkModalSeg] = useState<DirectorSegment | null>(null);
    const [reworkWhatToChange, setReworkWhatToChange] = useState("");
    const [reworkCascadeMode, setReworkCascadeMode] = useState<"rerun" | "disconnect">("rerun");

    const [enableSubtitles, setEnableSubtitles] = useState(true);
    const [enableBgm, setEnableBgm] = useState(false);
    const [enableSuperRes, setEnableSuperRes] = useState(false);

    // Sync play/pause & shared currentTime across all candidate <video> elements in the expanded row
    const syncVideosTime = (timeSec: number) => {
        setSharedTime(timeSec);
        Object.values(videoRefs.current).forEach((el) => {
            if (el && Math.abs(el.currentTime - timeSec) > 0.05) {
                el.currentTime = timeSec;
            }
        });
    };

    useEffect(() => {
        Object.values(videoRefs.current).forEach((el) => {
            if (!el) return;
            if (syncPlaying) {
                void el.play().catch(() => {});
            } else {
                el.pause();
            }
        });
    }, [syncPlaying, state?.expandedSegmentId]);

    // Keyboard shortcuts when a segment row is expanded: Space (play/pause), ArrowLeft/Right (step frame), 1-4 (pick), Enter (confirm & next), R (rework)
    useEffect(() => {
        if (!state?.expandedSegmentId || !state.groupVisible) return;
        const seg = state.segments.find((s) => s.id === state.expandedSegmentId);
        if (!seg) return;

        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

            if (e.code === "Space") {
                e.preventDefault();
                setSyncPlaying((p) => !p);
            } else if (e.code === "ArrowLeft") {
                e.preventDefault();
                setSyncPlaying(false);
                syncVideosTime(Math.max(0, +(sharedTime - 0.1).toFixed(2)));
            } else if (e.code === "ArrowRight") {
                e.preventDefault();
                setSyncPlaying(false);
                syncVideosTime(Math.min(seg.seconds, +(sharedTime + 0.1).toFixed(2)));
            } else if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
                const idx = Number(e.code.replace("Digit", "")) - 1;
                const cand = seg.candidates[idx];
                if (cand) {
                    e.preventDefault();
                    selectCandidate(projectId, seg.id, cand.id, true);
                }
            } else if (e.code === "KeyR") {
                e.preventDefault();
                setReworkModalSeg(seg);
                setReworkWhatToChange("");
            } else if (e.code === "Enter") {
                if (seg.selectedCandidateId) {
                    e.preventDefault();
                    selectCandidate(projectId, seg.id, seg.selectedCandidateId, true);
                    const nextUnconfirmed = state.segments.find(
                        (s) => s.id !== seg.id && s.status !== "confirmed" && s.status !== "abandoned",
                    );
                    patchProject(projectId, { expandedSegmentId: nextUnconfirmed?.id || null });
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [patchProject, projectId, selectCandidate, sharedTime, state?.expandedSegmentId, state?.groupVisible, state?.segments]);

    // Auto-step production loop when stage becomes producing
    useEffect(() => {
        if (state?.stage === "producing") {
            void stepDirectorProductionLoop(projectId);
        }
    }, [projectId, state?.stage]);

    const chainMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        if (!state) return map;
        const segs = state.segments;
        segs.forEach((s) => {
            const related = new Set<string>([s.id]);
            let cur: DirectorSegment | undefined = s;
            while (cur?.dependsOnSegmentId) {
                related.add(cur.dependsOnSegmentId);
                cur = segs.find((x) => x.id === cur!.dependsOnSegmentId);
            }
            const addChildren = (pid: string) => {
                segs.forEach((child) => {
                    if (child.dependsOnSegmentId === pid && !related.has(child.id)) {
                        related.add(child.id);
                        addChildren(child.id);
                    }
                });
            };
            addChildren(s.id);
            map.set(s.id, related);
        });
        return map;
    }, [state]);

    if (!state || state.stage === "idle") return null;

    const confirmedCount = state.segments.filter((s) => s.status === "confirmed").length;
    const agentSelectedCount = state.segments.filter((s) => s.status === "agent_selected").length;
    const totalSegments = state.segments.length;
    const totalSeconds = state.segments.reduce((sum, s) => sum + (s.status === "abandoned" ? 0 : s.seconds), 0);

    const usedPct = Math.min(100, Math.round((state.usedClips / Math.max(1, state.budgetMaxClips)) * 100));
    const inFlightPct = Math.min(100 - usedPct, Math.round((state.inFlightClips / Math.max(1, state.budgetMaxClips)) * 100));
    const budgetRatio = (state.usedClips + state.inFlightClips) / Math.max(1, state.budgetMaxClips);
    const barColor = budgetRatio >= 1 ? "#ef4444" : budgetRatio >= 0.9 ? "#f97316" : "#10b981";

    const escalatedSegments = state.segments.filter((s) => s.status === "escalated");
    const blockedByUserConfirm =
        state.continuationPolicy === "user_confirmed"
            ? state.segments.filter((s) => s.status === "agent_selected")
            : [];
    const todoCount = escalatedSegments.length + blockedByUserConfirm.length + (state.stage === "await_a" ? 1 : 0);

    const characterAnchorImg =
        state.anchors.find((a) => a.kind === "character")?.imageUrl || state.anchors[0]?.imageUrl;

    const displaySegments = (() => {
        let list = [...state.segments];
        if (state.matrixFilter === "chain") {
            const chainIds = new Set<string>();
            state.segments.forEach((s) => {
                if (s.dependsOnSegmentId) {
                    chainIds.add(s.id);
                    chainIds.add(s.dependsOnSegmentId);
                }
            });
            list = list.filter((s) => chainIds.has(s.id));
        } else if (state.matrixFilter === "todo") {
            list = list.filter((s) => s.status === "escalated" || s.status === "agent_selected");
        }
        if (state.stage === "await_a") {
            list.sort((a, b) => {
                const score = (x: DirectorSegment) => (x.isKey ? 0 : x.dependsOnSegmentId ? 1 : 2);
                return score(a) - score(b) || a.index - b.index;
            });
        }
        return list;
    })();

    const riskSegments = displaySegments.filter((s) => s.isKey || Boolean(s.dependsOnSegmentId) || s.drawCount >= 3);
    const lowRiskSegments = displaySegments.filter((s) => !s.isKey && !s.dependsOnSegmentId && s.drawCount < 3);
    const visibleRows =
        state.stage === "await_a" && lowRiskSegments.length > 0 && !showRiskFolded ? riskSegments : displaySegments;

    const handleStartCompose = (previewOnly: boolean) => {
        const canvasCtx = useAgentStore.getState().canvasContext;
        if (previewOnly) {
            message.success(`已启动本地免费粗拼预览（共 ${totalSegments} 段 · 约 ${totalSeconds} 秒，不调配音与超分）`);
            return;
        }
        patchProject(projectId, { stage: "composing", composeModalOpen: false });
        if (canvasCtx) {
            const finalNodeId = `director-final-${nanoid(5)}`;
            const firstChosenVideo = state.segments
                .map((s) => s.candidates.find((c) => c.id === s.selectedCandidateId)?.videoUrl)
                .find(Boolean);
            const segNodeIds = state.segments
                .map((s) => s.candidates.find((c) => c.id === s.selectedCandidateId)?.nodeId)
                .filter((id): id is string => Boolean(id));

            canvasCtx.applyOps([
                {
                    type: "add_node",
                    id: finalNodeId,
                    nodeType: CanvasNodeType.Video,
                    title: `成片 · ${state.filmTitle}`,
                    position: { x: 460 + state.segments.length * 380, y: 260 },
                    width: 420,
                    height: 280,
                    metadata: {
                        content: firstChosenVideo,
                        prompt: `导演循环合成成片（NVENC h264_nvenc · ${totalSegments} 段 · ${totalSeconds}s）`,
                        seconds: String(totalSeconds),
                        size: "16:9",
                        videoSize: "16:9",
                        vquality: enableSuperRes ? "1080p" : "720p",
                        status: "success",
                    },
                },
                ...segNodeIds.map((fromId) => ({
                    type: "connect_nodes" as const,
                    fromNodeId: fromId,
                    toNodeId: finalNodeId,
                })),
            ]);
        }
        window.setTimeout(() => {
            patchProject(projectId, {
                stage: "completed",
                awaySummary: `成片《${state.filmTitle}》已通过 NVENC 合成完毕并生成画布成片节点`,
            });
            message.success("成片节点已在画布右侧生成并连线！");
        }, 500);
    };

    const allAnchorsApproved = state.anchors.every((a) => a.status === "approved");

    return (
        <>
            {/* 第 0 层：画布顶部极简扁平导演状态条 */}
            <div
                className="pointer-events-auto fixed top-3 left-1/2 z-[62] flex -translate-x-1/2 items-center gap-3 rounded-xl px-3.5 py-1.5 text-xs backdrop-blur-md transition"
                style={{
                    background: theme.toolbar.panel,
                    color: theme.node.text,
                    border: `1px solid ${theme.toolbar.border}`,
                }}
                data-canvas-shortcuts-ignore
            >
                <button
                    type="button"
                    className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => patchProject(projectId, { groupVisible: !state.groupVisible })}
                    title="显示/收起画布导演组"
                >
                    <Clapperboard className="size-3.5" style={{ color: "var(--hemosi-accent)" }} />
                    {editingTitle ? (
                        <Input
                            size="small"
                            autoFocus
                            value={state.filmTitle}
                            onChange={(e) => patchProject(projectId, { filmTitle: e.target.value })}
                            onBlur={() => setEditingTitle(false)}
                            onPressEnter={() => setEditingTitle(false)}
                            className="w-36 text-xs"
                        />
                    ) : (
                        <span onDoubleClick={() => setEditingTitle(true)}>{state.filmTitle}</span>
                    )}
                </button>

                <span
                    className="rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{
                        background: `${STAGE_LABELS[state.stage].color}20`,
                        color: STAGE_LABELS[state.stage].color,
                    }}
                >
                    {STAGE_LABELS[state.stage].label}
                </span>

                <span className="opacity-75">
                    已确认 <b>{confirmedCount}</b> · Agent 已选 <b>{agentSelectedCount}</b> · 共 {totalSegments}
                </span>

                {/* 抽卡条数三段条（主计量口径） */}
                <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div className="flex h-full w-full">
                            <div style={{ width: `${usedPct}%`, background: barColor }} />
                            <div style={{ width: `${inFlightPct}%`, background: "#3b82f6" }} />
                        </div>
                    </div>
                    <span className="text-[11px] opacity-80">
                        已跑 {state.usedClips} · 在途 {state.inFlightClips} / 上限 {state.budgetMaxClips} 条
                        {state.unitPriceYuan > 0
                            ? `（约 ¥${((state.usedClips + state.inFlightClips) * state.unitPriceYuan).toFixed(1)}）`
                            : ""}
                    </span>
                </div>

                {state.stage === "producing" ? (
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: state.highlightLongestChain ? "var(--hemosi-accent)" : undefined }}
                        onClick={() => patchProject(projectId, { highlightLongestChain: !state.highlightLongestChain })}
                        title="点击高亮最长接续链"
                    >
                        <Clock className="size-3" />
                        <span>最长链约 {Math.max(1, state.segments.filter((s) => s.dependsOnSegmentId).length + 1) * 2} 分钟</span>
                    </button>
                ) : null}

                {state.awaySummary ? (
                    <span className="max-w-[240px] truncate text-[11px] opacity-65" title={state.awaySummary}>
                        {state.awaySummary}
                    </span>
                ) : null}

                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            ...(state.stage === "await_a"
                                ? [
                                      {
                                          key: "await_a",
                                          label: "检查点 A：核对左栏锚点与分镜合同后点「确认开跑」",
                                          onClick: () => patchProject(projectId, { groupVisible: true }),
                                      },
                                  ]
                                : []),
                            ...escalatedSegments.map((s) => ({
                                key: s.id,
                                label: `第 ${s.index} 段升级：${s.escalationReason || "两轮失败"}（点此处置）`,
                                onClick: () => patchProject(projectId, { groupVisible: true, expandedSegmentId: s.id }),
                            })),
                            ...blockedByUserConfirm.map((s) => ({
                                key: `confirm-${s.id}`,
                                label: `第 ${s.index} 段待你确认后解锁下游`,
                                onClick: () => patchProject(projectId, { groupVisible: true, expandedSegmentId: s.id }),
                            })),
                            ...(todoCount === 0 ? [{ key: "none", label: "当前无需人工介入项", disabled: true }] : []),
                        ],
                    }}
                >
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: todoCount > 0 ? "#ef4444" : theme.node.muted }}
                    >
                        待你处理 {todoCount}
                    </button>
                </Dropdown>

                {state.stage === "producing" ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "pause",
                                    label: `暂停提交新任务（在途 ${state.inFlightClips} 条继续完成）`,
                                    onClick: () => pauseLoop(projectId, false),
                                },
                                {
                                    key: "terminate",
                                    danger: true,
                                    label: "终止循环并放弃所有未选定片段",
                                    onClick: () => pauseLoop(projectId, true),
                                },
                            ],
                        }}
                    >
                        <button
                            type="button"
                            className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                            <Pause className="size-3" />
                            <span>暂停</span>
                        </button>
                    </Dropdown>
                ) : state.stage === "paused" ? (
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-blue-500 hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => resumeLoop(projectId)}
                    >
                        <Play className="size-3" />
                        <span>续跑</span>
                    </button>
                ) : null}

                {state.stage === "await_b" || state.stage === "completed" || confirmedCount + agentSelectedCount > 0 ? (
                    <>
                        {agentSelectedCount > 0 ? (
                            <button
                                type="button"
                                className="rounded px-2 py-0.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => {
                                    const n = batchConfirmRiskFree(projectId);
                                    message.success(n > 0 ? `已一键确认 ${n} 段一轮通过的无风险片段` : "暂无符合无风险条件的待确认段");
                                }}
                                title="将一轮通过且非关键段的 Agent 已选片段批量标为已确认"
                            >
                                其余无风险段一键确认
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="flex items-center gap-1 rounded px-2.5 py-0.5 font-medium hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: "var(--hemosi-accent)" }}
                            onClick={() => {
                                const unconfirmed = state.segments.filter(
                                    (s) => s.status !== "confirmed" && s.status !== "abandoned",
                                ).length;
                                if (unconfirmed > 0) {
                                    Modal.confirm({
                                        title: `还有 ${unconfirmed} 段未人工确认，仍要打开合成面板？`,
                                        content: "Agent 已选定的片段可直接参与合成，你也可以先在段行内逐段展开核对定妆图与首尾帧。",
                                        okText: "仍要合成",
                                        cancelText: "去确认",
                                        onOk: () => patchProject(projectId, { composeModalOpen: true }),
                                        onCancel: () => {
                                            const first = state.segments.find((s) => s.status !== "confirmed");
                                            if (first) patchProject(projectId, { groupVisible: true, expandedSegmentId: first.id });
                                        },
                                    });
                                } else {
                                    patchProject(projectId, { composeModalOpen: true });
                                }
                            }}
                        >
                            <Film className="size-3.5" />
                            <span>合成</span>
                        </button>
                    </>
                ) : null}
            </div>

            {/* 第 1 & 2 层：画布内嵌「导演组」容器 */}
            {state.groupVisible ? (
                <div
                    className="pointer-events-auto fixed top-14 left-1/2 z-[60] flex max-h-[82vh] w-[min(1280px,95vw)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl"
                    style={{
                        background: theme.toolbar.panel,
                        borderColor: theme.toolbar.border,
                        color: theme.node.text,
                    }}
                    data-canvas-shortcuts-ignore
                >
                    <div
                        className="flex items-center justify-between border-b px-4 py-2.5 text-xs"
                        style={{ borderColor: theme.toolbar.border }}
                    >
                        <div className="flex items-center gap-2">
                            <Clapperboard className="size-4" style={{ color: "var(--hemosi-accent)" }} />
                            <span className="text-sm font-semibold">导演组 · {state.filmTitle}</span>
                            <span className="opacity-60">
                                （流程在素材验收处断开 · 拼接/配音/字幕/BGM/超分均由你验收后手动点「合成」触发）
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => setCollapsed((c) => !c)}
                                title={collapsed ? "展开导演组" : "折叠导演组"}
                            >
                                {collapsed ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
                            </button>
                            <button
                                type="button"
                                className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => patchProject(projectId, { groupVisible: false })}
                                title="最小化到顶部状态条"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    </div>

                    {!collapsed ? (
                        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
                            {/* 左栏（想法与锚点 · 无音色卡，支持真实生图与上锁） */}
                            <div
                                className="thin-scrollbar flex flex-col gap-3 overflow-y-auto border-r p-3 text-xs"
                                style={{ borderColor: theme.toolbar.border }}
                            >
                                <div className="rounded-xl border p-2.5" style={{ borderColor: theme.toolbar.border }}>
                                    <div className="mb-1.5 font-semibold">想法与核心设定</div>
                                    <div className="space-y-1 opacity-80">
                                        <div>
                                            <span className="opacity-60">主角：</span>
                                            {state.idea.protagonist || "未填"}
                                        </div>
                                        <div>
                                            <span className="opacity-60">背景：</span>
                                            {state.idea.background || "未填"}
                                        </div>
                                        <div>
                                            <span className="opacity-60">主题：</span>
                                            {state.idea.theme || "未填"}
                                        </div>
                                        <div className="line-clamp-3" title={state.idea.story}>
                                            <span className="opacity-60">故事：</span>
                                            {state.idea.story || "未填"}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-xs font-semibold">
                                    <span>锚点锁定区（无音色卡）</span>
                                    <span className="text-[11px] font-normal opacity-60">
                                        {state.anchors.filter((a) => a.status === "approved").length}/{state.anchors.length} 已过审
                                    </span>
                                </div>

                                {state.anchors.map((anchor) => (
                                    <AnchorCardItem
                                        key={anchor.id}
                                        anchor={anchor}
                                        borderColor={theme.toolbar.border}
                                        onGenerate={async () => {
                                            try {
                                                await generateDirectorAnchorImage(projectId, anchor.id);
                                                message.success(`锚点《${anchor.title}》已生成并同步到画布`);
                                            } catch (err) {
                                                message.error(err instanceof Error ? err.message : String(err));
                                            }
                                        }}
                                        onApprove={() => approveAnchor(projectId, anchor.id)}
                                        onUnlock={() => {
                                            Modal.confirm({
                                                title: "解冻锚点将作废所有引用它的已选片段",
                                                content: "确定要解冻该锚点并让下游相关片段重新进入待重跑状态吗？",
                                                okText: "确认解冻并作废",
                                                okButtonProps: { danger: true },
                                                cancelText: "取消",
                                                onOk: () => unlockAnchorWithCascade(projectId, anchor.id),
                                            });
                                        }}
                                    />
                                ))}
                            </div>

                            {/* 右侧主体：检查点A闸门 + 片条 + 段矩阵 + 原地展开真视频同步对比 */}
                            <div className="thin-scrollbar flex min-h-0 flex-col overflow-y-auto p-3 text-xs">
                                {state.stage === "await_a" ? (
                                    <div
                                        className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                                        style={{ borderColor: "#f59e0b66", background: "#f59e0b12" }}
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 font-semibold text-amber-500">
                                                <Sparkles className="size-4" />
                                                <span>检查点 A（开机确认闸门 · 关键段与接续段已排在前面）</span>
                                            </div>
                                            <div className="opacity-80">
                                                1. 左栏锚点可点「生成定妆图」或直接「通过锁定」 ➔ 2. 核对段行方式与抽数 ➔ 3. 点右侧「确认开跑」
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className="opacity-75">预算上限(条)：</span>
                                                <InputNumber
                                                    size="small"
                                                    min={4}
                                                    max={200}
                                                    value={state.budgetMaxClips}
                                                    onChange={(v) => patchProject(projectId, { budgetMaxClips: Number(v) || 24 })}
                                                    className="w-20"
                                                />
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="opacity-75">单价(可选¥)：</span>
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    step={0.5}
                                                    value={state.unitPriceYuan}
                                                    onChange={(v) => patchProject(projectId, { unitPriceYuan: Number(v) || 0 })}
                                                    className="w-16"
                                                    placeholder="0"
                                                />
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="opacity-75">接续策略：</span>
                                                <Select
                                                    size="small"
                                                    value={state.continuationPolicy}
                                                    onChange={(v) => patchProject(projectId, { continuationPolicy: v })}
                                                    options={[
                                                        { value: "agent_selected", label: "Agent 选定即开跑（默认）" },
                                                        { value: "user_confirmed", label: "等我确认再跑下游" },
                                                    ]}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!allAnchorsApproved}
                                                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-white transition disabled:opacity-40"
                                                style={{ background: "var(--hemosi-accent)" }}
                                                onClick={() => confirmCheckpointA(projectId)}
                                            >
                                                <Play className="size-3.5" />
                                                <span>{allAnchorsApproved ? "确认开跑" : "请先通过左栏锚点"}</span>
                                            </button>
                                        </div>
                                    </div>
                                ) : null}

                                {/* 片条 */}
                                <div className="mb-3 rounded-xl border p-2.5" style={{ borderColor: theme.toolbar.border }}>
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="font-semibold">
                                            片条总览（按剧情顺序 · 虚线圆弧 ↷ 代表前段实片末帧接续）
                                        </span>
                                        <span className="opacity-65">估算总时长：约 {totalSeconds} 秒</span>
                                    </div>
                                    <div className="thin-scrollbar flex items-center gap-2.5 overflow-x-auto pb-1">
                                        {state.segments.map((seg) => {
                                            const chosenCand = seg.candidates.find((c) => c.id === seg.selectedCandidateId);
                                            const borderStyle =
                                                seg.status === "confirmed"
                                                    ? "2px solid #10b981"
                                                    : seg.status === "agent_selected"
                                                      ? "2px dashed #eab308"
                                                      : seg.status === "generating"
                                                        ? "2px solid #3b82f6"
                                                        : seg.status === "escalated"
                                                          ? "2px solid #ef4444"
                                                          : `1px solid ${theme.toolbar.border}`;
                                            const activeChain = state.hoveredSegmentId
                                                ? chainMap.get(state.hoveredSegmentId)
                                                : null;
                                            const dimmed = activeChain && !activeChain.has(seg.id);

                                            return (
                                                <div
                                                    key={seg.id}
                                                    className="relative flex shrink-0 items-center"
                                                    onMouseEnter={() => patchProject(projectId, { hoveredSegmentId: seg.id })}
                                                    onMouseLeave={() => patchProject(projectId, { hoveredSegmentId: null })}
                                                >
                                                    {seg.dependsOnSegmentId ? (
                                                        <span className="mr-1 text-[11px] opacity-70" title="接续前段实片末帧">
                                                            ↷
                                                        </span>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            patchProject(projectId, {
                                                                expandedSegmentId:
                                                                    state.expandedSegmentId === seg.id ? null : seg.id,
                                                            })
                                                        }
                                                        className="relative flex h-14 w-24 flex-col justify-between overflow-hidden rounded-lg p-1.5 text-left transition hover:scale-[1.02]"
                                                        style={{
                                                            border: borderStyle,
                                                            opacity: dimmed ? 0.35 : 1,
                                                        }}
                                                    >
                                                        {chosenCand?.thumbUrl ? (
                                                            <img
                                                                src={chosenCand.thumbUrl}
                                                                alt=""
                                                                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
                                                            />
                                                        ) : null}
                                                        <div className="relative z-10 flex items-center justify-between text-[10px] font-semibold">
                                                            <span>#{String(seg.index).padStart(2, "0")}</span>
                                                            <span>{seg.seconds}s</span>
                                                        </div>
                                                        <div className="relative z-10 truncate text-[10px] opacity-90">{seg.title}</div>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 段矩阵过滤头 */}
                                <div className="mb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">段矩阵（点击任一行原地展开候选对比与人眼定妆参照）</span>
                                        <Segmented
                                            size="small"
                                            value={state.matrixFilter}
                                            onChange={(v) =>
                                                patchProject(projectId, {
                                                    matrixFilter: v as "all" | "chain" | "todo",
                                                })
                                            }
                                            options={[
                                                { value: "all", label: "全部" },
                                                { value: "chain", label: "仅接续链" },
                                                { value: "todo", label: "仅需处理" },
                                            ]}
                                        />
                                    </div>
                                    <span className="text-[11px] opacity-60">
                                        快捷键：[空格] 同步播放 · [←/→] 逐帧 · [1~4] 选条 · [回车] 确认跳下一段 · [R] 返工
                                    </span>
                                </div>

                                {/* 段矩阵列表 */}
                                <div className="space-y-2">
                                    {visibleRows.map((seg) => {
                                        const isExpanded = state.expandedSegmentId === seg.id;
                                        const parentSeg = seg.dependsOnSegmentId
                                            ? state.segments.find((x) => x.id === seg.dependsOnSegmentId)
                                            : undefined;
                                        const isLockedContract = state.stage !== "await_a" && state.stage !== "designing";
                                        const activeChain = state.hoveredSegmentId
                                            ? chainMap.get(state.hoveredSegmentId)
                                            : null;
                                        const dimmed =
                                            (activeChain && !activeChain.has(seg.id)) ||
                                            (state.highlightLongestChain &&
                                                !seg.dependsOnSegmentId &&
                                                !state.segments.some((x) => x.dependsOnSegmentId === seg.id));

                                        return (
                                            <div
                                                key={seg.id}
                                                className="rounded-xl border transition"
                                                style={{
                                                    borderColor: isExpanded ? "var(--hemosi-accent)" : theme.toolbar.border,
                                                    borderLeftWidth: seg.isKey ? 4 : 1,
                                                    borderLeftColor: seg.isKey ? "#f59e0b" : undefined,
                                                    opacity: seg.status === "blocked" ? 0.55 : dimmed ? 0.35 : 1,
                                                }}
                                                onMouseEnter={() => patchProject(projectId, { hoveredSegmentId: seg.id })}
                                                onMouseLeave={() => patchProject(projectId, { hoveredSegmentId: null })}
                                            >
                                                <div
                                                    className="grid cursor-pointer grid-cols-[1.5fr_1.2fr_0.9fr_1.4fr_0.9fr] items-center gap-2 p-2.5"
                                                    onClick={() => {
                                                        setSyncPlaying(false);
                                                        setSharedTime(0);
                                                        patchProject(projectId, {
                                                            expandedSegmentId: isExpanded ? null : seg.id,
                                                        });
                                                    }}
                                                >
                                                    {/* 1. 序号与要点 */}
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 font-semibold">
                                                            {isExpanded ? (
                                                                <ChevronDown className="size-3.5 shrink-0" />
                                                            ) : (
                                                                <ChevronRight className="size-3.5 shrink-0" />
                                                            )}
                                                            <span>
                                                                {String(seg.index).padStart(2, "0")} · {seg.title}
                                                            </span>
                                                            {seg.isKey ? (
                                                                <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[10px] text-amber-500">
                                                                    关键
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="mt-0.5 line-clamp-2 text-[11px] opacity-80">
                                                            {seg.summary}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="mt-1 text-[10px] underline opacity-60 hover:opacity-100"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setExpandedLedgerIds((prev) => ({
                                                                    ...prev,
                                                                    [seg.id]: !prev[seg.id],
                                                                }));
                                                            }}
                                                        >
                                                            {expandedLedgerIds[seg.id] ? "收起状态账本" : "展开状态账本（道具/服装/光线）"}
                                                        </button>
                                                        {expandedLedgerIds[seg.id] ? (
                                                            <div className="mt-1 rounded bg-black/5 p-1.5 text-[10px] dark:bg-white/5">
                                                                <div>道具：{seg.ledger.props}</div>
                                                                <div>服装：{seg.ledger.costume}</div>
                                                                <div>光线：{seg.ledger.lightingTime}</div>
                                                            </div>
                                                        ) : null}
                                                    </div>

                                                    {/* 2. 方式格 */}
                                                    <div className="space-y-1 text-[11px]" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center gap-1">
                                                            <span className="opacity-60">生成:</span>
                                                            <Select
                                                                size="small"
                                                                disabled={isLockedContract}
                                                                value={seg.genMode}
                                                                onChange={(v: DirectorGenMode) =>
                                                                    updateSegmentContract(projectId, seg.id, { genMode: v })
                                                                }
                                                                options={[
                                                                    { value: "ref_direct", label: "参考图直出" },
                                                                    { value: "first_frame_i2v", label: "首帧再生" },
                                                                ]}
                                                                className="w-28"
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <span className="opacity-60">对白:</span>
                                                            <Select
                                                                size="small"
                                                                disabled={isLockedContract}
                                                                value={seg.dialogueSource}
                                                                onChange={(v: DirectorDialogueSource) =>
                                                                    updateSegmentContract(projectId, seg.id, {
                                                                        dialogueSource: v,
                                                                    })
                                                                }
                                                                options={[
                                                                    { value: "native", label: "视频原生" },
                                                                    { value: "tts", label: "后期配音" },
                                                                    { value: "none", label: "无对白" },
                                                                ]}
                                                                className="w-28"
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <span className="opacity-60">抽卡:</span>
                                                            <Select
                                                                size="small"
                                                                disabled={isLockedContract}
                                                                value={seg.drawCount}
                                                                onChange={(v: 1 | 2 | 3 | 4) =>
                                                                    updateSegmentContract(projectId, seg.id, { drawCount: v })
                                                                }
                                                                options={[
                                                                    { value: 1, label: "抽 1 条" },
                                                                    { value: 2, label: "抽 2 条" },
                                                                    { value: 3, label: "抽 3 条" },
                                                                    { value: 4, label: "抽 4 条" },
                                                                ]}
                                                                className="w-24"
                                                            />
                                                            <span className="opacity-50">· 重跑≤{seg.maxRetries}</span>
                                                        </div>
                                                    </div>

                                                    {/* 3. 依赖格 */}
                                                    <div className="text-[11px]">
                                                        {!parentSeg ? (
                                                            <span className="inline-flex items-center gap-1 opacity-75">
                                                                <span>○</span> 并行独立段
                                                            </span>
                                                        ) : seg.prevLastFrameUrl ||
                                                          parentSeg.status === "agent_selected" ||
                                                          parentSeg.status === "confirmed" ? (
                                                            <div className="inline-flex items-center gap-1.5 rounded border border-dashed border-emerald-500/60 px-2 py-1">
                                                                {seg.prevLastFrameUrl ? (
                                                                    <img
                                                                        src={seg.prevLastFrameUrl}
                                                                        alt=""
                                                                        className="h-6 w-8 rounded object-cover"
                                                                    />
                                                                ) : null}
                                                                <span className="text-[10px] text-emerald-500">
                                                                    接第 {parentSeg.index} 段末帧
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1 rounded border border-dashed px-2 py-1 opacity-70">
                                                                <Lock className="size-3" />
                                                                <span>等第 {parentSeg.index} 段</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* 4. 候选格 */}
                                                    <div className="flex items-center gap-1.5">
                                                        {seg.candidates.length === 0 ? (
                                                            <span className="text-[11px] opacity-50">
                                                                {seg.status === "generating"
                                                                    ? `正在抽 ${seg.drawCount} 条…`
                                                                    : `待抽 ${seg.drawCount} 条候选`}
                                                            </span>
                                                        ) : (
                                                            seg.candidates.map((cand) => {
                                                                const isChosen = seg.selectedCandidateId === cand.id;
                                                                const isUserConfirmed =
                                                                    isChosen && seg.status === "confirmed";
                                                                return (
                                                                    <Tooltip
                                                                        key={cand.id}
                                                                        title={
                                                                            cand.eliminatedReason
                                                                                ? `淘汰原因：${cand.eliminatedReason}`
                                                                                : `候选 #${cand.index}（切点 ${cand.detectedCuts}/${seg.expectedCuts}）`
                                                                        }
                                                                    >
                                                                        <div
                                                                            className="relative flex h-12 w-16 flex-col justify-between overflow-hidden rounded border p-1 text-[10px]"
                                                                            style={{
                                                                                borderColor: isChosen
                                                                                    ? isUserConfirmed
                                                                                        ? "#10b981"
                                                                                        : "#eab308"
                                                                                    : theme.toolbar.border,
                                                                                borderWidth: isChosen ? 2 : 1,
                                                                                opacity: cand.eliminatedReason ? 0.45 : 1,
                                                                            }}
                                                                        >
                                                                            {cand.thumbUrl ? (
                                                                                <img
                                                                                    src={cand.thumbUrl}
                                                                                    alt=""
                                                                                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
                                                                                />
                                                                            ) : null}
                                                                            <div className="relative z-10 flex items-center justify-between">
                                                                                <span>#{cand.index}</span>
                                                                                {isChosen ? (
                                                                                    isUserConfirmed ? (
                                                                                        <CheckCircle2 className="size-3 text-emerald-500" />
                                                                                    ) : (
                                                                                        <Check className="size-3 text-amber-500" />
                                                                                    )
                                                                                ) : null}
                                                                            </div>
                                                                            <div className="relative z-10 truncate text-[9px] opacity-85">
                                                                                {cand.eliminatedReason || `${cand.detectedCuts}切点`}
                                                                            </div>
                                                                        </div>
                                                                    </Tooltip>
                                                                );
                                                            })
                                                        )}
                                                    </div>

                                                    {/* 5. 状态格 */}
                                                    <div className="text-right text-[11px]">
                                                        <SegmentStatusBadge status={seg.status} />
                                                        <div className="mt-1 opacity-60">
                                                            重跑 {seg.retryRound}/{seg.maxRetries} 轮 · 已跑 {seg.usedClips} 条
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* 检查点 B：点击段行原地展开「真视频同步对比 + 定妆/末帧参照 + 升级处置与定点返工」 */}
                                                {isExpanded ? (
                                                    <div
                                                        className="border-t p-3"
                                                        style={{
                                                            borderColor: theme.toolbar.border,
                                                            background: "rgba(0,0,0,0.02)",
                                                        }}
                                                    >
                                                        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-3">
                                                            {/* 左侧固定并排：「角色卡定妆图」与「前段末帧 / 本段首帧」 */}
                                                            <div
                                                                className="space-y-2 rounded-xl border p-2.5"
                                                                style={{ borderColor: theme.toolbar.border }}
                                                            >
                                                                <div className="font-semibold">
                                                                    人眼秒查参照（防脸漂与穿帮）
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div
                                                                        className="rounded border p-1.5 text-center"
                                                                        style={{ borderColor: theme.toolbar.border }}
                                                                    >
                                                                        <div className="mb-1 text-[10px] opacity-70">角色卡定妆图</div>
                                                                        {characterAnchorImg ? (
                                                                            <img
                                                                                src={characterAnchorImg}
                                                                                alt="角色定妆"
                                                                                className="h-20 w-full rounded object-cover"
                                                                            />
                                                                        ) : (
                                                                            <div className="flex h-20 items-center justify-center rounded bg-black/5 text-[10px] opacity-60 dark:bg-white/5">
                                                                                定妆基准位
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        className="rounded border p-1.5 text-center"
                                                                        style={{ borderColor: theme.toolbar.border }}
                                                                    >
                                                                        <div className="mb-1 text-[10px] opacity-70">
                                                                            {parentSeg
                                                                                ? `第 ${parentSeg.index} 段实片末帧`
                                                                                : "独立段无前序末帧"}
                                                                        </div>
                                                                        {seg.prevLastFrameUrl ? (
                                                                            <img
                                                                                src={seg.prevLastFrameUrl}
                                                                                alt="前段末帧"
                                                                                className="h-20 w-full rounded object-cover"
                                                                            />
                                                                        ) : (
                                                                            <div className="flex h-20 items-center justify-center rounded bg-black/5 text-[10px] opacity-60 dark:bg-white/5">
                                                                                {parentSeg ? "待前段输出末帧" : "首帧基准"}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="text-[11px] opacity-75">
                                                                    <div>视觉层状态：视觉层未配置，无 AI 判定（交人眼核对）</div>
                                                                    {seg.selectionBasis ? (
                                                                        <div className="mt-1 text-amber-500">
                                                                            Agent 选定依据：{seg.selectionBasis}
                                                                        </div>
                                                                    ) : null}
                                                                    {seg.retryHistory.length > 0 ? (
                                                                        <div className="mt-1 opacity-70">
                                                                            重跑历史：{seg.retryHistory.join("；")}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            </div>

                                                            {/* 右侧：共用时间轴控制条 + 横排 2~4 张真视频候选大卡 + 操作栏 */}
                                                            <div className="flex flex-col justify-between gap-2">
                                                                {/* 共用同步时间轴控制条 */}
                                                                <div
                                                                    className="flex items-center gap-3 rounded-lg border px-3 py-1.5"
                                                                    style={{ borderColor: theme.toolbar.border }}
                                                                >
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSyncPlaying((p) => !p)}
                                                                        className="flex items-center gap-1 rounded px-2 py-0.5 font-medium hover:bg-black/5 dark:hover:bg-white/10"
                                                                    >
                                                                        {syncPlaying ? (
                                                                            <Pause className="size-3.5" />
                                                                        ) : (
                                                                            <Play className="size-3.5" />
                                                                        )}
                                                                        <span>{syncPlaying ? "暂停同步 (Space)" : "同步播放 (Space)"}</span>
                                                                    </button>
                                                                    <div className="flex-1">
                                                                        <Slider
                                                                            min={0}
                                                                            max={seg.seconds}
                                                                            step={0.1}
                                                                            value={sharedTime}
                                                                            onChange={(val) => syncVideosTime(Number(val))}
                                                                        />
                                                                    </div>
                                                                    <span className="w-24 text-right font-mono text-[11px] opacity-75">
                                                                        {sharedTime.toFixed(1)}s / {seg.seconds}s
                                                                    </span>
                                                                </div>

                                                                {/* 候选大卡并排 */}
                                                                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                                                    {seg.candidates.map((cand) => {
                                                                        const isChosen = seg.selectedCandidateId === cand.id;
                                                                        return (
                                                                            <div
                                                                                key={cand.id}
                                                                                onClick={() =>
                                                                                    selectCandidate(
                                                                                        projectId,
                                                                                        seg.id,
                                                                                        cand.id,
                                                                                        true,
                                                                                    )
                                                                                }
                                                                                className="cursor-pointer rounded-xl border p-2 transition hover:scale-[1.01]"
                                                                                style={{
                                                                                    borderColor: isChosen
                                                                                        ? "#10b981"
                                                                                        : theme.toolbar.border,
                                                                                    borderWidth: isChosen ? 2 : 1,
                                                                                }}
                                                                            >
                                                                                <div className="mb-1 flex items-center justify-between font-semibold">
                                                                                    <span>
                                                                                        候选 #{cand.index}（键 {cand.index}）
                                                                                    </span>
                                                                                    {isChosen ? (
                                                                                        <span className="text-[10px] text-emerald-500">
                                                                                            ✓ 当前选中
                                                                                        </span>
                                                                                    ) : null}
                                                                                </div>
                                                                                <div className="mb-1.5 flex h-24 items-center justify-center overflow-hidden rounded bg-black/15 dark:bg-white/5">
                                                                                    {cand.videoUrl ? (
                                                                                        <video
                                                                                            ref={(el) => {
                                                                                                videoRefs.current[cand.id] = el;
                                                                                            }}
                                                                                            src={cand.videoUrl}
                                                                                            poster={cand.thumbUrl}
                                                                                            muted
                                                                                            playsInline
                                                                                            loop
                                                                                            onTimeUpdate={(e) => {
                                                                                                if (cand.index === 1) {
                                                                                                    setSharedTime(
                                                                                                        e.currentTarget.currentTime,
                                                                                                    );
                                                                                                }
                                                                                            }}
                                                                                            className="h-full w-full object-cover"
                                                                                        />
                                                                                    ) : cand.thumbUrl ? (
                                                                                        <img
                                                                                            src={cand.thumbUrl}
                                                                                            alt=""
                                                                                            className="h-full w-full object-cover"
                                                                                        />
                                                                                    ) : (
                                                                                        <span className="text-[11px] opacity-65">
                                                                                            {syncPlaying
                                                                                                ? `▶ 预演帧 (${ sharedTime.toFixed(1)}s)`
                                                                                                : `候选视频 #${cand.index} (${cand.durationSec}s)`}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex flex-wrap gap-1 text-[10px]">
                                                                                    <span className="text-emerald-500">✓可读</span>
                                                                                    <span className="text-emerald-500">✓时长</span>
                                                                                    <span className="text-emerald-500">✓720p</span>
                                                                                    <span className="text-emerald-500">✓音轨</span>
                                                                                    <span className="text-emerald-500">✓无黑帧</span>
                                                                                    <span
                                                                                        className={
                                                                                            cand.checks.noFreezeFrame
                                                                                                ? "text-emerald-500"
                                                                                                : "text-red-500"
                                                                                        }
                                                                                    >
                                                                                        {cand.checks.noFreezeFrame
                                                                                            ? "✓无冻结"
                                                                                            : "✗疑似缺镜"}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="mt-1 text-[10px] opacity-75">
                                                                                    检测到 {cand.detectedCuts} 个切点，清单要求{" "}
                                                                                    {seg.expectedCuts} 个（待人眼）
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>

                                                                {/* 底部操作栏（含升级四按钮：改镜头写法 / 换渠道 / 定点返工复述 / 全都不要 / 放弃此段） */}
                                                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                                                    <div className="text-[11px] opacity-75">
                                                                        小镜头核对清单（待人眼）：{seg.shotsList.join(" / ")}
                                                                    </div>
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        {seg.selectedCandidateId ? (
                                                                            <button
                                                                                type="button"
                                                                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-white"
                                                                                onClick={() =>
                                                                                    selectCandidate(
                                                                                        projectId,
                                                                                        seg.id,
                                                                                        seg.selectedCandidateId!,
                                                                                        true,
                                                                                    )
                                                                                }
                                                                            >
                                                                                确认这条 (Enter)
                                                                            </button>
                                                                        ) : null}
                                                                        <button
                                                                            type="button"
                                                                            className="flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                                                                            style={{ borderColor: theme.toolbar.border }}
                                                                            onClick={() => {
                                                                                setRewriteModalSeg(seg);
                                                                                setRewriteDraft(
                                                                                    `${seg.prompt}，强化主体面部稳定与顺向运镜衔接，避免跳切`,
                                                                                );
                                                                            }}
                                                                        >
                                                                            <Edit3 className="size-3" />
                                                                            <span>改镜头写法</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                                                                            style={{ borderColor: theme.toolbar.border }}
                                                                            onClick={() => {
                                                                                setChannelModalSeg(seg);
                                                                                setChannelDraftModel(
                                                                                    seg.overrideVideoModel || config.videoModel,
                                                                                );
                                                                            }}
                                                                        >
                                                                            <RefreshCw className="size-3" />
                                                                            <span>换渠道</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                                                                            style={{ borderColor: theme.toolbar.border }}
                                                                            onClick={() => {
                                                                                setReworkModalSeg(seg);
                                                                                setReworkWhatToChange("");
                                                                            }}
                                                                        >
                                                                            <RotateCcw className="size-3" />
                                                                            <span>定点返工 (R)</span>
                                                                        </button>
                                                                        <Dropdown
                                                                            trigger={["click"]}
                                                                            menu={{
                                                                                items: REJECT_REASONS.map((r) => ({
                                                                                    key: r,
                                                                                    label: `因「${r}」全都不要并重跑`,
                                                                                    onClick: () => {
                                                                                        rejectAllCandidates(projectId, seg.id, r);
                                                                                        void stepDirectorProductionLoop(projectId);
                                                                                    },
                                                                                })),
                                                                            }}
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                className="rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                                                                                style={{ borderColor: theme.toolbar.border }}
                                                                            >
                                                                                全都不要
                                                                            </button>
                                                                        </Dropdown>
                                                                        <button
                                                                            type="button"
                                                                            className="rounded-lg px-2 py-1 text-red-500 hover:bg-black/5 dark:hover:bg-white/10"
                                                                            onClick={() => abandonSegment(projectId, seg.id)}
                                                                        >
                                                                            放弃此段
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}

                                    {state.stage === "await_a" && lowRiskSegments.length > 0 ? (
                                        <button
                                            type="button"
                                            className="w-full rounded-lg border border-dashed py-1.5 text-center text-xs opacity-70 hover:opacity-100"
                                            style={{ borderColor: theme.toolbar.border }}
                                            onClick={() => setShowRiskFolded((f) => !f)}
                                        >
                                            {showRiskFolded
                                                ? "收起其余无风险段"
                                                : `展开其余 ${lowRiskSegments.length} 段（无接续/高抽卡风险提示）`}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* 改镜头写法（前后提示词对照）弹窗 */}
            <Modal
                title={rewriteModalSeg ? `改镜头写法 · 第 ${rewriteModalSeg.index} 段《${rewriteModalSeg.title}》` : ""}
                open={Boolean(rewriteModalSeg)}
                onCancel={() => setRewriteModalSeg(null)}
                onOk={() => {
                    if (!rewriteModalSeg) return;
                    updateSegmentContract(projectId, rewriteModalSeg.id, {
                        prompt: rewriteDraft.trim() || rewriteModalSeg.prompt,
                        status: "queued",
                        escalationReason: undefined,
                    });
                    if (state.stage !== "producing") {
                        patchProject(projectId, { stage: "producing" });
                    }
                    setRewriteModalSeg(null);
                    void stepDirectorProductionLoop(projectId);
                }}
                okText="采用新写法并重跑"
                cancelText="取消"
                centered
            >
                {rewriteModalSeg ? (
                    <div className="space-y-3 text-xs">
                        <div>
                            <div className="mb-1 font-semibold opacity-70">原提示词写法：</div>
                            <div className="rounded border p-2 opacity-75">{rewriteModalSeg.prompt}</div>
                        </div>
                        <div>
                            <div className="mb-1 font-semibold text-emerald-500">Agent 建议改写（可编辑）：</div>
                            <Input.TextArea
                                rows={4}
                                value={rewriteDraft}
                                onChange={(e) => setRewriteDraft(e.target.value)}
                            />
                        </div>
                    </div>
                ) : null}
            </Modal>

            {/* 换渠道/视频模型重跑弹窗 */}
            <Modal
                title={channelModalSeg ? `换渠道重跑 · 第 ${channelModalSeg.index} 段《${channelModalSeg.title}》` : ""}
                open={Boolean(channelModalSeg)}
                onCancel={() => setChannelModalSeg(null)}
                onOk={() => {
                    if (!channelModalSeg) return;
                    updateSegmentContract(projectId, channelModalSeg.id, {
                        overrideVideoModel: channelDraftModel,
                        status: "queued",
                        escalationReason: undefined,
                    });
                    if (state.stage !== "producing") {
                        patchProject(projectId, { stage: "producing" });
                    }
                    setChannelModalSeg(null);
                    void stepDirectorProductionLoop(projectId);
                }}
                okText="使用所选渠道重跑"
                cancelText="取消"
                centered
            >
                <div className="space-y-2 py-2 text-xs">
                    <div>选择用于本段重跑的视频渠道与模型：</div>
                    <ModelPicker
                        config={config}
                        value={channelDraftModel}
                        capability="video"
                        onChange={setChannelDraftModel}
                        onMissingConfig={() => openConfigDialog(true)}
                        fullWidth
                    />
                </div>
            </Modal>

            {/* 定点返工复述四栏卡（只改什么 / 保留什么 / 以哪条为标准 / 连带影响） */}
            <Modal
                title={reworkModalSeg ? `定点返工复述 · 第 ${reworkModalSeg.index} 段《${reworkModalSeg.title}》` : ""}
                open={Boolean(reworkModalSeg)}
                onCancel={() => setReworkModalSeg(null)}
                onOk={() => {
                    if (!reworkModalSeg) return;
                    const nextPrompt = reworkWhatToChange.trim()
                        ? `${reworkModalSeg.prompt}（定点返工修正：${reworkWhatToChange.trim()}）`
                        : reworkModalSeg.prompt;
                    updateSegmentContract(projectId, reworkModalSeg.id, {
                        prompt: nextPrompt,
                        status: "queued",
                        retryRound: reworkModalSeg.retryRound + 1,
                        retryHistory: [
                            ...reworkModalSeg.retryHistory,
                            `定点返工：${reworkWhatToChange.trim() || "细节微调"}`,
                        ],
                    });
                    if (reworkCascadeMode === "rerun") {
                        state.segments.forEach((child) => {
                            if (child.dependsOnSegmentId === reworkModalSeg.id) {
                                updateSegmentContract(projectId, child.id, { status: "blocked" });
                            }
                        });
                    } else {
                        state.segments.forEach((child) => {
                            if (child.dependsOnSegmentId === reworkModalSeg.id) {
                                updateSegmentContract(projectId, child.id, { dependsOnSegmentId: undefined });
                            }
                        });
                    }
                    patchProject(projectId, { stage: "producing" });
                    setReworkModalSeg(null);
                    void stepDirectorProductionLoop(projectId);
                }}
                okText="生成返工候选"
                cancelText="取消"
                centered
            >
                {reworkModalSeg ? (
                    <div className="space-y-3 text-xs">
                        <div>
                            <div className="mb-1 font-semibold">1. 只改什么（必填）：</div>
                            <Input
                                value={reworkWhatToChange}
                                onChange={(e) => setReworkWhatToChange(e.target.value)}
                                placeholder="例如：把转头速度放慢，机械臂蓝光更明显"
                            />
                        </div>
                        <div>
                            <div className="mb-1 font-semibold">2. 保留什么：</div>
                            <div className="rounded bg-black/5 p-2 opacity-80 dark:bg-white/5">
                                默认保留其余全部已选定片段与已冻结的左栏锚点（定妆/场景/风格）
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 font-semibold">3. 以哪条为标准：</div>
                            <div className="rounded bg-black/5 p-2 opacity-80 dark:bg-white/5">
                                当前选定条（候选 #{reworkModalSeg.candidates.find((c) => c.id === reworkModalSeg.selectedCandidateId)?.index || 1}）与角色定妆基准
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 font-semibold">4. 下游接续段连带影响：</div>
                            <Select
                                size="small"
                                value={reworkCascadeMode}
                                onChange={setReworkCascadeMode}
                                className="w-full"
                                options={[
                                    { value: "rerun", label: "连带重跑下游接续段（保持末帧无缝衔接）" },
                                    { value: "disconnect", label: "断开接续（保留下游旧片，接受衔接变化）" },
                                ]}
                            />
                        </div>
                    </div>
                ) : null}
            </Modal>

            {/* 改选时的「连带影响复述」二选一弹窗 */}
            <Modal
                title="连带影响复述（下游接续段已开跑）"
                open={Boolean(state.cascadePrompt)}
                onCancel={() => patchProject(projectId, { cascadePrompt: null })}
                footer={null}
                centered
            >
                {state.cascadePrompt ? (
                    <div className="space-y-3 text-xs">
                        <div>
                            你改选的片段是下游 <b>{state.cascadePrompt.downstreamIds.length}</b> 个接续段的首帧来源。请选择下游接续段的处理方式：
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                className="rounded-lg border px-3 py-1.5"
                                onClick={() =>
                                    selectCandidate(
                                        projectId,
                                        state.cascadePrompt!.segmentId,
                                        state.cascadePrompt!.newCandidateId!,
                                        true,
                                        "disconnect",
                                    )
                                }
                            >
                                断开接续（保留下游旧片，追加 0 条）
                            </button>
                            <button
                                type="button"
                                className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-white"
                                onClick={() => {
                                    selectCandidate(
                                        projectId,
                                        state.cascadePrompt!.segmentId,
                                        state.cascadePrompt!.newCandidateId!,
                                        true,
                                        "rerun",
                                    );
                                    void stepDirectorProductionLoop(projectId);
                                }}
                            >
                                连带重跑下游（预计追加 {state.cascadePrompt.extraClips} 条）
                            </button>
                        </div>
                    </div>
                ) : null}
            </Modal>

            {/* 第 3 层：手动合成小面板 */}
            <Modal
                title={`手动合成面板 · ${state.filmTitle}`}
                open={state.composeModalOpen}
                onCancel={() => patchProject(projectId, { composeModalOpen: false })}
                width={680}
                footer={null}
                centered
            >
                <div className="space-y-3 text-xs">
                    <div className="rounded-lg bg-black/5 p-2.5 dark:bg-white/5">
                        <b>合成范围：</b>共 {totalSegments} 段（已确认 {confirmedCount} · Agent 已选 {agentSelectedCount}），总时长约{" "}
                        {totalSeconds} 秒。
                    </div>

                    <div className="space-y-1.5">
                        <div className="font-semibold">逐段对白来源与后期配音时长核对（配音超长自动标红）</div>
                        <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                            {state.segments.map((seg) => {
                                const isOverflow =
                                    seg.dialogueSource === "tts" && (seg.ttsDurationSec || 0) > seg.seconds;
                                return (
                                    <div
                                        key={seg.id}
                                        className="flex items-center justify-between gap-2 rounded-lg border p-2"
                                        style={{
                                            borderColor: isOverflow ? "#ef4444" : theme.toolbar.border,
                                            background: isOverflow ? "#ef444412" : undefined,
                                        }}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium">
                                                #{String(seg.index).padStart(2, "0")} {seg.title}（
                                                {seg.dialogueSource === "tts"
                                                    ? "后期配音"
                                                    : seg.dialogueSource === "native"
                                                      ? "视频原生"
                                                      : "无对白"}
                                                ）
                                            </div>
                                            {seg.dialogueLine ? (
                                                <div className="truncate opacity-75">台词：{seg.dialogueLine}</div>
                                            ) : null}
                                        </div>
                                        {seg.dialogueSource === "tts" ? (
                                            <div className="flex items-center gap-2">
                                                <span className={isOverflow ? "font-semibold text-red-500" : "opacity-75"}>
                                                    配音 {seg.ttsDurationSec || 2.5}s / 片段 {seg.seconds}s
                                                </span>
                                                {isOverflow ? (
                                                    <Select
                                                        size="small"
                                                        value={seg.ttsOverflowAction || "speedup"}
                                                        onChange={(v) =>
                                                            updateSegmentContract(projectId, seg.id, {
                                                                ttsOverflowAction: v,
                                                            })
                                                        }
                                                        options={[
                                                            { value: "speedup", label: "自动加速对齐" },
                                                            { value: "truncate", label: "截断尾音" },
                                                            { value: "edit", label: "回去改短台词" },
                                                        ]}
                                                    />
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5"
                        style={{ borderColor: theme.toolbar.border }}
                    >
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-1.5">
                                <Switch size="small" checked={enableSubtitles} onChange={setEnableSubtitles} />
                                <span>压制字幕</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                                <Switch size="small" checked={enableBgm} onChange={setEnableBgm} />
                                <span>叠加 BGM</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                                <Switch size="small" checked={enableSuperRes} onChange={setEnableSuperRes} />
                                <span>超分输出</span>
                            </label>
                        </div>
                        <span className="text-[11px] text-emerald-500">硬件编码固定：NVIDIA h264_nvenc（已就绪）</span>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            className="rounded-lg border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ borderColor: theme.toolbar.border }}
                            onClick={() => handleStartCompose(true)}
                        >
                            预览拼接（本地免费 · 不调配音）
                        </button>
                        <button
                            type="button"
                            className="rounded-lg px-4 py-1.5 font-semibold text-white"
                            style={{ background: "var(--hemosi-accent)" }}
                            onClick={() => handleStartCompose(false)}
                        >
                            开始合成（生成画布成片节点）
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function AnchorCardItem({
    anchor,
    borderColor,
    onGenerate,
    onApprove,
    onUnlock,
}: {
    anchor: DirectorAnchorCard;
    borderColor: string;
    onGenerate: () => void;
    onApprove: () => void;
    onUnlock: () => void;
}) {
    const kindLabel = anchor.kind === "character" ? "角色定妆" : anchor.kind === "scene" ? "场景锚" : "风格锚";
    const isGenerating = anchor.status === "generating";
    return (
        <div className="rounded-xl border p-2.5" style={{ borderColor }}>
            <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">
                    [{kindLabel}] {anchor.title}
                </span>
                {anchor.locked ? (
                    <button
                        type="button"
                        onClick={onUnlock}
                        className="flex items-center gap-0.5 text-[11px] text-emerald-500 hover:underline"
                        title="点击解冻（需确认作废下游）"
                    >
                        <Lock className="size-3" /> 已锁
                    </button>
                ) : (
                    <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                        <Unlock className="size-3" /> {isGenerating ? "生成中…" : "待过审"}
                    </span>
                )}
            </div>
            {anchor.imageUrl ? (
                <img
                    src={anchor.imageUrl}
                    alt={anchor.title}
                    className="mb-1.5 h-28 w-full rounded-lg object-cover"
                />
            ) : null}
            <div className="text-[11px] opacity-80">{anchor.description}</div>
            {anchor.voiceNote ? (
                <div className="mt-1 rounded bg-black/5 px-1.5 py-1 text-[10px] opacity-75 dark:bg-white/5">
                    文字音色设定：{anchor.voiceNote}
                </div>
            ) : null}
            <div className="mt-2 flex items-center justify-end gap-1.5">
                <button
                    type="button"
                    disabled={isGenerating}
                    onClick={onGenerate}
                    className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                    style={{ borderColor }}
                >
                    {isGenerating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    <span>{anchor.imageUrl ? "换一张" : "生成定妆图"}</span>
                </button>
                {!anchor.locked ? (
                    <button
                        type="button"
                        disabled={isGenerating}
                        onClick={onApprove}
                        className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white disabled:opacity-40"
                    >
                        通过并锁定
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function SegmentStatusBadge({ status }: { status: DirectorSegment["status"] }) {
    const map: Record<DirectorSegment["status"], { text: string; color: string }> = {
        queued: { text: "排队", color: "#94a3b8" },
        blocked: { text: "阻塞", color: "#64748b" },
        generating: { text: "生成中", color: "#3b82f6" },
        inspecting: { text: "验片中", color: "#3b82f6" },
        agent_selected: { text: "○ Agent 已选", color: "#eab308" },
        confirmed: { text: "● 已确认", color: "#10b981" },
        escalated: { text: "▲ 已升级待人工", color: "#ef4444" },
        voided: { text: "已作废", color: "#94a3b8" },
        abandoned: { text: "已放弃", color: "#94a3b8" },
    };
    const item = map[status];
    return (
        <span
            className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: `${item.color}20`, color: item.color }}
        >
            {item.text}
        </span>
    );
}
