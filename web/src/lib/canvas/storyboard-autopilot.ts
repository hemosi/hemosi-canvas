import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import type { StoryboardData } from "@/lib/canvas/storyboard-types";
import { collectStoryboardSettingImageIds, deriveNodeHealth } from "@/lib/canvas/storyboard-utils";
import type { CanvasNodeData } from "@/types/canvas";

export type AutopilotState = {
    status: "idle" | "running" | "paused" | "completed" | "canceled";
    completed: number;
    total: number;
    failedCodes: string[];
    stage: string;
};

export type AutopilotTasks = {
    /** Role / scene / prop setting images that have no picture yet. */
    settingTasks: StoryboardQueueTask[];
    firstFrameTasks: StoryboardQueueTask[];
    videoTasks: StoryboardQueueTask[];
};

/** What 一键出片 still has to generate, in the order it must run: settings → first frames → videos. */
export function collectAutopilotTasks(data: StoryboardData, nodes: CanvasNodeData[]): AutopilotTasks {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const settingTasks: StoryboardQueueTask[] = collectStoryboardSettingImageIds(data.settings, nodes)
        .map((id) => nodeMap.get(id))
        .filter((n): n is CanvasNodeData => Boolean(n) && !n!.metadata?.content && deriveNodeHealth(n) !== "running")
        .map((n) => ({ nodeId: n.id, kind: "image", label: `@${n.metadata?.refId || ""} ${n.title || "设定图"} · 设定图`, prompt: n.metadata?.prompt || "" }));
    const firstFrameTasks: StoryboardQueueTask[] = [];
    const videoTasks: StoryboardQueueTask[] = [];
    for (const row of data.rows) {
        const imgNode = nodeMap.get(row.imageNodeId);
        if (imgNode && !["ok", "running"].includes(deriveNodeHealth(imgNode))) {
            firstFrameTasks.push({ nodeId: row.imageNodeId, kind: "image", label: `${row.code} · 首帧图`, prompt: row.imgPrompt });
        }
        const vidNode = nodeMap.get(row.videoNodeId);
        if (vidNode && !["ok", "running"].includes(deriveNodeHealth(vidNode))) {
            videoTasks.push({ nodeId: row.videoNodeId, kind: "video", label: `${row.code} · 视频`, prompt: row.vidPrompt });
        }
    }
    return { settingTasks, firstFrameTasks, videoTasks };
}

/**
 * Runs the stages one after another and waits for each, so first frames get their setting images as references
 * and videos get their first frames. `confirmEachStage` shows the normal confirm card before every stage (manual mode);
 * otherwise the caller has already confirmed the whole run.
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
}): Promise<AutopilotState> {
    const initial = collectAutopilotTasks(params.data, params.getNodes());
    const total = initial.settingTasks.length + initial.firstFrameTasks.length + initial.videoTasks.length;
    if (total === 0) {
        const done: AutopilotState = { status: "completed", completed: 0, total: 0, failedCodes: [], stage: "全部已就绪" };
        params.onProgress(done);
        return done;
    }

    let completed = 0;
    const failedCodes: string[] = [];
    const stages: Array<{ title: string; tasks: () => StoryboardQueueTask[] }> = [
        { title: "生成角色/场景/物品设定图", tasks: () => initial.settingTasks },
        { title: "生成首帧图", tasks: () => initial.firstFrameTasks },
        {
            title: "生成视频",
            // Only videos whose first frame is ready now; the rest would run without their reference image.
            tasks: () =>
                initial.videoTasks.filter((t) => {
                    const row = params.data.rows.find((r) => r.videoNodeId === t.nodeId);
                    const ready = deriveNodeHealth(params.getNode(row?.imageNodeId || "")) === "ok";
                    if (!ready) failedCodes.push(`${row?.code || t.label}（首帧图未就绪，跳过视频）`);
                    return ready;
                }),
        },
    ];

    for (const stage of stages) {
        if (params.signal.aborted) break;
        const tasks = stage.tasks();
        if (!tasks.length) continue;
        params.onProgress({ status: "running", completed, total, failedCodes, stage: stage.title });
        const res = await params.runBatch(tasks, { skipConfirm: !params.confirmEachStage, title: `一键出片 · ${stage.title}` });
        completed += res.ok;
        for (const t of tasks) {
            if (deriveNodeHealth(params.getNode(t.nodeId)) !== "ok") failedCodes.push(t.label);
        }
        if (res.canceled || params.signal.aborted) {
            const canceled: AutopilotState = { status: "canceled", completed, total, failedCodes, stage: "已取消" };
            params.onProgress(canceled);
            return canceled;
        }
    }

    if (params.signal.aborted) {
        const canceled: AutopilotState = { status: "canceled", completed, total, failedCodes, stage: "已取消" };
        params.onProgress(canceled);
        return canceled;
    }

    const finalState: AutopilotState = {
        status: "completed",
        completed,
        total,
        failedCodes,
        stage: failedCodes.length ? `完成 ${completed}/${total}，${failedCodes.join("、")} 失败` : `全部完成 (${completed}/${total})`,
    };
    params.onProgress(finalState);
    return finalState;
}
