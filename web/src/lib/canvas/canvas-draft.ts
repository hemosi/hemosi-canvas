import { computeMediaSize, computeVideoSize, inferMediaRatio, inferVideoRatio, parsePixelSize, VIDEO_SECONDS_MIN } from "@/lib/media-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

export function isDraftMode(mode: CanvasGenerationMode): mode is "image" | "video" {
    return mode === "image" || mode === "video";
}

/**
 * Cheapest variant of a request config, built only from the existing parameter presets:
 * images use the 1k size preset, low quality and a single image; videos use 480p and the shortest duration.
 */
export function applyDraftConfig(config: AiConfig, mode: CanvasGenerationMode): AiConfig {
    if (mode === "image") {
        const pixels = parsePixelSize(config.size);
        let size = config.size;
        if (pixels) {
            const preset = parsePixelSize(computeMediaSize("1k", inferMediaRatio(config.size)) || "");
            if (preset && preset.width * preset.height < pixels.width * pixels.height) size = `${preset.width}x${preset.height}`;
        }
        return { ...config, size, quality: "low", count: "1" };
    }
    if (mode === "video") {
        const size = parsePixelSize(config.size) ? computeVideoSize("480", inferVideoRatio(config.size)) : config.size;
        return { ...config, size, vquality: "480", videoSeconds: String(VIDEO_SECONDS_MIN) };
    }
    return config;
}
