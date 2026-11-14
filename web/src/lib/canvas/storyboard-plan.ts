import { nanoid } from "nanoid";
import { z } from "zod";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { allocateRefId } from "@/lib/canvas/node-ref-id";
import { SettingKindSchema, type SettingItem, type StoryboardData, type StoryboardRow } from "@/lib/canvas/storyboard-types";
import {
    extractAtTokens,
    nextSettingId,
    nextShotCode,
    reconcileStoryboardGraph,
    type StoryboardModelPresets,
} from "@/lib/canvas/storyboard-utils";
import { requestImageQuestion, uploadGeminiFile, type AiTextMessage } from "@/services/api/image";
import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export const RowInputSchema = z.object({
    code: z.string().optional(),
    duration: z.number().positive().default(5),
    shotSize: z.string().default(""),
    move: z.string().default(""),
    staticScreen: z.string().default(""),
    action: z.string().default(""),
    line: z.string().default(""),
    sfx: z.string().default(""),
    refs: z.string().default(""),
    note: z.string().default(""),
    imgPrompt: z.string().default(""),
    vidPrompt: z.string().default(""),
});
export type RowInput = z.infer<typeof RowInputSchema>;

export const ChangeSchema = z.discriminatedUnion("kind", [
    z.object({
        id: z.string().min(1),
        kind: z.literal("row.add"),
        at: z.number().int().nonnegative().optional(),
        row: RowInputSchema,
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("row.update"),
        rowId: z.string().min(1),
        patch: RowInputSchema.partial(),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("row.remove"),
        rowId: z.string().min(1),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("row.move"),
        rowId: z.string().min(1),
        to: z.number().int().nonnegative(),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("setting.add"),
        setting: z.object({
            kind: SettingKindSchema,
            name: z.string().min(1),
            desc: z.string().default(""),
        }),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("setting.update"),
        settingId: z.string().min(1),
        patch: z.object({
            name: z.string().optional(),
            desc: z.string().optional(),
        }),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("canvas.text.add"),
        title: z.string().default("文本"),
        content: z.string().min(1),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("canvas.image.add"),
        title: z.string().default("图片"),
        prompt: z.string().min(1),
        size: z.string().optional(),
        refs: z.string().default(""),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("canvas.video.add"),
        title: z.string().default("视频"),
        prompt: z.string().min(1),
        duration: z.number().positive().default(5),
        size: z.string().optional(),
        refs: z.string().default(""),
    }),
]);
export type Change = z.infer<typeof ChangeSchema>;
export type AgentMode = "canvas" | "storyboard";

