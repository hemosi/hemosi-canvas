import { withLocalProxy } from "@/stores/use-config-store";

export type VideoShotSegment = { start: number; end: number; keyframe: Blob };

const SAMPLE_W = 64;
const SAMPLE_H = 36;

function seek(video: HTMLVideoElement, time: number) {
    return new Promise<void>((resolve, reject) => {
        const done = () => {
            video.removeEventListener("seeked", done);
            video.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            video.removeEventListener("seeked", done);
            video.removeEventListener("error", fail);
            reject(new Error("视频读取失败"));
        };
        video.addEventListener("seeked", done);
        video.addEventListener("error", fail);
        video.currentTime = time;
    });
}

async function openVideo(source: string) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("视频读取失败"));
        video.src = source;
        video.load();
    });
    return video;
}

/** Mean absolute luma difference (0–1) between two small frames. */
export function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
        const la = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
        const lb = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
        sum += Math.abs(la - lb);
    }
    return sum / (a.length / 4) / 255;
}

/** Cut times from per-sample diffs: a sample whose diff passes `threshold` starts a new shot, shots shorter than `minLen` are merged. */
export function cutsFromDiffs(times: number[], diffs: number[], duration: number, threshold = 0.12, minLen = 0.8) {
    const cuts = [0];
    diffs.forEach((diff, index) => {
        if (diff >= threshold && times[index] - cuts[cuts.length - 1] >= minLen && duration - times[index] >= minLen) cuts.push(times[index]);
    });
    return cuts.map((start, index) => ({ start, end: cuts[index + 1] ?? duration }));
}

async function analyse(source: string, onProgress?: (ratio: number) => void): Promise<VideoShotSegment[]> {
    const video = await openVideo(source);
    try {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error("读不到视频时长");
        const step = Math.max(0.25, duration / 600);
        const small = document.createElement("canvas");
        small.width = SAMPLE_W;
        small.height = SAMPLE_H;
        const ctx = small.getContext("2d", { willReadFrequently: true })!;
        const times: number[] = [];
        const diffs: number[] = [];
        let prev: Uint8ClampedArray | null = null;
        for (let time = 0; time < duration; time += step) {
            await seek(video, time);
            ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
            const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data; // throws SecurityError on a tainted video
            if (prev) {
                times.push(time);
                diffs.push(frameDiff(prev, data));
            }
            prev = data;
            onProgress?.(time / duration);
        }
        const segments = cutsFromDiffs(times, diffs, duration);
        const full = document.createElement("canvas");
        full.width = video.videoWidth;
        full.height = video.videoHeight;
        const fctx = full.getContext("2d")!;
        const result: VideoShotSegment[] = [];
        for (const segment of segments) {
            await seek(video, Math.min(duration - 0.01, (segment.start + segment.end) / 2));
            fctx.drawImage(video, 0, 0);
            const keyframe = await new Promise<Blob>((resolve, reject) => full.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("截帧失败"))), "image/png"));
            result.push({ ...segment, keyframe });
        }
        return result;
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

/** Split a video into shots by scene-change detection; each shot gets its time range and a mid-shot keyframe. */
export async function splitVideoIntoShots(source: string, onProgress?: (ratio: number) => void) {
    try {
        return await analyse(source, onProgress);
    } catch (error) {
        if (!(error instanceof DOMException && error.name === "SecurityError") || /^(blob|data):/i.test(source)) throw error;
    }
    const response = await fetch(withLocalProxy(source));
    if (!response.ok) throw new Error(`视频下载失败 HTTP ${response.status}`);
    const blobUrl = URL.createObjectURL(await response.blob());
    try {
        return await analyse(blobUrl, onProgress);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}
