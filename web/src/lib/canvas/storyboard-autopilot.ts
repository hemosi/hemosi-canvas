import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import type { StoryboardData, StoryboardRow } from "@/lib/canvas/storyboard-types";
import { collectStoryboardSettingImageIds, deriveNodeHealth, resolveRowReferenceImageNodeIds, rowHealth } from "@/lib/canvas/storyboard-utils";
import type { CanvasNodeData } from "@/types/canvas";

export type AutopilotState = {
    status: "idle" | "running" | "paused" | "completed" | "canceled";
    completed: number;
    total: number;
    failedCodes: string[];
    stage: string;
    /** Why each failed shot failed, by row id; the table marks these rows red. */
    rowErrors?: Record<string, string>;
};

export type AutopilotTasks = {
    /** Role / scene / prop setting images that have no picture yet. */
    settingTasks: StoryboardQueueTask[];
    firstFrameTasks: StoryboardQueueTask[];
    videoTasks: StoryboardQueueTask[];
};

/** Tries per image before the shot's video is skipped. */
export const MAX_IMAGE_RETRIES = 3;

const settingTask = (n: CanvasNodeData): StoryboardQueueTask => ({ nodeId: n.id, kind: "image", label: `@${n.metadata?.refId || ""} ${n.title || "设定图"} · 设定图`, prompt: n.metadata?.prompt || "" });

/** What 一键出片 still has to generate, in the order it must run: settings → first frames → videos. `rowIds` limits it to those shots. */
export function collectAutopilotTasks(data: StoryboardData, nodes: CanvasNodeData[], rowIds?: string[]): AutopilotTasks {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const rows = rowIds ? data.rows.filter((r) => rowIds.includes(r.id)) : data.rows;
    const settingIds = rowIds ? [...new Set(rows.flatMap((r) => resolveRowReferenceImageNodeIds(r, data.settings, nodes)))].filter((id) => collectStoryboardSettingImageIds(data.settings, nodes).includes(id)) : collectStoryboardSettingImageIds(data.settings, nodes);
    const settingTasks: StoryboardQueueTask[] = settingIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is CanvasNodeData => Boolean(n) && !n!.metadata?.content && deriveNodeHealth(n) !== "running")
        .map(settingTask);
    const firstFrameTasks: StoryboardQueueTask[] = [];
    const videoTasks: StoryboardQueueTask[] = [];
    for (const row of rows) {
        const health = rowHealth(row, nodeMap);
        if (nodeMap.get(row.imageNodeId) && !["ok", "running"].includes(health.image)) {
            firstFrameTasks.push({ nodeId: row.imageNodeId, kind: "image", label: `${row.code} · 首帧图`, prompt: row.imgPrompt });
        }
        if (nodeMap.get(row.videoNodeId) && !["ok", "running"].includes(health.video)) {
            videoTasks.push({ nodeId: row.videoNodeId, kind: "video", label: `${row.code} · 视频`, prompt: row.vidPrompt });
        }
    }
    return { settingTasks, firstFrameTasks, videoTasks };
}

/** The images a shot's video depends on: its first frame plus every setting image it references. */
export function rowDependencyImageIds(row: StoryboardRow, data: StoryboardData, nodes: CanvasNodeData[]): string[] {
    return [...new Set([row.imageNodeId, ...resolveRowReferenceImageNodeIds(row, data.settings, nodes)].filter(Boolean))];
}

/**
 * Before videos run: every first frame and referenced setting image must actually load. Broken ones are regenerated,
 * up to `maxTries` rounds. Returns the rows still broken afterwards (their video is skipped) and whether the user canceled.
 */
export async function ensureVideoInputsLoad(params: {
    rows: StoryboardRow[];
    data: StoryboardData;
    getNode: (id: string) => CanvasNodeData | undefined;
    getNodes: () => CanvasNodeData[];
    canLoadImage: (node: CanvasNodeData) => Promise<boolean>;
    regenerate: (tasks: StoryboardQueueTask[], attempt: number) => Promise<{ canceled: boolean }>;
    maxTries?: number;
}): Promise<{ brokenRows: Record<string, string[]>; canceled: boolean }> {
    const maxTries = params.maxTries ?? MAX_IMAGE_RETRIES;
    const findBroken = async () => {
        const broken: Record<string, string[]> = {};
        for (const row of params.rows) {
            for (const id of rowDependencyImageIds(row, params.data, params.getNodes())) {
                const node = params.getNode(id);
                if (!node || !(await params.canLoadImage(node))) (broken[row.id] ||= []).push(id);
            }
        }
        return broken;
    };
    let broken = await findBroken();
    for (let attempt = 1; attempt <= maxTries && Object.keys(broken).length; attempt++) {
        const ids = [...new Set(Object.values(broken).flat())];
        const tasks = ids.map((id): StoryboardQueueTask | null => {
            const row = params.rows.find((r) => r.imageNodeId === id);
            if (row) return { nodeId: id, kind: "image", label: `${row.code} · 首帧图`, prompt: row.imgPrompt };
            const node = params.getNode(id);
            return node ? settingTask(node) : null;
        }).filter((t): t is StoryboardQueueTask => Boolean(t));
        if (!tasks.length) break;
        const res = await params.regenerate(tasks, attempt);
        if (res.canceled) return { brokenRows: broken, canceled: true };
        broken = await findBroken();
    }
    return { brokenRows: broken, canceled: false };
}

