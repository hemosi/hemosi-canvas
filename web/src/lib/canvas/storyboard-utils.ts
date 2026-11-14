import { nanoid } from "nanoid";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { allocateRefId } from "@/lib/canvas/node-ref-id";
import type { SettingItem, SettingKind, StoryboardData, StoryboardRow } from "@/lib/canvas/storyboard-types";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type NodeHealth = "error" | "running" | "idle" | "stale" | "ok";

export const AT_TOKEN_RE = /@(R\d+|S\d+|P\d+|图\d+|视\d+|文\d+|音\d+|S\d{2,})/g;

export { DEFAULT_IMAGE_MODEL_RULE, DEFAULT_VIDEO_MODEL_RULE } from "@/lib/model-prompt-presets";

export type StoryboardModelPresets = {
    imageModel?: string;
    imageSize?: string;
    videoModel?: string;
    videoSize?: string;
};

export function createEmptyStoryboardData(): StoryboardData {
    return {
        schemaVersion: 1,
        // Empty = follow the prompt rule of the model picked in Settings; text here overrides it for this table only.
        imageModelRule: "",
        videoModelRule: "",
        settings: [],
        rows: [],
    };
}

export function nextSettingId(kind: SettingKind, settings: SettingItem[]): string {
    const prefix = kind === "person" ? "R" : kind === "scene" ? "S" : "P";
    const max = settings.reduce((acc, item) => {
        if (!item.id.startsWith(prefix)) return acc;
        const n = Number(item.id.slice(prefix.length));
        return Number.isInteger(n) && n > acc ? n : acc;
    }, 0);
    return `${prefix}${max + 1}`;
}

export function nextShotCode(rows: StoryboardRow[]): string {
    const max = rows.reduce((acc, row) => {
        const m = /^S(\d+)$/i.exec(row.code.trim());
        if (!m) return acc;
        const n = Number(m[1]);
        return Number.isInteger(n) && n > acc ? n : acc;
    }, 0);
    return `S${String(max + 1).padStart(2, "0")}`;
}

export function extractAtTokens(text: string): string[] {
    if (!text) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const match of text.matchAll(AT_TOKEN_RE)) {
        const token = match[1];
        if (!seen.has(token)) {
            seen.add(token);
            out.push(token);
        }
    }
    return out;
}

