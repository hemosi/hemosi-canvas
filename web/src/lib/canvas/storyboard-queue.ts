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
