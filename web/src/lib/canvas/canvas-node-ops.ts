import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeStatus } from "@/types/canvas";

export const COLLAPSED_NODE_HEIGHT = 48;

export type NodeStatusBadge = "loading" | "success" | "error" | "draft" | null;

/** One status for the node's corner badge: 生成中 / 成功 / 失败 / 草稿. Success only shows on generated results. */
export function nodeStatusBadge(node: CanvasNodeData): NodeStatusBadge {
    const meta = node.metadata || {};
    const statuses: (CanvasNodeStatus | undefined)[] = [meta.status, meta.shotStatus?.image, meta.shotStatus?.video, ...(meta.images || []).map((image) => image.status)];
    if (statuses.includes("loading")) return "loading";
    if (meta.status === "error" || meta.shotStatus?.image === "error" || meta.shotStatus?.video === "error") return "error";
    if (meta.draftResult) return "draft";
    const generated = Boolean(meta.generationSourceId || meta.shotImage || meta.shotVideo || (meta.model && meta.content));
    return meta.status === "success" && generated ? "success" : generated && (meta.shotStatus?.image === "success" || meta.shotStatus?.video === "success") ? "success" : null;
}

export function toggleNodeCollapsed(node: CanvasNodeData): CanvasNodeData {
    if (node.metadata?.collapsed) return { ...node, height: node.metadata.expandedHeight || node.height, metadata: { ...node.metadata, collapsed: false, expandedHeight: undefined } };
    return { ...node, height: COLLAPSED_NODE_HEIGHT, metadata: { ...node.metadata, collapsed: true, expandedHeight: node.height } };
}

export function newNodeId(type: string) {
    return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Copy one node next to itself; withConnections also re-creates its incoming and outgoing links on the copy. */
export function duplicateNodeWithLinks(source: CanvasNodeData, connections: CanvasConnection[], withConnections: boolean) {
    const id = newNodeId(source.type);
    const node: CanvasNodeData = { ...source, id, title: `${source.title} 副本`, position: { x: source.position.x + 36, y: source.position.y + 36 }, metadata: { ...source.metadata, locked: false } };
    const links = withConnections
        ? connections.flatMap((connection) =>
              connection.toNodeId === source.id ? [{ ...connection, id: nanoid(), toNodeId: id }] : connection.fromNodeId === source.id ? [{ ...connection, id: nanoid(), fromNodeId: id }] : [],
          )
        : [];
    return { node, connections: links };
}

/** Connections that would be cut when the given nodes are deleted. */
export function connectionsTouching(ids: Set<string>, connections: CanvasConnection[]) {
    return connections.filter((connection) => ids.has(connection.fromNodeId) || ids.has(connection.toNodeId));
}

function extensionFor(mimeType: string, fallback: string) {
    const sub = mimeType.split("/")[1]?.split(";")[0] || "";
    if (sub === "jpeg") return "jpg";
    if (sub === "mpeg") return "mp3";
    if (sub === "x-wav") return "wav";
    return sub || fallback;
}

async function blobFor(content: string, storageKey?: string) {
    if (storageKey) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (blob) return blob;
    }
    if (!content) return null;
    return (await fetch(content)).blob();
}

/** The node's text summary used for downloads and text exports. */
export function nodeTextContent(node: CanvasNodeData) {
    const meta = node.metadata || {};
    if (node.type === CanvasNodeType.Text) return meta.content || meta.prompt || "";
    if (node.type === HemosiNodeType.Shot) return [`镜头 ${meta.shotNo ?? ""}`, meta.shotDescription ? `画面：${meta.shotDescription}` : "", meta.prompt ? `提示词：${meta.prompt}` : ""].filter(Boolean).join("\n");
    if (node.type === HemosiNodeType.Anchor) return meta.anchorText || "";
    return meta.prompt || "";
}

