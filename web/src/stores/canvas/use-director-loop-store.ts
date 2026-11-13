import { create } from "zustand";
import { nanoid } from "nanoid";

export type DirectorLoopStage =
    | "idle"
    | "designing"
    | "await_a"
    | "producing"
    | "paused"
    | "await_b"
    | "composing"
    | "completed";

export type DirectorAnchorKind = "character" | "scene" | "style";

export type DirectorAnchorCard = {
    id: string;
    kind: DirectorAnchorKind;
    title: string;
    description: string;
    /** 音色仅作文字设定，不设音色卡试听 */
    voiceNote?: string;
    imageUrl?: string;
    nodeId?: string;
    status: "pending" | "generating" | "approved";
    locked: boolean;
};

export type DirectorCandidateChecks = {
    readable: boolean;
    durationOk: boolean;
    resolutionOk: boolean;
    audioOk: boolean;
    noBlackFrame: boolean;
    noFreezeFrame: boolean;
};

export type DirectorCandidate = {
    id: string;
    index: number;
    videoUrl?: string;
    thumbUrl?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    durationSec: number;
    detectedCuts: number;
    checks: DirectorCandidateChecks;
    eliminatedReason?: string;
    nodeId?: string;
};

export type DirectorSegmentStatus =
    | "queued"
    | "blocked"
    | "generating"
    | "inspecting"
    | "agent_selected"
    | "confirmed"
    | "escalated"
    | "voided"
    | "abandoned";

export type DirectorDialogueSource = "native" | "tts" | "none";
export type DirectorGenMode = "ref_direct" | "first_frame_i2v";

export type DirectorSegment = {
    id: string;
    index: number;
    title: string;
    summary: string;
    prompt: string;
    isKey: boolean;
    /** 接续上游段 ID；为空表示独立并行段 */
    dependsOnSegmentId?: string;
    prevLastFrameUrl?: string;
    genMode: DirectorGenMode;
    dialogueSource: DirectorDialogueSource;
    dialogueLine?: string;
    ttsVoice?: string;
    ttsDurationSec?: number;
    ttsOverflowAction?: "speedup" | "truncate" | "edit";
    drawCount: 1 | 2 | 3 | 4;
    maxRetries: number;
    retryRound: number;
    retryHistory: string[];
    expectedCuts: number;
    seconds: number;
    shotsList: string[];
    ledger: {
        props: string;
        costume: string;
        lightingTime: string;
    };
    status: DirectorSegmentStatus;
    escalationReason?: string;
    selectionBasis?: string;
    selectedCandidateId?: string;
    overrideVideoModel?: string;
    candidates: DirectorCandidate[];
    usedClips: number;
};

export type DirectorCascadePrompt = {
    segmentId: string;
    newCandidateId?: string;
    reworkNote?: string;
    downstreamIds: string[];
    extraClips: number;
};

export type DirectorLogItem = {
    id: string;
    level: "todo" | "auto" | "info";
    segmentIndex?: number;
    text: string;
    time: string;
};

export type DirectorLoopProjectState = {
    filmTitle: string;
    stage: DirectorLoopStage;
    idea: {
        protagonist: string;
        background: string;
        theme: string;
        story: string;
    };
    /** 抽卡条数为主计量与熔断口径 */
    budgetMaxClips: number;
    anchorQuotaClips: number;
    usedClips: number;
    inFlightClips: number;
    /** 可选单价（>0 时才在小字显示估算金额，默认 0 不显示任何假金额） */
    unitPriceYuan: number;
    continuationPolicy: "agent_selected" | "user_confirmed";
    anchors: DirectorAnchorCard[];
    segments: DirectorSegment[];
    expandedSegmentId: string | null;
    hoveredSegmentId: string | null;
    highlightLongestChain: boolean;
    matrixFilter: "all" | "chain" | "todo";
    composeModalOpen: boolean;
    awaySummary: string | null;
    cascadePrompt: DirectorCascadePrompt | null;
    logs: DirectorLogItem[];
    groupVisible: boolean;
};

const STORAGE_KEY = "hemosi:director-loop-v1";

function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function createDefaultDirectorProject(filmTitle = "未命名导演循环项目"): DirectorLoopProjectState {
    return {
        filmTitle,
        stage: "idle",
        idea: {
            protagonist: "",
            background: "",
            theme: "",
            story: "",
        },
        budgetMaxClips: 24,
        anchorQuotaClips: 3,
        usedClips: 0,
        inFlightClips: 0,
        unitPriceYuan: 0,
        continuationPolicy: "agent_selected",
        anchors: [],
        segments: [],
        expandedSegmentId: null,
        hoveredSegmentId: null,
        highlightLongestChain: false,
        matrixFilter: "all",
        composeModalOpen: false,
        awaySummary: null,
        cascadePrompt: null,
        logs: [],
        groupVisible: false,
    };
}

