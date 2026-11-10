import { withLocalProxy } from "@/stores/use-config-store";

export type VideoFramePosition = "first" | "last" | "current";

export async function captureVideoFrame(source: string, position: VideoFramePosition, currentTime: number) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
        const metadataLoaded = waitForVideo(video, "loadedmetadata");
        video.src = source;
        video.load();

        await metadataLoaded;
        const endTime = Math.max(0, video.duration - 0.001);
        const time = position === "first" ? 0 : position === "last" ? endTime : Math.min(currentTime, endTime);
        if (time) {
            const seeked = waitForVideo(video, "seeked");
            video.currentTime = time;
            await seeked;
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForVideo(video, "loadeddata");
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Failed to capture video frame"))), "image/png"));
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const finish = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            reject(new Error("Failed to read video frame"));
        };
        video.addEventListener(eventName, finish);
        video.addEventListener("error", fail);
    });
}

/** The frame could not be read because the video is cross-origin without CORS and could not be re-fetched. */
export class VideoFrameTaintedError extends Error {
    constructor() {
        super("Video frame is cross-origin and cannot be captured");
        this.name = "VideoFrameTaintedError";
    }
}

function isSecurityError(error: unknown) {
    return error instanceof DOMException && error.name === "SecurityError";
}

function drawElementFrame(video: HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    // toBlob throws SecurityError synchronously when the canvas is tainted by a cross-origin video.
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Failed to capture video frame"))), "image/png"));
}

/**
 * Capture a frame, trying in order: the on-canvas <video> element (current frame), an offscreen
 * crossOrigin=anonymous copy of the source, and finally a same-origin blob URL fetched through the local proxy.
 * Throws VideoFrameTaintedError when every path is blocked by CORS.
 */
export async function captureVideoFrameSafe(source: string, position: VideoFramePosition, element?: HTMLVideoElement | null) {
    const currentTime = element?.currentTime || 0;
    let tainted = false;
    if (position === "current" && element && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth) {
        try {
            return await drawElementFrame(element);
        } catch (error) {
            if (!isSecurityError(error)) throw error;
            tainted = true;
        }
    }
    try {
        return await captureVideoFrame(source, position, currentTime);
    } catch (error) {
        if (isSecurityError(error)) tainted = true;
    }
    if (/^(blob|data):/i.test(source)) {
        if (tainted) throw new VideoFrameTaintedError();
        throw new Error("Failed to read video frame");
    }
    let blobUrl = "";
    try {
        const response = await fetch(withLocalProxy(source));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        blobUrl = URL.createObjectURL(await response.blob());
    } catch {
        throw new VideoFrameTaintedError();
    }
    try {
        return await captureVideoFrame(blobUrl, position, currentTime);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}
