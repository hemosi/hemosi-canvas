import { computeMediaSize, computeVideoSize, inferMediaRatio, inferVideoRatio, parsePixelSize, VIDEO_SECONDS_MIN } from "@/lib/media-size";
import { getNodeDefinition, isBuiltinNodeType } from "@/lib/canvas/node-registry";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasBuiltinPanelParam } from "@/types/canvas-plugin";
import type { CanvasGenerationMode, CanvasNodeData } from "@/types/canvas";

export const ALL_DRAFT_PARAMS: CanvasBuiltinPanelParam[] = ["size", "quality", "resolution", "duration"];

export function isDraftMode(mode: CanvasGenerationMode): mode is "image" | "video" {
    return mode === "image" || mode === "video";
}

/**
 * Params the 草稿 switch may change for a node, or null when the node has no draft switch.
 * Built-in nodes: all. Plugin nodes on the built-in panel: the size/quality/resolution/duration params they expose
 * (useBuiltinPanel.params, all when omitted); plugins without such params, or with their own panel, get none.
 */
export function draftParamsFor(node: CanvasNodeData | undefined, mode: CanvasGenerationMode): CanvasBuiltinPanelParam[] | null {
    if (!node || !isDraftMode(mode)) return null;
    if (isBuiltinNodeType(node.type)) return ALL_DRAFT_PARAMS;
    const panel = getNodeDefinition(node.type)?.useBuiltinPanel;
    if (!panel || panel.mode !== mode) return null;
    const params = (panel.params ?? ALL_DRAFT_PARAMS).filter((param) => ALL_DRAFT_PARAMS.includes(param));
    return params.length ? params : null;
}

/** Plugin nodes on the built-in panel can hide the settings popover with useBuiltinPanel.params = []. */
export function showsBuiltinParams(node: CanvasNodeData) {
    if (isBuiltinNodeType(node.type)) return true;
    const params = getNodeDefinition(node.type)?.useBuiltinPanel?.params;
    return !params || params.length > 0;
}

/**
 * Cheapest variant of a request config, built only from the existing parameter presets:
 * images use the 1k size preset, low quality and a single image; videos use 480p and the shortest duration.
 * `params` limits which of these are changed (plugin nodes only expose some of them).
 */
export function applyDraftConfig(config: AiConfig, mode: CanvasGenerationMode, params: CanvasBuiltinPanelParam[] = ALL_DRAFT_PARAMS): AiConfig {
    const has = (param: CanvasBuiltinPanelParam) => params.includes(param);
    if (mode === "image") {
        const pixels = parsePixelSize(config.size);
        let size = config.size;
        if (pixels && (has("size") || has("resolution"))) {
            const preset = parsePixelSize(computeMediaSize("1k", inferMediaRatio(config.size)) || "");
            if (preset && preset.width * preset.height < pixels.width * pixels.height) size = `${preset.width}x${preset.height}`;
        }
        return { ...config, size, ...(has("quality") ? { quality: "low" } : {}), count: "1" };
    }
    if (mode === "video") {
        const size = (has("size") || has("resolution")) && parsePixelSize(config.size) ? computeVideoSize("480", inferVideoRatio(config.size)) : config.size;
        return {
            ...config,
            size,
            ...(has("quality") || has("resolution") ? { vquality: "480" } : {}),
            ...(has("duration") ? { videoSeconds: String(VIDEO_SECONDS_MIN) } : {}),
        };
    }
    return config;
}