/** True when the node has an image that the browser can actually decode. */
export async function canLoadImageNode(node: CanvasNodeData): Promise<boolean> {
    const content = node.metadata?.content;
    if (!content || node.metadata?.status === "error") return false;
    try {
        const { imageToDataUrl } = await import("@/services/image-storage");
        const src = await imageToDataUrl({ dataUrl: content, storageKey: node.metadata?.storageKey });
        if (!src) return false;
        return await new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = src;
        });
    } catch {
        return false;
    }
}

/**
 * Runs the stages one after another and waits for each, so first frames get their setting images as references
 * and videos get their first frames. Before videos, every input image is checked and regenerated (up to 3 times);
 * a shot whose images still fail is skipped and reported in rowErrors. `confirmEachStage` shows the normal confirm
 * card before every stage (manual mode); otherwise the caller has already confirmed the whole run.
 */
export async function runStoryboardAutopilot(params: {
    data: StoryboardData;
    getNode: (id: string) => CanvasNodeData | undefined;
    getNodes: () => CanvasNodeData[];
    runBatch: (
        tasks: StoryboardQueueTask[],
        options?: { skipConfirm?: boolean; title?: string },
    ) => Promise<{ ok: number; failed: number; canceled: boolean }>;
    onProgress: (state: AutopilotState) => void;
    signal: AbortSignal;
    confirmEachStage?: boolean;
    /** Only these shots (「只重跑失败的」). */
    rowIds?: string[];
    canLoadImage?: (node: CanvasNodeData) => Promise<boolean>;
}): Promise<AutopilotState> {
    const initial = collectAutopilotTasks(params.data, params.getNodes(), params.rowIds);
    const total = initial.settingTasks.length + initial.firstFrameTasks.length + initial.videoTasks.length;
    const rowErrors: Record<string, string> = {};
    if (total === 0) {
        const done: AutopilotState = { status: "completed", completed: 0, total: 0, failedCodes: [], stage: "全部已就绪", rowErrors };
        params.onProgress(done);
        return done;
    }

    let completed = 0;
    const failedCodes: string[] = [];
    const rowOf = (nodeId: string) => params.data.rows.find((r) => r.imageNodeId === nodeId || r.videoNodeId === nodeId);
    const canLoad = params.canLoadImage || (async (n: CanvasNodeData) => deriveNodeHealth(n) === "ok" || Boolean(n.metadata?.content && n.metadata?.status !== "error"));
    const finish = (status: AutopilotState["status"], stage: string): AutopilotState => {
        const state: AutopilotState = { status, completed, total, failedCodes, stage, rowErrors };
        params.onProgress(state);
        return state;
    };
    const run = async (tasks: StoryboardQueueTask[], title: string) => {
        params.onProgress({ status: "running", completed, total, failedCodes, stage: title, rowErrors });
        const res = await params.runBatch(tasks, { skipConfirm: !params.confirmEachStage, title: `一键出片 · ${title}` });
        completed += res.ok;
        return res;
    };

    // 1. Setting images, 2. first frames. Failures here are retried by the check before videos.
    for (const stage of [
        { title: "生成角色/场景/物品设定图", tasks: initial.settingTasks },
        { title: "生成首帧图", tasks: initial.firstFrameTasks },
    ]) {
        if (params.signal.aborted) return finish("canceled", "已取消");
        if (!stage.tasks.length) continue;
        const res = await run(stage.tasks, stage.title);
        if (res.canceled || params.signal.aborted) return finish("canceled", "已取消");
    }

    // 3. Check every video's input images can load; regenerate broken ones up to 3 times, else skip that shot.
    const videoRows = initial.videoTasks.map((t) => rowOf(t.nodeId)).filter((r): r is StoryboardRow => Boolean(r));
    const check = await ensureVideoInputsLoad({
        rows: videoRows,
        data: params.data,
        getNode: params.getNode,
        getNodes: params.getNodes,
        canLoadImage: canLoad,
        regenerate: (tasks, attempt) => run(tasks, `重生无法加载的图片（第 ${attempt}/${MAX_IMAGE_RETRIES} 次）`),
    });
    if (check.canceled || params.signal.aborted) return finish("canceled", "已取消");
    for (const [rowId, ids] of Object.entries(check.brokenRows)) {
        const row = params.data.rows.find((r) => r.id === rowId);
        const names = ids.map((id) => (id === row?.imageNodeId ? "首帧图" : `@${params.getNode(id)?.metadata?.refId || "设定图"}`)).join("、");
        rowErrors[rowId] = `${names} 重试 ${MAX_IMAGE_RETRIES} 次仍无法加载，已跳过本镜视频`;
        failedCodes.push(`${row?.code || rowId}（图片无法加载，跳过视频）`);
    }

    // 4. Videos of the shots whose images are fine.
    const videoTasks = initial.videoTasks.filter((t) => !check.brokenRows[rowOf(t.nodeId)?.id || ""]);
    if (videoTasks.length) {
        const res = await run(videoTasks, "生成视频");
        if (res.canceled || params.signal.aborted) return finish("canceled", "已取消");
        for (const t of videoTasks) {
            if (deriveNodeHealth(params.getNode(t.nodeId)) === "ok") continue;
            const row = rowOf(t.nodeId);
            if (row) rowErrors[row.id] = params.getNode(t.nodeId)?.metadata?.errorDetails || "视频生成失败";
            failedCodes.push(t.label);
        }
    }

    return finish(
        "completed",
        failedCodes.length ? `完成 ${completed}/${total}，${failedCodes.join("、")} 失败` : `全部完成 (${completed}/${total})`,
    );
}