export function computeInputsHash(parts: unknown[]): string {
    const raw = JSON.stringify(parts);
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

export function deriveNodeHealth(node: CanvasNodeData | undefined): NodeHealth {
    if (!node) return "idle";
    const status = node.metadata?.status;
    if (status === "error") return "error";
    if (status === "loading") return "running";
    const hasContent = Boolean(node.metadata?.content);
    if (!hasContent) return "idle";
    if (
        node.metadata?.generatedInputsHash &&
        node.metadata?.inputsHash &&
        node.metadata.generatedInputsHash !== node.metadata.inputsHash
    ) {
        return "stale";
    }
    return "ok";
}

/** A row's first-frame and video health; a video made from a stale first frame is stale too. */
export function rowHealth(row: StoryboardRow, nodeMap: Map<string, CanvasNodeData>): { image: NodeHealth; video: NodeHealth } {
    const image = deriveNodeHealth(nodeMap.get(row.imageNodeId));
    const video = deriveNodeHealth(nodeMap.get(row.videoNodeId));
    return { image, video: video === "ok" && image === "stale" ? "stale" : video };
}

/** Signature of every setting image's current picture; when it changes, the rows using them must be re-hashed (过期). */
export function settingImagesSignature(settings: SettingItem[], nodes: CanvasNodeData[]): string {
    const map = new Map(nodes.map((n) => [n.id, n]));
    return computeInputsHash(collectStoryboardSettingImageIds(settings, nodes).map((id) => `${id}:${map.get(id)?.metadata?.storageKey || map.get(id)?.metadata?.content || ""}`));
}

export function resolveRowReferenceImageNodeIds(
    row: StoryboardRow,
    settings: SettingItem[],
    nodes: CanvasNodeData[],
): string[] {
    const refToNode = new Map<string, CanvasNodeData>();
    for (const node of nodes) {
        if (node.metadata?.refId) refToNode.set(node.metadata.refId, node);
    }
    const settingMap = new Map(settings.map((s) => [s.id, s]));
    const combined = [row.refs, row.staticScreen, row.action, row.imgPrompt, row.vidPrompt].join(" ");
    const tokens = extractAtTokens(combined);
    const result: string[] = [];
    const pushNode = (node: CanvasNodeData | undefined) => {
        if (node && node.type === CanvasNodeType.Image && !result.includes(node.id)) {
            result.push(node.id);
        }
    };
    for (const token of tokens) {
        pushNode(refToNode.get(token));
        const setting = settingMap.get(token);
        if (setting) {
            for (const subToken of extractAtTokens(setting.desc)) {
                pushNode(refToNode.get(subToken));
            }
        }
    }
    return result;
}

export function collectStoryboardSettingImageIds(settings: SettingItem[], nodes: CanvasNodeData[]): string[] {
    const refToNode = new Map<string, CanvasNodeData>();
    for (const node of nodes) {
        if (node.metadata?.refId) refToNode.set(node.metadata.refId, node);
    }
    const ids: string[] = [];
    for (const setting of settings) {
        for (const token of extractAtTokens(setting.desc)) {
            const node = refToNode.get(token);
            if (node && node.type === CanvasNodeType.Image && !ids.includes(node.id)) {
                ids.push(node.id);
            }
        }
    }
    return ids;
}

export function computeStoryboardLayout(
    storyboardNode: CanvasNodeData,
    data: StoryboardData,
    nodes: CanvasNodeData[],
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const sbX = storyboardNode.position.x;
    const sbY = storyboardNode.position.y;
    const sbW = storyboardNode.width;

    const settingImgIds = collectStoryboardSettingImageIds(data.settings, nodes);
    settingImgIds.forEach((id, idx) => {
        const node = nodeMap.get(id);
        if (!node || node.metadata?.manualPos) return;
        positions.set(id, { x: sbX - 300, y: sbY + idx * 240 });
    });

    const imgColX = sbX + sbW + 100;
    const vidColX = sbX + sbW + 420;
    data.rows.forEach((row, idx) => {
        const y = sbY + idx * 230;
        const imgNode = nodeMap.get(row.imageNodeId);
        if (imgNode && !imgNode.metadata?.manualPos) {
            positions.set(imgNode.id, { x: imgColX, y });
        }
        const vidNode = nodeMap.get(row.videoNodeId);
        if (vidNode && !vidNode.metadata?.manualPos) {
            positions.set(vidNode.id, { x: vidColX, y });
        }
    });

    return positions;
}

export function syncStoryboardConnections(
    storyboardNodeId: string,
    data: StoryboardData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): CanvasConnection[] {
    const managedTargets = new Set<string>();
    for (const row of data.rows) {
        if (row.imageNodeId) managedTargets.add(row.imageNodeId);
        if (row.videoNodeId) managedTargets.add(row.videoNodeId);
    }

    const kept = connections.filter((conn) => {
        if (conn.fromNodeId === storyboardNodeId && managedTargets.has(conn.toNodeId)) return false;
        if (managedTargets.has(conn.toNodeId)) return false;
        return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const added: CanvasConnection[] = [];
    const seenEdge = new Set(kept.map((c) => `${c.fromNodeId}->${c.toNodeId}:${c.kind || "reference"}`));
    const pushEdge = (fromNodeId: string, toNodeId: string, kind: CanvasConnection["kind"]) => {
        if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return;
        const key = `${fromNodeId}->${toNodeId}:${kind || "reference"}`;
        if (seenEdge.has(key)) return;
        seenEdge.add(key);
        added.push({ id: nanoid(), fromNodeId, toNodeId, kind });
    };

    for (const row of data.rows) {
        if (row.imageNodeId) {
            pushEdge(storyboardNodeId, row.imageNodeId, "input");
            const refImgIds = resolveRowReferenceImageNodeIds(row, data.settings, nodes);
            for (const refId of refImgIds) {
                pushEdge(refId, row.imageNodeId, "reference");
            }
        }
        if (row.imageNodeId && row.videoNodeId) {
            pushEdge(row.imageNodeId, row.videoNodeId, "reference");
        }
    }

    return [...kept, ...added];
}

export function reconcileStoryboardGraph(params: {
    storyboardNodeId: string;
    data: StoryboardData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    refCounters?: Record<string, number>;
    autoLayout?: boolean;
    modelPresets?: StoryboardModelPresets;
}): {
    data: StoryboardData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    refCounters: Record<string, number>;
} {
    let nextCounters = { ...(params.refCounters || {}) };
    let nextNodes = [...params.nodes];
    const nodeMap = () => new Map(nextNodes.map((n) => [n.id, n]));
    // The table's ratio is the default for new nodes; a size a node already has is never overwritten.
    const ratio = params.modelPresets?.imageSize || params.modelPresets?.videoSize || params.data.aspectRatio;
    const presets: StoryboardModelPresets | undefined = { ...params.modelPresets, imageSize: params.modelPresets?.imageSize || ratio, videoSize: params.modelPresets?.videoSize || ratio };

    const sbNode = nodeMap().get(params.storyboardNodeId);
    if (!sbNode) {
        return { data: params.data, nodes: nextNodes, connections: params.connections, refCounters: nextCounters };
    }

    // 1. Ensure each setting has a bound @图n image node if none exists yet
    const nextSettings: SettingItem[] = params.data.settings.map((setting) => {
        const hasImageRef = extractAtTokens(setting.desc).some((tok) =>
            nextNodes.some((n) => n.type === CanvasNodeType.Image && n.metadata?.refId === tok),
        );
        if (hasImageRef) return setting;

        const allocated = allocateRefId(CanvasNodeType.Image, nextNodes, nextCounters);
        nextCounters = allocated.nextCounters;
        const created = createCanvasNode(
            CanvasNodeType.Image,
            { x: sbNode.position.x - 180, y: sbNode.position.y + 120 },
            {
                refId: allocated.refId,
                prompt: setting.desc || setting.name,
                imageRole: setting.kind === "person" ? "character" : setting.kind === "scene" ? "scene" : "reference",
                ...(presets?.imageModel ? { model: presets.imageModel } : {}),
                ...(presets?.imageSize ? { size: presets.imageSize } : {}),
            },
        );
        created.title = setting.name || setting.id;
        nextNodes.push(created);
        const nextDesc = setting.desc.trim() ? `${setting.desc.trim()} @${allocated.refId}` : `@${allocated.refId}`;
        return { ...setting, desc: nextDesc };
    });

    // 2. Ensure each row has downstream imageNodeId & videoNodeId and sync prompt/seconds/inputsHash
    const nextRows: StoryboardRow[] = params.data.rows.map((row) => {
        let map = nodeMap();
        let imageNodeId = row.imageNodeId;
        let videoNodeId = row.videoNodeId;

        if (!imageNodeId || !map.has(imageNodeId)) {
            const allocated = allocateRefId(CanvasNodeType.Image, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const created = createCanvasNode(
                CanvasNodeType.Image,
                { x: sbNode.position.x + sbNode.width + 220, y: sbNode.position.y + 120 },
                {
                    refId: allocated.refId,
                    prompt: row.imgPrompt,
                    imageRole: "firstFrame",
                    ...(presets?.imageModel ? { model: presets.imageModel } : {}),
                    ...(presets?.imageSize ? { size: presets.imageSize } : {}),
                },
            );
            created.title = `${row.code} · 首帧图`;
            nextNodes.push(created);
            imageNodeId = created.id;
        }

        if (!videoNodeId || !map.has(videoNodeId)) {
            const allocated = allocateRefId(CanvasNodeType.Video, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const created = createCanvasNode(
                CanvasNodeType.Video,
                { x: sbNode.position.x + sbNode.width + 540, y: sbNode.position.y + 120 },
                {
                    refId: allocated.refId,
                    prompt: row.vidPrompt,
                    seconds: String(row.duration || 5),
                    ...(presets?.videoModel ? { model: presets.videoModel, videoModel: presets.videoModel } : {}),
                    ...(presets?.videoSize ? { size: presets.videoSize } : {}),
                },
            );
            created.title = `${row.code} · 视频`;
            nextNodes.push(created);
            videoNodeId = created.id;
        }

        const updatedRow: StoryboardRow = { ...row, imageNodeId, videoNodeId };
        const refImgIds = resolveRowReferenceImageNodeIds(updatedRow, nextSettings, nextNodes);
        map = nodeMap();
        const refImgKeys = refImgIds.map((id) => {
            const n = map.get(id);
            return `${id}:${n?.metadata?.storageKey || n?.metadata?.content || ""}`;
        });

        const imgNode = map.get(imageNodeId);
        const imgModel = presets?.imageModel || imgNode?.metadata?.model || "";
        const imgSize = imgNode?.metadata?.size || presets?.imageSize || "";
        const imgPromptToUse = imgNode?.metadata?.manualPrompt ? (imgNode.metadata.prompt || "") : row.imgPrompt;
        const expectedImgHash = computeInputsHash([imgPromptToUse, refImgKeys, imgModel, imgSize]);

        const vidNode = map.get(videoNodeId);
        const vidModel = presets?.videoModel || vidNode?.metadata?.model || "";
        const vidSize = vidNode?.metadata?.size || presets?.videoSize || "";
        const vidPromptToUse = vidNode?.metadata?.manualPrompt ? (vidNode.metadata.prompt || "") : row.vidPrompt;
        const firstFrameKey = imgNode?.metadata?.storageKey || imgNode?.metadata?.content || "";
        const expectedVidHash = computeInputsHash([vidPromptToUse, firstFrameKey, vidModel, String(row.duration || 5), vidSize]);

        nextNodes = nextNodes.map((n) => {
            if (n.id === imageNodeId) {
                return {
                    ...n,
                    title: `${row.code} · 首帧图`,
                    metadata: {
                        ...n.metadata,
                        imageRole: "firstFrame",
                        ...(presets?.imageModel ? { model: presets.imageModel } : {}),
                        ...(presets?.imageSize && !n.metadata?.size ? { size: presets.imageSize } : {}),
                        ...(n.metadata?.manualPrompt ? {} : { prompt: row.imgPrompt }),
                        inputsHash: expectedImgHash,
                    },
                };
            }
            if (n.id === videoNodeId) {
                return {
                    ...n,
                    title: `${row.code} · 视频`,
                    metadata: {
                        ...n.metadata,
                        seconds: String(row.duration || 5),
                        ...(presets?.videoModel ? { model: presets.videoModel, videoModel: presets.videoModel } : {}),
                        ...(presets?.videoSize && !n.metadata?.size ? { size: presets.videoSize } : {}),
                        ...(n.metadata?.manualPrompt ? {} : { prompt: row.vidPrompt }),
                        inputsHash: expectedVidHash,
                    },
                };
            }
            return n;
        });

        return updatedRow;
    });

    const nextData: StoryboardData = {
        ...params.data,
        settings: nextSettings,
        rows: nextRows,
    };

    // 3. Update storyboard node itself
    nextNodes = nextNodes.map((n) =>
        n.id === params.storyboardNodeId ? { ...n, metadata: { ...n.metadata, storyboard: nextData } } : n,
    );

    // 4. Auto-layout if requested
    if (params.autoLayout) {
        const latestSb = nextNodes.find((n) => n.id === params.storyboardNodeId) || sbNode;
        const layout = computeStoryboardLayout(latestSb, nextData, nextNodes);
        if (layout.size > 0) {
            nextNodes = nextNodes.map((n) => {
                const pos = layout.get(n.id);
                return pos ? { ...n, position: pos } : n;
            });
        }
    }

    // 5. Sync connections
    const nextConnections = syncStoryboardConnections(params.storyboardNodeId, nextData, nextNodes, params.connections);

    return {
        data: nextData,
        nodes: nextNodes,
        connections: nextConnections,
        refCounters: nextCounters,
    };
}
