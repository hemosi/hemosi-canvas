import { create } from "zustand";
import localforage from "localforage";
import { nanoid } from "nanoid";

export type DirectorLoopStage =
    | "idle"
    | "designing"
    | "await_a"
    | "producing"
    | "paused"
    | "await_b"
    | "composing"
    | "done";

export type SegmentGenMode = "ref_direct" | "first_frame_i2v";
export type SegmentDialogueSource = "native" | "dubbing" | "none";

export type SegmentStatus =
    | "queued"
    | "blocked"
    | "generating"
    | "inspecting"
    | "agent_selected"
    | "confirmed"
    | "escalated"
    | "abandoned"
    | "invalidated";

export interface DirectorAnchorCard {
    id: string;
    kind: "character" | "scene" | "style";
    title: string;
    description: string;
    voiceNote?: string;
    /** Whether this anchor contains a real person (Hypit person-reference flag) */
    isRealPerson?: boolean;
    /** Optional per-anchor image model override */
    imageModel?: string;
    /** User-attached reference images for generating this anchor */
    referenceImageUrls?: string[];
    imageUrl?: string;
    nodeId?: string;
    locked: boolean;
    status: "pending" | "generating" | "approved";
}

export interface DeterministicChecks {
    readable: boolean;
    durationOk: boolean;
    resolutionOk: boolean;
    hasAudioTrack: boolean;
    noBlackFrames: boolean;
    noFrozenFrames: boolean;
}

export interface DirectorCandidate {
    id: string;
    index: number;
    videoUrl: string;
    thumbUrl?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    durationSec: number;
    detectedCuts: number;
    checks: DeterministicChecks;
    visionNote?: string;
    failReason?: string;
    rejected?: boolean;
    isExternal?: boolean;
    nodeId?: string;
}

export interface DirectorSegmentContract {
    id: string;
    index: number;
    title: string;
    summary: string;
    prompt: string;
    imagePrompt?: string;
    dialogue?: string;
    isKey: boolean;
    genMode: SegmentGenMode;
    dialogueSource: SegmentDialogueSource;
    drawCount: number;
    maxReruns: number;
    rerunCount: number;
    seconds: number;
    dependsOnSegmentId?: string;
    prevLastFrameUrl?: string;
    /** Extra user-dragged or node-picked reference images for this segment */
    referenceImageUrls?: string[];
    /** Per-segment model overrides */
    overrideImageModel?: string;
    overrideVideoModel?: string;
    expectedCuts: number;
    shotsList: string[];
    status: SegmentStatus;
    candidates: DirectorCandidate[];
    selectedCandidateId?: string;
    selectionBasis?: string;
    rerunHistory: string[];
    escalationReason?: string;
    dubbingAudioUrl?: string;
    dubbingDurationSec?: number;
    dubbingFitMode?: "speed" | "trim" | "edit_script";
}

export interface DirectorLogEntry {
    id: string;
    time: string;
    level: "todo" | "auto" | "info";
    text: string;
    segmentIndex?: number;
}

export interface DirectorPreviewMedia {
    type: "image" | "video";
    url: string;
    title?: string;
}

export interface DirectorLoopProjectState {
    projectId: string;
    filmTitle: string;
    stage: DirectorLoopStage;
    groupVisible: boolean;
    idea: {
        protagonist: string;
        background: string;
        theme: string;
        story: string;
    };
    continuationPolicy: "agent_selected" | "user_confirmed";
    defaultImageModel?: string;
    defaultVideoModel?: string;
    anchors: DirectorAnchorCard[];
    segments: DirectorSegmentContract[];
    expandedSegmentId?: string;
    filterMode: "all" | "chain" | "todo";
    awaySummary?: string;
    finalVideoUrl?: string;
    finalNodeId?: string;
    logs: DirectorLogEntry[];
    updatedAt: number;
}

export interface InitPlanPayload {
    filmTitle: string;
    idea: DirectorLoopProjectState["idea"];
    defaultImageModel?: string;
    defaultVideoModel?: string;
    anchors: Array<{
        kind: DirectorAnchorCard["kind"];
        title: string;
        description: string;
        voiceNote?: string;
        isRealPerson?: boolean;
        imageUrl?: string;
        imageModel?: string;
    }>;
    segments: Array<{
        title: string;
        summary: string;
        prompt: string;
        imagePrompt?: string;
        dialogue?: string;
        isKey?: boolean;
        genMode?: SegmentGenMode;
        dialogueSource?: SegmentDialogueSource;
        drawCount?: number;
        seconds?: number;
        dependsOnIndex?: number;
        shotsList?: string[];
        referenceImageUrls?: string[];
    }>;
}

interface DirectorLoopStore {
    byProject: Record<string, DirectorLoopProjectState>;
    previewMedia: DirectorPreviewMedia | null;
    hydrated: boolean;
    hydrate: () => Promise<void>;
    setPreviewMedia: (media: DirectorPreviewMedia | null) => void;
    getProject: (projectId: string) => DirectorLoopProjectState;
    initFromPlan: (projectId: string, payload: InitPlanPayload) => void;
    patchProject: (
        projectId: string,
        updater: Partial<DirectorLoopProjectState> | ((prev: DirectorLoopProjectState) => Partial<DirectorLoopProjectState>),
    ) => void;
    updateAnchor: (projectId: string, anchorId: string, patch: Partial<DirectorAnchorCard>) => void;
    updateSegmentContract: (projectId: string, segmentId: string, patch: Partial<DirectorSegmentContract>) => void;
    addLog: (projectId: string, level: DirectorLogEntry["level"], text: string, segmentIndex?: number) => void;
    resetProject: (projectId: string) => void;
}