/** The original files of a node (image/video/audio), or its text. */
export async function collectNodeFiles(node: CanvasNodeData): Promise<{ base: string; ext: string; data: Blob | string }[]> {
    const meta = node.metadata || {};
    const files: { base: string; ext: string; data: Blob | string }[] = [];
    const push = async (suffix: string, content: string | undefined, storageKey: string | undefined, fallbackExt: string) => {
        if (!content && !storageKey) return;
        const blob = await blobFor(content || "", storageKey).catch(() => null);
        if (blob) files.push({ base: suffix, ext: extensionFor(blob.type, fallbackExt), data: blob });
    };
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
        await push("", meta.content, meta.storageKey, node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? "mp3" : "png");
    } else if (node.type === HemosiNodeType.Shot) {
        await push("-图", meta.shotImage?.content, meta.shotImage?.storageKey, "png");
        await push("-视频", meta.shotVideo?.content, meta.shotVideo?.storageKey, "mp4");
    } else if (node.type === HemosiNodeType.Anchor) {
        for (const [index, image] of (meta.anchorImages || []).entries()) await push(`-${index + 1}`, image.content, image.storageKey, "png");
    } else if (meta.content && !meta.content.startsWith("data:") && node.type !== CanvasNodeType.Text) {
        // plugin nodes with media content
        await push("", meta.content, meta.storageKey, "bin");
    }
    const text = nodeTextContent(node);
    if (text && (node.type === CanvasNodeType.Text || node.type === HemosiNodeType.Shot || node.type === HemosiNodeType.Anchor)) files.push({ base: node.type === CanvasNodeType.Text ? "" : "-文字", ext: "txt", data: text });
    return files;
}

function safeName(value: string) {
    return value.replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 60);
}

/** Download a node's original content: one file directly, several as separate downloads. */
export async function downloadNodeContent(node: CanvasNodeData) {
    const files = await collectNodeFiles(node);
    files.forEach((file) => saveAs(typeof file.data === "string" ? new Blob([file.data], { type: "text/plain;charset=utf-8" }) : file.data, `${safeName(node.title || node.type)}${file.base}.${file.ext}`));
    return files.length;
}

const textSelections = new Map<string, { text: string; at: number }>();
/** Remember the text selected in a text node right before its editor closed (toolbar clicks close the editor first). */
export function rememberTextSelection(nodeId: string, text: string) {
    textSelections.set(nodeId, { text, at: Date.now() });
}
export function takeTextSelection(nodeId: string) {
    const entry = textSelections.get(nodeId);
    textSelections.delete(nodeId);
    return entry && Date.now() - entry.at < 15_000 ? entry.text : "";
}

/** Keep the previous text as a version when an edit starts more than 30 s after the last saved version. */
export function withTextVersion(node: CanvasNodeData, nextContent: string): CanvasNodeData["metadata"] {
    const meta = node.metadata || {};
    const previous = meta.content || "";
    const versions = meta.textVersions || [];
    const last = versions[versions.length - 1];
    const stale = !last || Date.now() - new Date(last.createdAt).getTime() > 30_000;
    if (!previous.trim() || previous === nextContent || !stale || last?.content === previous) return { ...meta, content: nextContent };
    return { ...meta, content: nextContent, textVersions: [...versions, { id: nanoid(), createdAt: new Date().toISOString(), content: previous }] };
}

export function restoreTextVersion(node: CanvasNodeData, versionId: string): CanvasNodeData {
    const meta = node.metadata || {};
    const version = meta.textVersions?.find((item) => item.id === versionId);
    if (!version) return node;
    const current = meta.content || "";
    const versions = [...(meta.textVersions || []).filter((item) => item.id !== versionId), ...(current.trim() ? [{ id: nanoid(), createdAt: new Date().toISOString(), content: current }] : [])];
    return { ...node, metadata: { ...meta, content: version.content, textVersions: versions, texts: meta.texts?.map((text) => (text.id === meta.primaryTextId ? { ...text, content: version.content } : text)) } };
}
