import type { StoryboardQueueTask } from "@/lib/canvas/storyboard-queue";
import type { StoryboardData } from "@/lib/canvas/storyboard-types";
import { deriveNodeHealth } from "@/lib/canvas/storyboard-utils";
import type { CanvasNodeData } from "@/types/canvas";

export type AutopilotState = {
    status: "idle" | "running" | "paused" | "completed" | "canceled";
    completed: number;
    total: number;
    failedCodes: string[];
    stage: string;
};

export async function runStoryboardAutopilot(params: {
    data: StoryboardData;
    getNode: (id: string) => CanvasNodeData | undefined;
    runBatch: (
        tasks: StoryboardQueueTask[],
        options?: { skipConfirm?: boolean; title?: string },
    ) => Promise<{ ok: number; failed: number; canceled: boolean }>;
    onProgress: (state: AutopilotState) => void;
    signal: AbortSignal;
}): Promise<AutopilotState> {
    const imgTasks: StoryboardQueueTask[] = [];
    const vidTasks: StoryboardQueueTask[] = [];

    for (const row of params.data.rows) {
        const imgNode = params.getNode(row.imageNodeId);
        if (imgNode && deriveNodeHealth(imgNode) !== "ok") {
            imgTasks.push({
                nodeId: row.imageNodeId,
                kind: "image",
                label: `${row.code} · 首帧图`,
                prompt: row.imgPrompt,
            });
        }
        const vidNode = params.getNode(row.videoNodeId);
        if (vidNode && deriveNodeHealth(vidNode) !== "ok") {
            vidTasks.push({
                nodeId: row.videoNodeId,
                kind: "video",
                label: `${row.code} · 视频`,
                prompt: row.vidPrompt,
            });
        }
    }

    const total = imgTasks.length + vidTasks.length;
    if (total === 0) {
        const done: AutopilotState = { status: "completed", completed: 0, total: 0, failedCodes: [], stage: "全部已就绪" };
        params.onProgress(done);
        return done;
    }

    let completed = 0;
    const failedCodes: string[] = [];

    if (imgTasks.length > 0 && !params.signal.aborted) {
        params.onProgress({ status: "running", completed, total, failedCodes, stage: "生成首帧图" });
        const res = await params.runBatch(imgTasks, { skipConfirm: true });
        completed += res.ok;
        for (const t of imgTasks) {
            if (deriveNodeHealth(params.getNode(t.nodeId)) !== "ok") {
                failedCodes.push(t.label);
            }
        }
        if (res.canceled || params.signal.aborted) {
            const canceled: AutopilotState = { status: "canceled", completed, total, failedCodes, stage: "已取消" };
            params.onProgress(canceled);
            return canceled;
        }
    }

    if (vidTasks.length > 0 && !params.signal.aborted) {
        params.onProgress({ status: "running", completed, total, failedCodes, stage: "生成视频" });
        const res = await params.runBatch(vidTasks, { skipConfirm: true });
        completed += res.ok;
        for (const t of vidTasks) {
            if (deriveNodeHealth(params.getNode(t.nodeId)) !== "ok") {
                failedCodes.push(t.label);
            }
        }
        if (res.canceled || params.signal.aborted) {
            const canceled: AutopilotState = { status: "canceled", completed, total, failedCodes, stage: "已取消" };
            params.onProgress(canceled);
            return canceled;
        }
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
