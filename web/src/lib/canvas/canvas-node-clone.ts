import type { CanvasNodeMetadata } from "@/types/canvas";

/** Metadata keys that hold generated media or a running task rather than the node's prompt and parameters. */
const GENERATED_KEYS = ["storageKey", "images", "primaryImageId", "naturalWidth", "naturalHeight", "bytes", "mimeType", "durationMs", "videoTaskId", "videoTaskProvider", "errorDetails", "texts", "primaryTextId", "draftResult"] as const;

/** Copy of node metadata with generated media removed; keeps prompts, params and structure. */
export function stripGeneratedResult(metadata: CanvasNodeMetadata | undefined, options: { keepTextContent?: boolean } = {}): CanvasNodeMetadata {
    const next: CanvasNodeMetadata = { ...(metadata || {}) };
    for (const key of GENERATED_KEYS) delete next[key];
    if (!options.keepTextContent) next.content = "";
    next.status = "idle";
    return next;
}