function loadPersisted(): Record<string, DirectorLoopProjectState> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function savePersisted(map: Record<string, DirectorLoopProjectState>) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Ignore storage overflow
    }
}

type DirectorLoopStore = {
    byProject: Record<string, DirectorLoopProjectState>;
    getProject: (projectId: string) => DirectorLoopProjectState;
    patchProject: (projectId: string, patch: Partial<DirectorLoopProjectState> | ((prev: DirectorLoopProjectState) => Partial<DirectorLoopProjectState>)) => void;
    addLog: (projectId: string, level: DirectorLogItem["level"], text: string, segmentIndex?: number) => void;
    initFromPlan: (
        projectId: string,
        payload: {
            filmTitle: string;
            idea: DirectorLoopProjectState["idea"];
            budgetMaxClips: number;
            unitPriceYuan?: number;
            anchors: Array<Omit<DirectorAnchorCard, "id" | "status" | "locked"> & { imageUrl?: string; nodeId?: string }>;
            segments: Array<{
                title: string;
                summary: string;
                prompt: string;
                isKey?: boolean;
                dependsOnIndex?: number;
                genMode?: DirectorGenMode;
                dialogueSource?: DirectorDialogueSource;
                dialogueLine?: string;
                ttsVoice?: string;
                drawCount?: 1 | 2 | 3 | 4;
                seconds?: number;
                shotsList?: string[];
                ledger?: DirectorSegment["ledger"];
            }>;
        },
    ) => void;
    approveAnchor: (projectId: string, anchorId: string, imageUrl?: string) => void;
    unlockAnchorWithCascade: (projectId: string, anchorId: string) => void;
    updateSegmentContract: (projectId: string, segmentId: string, patch: Partial<DirectorSegment>) => void;
    confirmCheckpointA: (projectId: string) => void;
    pauseLoop: (projectId: string, terminateUnselected?: boolean) => void;
    resumeLoop: (projectId: string) => void;
    selectCandidate: (projectId: string, segmentId: string, candidateId: string, byUser: boolean, forceCascadeMode?: "rerun" | "disconnect") => void;
    rejectAllCandidates: (projectId: string, segmentId: string, reason: string) => void;
    abandonSegment: (projectId: string, segmentId: string) => void;
    batchConfirmRiskFree: (projectId: string) => number;
};

