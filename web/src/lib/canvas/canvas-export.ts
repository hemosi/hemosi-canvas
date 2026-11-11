import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { collectNodeFiles, nodeTextContent } from "@/lib/canvas/canvas-node-ops";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultProjectName")) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            await Promise.all(
                collectStorageKeys(project).map(async (storageKey) => {
                    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) return;
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

/**
 * Download the chosen nodes' results as one zip: original image/video/audio files, texts, and 文本汇总.md.
 * Shots (and nodes fed directly by a shot) are named by shot number, e.g. S03_镜头 3-图.png, sorted by shot.
 */
export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName"), graph?: { nodes: CanvasNodeData[]; connections: CanvasConnection[] }) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || i18n.t("canvas.export.item");
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };
    const shotNoOf = (node: CanvasNodeData) => {
        if (node.type === HemosiNodeType.Shot) return node.metadata?.shotNo;
        const upstream = graph?.connections.filter((connection) => connection.toNodeId === node.id).map((connection) => graph.nodes.find((item) => item.id === connection.fromNodeId)).find((item) => item?.type === HemosiNodeType.Shot);
        return upstream?.metadata?.shotNo;
    };
    const ordered = nodes
        .filter((node) => node.type !== CanvasNodeType.Group)
        .map((node, index) => ({ node, index, shotNo: shotNoOf(node) }))
        .sort((a, b) => (a.shotNo ?? Number.MAX_SAFE_INTEGER) - (b.shotNo ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
    const summary: string[] = [`# ${fileName}`, ""];
    for (const { node, shotNo } of ordered) {
        const prefix = shotNo !== undefined ? `S${String(shotNo).padStart(2, "0")}_` : "";
        const title = node.title || node.type;
        const files = await collectNodeFiles(node);
        const names: string[] = [];
        for (const file of files) {
            if (file.ext === "txt" && node.type !== CanvasNodeType.Text) continue; // shot/anchor text goes into the summary
            const name = uniqueName(`${prefix}${title}${file.base}`, file.ext);
            names.push(name);
            zipFiles.push({ name, data: file.data });
        }
        const text = nodeTextContent(node);
        if (!files.length && !text) {
            const name = uniqueName(`${prefix}${title}`, "json");
            names.push(name);
            zipFiles.push({ name, data: JSON.stringify(node, null, 2) });
        }
        summary.push(`## ${shotNo !== undefined ? `镜头 ${shotNo} · ` : ""}${title}`, "", text || "（无文字）", "", ...(names.length ? [`文件：${names.join("、")}`, ""] : []));
    }
    zipFiles.push({ name: uniqueName("文本汇总", "md"), data: summary.join("\n") });

    const zip = await createZip(zipFiles);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
