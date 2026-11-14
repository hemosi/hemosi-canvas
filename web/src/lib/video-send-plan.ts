/**
 * How the images of one video generation are actually sent. This is the single source of truth:
 * the request builders (services/api/video.ts) and the reference strip UI both read it.
 *
 * - By default every image goes as a reference image.
 * - Only an image the user marked 首帧 / 尾帧 goes as first_frame / last_frame.
 * - When the model/channel cannot take first frame + references in one request, the extra references are
 *   left out and `warning` says so; nothing is changed silently.
 */
export type VideoSendPlan = {
    mode: "frames" | "reference";
    /** Index (in the original image list) sent as first_frame. */
    first?: number;
    /** Index sent as last_frame. */
    last?: number;
    /** Indexes sent as reference images. */
    references: number[];
    /** Indexes that will not be sent. */
    dropped: number[];
    warning?: string;
};

/**
 * No vendor this app talks to accepts first/last frame and reference images in the same request
 * (Veo, Kling, Seedance, Runway and the OpenAI-style gateways all take one or the other).
 */
export const VIDEO_MIX_FRAMES_AND_REFERENCES = false;

export function planVideoImageSend(roles: Array<string | undefined>, mixSupported = VIDEO_MIX_FRAMES_AND_REFERENCES): VideoSendPlan {
    const all = roles.map((_, index) => index);
    const firsts = all.filter((i) => roles[i] === "firstFrame");
    const lasts = all.filter((i) => roles[i] === "lastFrame");
    if (!firsts.length && !lasts.length) return { mode: "reference", references: all, dropped: [] };
    if (!firsts.length) {
        return {
            mode: "reference",
            references: all,
            dropped: [],
            warning: "只标了尾帧、没有首帧：视频模型不能只用尾帧，本次全部按参考图发送。要用首尾帧请再标一张「首帧」。",
        };
    }
    const first = firsts[0];
    const last = lasts[0];
    const others = all.filter((i) => i !== first && i !== last);
    const notes: string[] = [];
    if (firsts.length > 1 || lasts.length > 1) notes.push("标了多张首帧/尾帧，只用排在最前的一张，其余按参考图处理");
    if (!others.length || mixSupported) {
        return { mode: "frames", first, last, references: mixSupported ? others : [], dropped: [], warning: notes.join("；") || undefined };
    }
    notes.push(
        `当前视频模型/渠道不能同时用首帧和参考图：本次只发${last !== undefined ? "首帧+尾帧" : "首帧"}，另外 ${others.length} 张参考图不会发送。要发参考图，请把首帧/尾帧改回「参考图」`,
    );
    return { mode: "frames", first, last, references: [], dropped: others, warning: notes.join("；") };
}

/** Reorder images to what the request builders expect: [first, last?] in frames mode, all images in reference mode. */
export function applyVideoSendPlan<T>(images: T[], plan: VideoSendPlan): T[] {
    if (plan.mode === "reference") return plan.references.map((i) => images[i]).filter((item) => item !== undefined);
    return [plan.first, plan.last, ...plan.references].filter((i): i is number => i !== undefined).map((i) => images[i]).filter((item) => item !== undefined);
}

/** Short label of the plan for the UI, e.g. 「首帧+尾帧」「全部按参考图（3 张）」. */
export function videoSendPlanLabel(plan: VideoSendPlan, count: number): string {
    if (!count) return "无图片（纯文生视频）";
    if (plan.mode === "reference") return `全部按参考图发送（${plan.references.length} 张）`;
    const parts = ["首帧", plan.last !== undefined ? "尾帧" : "", plan.references.length ? `参考图 ${plan.references.length} 张` : ""].filter(Boolean);
    return `按 ${parts.join("+")} 发送`;
}