export const useDirectorLoopStore = create<DirectorLoopStore>((set, get) => ({
    byProject: loadPersisted(),

    getProject: (projectId) => {
        if (!projectId) return createDefaultDirectorProject();
        return get().byProject[projectId] || createDefaultDirectorProject();
    },

    patchProject: (projectId, patch) => {
        if (!projectId) return;
        set((state) => {
            const current = state.byProject[projectId] || createDefaultDirectorProject();
            const delta = typeof patch === "function" ? patch(current) : patch;
            const next = { ...current, ...delta };
            const nextMap = { ...state.byProject, [projectId]: next };
            savePersisted(nextMap);
            return { byProject: nextMap };
        });
    },

    addLog: (projectId, level, text, segmentIndex) => {
        if (!projectId) return;
        get().patchProject(projectId, (prev) => ({
            logs: [{ id: nanoid(6), level, segmentIndex, text, time: nowTime() }, ...prev.logs].slice(0, 120),
        }));
    },

    initFromPlan: (projectId, payload) => {
        const anchors: DirectorAnchorCard[] = payload.anchors.map((a) => ({
            id: `anchor-${nanoid(6)}`,
            kind: a.kind,
            title: a.title,
            description: a.description,
            voiceNote: a.voiceNote,
            imageUrl: a.imageUrl,
            nodeId: a.nodeId,
            status: a.imageUrl ? "approved" : "pending",
            locked: Boolean(a.imageUrl),
        }));

        const segIds = payload.segments.map(() => `seg-${nanoid(6)}`);
        const segments: DirectorSegment[] = payload.segments.map((s, idx) => {
            const depIdx = typeof s.dependsOnIndex === "number" && s.dependsOnIndex >= 0 && s.dependsOnIndex < idx ? s.dependsOnIndex : undefined;
            const dependsOnSegmentId = depIdx !== undefined ? segIds[depIdx] : undefined;
            const line = s.dialogueLine?.trim() || "";
            return {
                id: segIds[idx],
                index: idx + 1,
                title: s.title || `第 ${idx + 1} 段`,
                summary: s.summary,
                prompt: s.prompt,
                isKey: Boolean(s.isKey || idx === 0),
                dependsOnSegmentId,
                genMode: s.genMode || (dependsOnSegmentId ? "first_frame_i2v" : "ref_direct"),
                dialogueSource: s.dialogueSource || (line ? "tts" : "none"),
                dialogueLine: line || undefined,
                ttsVoice: s.ttsVoice || "默认旁白/角色音",
                ttsDurationSec: line ? Math.max(1.5, +(line.length / 4.6).toFixed(1)) : undefined,
                drawCount: s.drawCount || 2,
                maxRetries: 2,
                retryRound: 0,
                retryHistory: [],
                expectedCuts: Math.max(1, s.shotsList?.length || 2),
                seconds: s.seconds || 10,
                shotsList: s.shotsList?.length ? s.shotsList : [s.summary],
                ledger: s.ledger || { props: "默认道具", costume: "默认定妆服装", lightingTime: "默认环境光" },
                status: dependsOnSegmentId ? "blocked" : "queued",
                candidates: [],
                usedClips: 0,
            };
        });

        get().patchProject(projectId, {
            filmTitle: payload.filmTitle || "未命名导演循环项目",
            stage: "await_a",
            idea: payload.idea,
            budgetMaxClips: Math.max(4, payload.budgetMaxClips || 24),
            unitPriceYuan: payload.unitPriceYuan || 0,
            usedClips: anchors.filter((a) => a.imageUrl).length,
            inFlightClips: 0,
            anchors,
            segments,
            expandedSegmentId: null,
            groupVisible: true,
            awaySummary: `已建立 ${anchors.length} 张锚点卡与 ${segments.length} 段分镜合同，请核对锚点并点「确认开跑」`,
        });
        get().addLog(projectId, "todo", `已进入检查点 A（待开机确认）：共 ${segments.length} 段，预算上限 ${payload.budgetMaxClips} 条`);
    },

    approveAnchor: (projectId, anchorId, imageUrl) => {
        get().patchProject(projectId, (prev) => ({
            anchors: prev.anchors.map((a) =>
                a.id === anchorId ? { ...a, imageUrl: imageUrl ?? a.imageUrl, status: "approved", locked: true } : a,
            ),
        }));
    },

    unlockAnchorWithCascade: (projectId, anchorId) => {
        get().patchProject(projectId, (prev) => ({
            anchors: prev.anchors.map((a) => (a.id === anchorId ? { ...a, status: "pending", locked: false } : a)),
            segments: prev.segments.map((s) =>
                s.status === "agent_selected" || s.status === "confirmed" ? { ...s, status: "voided" } : s,
            ),
        }));
        get().addLog(projectId, "todo", "已解冻锚点图，所有引用它的已选片段已标记为作废待重跑");
    },

    updateSegmentContract: (projectId, segmentId, patch) => {
        get().patchProject(projectId, (prev) => ({
            segments: prev.segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s)),
        }));
    },

    confirmCheckpointA: (projectId) => {
        get().patchProject(projectId, (prev) => ({
            stage: "producing",
            anchors: prev.anchors.map((a) => ({ ...a, status: "approved", locked: true })),
            awaySummary: "生产循环已启动：独立段并行抽卡，接续段按前段末帧推进",
        }));
        get().addLog(projectId, "auto", "检查点 A 已确认锁定，导演循环正式开跑");
    },

    pauseLoop: (projectId, terminateUnselected = false) => {
        get().patchProject(projectId, (prev) => ({
            stage: "paused",
            inFlightClips: terminateUnselected ? 0 : prev.inFlightClips,
            segments: terminateUnselected
                ? prev.segments.map((s) =>
                      s.status === "queued" || s.status === "blocked" || s.status === "generating"
                          ? { ...s, status: "abandoned" }
                          : s,
                  )
                : prev.segments,
            awaySummary: terminateUnselected ? "已终止未选定片段" : "已暂停提交新任务（在途任务继续）",
        }));
        get().addLog(projectId, "info", terminateUnselected ? "用户终止了未选定的生产任务" : "用户暂停了新任务提交");
    },

    resumeLoop: (projectId) => {
        get().patchProject(projectId, {
            stage: "producing",
            awaySummary: "已恢复导演循环生产",
        });
        get().addLog(projectId, "info", "已恢复导演循环生产");
    },

    selectCandidate: (projectId, segmentId, candidateId, byUser, forceCascadeMode) => {
        const state = get().getProject(projectId);
        const seg = state.segments.find((s) => s.id === segmentId);
        if (!seg) return;

        // Find downstream segments that already ran or are running based on a previous selection
        const downstream: DirectorSegment[] = [];
        const collectDownstream = (parentId: string) => {
            state.segments.forEach((item) => {
                if (item.dependsOnSegmentId === parentId) {
                    downstream.push(item);
                    collectDownstream(item.id);
                }
            });
        };
        collectDownstream(segmentId);

        const activeDownstream = downstream.filter(
            (d) => d.status === "generating" || d.status === "agent_selected" || d.status === "confirmed",
        );

        // If user changes selection and downstream already started, require cascade confirmation first
        if (
            byUser &&
            seg.selectedCandidateId &&
            seg.selectedCandidateId !== candidateId &&
            activeDownstream.length > 0 &&
            !forceCascadeMode
        ) {
            const extraClips = activeDownstream.reduce((sum, d) => sum + d.drawCount, 0);
            get().patchProject(projectId, {
                cascadePrompt: {
                    segmentId,
                    newCandidateId: candidateId,
                    downstreamIds: activeDownstream.map((d) => d.id),
                    extraClips,
                },
            });
            return;
        }

        const chosen = seg.candidates.find((c) => c.id === candidateId);
        const downSet = new Set(activeDownstream.map((d) => d.id));

        get().patchProject(projectId, (prev) => {
            const nextSegments = prev.segments.map((item) => {
                if (item.id === segmentId) {
                    return {
                        ...item,
                        selectedCandidateId: candidateId,
                        status: (byUser ? "confirmed" : "agent_selected") as DirectorSegmentStatus,
                    };
                }
                // Update direct child's first-frame slot from chosen candidate's last frame
                if (item.dependsOnSegmentId === segmentId) {
                    const canUnlock =
                        prev.continuationPolicy === "agent_selected" || byUser;
                    return {
                        ...item,
                        prevLastFrameUrl: chosen?.lastFrameUrl || chosen?.thumbUrl || item.prevLastFrameUrl,
                        status:
                            forceCascadeMode === "rerun" && downSet.has(item.id)
                                ? ("queued" as DirectorSegmentStatus)
                                : item.status === "blocked" && canUnlock
                                  ? ("queued" as DirectorSegmentStatus)
                                  : item.status,
                    };
                }
                if (forceCascadeMode === "rerun" && downSet.has(item.id)) {
                    return { ...item, status: "blocked" as DirectorSegmentStatus, selectedCandidateId: undefined };
                }
                if (forceCascadeMode === "disconnect" && item.dependsOnSegmentId === segmentId) {
                    return { ...item, dependsOnSegmentId: undefined };
                }
                return item;
            });

            const allDone = nextSegments.every(
                (s) => s.status === "agent_selected" || s.status === "confirmed" || s.status === "abandoned",
            );

            return {
                segments: nextSegments,
                cascadePrompt: null,
                stage: allDone && prev.stage === "producing" ? "await_b" : prev.stage,
            };
        });
    },

    rejectAllCandidates: (projectId, segmentId, reason) => {
        get().patchProject(projectId, (prev) => ({
            segments: prev.segments.map((s) => {
                if (s.id !== segmentId) return s;
                const nextRound = s.retryRound + 1;
                const escalated = nextRound > s.maxRetries;
                return {
                    ...s,
                    retryRound: nextRound,
                    retryHistory: [...s.retryHistory, `第 ${nextRound} 轮：${reason}`],
                    selectedCandidateId: undefined,
                    status: escalated ? "escalated" : "queued",
                    escalationReason: escalated ? `同一原因（${reason}）两轮失败` : undefined,
                };
            }),
        }));
        get().addLog(projectId, "todo", `段返工重跑：原因「${reason}」`);
    },

    abandonSegment: (projectId, segmentId) => {
        get().patchProject(projectId, (prev) => {
            const nextSegments = prev.segments.map((s) => (s.id === segmentId ? { ...s, status: "abandoned" as const } : s));
            const allDone = nextSegments.every(
                (s) => s.status === "agent_selected" || s.status === "confirmed" || s.status === "abandoned",
            );
            return {
                segments: nextSegments,
                stage: allDone && prev.stage === "producing" ? "await_b" : prev.stage,
            };
        });
    },

    batchConfirmRiskFree: (projectId) => {
        let count = 0;
        get().patchProject(projectId, (prev) => ({
            segments: prev.segments.map((s) => {
                if (s.status === "agent_selected" && s.retryRound === 0 && !s.isKey) {
                    count += 1;
                    return { ...s, status: "confirmed" as const };
                }
                return s;
            }),
        }));
        if (count > 0) {
            get().addLog(projectId, "info", `已一键确认 ${count} 段无风险片段`);
        }
        return count;
    },
}));
