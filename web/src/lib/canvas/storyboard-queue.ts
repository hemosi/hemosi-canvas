import {
    modelNotReadyReason,
    modelOptionName,
    resolveModelChannel,
    resolveModelForCapability,
    type AiConfig,
} from "@/stores/use-config-store";

export type StoryboardQueueTask = {
    nodeId: string;
    kind: "image" | "video";
    label: string;
    prompt: string;
};

export function isLocalChannelUrl(baseUrl: string | undefined): boolean {
    if (!baseUrl) return false;
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        const m = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
        if (m) {
            const second = Number(m[1]);
            if (second >= 16 && second <= 31) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function resolveStoryboardRunMeta(config: AiConfig, kind: "image" | "video", nodeModel?: string) {
    const rawModel = nodeModel || resolveModelForCapability(config, kind === "video" ? config.videoModel : config.imageModel, kind);
    const channel = resolveModelChannel(config, rawModel);
    const baseUrl = channel?.baseUrl || config.baseUrl || "";
    const concurrency = isLocalChannelUrl(baseUrl) ? 1 : 3;
    const reason = modelNotReadyReason(config, rawModel);
    return {
        rawModel,
        modelName: modelOptionName(rawModel) || rawModel || "未配置模型",
        channelName: channel?.name || "默认渠道",
        baseUrl,
        concurrency,
        ready: !reason,
        reason,
    };
}

export type StoryboardRunGroup = {
    kind: "image" | "video";
    count: number;
    modelName: string;
    channelName: string;
    concurrency: number;
    ready: boolean;
    reason?: string | null;
};

/** One line per (kind, model) in a batch, so the confirm card shows every model it will spend on, not just the first task's. */
export function summarizeStoryboardRun(
    config: AiConfig,
    tasks: StoryboardQueueTask[],
    nodeModel: (nodeId: string) => string | undefined,
): StoryboardRunGroup[] {
    const groups = new Map<string, StoryboardRunGroup>();
    for (const task of tasks) {
        const meta = resolveStoryboardRunMeta(config, task.kind, nodeModel(task.nodeId));
        const key = `${task.kind}:${meta.rawModel}`;
        const cur = groups.get(key);
        if (cur) cur.count++;
        else groups.set(key, { kind: task.kind, count: 1, modelName: meta.modelName, channelName: meta.channelName, concurrency: meta.concurrency, ready: meta.ready, reason: meta.reason });
    }
    return [...groups.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1));
}

export async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
    signal?: AbortSignal,
): Promise<{ completed: number; canceled: boolean }> {
    const limit = Math.max(1, Math.floor(concurrency));
    let cursor = 0;
    let completed = 0;

    const runOne = async () => {
        while (cursor < items.length) {
            if (signal?.aborted) return;
            const index = cursor++;
            await worker(items[index], index);
            completed++;
        }
    };

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
    await Promise.all(workers);
    return { completed, canceled: Boolean(signal?.aborted) };
}

/** 按上游参考连线给同阶段任务分层：上游也在本批里的任务排到后面一层（如反打等正打出图）；成环的剩余任务放最后一层。 */
export function layerByUpstream<T extends { nodeId: string }>(tasks: T[], connections: { fromNodeId: string; toNodeId: string }[]): T[][] {
    const ids = new Set(tasks.map((task) => task.nodeId));
    const done = new Set<string>();
    const layers: T[][] = [];
    let rest = tasks;
    while (rest.length) {
        const layer = rest.filter((task) => connections.every((c) => c.toNodeId !== task.nodeId || !ids.has(c.fromNodeId) || c.fromNodeId === task.nodeId || done.has(c.fromNodeId)));
        const current = layer.length ? layer : rest;
        layers.push(current);
        current.forEach((task) => done.add(task.nodeId));
        rest = rest.filter((task) => !current.includes(task));
    }
    return layers;
}
