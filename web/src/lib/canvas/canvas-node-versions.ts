import { nanoid } from "nanoid";

import { CanvasNodeType, HemosiNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeVersion } from "@/types/canvas";

/** Snapshot of a node's current result, or null when it has none (image/video/audio nodes, shot image/video). */
export function snapshotResult(node: CanvasNodeData, kind?: "image" | "video"): CanvasNodeVersion | null {
    const meta = node.metadata || {};
    const base = { id: nanoid(), createdAt: new Date().toISOString(), prompt: meta.prompt, model: meta.model, draft: meta.draftResult };
    if (node.type === HemosiNodeType.Shot) {
        const media = kind === "video" ? meta.shotVideo : meta.shotImage;
        if (!media?.content) return null;
        return { ...base, kind: kind === "video" ? "video" : "image", content: media.content, storageKey: media.storageKey, mimeType: media.mimeType, naturalWidth: media.naturalWidth, naturalHeight: media.naturalHeight, bytes: media.bytes, model: kind === "video" ? meta.videoModel || meta.model : meta.model };
    }
    if (!meta.content || (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio)) return null;
    return { ...base, kind: node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image", content: meta.content, storageKey: meta.storageKey, mimeType: meta.mimeType, naturalWidth: meta.naturalWidth, naturalHeight: meta.naturalHeight, bytes: meta.bytes, durationMs: meta.durationMs };
}

const sameMedia = (a?: CanvasNodeVersion | null, b?: CanvasNodeVersion | null) => Boolean(a && b && (a.storageKey ? a.storageKey === b.storageKey : a.content === b.content));

/** Keep the node's previous result as a version before it is replaced. Every version is kept until the user deletes it. */
export function withPreviousVersion(previous: CanvasNodeData | undefined, nextMeta: CanvasNodeMetadata, kind?: "image" | "video"): CanvasNodeMetadata {
    const snapshot = previous ? snapshotResult(previous, kind) : null;
    const versions = nextMeta.versions || previous?.metadata?.versions || [];
    if (!snapshot || versions.some((version) => sameMedia(version, snapshot))) return { ...nextMeta, versions };
    return { ...nextMeta, versions: [...versions, snapshot] };
}

/** Make a version current again; the result it replaces becomes a version so nothing is lost. */
export function restoreVersion(node: CanvasNodeData, versionId: string): CanvasNodeData {
    const meta = node.metadata || {};
    const version = meta.versions?.find((item) => item.id === versionId);
    if (!version) return node;
    const current = snapshotResult(node, version.kind === "video" ? "video" : "image");
    const versions = [...(meta.versions || []).filter((item) => item.id !== versionId), ...(current ? [current] : [])];
    const media = { content: version.content, storageKey: version.storageKey, mimeType: version.mimeType, naturalWidth: version.naturalWidth, naturalHeight: version.naturalHeight, bytes: version.bytes };
    if (node.type === HemosiNodeType.Shot) {
        return { ...node, metadata: { ...meta, versions, ...(version.kind === "video" ? { shotVideo: { ...media, durationMs: version.durationMs } } : { shotImage: { id: version.id, status: "success" as const, ...media, content: version.content, naturalWidth: version.naturalWidth || 0, naturalHeight: version.naturalHeight || 0, bytes: version.bytes || 0, mimeType: version.mimeType || "" } }) } };
    }
    return { ...node, metadata: { ...meta, ...media, durationMs: version.durationMs, prompt: version.prompt ?? meta.prompt, draftResult: version.draft, versions, status: "success", images: undefined, primaryImageId: undefined } };
}

export function deleteVersion(node: CanvasNodeData, versionId: string): CanvasNodeData {
    return { ...node, metadata: { ...node.metadata, versions: (node.metadata?.versions || []).filter((item) => item.id !== versionId) } };
}