export const PlanSchema = z.object({
    summary: z.string(),
    changes: z.array(ChangeSchema),
    suggestRun: z
        .object({
            rowIds: z.array(z.string()),
            kind: z.enum(["image", "video", "both"]),
        })
        .optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export type GhostPreviewNode = {
    key: string;
    kind: "setting-image" | "first-frame" | "video";
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fromX?: number;
    fromY?: number;
};

export type PlanDiff = {
    addedRowIds: string[];
    updatedRowIds: string[];
    removedRowIds: string[];
    addedSettingIds: string[];
    updatedSettingIds: string[];
    ghostNodes: GhostPreviewNode[];
};

function findRowIndex(rows: StoryboardRow[], rowIdOrCode: string): number {
    return rows.findIndex((r) => r.id === rowIdOrCode || r.code === rowIdOrCode);
}

export function previewPlan(
    data: StoryboardData,
    plan: Plan,
    enabledIds: Set<string>,
    nodes: CanvasNodeData[],
    storyboardNode?: CanvasNodeData,
): { next: StoryboardData; diff: PlanDiff; warnings: string[] } {
    let settings: SettingItem[] = data.settings.map((s) => ({ ...s }));
    let rows: StoryboardRow[] = data.rows.map((r) => ({ ...r }));
    const warnings: string[] = [];
    const diff: PlanDiff = {
        addedRowIds: [],
        updatedRowIds: [],
        removedRowIds: [],
        addedSettingIds: [],
        updatedSettingIds: [],
        ghostNodes: [],
    };
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    let removeCount = 0;

    for (const ch of plan.changes) {
        if (!enabledIds.has(ch.id)) continue;

        if (ch.kind === "setting.add") {
            const id = nextSettingId(ch.setting.kind, settings);
            settings.push({ id, kind: ch.setting.kind, name: ch.setting.name, desc: ch.setting.desc });
            diff.addedSettingIds.push(id);
            continue;
        }

        if (ch.kind === "setting.update") {
            const idx = settings.findIndex((s) => s.id === ch.settingId);
            if (idx < 0) {
                warnings.push(`设定 ${ch.settingId} 不存在`);
                continue;
            }
            settings[idx] = { ...settings[idx], ...ch.patch };
            diff.updatedSettingIds.push(ch.settingId);
            continue;
        }

        if (ch.kind === "row.add") {
            const code = ch.row.code?.trim() || nextShotCode(rows);
            const newRow: StoryboardRow = {
                id: `row-${ch.id}`,
                code,
                duration: ch.row.duration ?? 5,
                shotSize: ch.row.shotSize ?? "",
                move: ch.row.move ?? "",
                staticScreen: ch.row.staticScreen ?? "",
                action: ch.row.action ?? "",
                line: ch.row.line ?? "",
                sfx: ch.row.sfx ?? "",
                refs: ch.row.refs ?? "",
                note: ch.row.note ?? "",
                imgPrompt: ch.row.imgPrompt ?? "",
                vidPrompt: ch.row.vidPrompt ?? "",
                imageNodeId: "",
                videoNodeId: "",
            };
            const at = ch.at !== undefined ? Math.max(0, Math.min(rows.length, ch.at)) : rows.length;
            rows.splice(at, 0, newRow);
            diff.addedRowIds.push(newRow.id);
            continue;
        }

        if (ch.kind === "row.update") {
            const idx = findRowIndex(rows, ch.rowId);
            if (idx < 0) {
                warnings.push(`目标行 ${ch.rowId} 不存在`);
                continue;
            }
            const cur = rows[idx];
            const imgNode = nodeMap.get(cur.imageNodeId);
            const vidNode = nodeMap.get(cur.videoNodeId);
            const patch = { ...ch.patch };
            if (imgNode?.metadata?.manualPrompt && patch.imgPrompt !== undefined) {
                warnings.push(`跳过已手改首帧图提示词的 ${cur.code}`);
                delete patch.imgPrompt;
            }
            if (vidNode?.metadata?.manualPrompt && patch.vidPrompt !== undefined) {
                warnings.push(`跳过已手改视频提示词的 ${cur.code}`);
                delete patch.vidPrompt;
            }
            rows[idx] = { ...cur, ...patch };
            diff.updatedRowIds.push(cur.id);
            continue;
        }

        if (ch.kind === "row.remove") {
            const idx = findRowIndex(rows, ch.rowId);
            if (idx < 0) {
                warnings.push(`目标行 ${ch.rowId} 不存在`);
                continue;
            }
            diff.removedRowIds.push(rows[idx].id);
            rows.splice(idx, 1);
            removeCount++;
            continue;
        }

        if (ch.kind === "row.move") {
            const idx = findRowIndex(rows, ch.rowId);
            if (idx < 0) {
                warnings.push(`目标行 ${ch.rowId} 不存在`);
                continue;
            }
            const to = Math.max(0, Math.min(rows.length - 1, ch.to));
            const [moved] = rows.splice(idx, 1);
            rows.splice(to, 0, moved);
        }
    }

    if (removeCount > 3) {
        warnings.push(`本次将删除 ${removeCount} 行（超过 3 行），请确认`);
    }

    const settingIdSet = new Set(settings.map((s) => s.id));
    for (const row of rows) {
        for (const tok of extractAtTokens(`${row.refs} ${row.staticScreen} ${row.action}`)) {
            if (/^[RSP]\d+$/.test(tok) && !settingIdSet.has(tok)) {
                warnings.push(`${row.code} 引用了不存在的设定 @${tok}`);
            }
        }
    }

    if (storyboardNode) {
        const sbX = storyboardNode.position.x;
        const sbY = storyboardNode.position.y;
        const sbW = storyboardNode.width;
        diff.addedSettingIds.forEach((id, i) => {
            const s = settings.find((x) => x.id === id);
            diff.ghostNodes.push({
                key: `ghost-set-${id}`,
                kind: "setting-image",
                label: `${id} ${s?.name || ""}`,
                x: sbX - 300,
                y: sbY + (data.settings.length + i) * 240,
                width: 220,
                height: 180,
            });
        });
        rows.forEach((row, idx) => {
            if (!diff.addedRowIds.includes(row.id)) return;
            const y = sbY + idx * 230;
            diff.ghostNodes.push({
                key: `ghost-img-${row.id}`,
                kind: "first-frame",
                label: `${row.code} · 首帧图`,
                x: sbX + sbW + 100,
                y,
                width: 240,
                height: 180,
                fromX: sbX + sbW,
                fromY: sbY + Math.min(storyboardNode.height - 40, 120 + idx * 44),
            });
            diff.ghostNodes.push({
                key: `ghost-vid-${row.id}`,
                kind: "video",
                label: `${row.code} · 视频`,
                x: sbX + sbW + 420,
                y,
                width: 240,
                height: 180,
                fromX: sbX + sbW + 340,
                fromY: y + 90,
            });
        });
    }

    return {
        next: { ...data, settings, rows },
        diff,
        warnings: [...new Set(warnings)],
    };
}

export function applyCanvasPlan(params: {
    plan: Plan;
    enabledIds: Set<string>;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    refCounters?: Record<string, number>;
    modelPresets?: StoryboardModelPresets;
    anchorPosition?: { x: number; y: number };
}) {
    let nextNodes = [...params.nodes];
    let nextConnections = [...params.connections];
    let nextCounters = { ...(params.refCounters || {}) };
    const createdTasks: Array<{ nodeId: string; kind: "image" | "video"; label: string; prompt: string }> = [];
    const presets = params.modelPresets;

    const refToNode = new Map<string, CanvasNodeData>();
    for (const n of nextNodes) {
        if (n.metadata?.refId) refToNode.set(n.metadata.refId, n);
    }

    let offsetIdx = 0;
    for (const ch of params.plan.changes) {
        if (!params.enabledIds.has(ch.id)) continue;
        if (ch.kind !== "canvas.text.add" && ch.kind !== "canvas.image.add" && ch.kind !== "canvas.video.add") {
            continue;
        }

        const refTokens =
            ch.kind === "canvas.text.add"
                ? []
                : extractAtTokens(`${ch.refs || ""} ${ch.prompt || ""}`);
        const refNodes = refTokens
            .map((t) => refToNode.get(t))
            .filter((n): n is CanvasNodeData => Boolean(n));

        const baseAnchor = refNodes[0]
            ? { x: refNodes[0].position.x + refNodes[0].width + 120, y: refNodes[0].position.y }
            : params.anchorPosition || { x: 240, y: 180 };
        const pos = { x: baseAnchor.x, y: baseAnchor.y + offsetIdx * 260 };
        offsetIdx++;

        if (ch.kind === "canvas.text.add") {
            const allocated = allocateRefId(CanvasNodeType.Text, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const textId = nanoid();
            const created = createCanvasNode(CanvasNodeType.Text, pos, {
                refId: allocated.refId,
                content: ch.content,
                texts: [{ id: textId, content: ch.content, status: "success" }],
                primaryTextId: textId,
            });
            created.title = ch.title || "文本";
            nextNodes.push(created);
            refToNode.set(allocated.refId, created);
            continue;
        }

        if (ch.kind === "canvas.image.add") {
            const allocated = allocateRefId(CanvasNodeType.Image, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const created = createCanvasNode(CanvasNodeType.Image, pos, {
                refId: allocated.refId,
                prompt: ch.prompt,
                ...(presets?.imageModel ? { model: presets.imageModel } : {}),
                size: ch.size || presets?.imageSize || "9:16",
            });
            created.title = ch.title || "图片";
            nextNodes.push(created);
            refToNode.set(allocated.refId, created);
            for (const rn of refNodes) {
                if (rn.type === CanvasNodeType.Image) {
                    nextConnections.push({
                        id: nanoid(),
                        fromNodeId: rn.id,
                        toNodeId: created.id,
                        kind: "reference",
                    });
                }
            }
            createdTasks.push({
                nodeId: created.id,
                kind: "image",
                label: `@${allocated.refId} ${created.title}`,
                prompt: ch.prompt,
            });
            continue;
        }

        if (ch.kind === "canvas.video.add") {
            const allocated = allocateRefId(CanvasNodeType.Video, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const created = createCanvasNode(CanvasNodeType.Video, pos, {
                refId: allocated.refId,
                prompt: ch.prompt,
                seconds: String(ch.duration || 5),
                ...(presets?.videoModel ? { model: presets.videoModel, videoModel: presets.videoModel } : {}),
                size: ch.size || presets?.videoSize || "16:9",
            });
            created.title = ch.title || "视频";
            nextNodes.push(created);
            refToNode.set(allocated.refId, created);
            for (const rn of refNodes) {
                if (rn.type === CanvasNodeType.Image) {
                    nextConnections.push({
                        id: nanoid(),
                        fromNodeId: rn.id,
                        toNodeId: created.id,
                        kind: "reference",
                    });
                }
            }
            createdTasks.push({
                nodeId: created.id,
                kind: "video",
                label: `@${allocated.refId} ${created.title}`,
                prompt: ch.prompt,
            });
        }
    }

    return {
        nodes: nextNodes,
        connections: nextConnections,
        refCounters: nextCounters,
        createdTasks,
    };
}

export function applyPlan(params: {
    storyboardNodeId: string;
    data: StoryboardData;
    plan: Plan;
    enabledIds: Set<string>;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    refCounters?: Record<string, number>;
    removeOrphanDownstream?: boolean;
    modelPresets?: StoryboardModelPresets;
}) {
    const { next, diff, warnings } = previewPlan(params.data, params.plan, params.enabledIds, params.nodes);

    let nextNodes = [...params.nodes];
    let nextConnections = [...params.connections];

    if (params.removeOrphanDownstream && diff.removedRowIds.length > 0) {
        const removedSet = new Set(diff.removedRowIds);
        const orphanNodeIds = new Set<string>();
        for (const r of params.data.rows) {
            if (removedSet.has(r.id)) {
                if (r.imageNodeId) orphanNodeIds.add(r.imageNodeId);
                if (r.videoNodeId) orphanNodeIds.add(r.videoNodeId);
            }
        }
        nextNodes = nextNodes.filter((n) => !orphanNodeIds.has(n.id));
        nextConnections = nextConnections.filter(
            (c) => !orphanNodeIds.has(c.fromNodeId) && !orphanNodeIds.has(c.toNodeId),
        );
    }

    // Give rows added by this plan fresh unique IDs on commit; existing rows keep theirs.
    const addedRowIds = new Set(diff.addedRowIds);
    const finalRows = next.rows.map((r) => (addedRowIds.has(r.id) ? { ...r, id: `row-${nanoid(8)}` } : r));

    const reconciled = reconcileStoryboardGraph({
        storyboardNodeId: params.storyboardNodeId,
        data: { ...next, rows: finalRows },
        nodes: nextNodes,
        connections: nextConnections,
        refCounters: params.refCounters,
        autoLayout: true,
        modelPresets: params.modelPresets,
    });

    const canvasAdded = applyCanvasPlan({
        plan: params.plan,
        enabledIds: params.enabledIds,
        nodes: reconciled.nodes,
        connections: reconciled.connections,
        refCounters: reconciled.refCounters,
        modelPresets: params.modelPresets,
    });

    return {
        data: reconciled.data,
        nodes: canvasAdded.nodes,
        connections: canvasAdded.connections,
        refCounters: canvasAdded.refCounters,
        createdTasks: canvasAdded.createdTasks,
        warnings,
        diff,
    };
}

export type AgentHistoryTurn = {
    role: "user" | "assistant";
    text: string;
};

export function getNodeTextContent(n: CanvasNodeData): string {
    const texts = n.metadata?.texts || [];
    const primaryTextId = n.metadata?.primaryTextId || texts[0]?.id;
    const primaryText = texts.find((t) => t.id === primaryTextId);
    return (primaryText?.content || n.metadata?.content || "").trim();
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
    const mime = blob.type || fallbackMime;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

async function resolveAttachedMedia(params: {
    config: AiConfig;
    nodes: CanvasNodeData[];
    attachedNodeIds: string[];
    instruction: string;
    signal?: AbortSignal;
}): Promise<{
    labels: string[];
    textBlocks: string[];
    parts: Array<{ type: "image_url"; image_url: { url: string } } | { type: "video"; video: { url: string; mimeType: string } }>;
}> {
    const mentionedRefs = new Set(extractAtTokens(params.instruction));
    const targetNodes = params.nodes.filter((n) => {
        const isMatched =
            params.attachedNodeIds.includes(n.id) || Boolean(n.metadata?.refId && mentionedRefs.has(n.metadata.refId));
        if (!isMatched) return false;
        if (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) {
            return Boolean(n.metadata?.content);
        }
        if (n.type === CanvasNodeType.Text) {
            return Boolean(getNodeTextContent(n));
        }
        return false;
    });
    const labels: string[] = [];
    const textBlocks: string[] = [];
    const parts: Array<{ type: "image_url"; image_url: { url: string } } | { type: "video"; video: { url: string; mimeType: string } }> = [];
    const reqCfg = resolveModelRequestConfig(params.config, params.config.model || params.config.textModel);

    for (const n of targetNodes) {
        try {
            if (n.type === CanvasNodeType.Text) {
                const txt = getNodeTextContent(n);
                if (txt) {
                    const refLabel = `@${n.metadata?.refId || n.id} (文本: ${n.title || "未命名"})`;
                    labels.push(refLabel);
                    textBlocks.push(`--- ${refLabel} ---\n${txt}`);
                }
                continue;
            }
            const content = n.metadata?.content || "";
            if (n.type === CanvasNodeType.Image) {
                const dataUrl = content.startsWith("data:")
                    ? content
                    : await imageToDataUrl({
                          dataUrl: content,
                          storageKey: n.metadata?.storageKey,
                      });
                if (dataUrl) {
                    labels.push(`@${n.metadata?.refId || n.id} (图片: ${n.title || "未命名"})`);
                    parts.push({ type: "image_url", image_url: { url: dataUrl } });
                }
            } else if (n.type === CanvasNodeType.Video) {
                const storedBlob = n.metadata?.storageKey ? await getMediaBlob(n.metadata.storageKey) : null;
                const blob = storedBlob || (await (await fetch(content)).blob());
                const mimeType = blob.type || n.metadata?.mimeType || "video/mp4";
                let videoUrl = "";
                if (reqCfg.apiFormat === "gemini" && blob.size > 8 * 1024 * 1024) {
                    videoUrl = await uploadGeminiFile(params.config, blob, mimeType, params.signal);
                } else {
                    videoUrl = await blobToDataUrl(blob, mimeType);
                }
                if (videoUrl) {
                    labels.push(`@${n.metadata?.refId || n.id} (视频: ${n.title || "未命名"})`);
                    parts.push({ type: "video", video: { url: videoUrl, mimeType } });
                }
            }
        } catch {}
    }
    return { labels, textBlocks, parts };
}

/** Fallback when the model-written compact fails: keep each turn's head, newest last. */
export function compressHistoryTurns(existingSummary: string, turns: AgentHistoryTurn[]): string {
    const lines = turns.map((t) => {
        const roleLabel = t.role === "user" ? "用户" : "助手";
        const snippet = t.text.replace(/\s+/g, " ").trim().slice(0, 600);
        return `- ${roleLabel}: ${snippet}`;
    });
    const combined = [existingSummary ? `【先前摘要】${existingSummary}` : "", ...lines].filter(Boolean).join("\n");
    return combined.slice(-20000);
}

/**
 * Auto compact: the chat model rewrites the older turns (plus any earlier summary) into one detailed summary.
 * Only what is sent to the model is compacted; the panel keeps every message.
 */
export async function compactHistoryWithModel(params: {
    config: AiConfig;
    existingSummary: string;
    turns: AgentHistoryTurn[];
    signal?: AbortSignal;
}): Promise<string> {
    const transcript = params.turns.map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.text}`).join("\n\n");
    const messages: AiTextMessage[] = [
        {
            role: "system",
            content: [
                "你负责压缩 HemosiTV 画布/分镜 Agent 的对话历史，压缩结果会替代原对话发给后续轮次的模型。",
                "请输出一份详细摘要（纯文本，不要 JSON），必须保留：",
                "1. 剧情、世界观、风格、时长与比例等已经确定的创作决定；",
                "2. 角色、场景、道具设定及其 @R/@S/@P/@图n 引用编号与外观要点；",
                "3. 已提出的分镜和节点改动，以及用户是否采用（已应用/未采用/待确认）；",
                "4. 用户明确提出的要求、偏好、否决过的方案；",
                "5. 尚未完成的事和下一步。",
                "不要丢编号和名称，不要编造，不要写客套话。",
            ].join("\n"),
        },
        {
            role: "user",
            content: `${params.existingSummary ? `【已有摘要】\n${params.existingSummary}\n\n` : ""}【需要压缩的新对话】\n${transcript}`,
        },
    ];
    const summary = (await requestImageQuestion(params.config, messages, () => {}, { signal: params.signal })).trim();
    if (!summary) throw new Error("压缩结果为空");
    return summary;
}

export async function buildStoryboardAgentMessages(
    config: AiConfig,
    storyboardNode: CanvasNodeData | null,
    nodes: CanvasNodeData[],
    instruction: string,
    options?: {
        agentMode?: AgentMode;
        selectedRowId?: string | null;
        attachedNodeIds?: string[];
        history?: AgentHistoryTurn[];
        compressedSummary?: string;
        signal?: AbortSignal;
    },
): Promise<AiTextMessage[]> {
    const mode: AgentMode = options?.agentMode || "canvas";
    const sb = storyboardNode?.metadata?.storyboard;
    const mediaNodes = nodes
        .filter((n) => (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video || n.type === CanvasNodeType.Text) && n.metadata?.refId)
        .map((n) => `@${n.metadata!.refId} (${n.title || n.type})`);

    const canvasSystemPrompt = [
        "你是 HemosiTV 画布助手，既可以和用户自然对话（看图、看视频、改写剧本、讨论创意），也可以根据用户要求直接在画布上生成「文本节点」、「图片节点（含角色卡/场景图）」或「视频节点」。",
        "请输出合法 JSON 对象（不要加多余包裹），结构如下：",
        `{
  "summary": "你对用户的自然回复（纯聊天/分析时写完整回答；生成画布节点时写简明说明）",
  "changes": [
    { "id": "c1", "kind": "canvas.text.add", "title": "文本标题", "content": "文本节点的完整内容" },
    { "id": "c2", "kind": "canvas.image.add", "title": "图片标题（如：林佳佳·废土角色卡）", "prompt": "完整详细的生图提示词", "size": "9:16|16:9|1:1", "refs": "@图20（如需垫图/参考画布已有图片，填对应 @图n，会自动连线；无则填 空字符串）" },
    { "id": "c3", "kind": "canvas.video.add", "title": "视频标题", "prompt": "完整详细的生视频提示词", "duration": 5, "size": "16:9|9:16", "refs": "@图20（如需以画布图片作为首帧/参考图，填对应 @图n）" }
  ]
}`,
        "铁律：",
        "1. 当用户只是聊天、提问、讨论剧情时，把回答写在 summary 中，changes 设为空数组 []。",
        "2. 当用户明确让你生成角色卡、图片节点、文本节点或视频节点（例如说“生成一张角色卡”、“出图”、“写个剧本放画布上”）时，必须输出对应的 canvas.image.add / canvas.text.add / canvas.video.add 到 changes 数组中，绝不能只在文字里嘴炮说“已建好”而不输出 changes！",
        "3. 如果用户提供了参考图（如 @图20）让你基于它生成新角色卡或新图片，必须在 canvas.image.add 的 refs 字段里写上 \"@图20\"，系统会自动把 @图20 连线给新生成的图片节点。",
    ].join("\n");

    const storyboardSystemPrompt = [
        "你是 HemosiTV 分镜导演 Agent，专注于协助用户规划和修改当前选中的 10 列标准 AI 短剧分镜表（同时也支持生成独立画布节点）。",
        "请输出 JSON 对象（不要加多余包裹），结构如下：",
        `{
  "summary": "你对用户的自然回复或分镜修改说明",
  "changes": [
    { "id": "c1", "kind": "setting.add", "setting": { "kind": "person|scene|prop", "name": "名称", "desc": "外观描述（可带 @图1）" } },
    { "id": "c2", "kind": "row.add", "row": { "code": "S01", "duration": 4, "shotSize": "全景", "move": "缓推", "staticScreen": "静态画面", "action": "单一动作", "line": "台词或——", "sfx": "音效或——", "refs": "@R1 / @S1", "note": "备注", "imgPrompt": "图片提示词", "vidPrompt": "视频提示词" } },
    { "id": "c3", "kind": "row.update", "rowId": "S01或rowId", "patch": { ... } },
    { "id": "c4", "kind": "row.remove", "rowId": "S01或rowId" },
    { "id": "c5", "kind": "row.move", "rowId": "S01或rowId", "to": 0 },
    { "id": "c6", "kind": "canvas.image.add", "title": "图片标题", "prompt": "生图提示词", "size": "9:16|16:9", "refs": "@图1" }
  ],
  "suggestRun": { "rowIds": ["S01"], "kind": "image|video|both" }
}`,
        "铁律：",
        "1. 如果用户只是在讨论或闲聊，直接把回答写在 summary 中，且必须将 changes 设为空数组 []！",
        "2. 当用户附带了图片或视频（如 @图1、@视1）时，你已收到真实的图像/视频数据，请直接观察画面细节。",
        "3. 生成或修改分镜表时：staticScreen 只描述静态构图，一个字不提运动；action 只描述单一连贯动作；结合全剧上下文与模板直接写出每镜的 imgPrompt 与 vidPrompt；引用角色/场景/图片节点时使用 @R1、@S1、@图n。",
    ].join("\n");

    const historyMessages: AiTextMessage[] = (options?.history || []).map((turn) => ({
        role: turn.role,
        content: turn.text,
    }));

    const media = await resolveAttachedMedia({
        config,
        nodes,
        attachedNodeIds: options?.attachedNodeIds || [],
        instruction,
        signal: options?.signal,
    });

    const snapshotBlock =
        mode === "storyboard"
            ? `【当前绑定分镜表（${storyboardNode?.metadata?.refId || storyboardNode?.title || "未创建"}）快照】\n${JSON.stringify(
                  {
                      imageModelRule: sb?.imageModelRule || "",
                      videoModelRule: sb?.videoModelRule || "",
                      settings: sb?.settings || [],
                      rows: (sb?.rows || []).map((r) => ({
                          id: r.id,
                          code: r.code,
                          duration: r.duration,
                          shotSize: r.shotSize,
                          move: r.move,
                          staticScreen: r.staticScreen,
                          action: r.action,
                          line: r.line,
                          sfx: r.sfx,
                          refs: r.refs,
                          note: r.note,
                          imgPrompt: r.imgPrompt,
                          vidPrompt: r.vidPrompt,
                      })),
                      selectedRowId: options?.selectedRowId || null,
                      availableCanvasMedia: mediaNodes,
                  },
                  null,
                  2,
              )}\n\n`
            : `【画布已有素材引用编号】${mediaNodes.length ? mediaNodes.join("、") : "暂无"}\n\n`;

    const summaryBlock = options?.compressedSummary
        ? `【早期对话压缩摘要（auto compact）】\n${options.compressedSummary}\n\n`
        : "";

    const userText = `${summaryBlock}${snapshotBlock}${
        media.labels.length ? `【本轮拾取/附带的画布素材】${media.labels.join("、")}\n\n` : ""
    }${
        media.textBlocks.length ? `【拾取的画布文本节点内容】\n${media.textBlocks.join("\n\n")}\n\n` : ""
    }【用户消息】\n${instruction}`;

    const userContent: AiTextMessage["content"] =
        media.parts.length > 0 ? [...media.parts, { type: "text" as const, text: userText }] : userText;

    return [
        { role: "system", content: mode === "storyboard" ? storyboardSystemPrompt : canvasSystemPrompt },
        ...historyMessages,
        { role: "user", content: userContent },
    ];
}

function extractJsonObject(raw: string): string {
    const trimmed = raw.trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fence) return fence[1].trim();
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
    return trimmed;
}

export async function requestStoryboardPlan(params: {
    config: AiConfig;
    storyboardNode: CanvasNodeData | null;
    nodes: CanvasNodeData[];
    instruction: string;
    agentMode?: AgentMode;
    selectedRowId?: string | null;
    attachedNodeIds?: string[];
    history?: AgentHistoryTurn[];
    compressedSummary?: string;
    signal?: AbortSignal;
}): Promise<{ ok: true; plan: Plan; raw: string } | { ok: false; raw: string; error: string }> {
    const messages = await buildStoryboardAgentMessages(
        params.config,
        params.storyboardNode,
        params.nodes,
        params.instruction,
        {
            agentMode: params.agentMode,
            selectedRowId: params.selectedRowId,
            attachedNodeIds: params.attachedNodeIds,
            history: params.history,
            compressedSummary: params.compressedSummary,
            signal: params.signal,
        },
    );

    let lastRaw = "";
    let lastError = "";

    for (let attempt = 0; attempt < 3; attempt++) {
        const retryMessages: AiTextMessage[] =
            attempt === 0
                ? messages
                : [
                      ...messages,
                      { role: "assistant", content: lastRaw },
                      {
                          role: "user",
                          content: `上次输出校验失败：${lastError}\n请严格修正并输出合法 JSON 对象。`,
                      },
                  ];

        const raw = await requestImageQuestion(
            params.config,
            retryMessages,
            () => {},
            { signal: params.signal },
        );
        lastRaw = raw;

        try {
            const trimmed = raw.trim();
            if (!trimmed.includes('"changes"')) {
                return {
                    ok: true,
                    plan: { summary: trimmed, changes: [] },
                    raw,
                };
            }
            const parsed = JSON.parse(extractJsonObject(raw));
            const validated = PlanSchema.safeParse(parsed);
            if (validated.success) {
                return { ok: true, plan: validated.data, raw };
            }
            lastError = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        } catch (err) {
            lastError = err instanceof Error ? err.message : "JSON 解析失败";
        }
    }

    return { ok: false, raw: lastRaw, error: lastError || "Plan 校验失败" };
}