const STORAGE_KEY = "hemosi:director-loop-v2";

function emptyProject(projectId: string): DirectorLoopProjectState {
    return {
        projectId,
        filmTitle: "未命名导演项目",
        stage: "idle",
        groupVisible: false,
        idea: { protagonist: "", background: "", theme: "", story: "" },
        continuationPolicy: "agent_selected",
        anchors: [],
        segments: [],
        filterMode: "all",
        logs: [],
        updatedAt: Date.now(),
    };
}

function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function persist(byProject: Record<string, DirectorLoopProjectState>) {
    void localforage.setItem(STORAGE_KEY, byProject).catch(() => {});
}

export const useDirectorLoopStore = create<DirectorLoopStore>((set, get) => ({
    byProject: {},
    previewMedia: null,
    hydrated: false,
    hydrate: async () => {
        if (get().hydrated) return;
        try {
            const saved = await localforage.getItem<Record<string, DirectorLoopProjectState>>(STORAGE_KEY);
            if (saved && typeof saved === "object") {
                set({ byProject: saved, hydrated: true });
                return;
            }
        } catch {
            // ignore
        }
        set({ hydrated: true });
    },
    setPreviewMedia: (media) => set({ previewMedia: media }),
    getProject: (projectId) => get().byProject[projectId] || emptyProject(projectId),
    initFromPlan: (projectId, payload) => {
        const anchors: DirectorAnchorCard[] = payload.anchors.map((a) => ({
            id: `anc-${nanoid(6)}`,
            kind: a.kind,
            title: a.title,
            description: a.description,
            voiceNote: a.voiceNote,
            isRealPerson: a.isRealPerson,
            imageModel: a.imageModel,
            imageUrl: a.imageUrl,
            locked: Boolean(a.imageUrl),
            status: a.imageUrl ? "approved" : "pending",
        }));

        const segIds = payload.segments.map(() => `seg-${nanoid(6)}`);
        const segments: DirectorSegmentContract[] = payload.segments.map((s, idx) => {
            const depIdx = s.dependsOnIndex;
            const dependsOnSegmentId = depIdx !== undefined && depIdx >= 0 && depIdx < idx ? segIds[depIdx] : undefined;
            return {
                id: segIds[idx],
                index: idx + 1,
                title: s.title,
                summary: s.summary,
                prompt: s.prompt,
                imagePrompt: s.imagePrompt,
                dialogue: s.dialogue,
                isKey: Boolean(s.isKey),
                genMode: s.genMode || "ref_direct",
                dialogueSource: s.dialogueSource || "none",
                drawCount: Math.max(1, Math.min(4, s.drawCount || 2)),
                maxReruns: 2,
                rerunCount: 0,
                seconds: Math.max(2, s.seconds || 5),
                dependsOnSegmentId,
                referenceImageUrls: s.referenceImageUrls,
                expectedCuts: Math.max(1, s.shotsList?.length || 1),
                shotsList: s.shotsList || [s.summary],
                status: dependsOnSegmentId ? "blocked" : "queued",
                candidates: [],
                rerunHistory: [],
            };
        });

        const next: DirectorLoopProjectState = {
            projectId,
            filmTitle: payload.filmTitle || "未命名导演项目",
            stage: "await_a",
            groupVisible: true,
            idea: payload.idea,
            continuationPolicy: "agent_selected",
            defaultImageModel: payload.defaultImageModel,
            defaultVideoModel: payload.defaultVideoModel,
            anchors,
            segments,
            filterMode: "all",
            logs: [],
            updatedAt: Date.now(),
        };

        set((state) => {
            const byProject = { ...state.byProject, [projectId]: next };
            persist(byProject);
            return { byProject };
        });
        get().addLog(projectId, "todo", `已进入检查点 A（待开机确认）：共 ${segments.length} 段`);
    },
    patchProject: (projectId, updater) => {
        set((state) => {
            const prev = state.byProject[projectId] || emptyProject(projectId);
            const patch = typeof updater === "function" ? updater(prev) : updater;
            const updated: DirectorLoopProjectState = { ...prev, ...patch, updatedAt: Date.now() };
            const byProject = { ...state.byProject, [projectId]: updated };
            persist(byProject);
            return { byProject };
        });
    },
    updateAnchor: (projectId, anchorId, patch) => {
        get().patchProject(projectId, (prev) => ({
            anchors: prev.anchors.map((a) => (a.id === anchorId ? { ...a, ...patch } : a)),
        }));
    },
    updateSegmentContract: (projectId, segmentId, patch) => {
        get().patchProject(projectId, (prev) => ({
            segments: prev.segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s)),
        }));
    },
    addLog: (projectId, level, text, segmentIndex) => {
        get().patchProject(projectId, (prev) => ({
            logs: [{ id: `log-${nanoid(5)}`, time: nowTime(), level, text, segmentIndex }, ...prev.logs].slice(0, 120),
        }));
    },
    resetProject: (projectId) => {
        set((state) => {
            const byProject = { ...state.byProject };
            delete byProject[projectId];
            persist(byProject);
            return { byProject };
        });
    },
}));
