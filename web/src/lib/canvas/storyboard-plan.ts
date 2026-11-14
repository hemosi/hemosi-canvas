import { nanoid } from "nanoid";
import { z } from "zod";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { allocateRefId } from "@/lib/canvas/node-ref-id";
import { effectiveStoryboardRule, syncStoryboardModelRules } from "@/lib/canvas/storyboard-model-rules";
import { SettingKindSchema, type SettingItem, type StoryboardData, type StoryboardRow } from "@/lib/canvas/storyboard-types";
import {
    extractAtTokens,
    nextSettingId,
    nextShotCode,
    reconcileStoryboardGraph,
    settingImageNode,
    settingsGate,
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
            /** Prompt for the setting picture; a picture node is created with it and bound to the setting. */
            imgPrompt: z.string().default(""),
        }),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("setting.update"),
        settingId: z.string().min(1),
        patch: z.object({
            name: z.string().optional(),
            desc: z.string().optional(),
            imgPrompt: z.string().optional(),
        }),
    }),
    z.object({
        id: z.string().min(1),
        kind: z.literal("setting.review"),
        settingId: z.string().min(1),
        /** What the generated picture actually shows. */
        actual: z.string().default(""),
        /** Conflicts with the outline / setting description; empty when none. */
        conflicts: z.string().default(""),
        ok: z.boolean().default(false),
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
    /** Skills the model asks to load (auto-load by description); the app re-asks once with them. */
    loadSkills: z.array(z.string()).optional(),
    changes: z.array(ChangeSchema),
    suggestRun: z
        .object({
            rowIds: z.array(z.string()),
            kind: z.enum(["image", "video", "both"]),
        })
        .optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** Most setting pictures sent to the model in one turn (images cost tokens). */
export const MAX_AUTO_SETTING_IMAGES = 8;

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
    // 设定关 is judged on the table as it was when the plan arrived; settings this plan adds are not locked yet.
    const gate = settingsGate(data.settings);
    const gateNote = gate.empty ? "表里还没有设定" : `设定 ${gate.unlocked.join("、")} 还没锁定`;
    let rowsBlocked = 0;

    for (const ch of plan.changes) {
        if (!enabledIds.has(ch.id)) continue;

        if (ch.kind === "setting.add") {
            const id = nextSettingId(ch.setting.kind, settings);
            settings.push({ id, kind: ch.setting.kind, name: ch.setting.name, desc: ch.setting.desc, prompt: ch.setting.imgPrompt || undefined, locked: false });
            diff.addedSettingIds.push(id);
            continue;
        }

        if (ch.kind === "setting.update") {
            const idx = settings.findIndex((s) => s.id === ch.settingId);
            if (idx < 0) {
                warnings.push(`设定 ${ch.settingId} 不存在`);
                continue;
            }
            const cur = settings[idx];
            const { imgPrompt, ...rest } = ch.patch;
            const looksChanged = (rest.desc !== undefined && rest.desc !== cur.desc) || (imgPrompt !== undefined && imgPrompt !== cur.prompt);
            if (cur.locked && looksChanged) warnings.push(`${cur.id} 已锁定，这次改了外观，应用后会解锁，需要重新出图并审核`);
            settings[idx] = { ...cur, ...rest, ...(imgPrompt !== undefined ? { prompt: imgPrompt } : {}), ...(cur.locked && looksChanged ? { locked: false, review: undefined } : {}) };
            diff.updatedSettingIds.push(ch.settingId);
            continue;
        }

        if (ch.kind === "setting.review") {
            const idx = settings.findIndex((s) => s.id === ch.settingId);
            if (idx < 0) {
                warnings.push(`设定 ${ch.settingId} 不存在`);
                continue;
            }
            const conflicts = ch.conflicts.trim();
            const review = `${ch.actual.trim() ? `实际画面：${ch.actual.trim()}` : ""}${conflicts ? `${ch.actual.trim() ? "；" : ""}冲突：${conflicts}` : ""}` || (ch.ok ? "审核通过" : "");
            if (conflicts) warnings.push(`${ch.settingId} 与梗概有冲突：${conflicts}`);
            const autoLock = Boolean(data.autoLockSettings) && ch.ok && !conflicts;
            settings[idx] = { ...settings[idx], review, ...(autoLock ? { locked: true } : {}) };
            diff.updatedSettingIds.push(ch.settingId);
            continue;
        }

        if ((ch.kind === "row.add" || ch.kind === "row.update") && !gate.ready) {
            rowsBlocked++;
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

    if (rowsBlocked) {
        warnings.push(`${gateNote}，${rowsBlocked} 条分镜行没有写入。先在分镜表设定栏审核设定图并点「锁定」，全部锁定后再让 Agent 写分镜`);
    }

    if (removeCount > 3) {
        warnings.push(`本次将删除 ${removeCount} 行（超过 3 行），请确认`);
    }

    const settingIdSet = new Set(settings.map((s) => s.id));
    const addedRows = new Set(diff.addedRowIds);
    for (const row of rows) {
        if (addedRows.has(row.id)) {
            if (!extractAtTokens(row.refs).some((tok) => /^[RSP]\d+$/.test(tok))) warnings.push(`${row.code} 的「角色/场景」没有引用任何设定，首帧图会没有设定图参考`);
            if (!/\[(接上镜|切镜)\]/.test(row.note)) warnings.push(`${row.code} 备注没标 [接上镜] 或 [切镜]`);
        }
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
                // The ratio picked on the confirm card wins, so images and videos of one plan share it.
                size: presets?.imageSize || ch.size || "9:16",
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
                size: presets?.videoSize || ch.size || "16:9",
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
    const presetModels = { imageModel: params.modelPresets?.imageModel, videoModel: params.modelPresets?.videoModel };
    const synced = syncStoryboardModelRules(params.data, presetModels) || params.data;
    const ratio = params.modelPresets?.imageSize || params.modelPresets?.videoSize;
    const baseData = ratio && ratio !== synced.aspectRatio ? { ...synced, aspectRatio: ratio } : synced;
    const { next, diff, warnings } = previewPlan(baseData, params.plan, params.enabledIds, params.nodes);

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

    const canvasCount = params.plan.changes.filter((c) => params.enabledIds.has(c.id) && c.kind.startsWith("canvas.")).length;
    const movedCount = params.plan.changes.filter((c) => params.enabledIds.has(c.id) && c.kind === "row.move" && !warnings.includes(`目标行 ${c.rowId} 不存在`)).length;
    const applied =
        diff.addedRowIds.length +
        diff.updatedRowIds.length +
        diff.removedRowIds.length +
        diff.addedSettingIds.length +
        diff.updatedSettingIds.length +
        movedCount +
        canvasCount;

    return {
        applied,
        data: reconciled.data,
        nodes: canvasAdded.nodes,
        connections: canvasAdded.connections,
        refCounters: canvasAdded.refCounters,
        createdTasks: canvasAdded.createdTasks,
        warnings,
        diff,
    };
}

export type AgentSkillContext = {
    index: Array<{ name: string; description: string }>;
    loaded: Array<{ name: string; body: string }>;
};

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
    /** Picked by the app itself (locked setting pictures), sent with these labels. */
    autoNodeIds?: string[];
    autoLabel?: (node: CanvasNodeData) => string;
}): Promise<{
    labels: string[];
    textBlocks: string[];
    parts: Array<{ type: "image_url"; image_url: { url: string } } | { type: "video"; video: { url: string; mimeType: string } }>;
    failures: string[];
}> {
    const mentionedRefs = new Set(extractAtTokens(params.instruction));
    const targetNodes = params.nodes.filter((n) => {
        const isMatched =
            params.attachedNodeIds.includes(n.id) || params.autoNodeIds?.includes(n.id) || Boolean(n.metadata?.refId && mentionedRefs.has(n.metadata.refId));
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
    const failures: string[] = [];
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
                    labels.push(params.autoLabel && params.autoNodeIds?.includes(n.id) && !params.attachedNodeIds.includes(n.id) ? params.autoLabel(n) : `@${n.metadata?.refId || n.id} (图片: ${n.title || "未命名"})`);
                    parts.push({ type: "image_url", image_url: { url: dataUrl } });
                } else {
                    failures.push(`@${n.metadata?.refId || n.id}：读取结果为空`);
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
                } else {
                    failures.push(`@${n.metadata?.refId || n.id}：读取结果为空`);
                }
            }
        } catch (err) {
            if ((err as Error)?.name === "AbortError") throw err;
            failures.push(`@${n.metadata?.refId || n.id}：${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { labels, textBlocks, parts, failures };
}

/**
 * Setting pictures to send with a storyboard turn, without the user picking them. Before 设定关 passes: every setting
 * that has a picture (unlocked first, so the Agent can review them). After: the locked ones the rows are written from.
 * Capped at `max`; the rest are listed as omitted.
 */
export function pickAutoSettingImages(settings: SettingItem[], nodes: CanvasNodeData[], max = MAX_AUTO_SETTING_IMAGES): { ids: string[]; labels: Map<string, string>; omitted: string[] } {
    const gate = settingsGate(settings);
    const withImage = settings
        .map((s) => ({ s, node: settingImageNode(s, nodes) }))
        .filter((x): x is { s: SettingItem; node: CanvasNodeData } => Boolean(x.node?.metadata?.content))
        .filter((x) => !gate.ready || x.s.locked)
        .sort((a, b) => Number(Boolean(a.s.locked)) - Number(Boolean(b.s.locked)));
    const picked = withImage.slice(0, max);
    const labels = new Map(picked.map((x) => [x.node.id, `@${x.node.metadata?.refId || x.node.id} = 设定 @${x.s.id} ${x.s.name}（${x.s.locked ? "已锁定" : "未锁定，待审核"}）`]));
    return { ids: picked.map((x) => x.node.id), labels, omitted: withImage.slice(max).map((x) => `@${x.s.id} ${x.s.name}`) };
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
        /** Attached media that could not be read and was left out of the request. */
        onMediaFailures?: (failures: string[]) => void;
        /** Skills: the name+description index (for auto-load) and the ones loaded for this turn. */
        skills?: AgentSkillContext;
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
        "你是 HemosiTV 分镜导演 Agent，负责和用户一起把一句话需求做成：故事梗概 → 设定（角色/场景/物品）→ 设定图 → 10 列分镜表（同时也支持生成独立画布节点）。",
        "请输出 JSON 对象（不要加多余包裹），结构如下：",
        `{
  "summary": "你对用户的自然回复或修改说明（可用 markdown）",
  "changes": [
    { "id": "c1", "kind": "setting.add", "setting": { "kind": "person|scene|prop", "name": "名称（同一角色换装就拆成两个设定，如：林佳佳·皮夹克）", "desc": "外观要点 + 出现镜号（可带 @图1 绑定画布已有图片）", "imgPrompt": "可直接生成设定图的完整提示词" } },
    { "id": "c2", "kind": "setting.update", "settingId": "R1", "patch": { "desc": "…", "imgPrompt": "…" } },
    { "id": "c3", "kind": "setting.review", "settingId": "R1", "actual": "这张设定图实际画了什么（服装/发型/配色/背景/时间天气/载具外形）", "conflicts": "与梗概或设定描述冲突的地方，没有就填空字符串", "ok": true },
    { "id": "c4", "kind": "row.add", "row": { "code": "S01", "duration": 4, "shotSize": "全景", "move": "缓推", "staticScreen": "静态画面", "action": "单一动作", "line": "台词或——", "sfx": "音效或——", "refs": "@R1 @S1 @P1", "note": "[切镜] 备注", "imgPrompt": "图片提示词", "vidPrompt": "视频提示词" } },
    { "id": "c5", "kind": "row.update", "rowId": "S01", "patch": { ... } },
    { "id": "c6", "kind": "row.remove", "rowId": "S01" },
    { "id": "c7", "kind": "row.move", "rowId": "S01", "to": 0 },
    { "id": "c8", "kind": "canvas.image.add", "title": "图片标题", "prompt": "生图提示词", "size": "9:16|16:9", "refs": "@图1" }
  ],
  "suggestRun": { "rowIds": ["S01"], "kind": "image|video|both" },
  "loadSkills": ["需要加载的 skill 名称（可省略）"]
}`,
        "【内置硬规则 · 最高优先级，下方任何 skill / 风格说明都不能推翻】",
        "0. 用户只是讨论或闲聊时，把回答写在 summary 里，changes 必须是 []。用户附带了图片或视频（如 @图1、@视1）时，你已收到真实画面，请直接观察。",
        "【先设计、后分镜】看快照里的 settingsGate：",
        "1. settingsGate.ready=false（表里没有设定，或有设定未锁定，或你判断关键的人物/场景/物品/载具还没有设定）时，本轮只能输出 setting.add / setting.update / setting.review，严禁 row.add / row.update。",
        "   - 还没有设定：summary 先写故事梗概（按镜头节奏分段：开端-发展-高潮-结尾），再用 setting.add 列出全部设定：角色（每套服装/造型单独一个设定）、场景、物品和载具（包括敌方的）。desc 写外观要点和出现的镜号；imgPrompt 写能直接生成设定图的完整提示词（角色：全身定妆/三视图，服装与梗概一致；场景：无人空镜，交代时间天气光线；物品：多角度、干净背景）。系统会为每个设定建好图片节点并绑定。",
        "   - 本轮附带了设定图（标注为「设定 @R1 …」）：逐张观察，为每张输出 setting.review：actual 写图里实际画了什么，conflicts 写和梗概/设定描述对不上的地方。有冲突时 ok=false，并在 summary 里问用户是改图（你给出新的 imgPrompt 用 setting.update）还是改剧本，不要自己往下写分镜。",
        "   - 设定由用户点「锁定」确认（用户也可开启让你自动锁定：审核无冲突时 ok=true）。",
        "2. settingsGate.ready=true 后才能写分镜行，且只能引用已锁定的设定。",
        "【镜头连贯硬规则】",
        "3. 每一行 refs 必须列出本镜画面里出现的全部设定（@R/@S/@P），一个都不能漏——系统按 refs 把设定图连到首帧图，漏写的设定在画面里就会走样。",
        "4. 每一镜的 staticScreen 和 imgPrompt 必须从上一镜结尾接着写：人物位置、朝向、姿态、手里拿的东西、所在载具、光线天气时间都承接上一镜结尾状态；状态要变（如上车、换装、换地点）就单独加一镜交代过程。",
        "5. note 开头必须标 [接上镜]（同一空间的连续动作）或 [切镜]（景别/机位/场景变化）。不使用尾帧接首帧，一律靠同一套锁定的设定图和承接描述保持一致。",
        "6. staticScreen 只描述静态构图，一个字不提运动；action 只描述单一连贯动作；结合全剧上下文与提示词模板写出每镜的 imgPrompt 与 vidPrompt。",
        "7. 写完或改完分镜行后，summary 末尾必须有「衔接自检」：逐条列出你发现的断点（服装/道具/位置/光线跳变、缺少交代的动作、引用了未锁定或不存在的设定），没有就写「未发现断点」。",
    ].join("\n");

    const skillIndex = options?.skills?.index?.length
        ? `【可用 skill 索引】需要时在 JSON 的 loadSkills 里写上名称，系统会把内容加载给你后重答：\n${options.skills.index.map((k) => `- ${k.name}：${k.description}`).join("\n")}`
        : "";
    const skillBodies = options?.skills?.loaded?.length
        ? `【已加载的 skill · 风格/写法参考，优先级低于上面的内置硬规则，冲突时以硬规则为准】\n${options.skills.loaded.map((k) => `### skill：${k.name}\n${k.body}`).join("\n\n")}`
        : "";
    const withSkills = (base: string) => [base, skillIndex, skillBodies].filter(Boolean).join("\n\n");

    const historyMessages: AiTextMessage[] = (options?.history || []).map((turn) => ({
        role: turn.role,
        content: turn.text,
    }));

    // Storyboard turns also carry the setting pictures (review before the gate, locked ones when writing rows).
    const auto = mode === "storyboard" && sb ? pickAutoSettingImages(sb.settings, nodes) : null;
    const media = await resolveAttachedMedia({
        config,
        nodes,
        attachedNodeIds: options?.attachedNodeIds || [],
        instruction,
        signal: options?.signal,
        autoNodeIds: auto?.ids,
        autoLabel: (n) => auto?.labels.get(n.id) || `@${n.metadata?.refId || n.id}`,
    });
    if (media.failures.length) options?.onMediaFailures?.(media.failures);

    const snapshotBlock =
        mode === "storyboard"
            ? `【当前绑定分镜表（${storyboardNode?.metadata?.refId || storyboardNode?.title || "未创建"}）快照】\n${JSON.stringify(
                  {
                      // The table's own override, else the rule bound to its model in Settings.
                      imageModelRule: sb ? effectiveStoryboardRule("image", sb, config).rule : "",
                      videoModelRule: sb ? effectiveStoryboardRule("video", sb, config).rule : "",
                      settingsGate: settingsGate(sb?.settings || []),
                      autoLockSettings: Boolean(sb?.autoLockSettings),
                      settings: (sb?.settings || []).map((st) => ({
                          id: st.id,
                          kind: st.kind,
                          name: st.name,
                          desc: st.desc,
                          imgPrompt: st.prompt || "",
                          locked: Boolean(st.locked),
                          hasImage: Boolean(settingImageNode(st, nodes)?.metadata?.content),
                          review: st.review || "",
                      })),
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

    const omittedBlock = auto?.omitted.length ? `【设定图超过 ${MAX_AUTO_SETTING_IMAGES} 张，以下没有附带给你（需要时让用户拾取）】${auto.omitted.join("、")}\n\n` : "";
    const userText = `${summaryBlock}${snapshotBlock}${omittedBlock}${
        media.labels.length ? `【本轮拾取/附带的画布素材】${media.labels.join("、")}\n\n` : ""
    }${
        media.failures.length ? `【以下素材读取失败、未发送给你，不要假装看到了】${media.failures.join("；")}\n\n` : ""
    }${
        media.textBlocks.length ? `【拾取的画布文本节点内容】\n${media.textBlocks.join("\n\n")}\n\n` : ""
    }【用户消息】\n${instruction}`;

    const userContent: AiTextMessage["content"] =
        media.parts.length > 0 ? [...media.parts, { type: "text" as const, text: userText }] : userText;

    return [
        { role: "system", content: withSkills(mode === "storyboard" ? storyboardSystemPrompt : canvasSystemPrompt) },
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

/** A reply without "changes" is plain chat; when it is a JSON object like {"summary": "..."}, show only the summary text. */
function summaryOnlyText(trimmed: string): string {
    if (!trimmed.includes('"summary"')) return trimmed;
    try {
        const parsed = JSON.parse(extractJsonObject(trimmed)) as { summary?: unknown };
        if (typeof parsed?.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
    } catch {
        // Not valid JSON: fall through and show the reply as written.
    }
    return trimmed;
}

export type AgentSkill = { name: string; description: string; body: string };

/** Names the model asked for that exist and are not loaded yet. */
export function skillsToAutoLoad(requested: string[] | undefined, available: AgentSkill[], loadedNames: string[]): string[] {
    const known = new Map(available.map((k) => [k.name.trim().toLowerCase(), k.name]));
    const loaded = new Set(loadedNames.map((n) => n.toLowerCase()));
    return [...new Set((requested || []).map((n) => known.get(n.trim().toLowerCase())).filter((n): n is string => Boolean(n) && !loaded.has(n!.toLowerCase())))];
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
    /** Enabled skills (their name+description go in the index) and the ones the user switched on for this chat. */
    skills?: { available: AgentSkill[]; activeNames: string[] };
}): Promise<
    | { ok: true; plan: Plan; raw: string; mediaFailures: string[]; autoLoadedSkills: string[] }
    | { ok: false; raw: string; error: string; mediaFailures: string[]; autoLoadedSkills: string[] }
> {
    const available = params.skills?.available || [];
    let loadedNames = (params.skills?.activeNames || []).filter((n) => available.some((k) => k.name === n));
    const autoLoadedSkills: string[] = [];
    // One extra round at most: the model may ask for skills by description, then answers again with them loaded.
    for (let round = 0; round < 2; round++) {
        const res = await requestPlanOnce(params, {
            index: available.filter((k) => !loadedNames.includes(k.name)).map(({ name, description }) => ({ name, description })),
            loaded: available.filter((k) => loadedNames.includes(k.name)).map(({ name, body }) => ({ name, body })),
        });
        const wanted = res.ok && round === 0 ? skillsToAutoLoad(res.plan.loadSkills, available, loadedNames) : [];
        if (!wanted.length) return { ...res, autoLoadedSkills };
        autoLoadedSkills.push(...wanted);
        loadedNames = [...loadedNames, ...wanted];
    }
    throw new Error("unreachable");
}

async function requestPlanOnce(
    params: Parameters<typeof requestStoryboardPlan>[0],
    skills: AgentSkillContext,
): Promise<{ ok: true; plan: Plan; raw: string; mediaFailures: string[] } | { ok: false; raw: string; error: string; mediaFailures: string[] }> {
    let mediaFailures: string[] = [];
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
            skills,
            onMediaFailures: (failures) => {
                mediaFailures = failures;
            },
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
                return { ok: true, plan: { summary: summaryOnlyText(trimmed), changes: [], loadSkills: loadSkillsOf(trimmed) }, raw, mediaFailures };
            }
            const parsed = JSON.parse(extractJsonObject(raw));
            const validated = PlanSchema.safeParse(parsed);
            if (validated.success) {
                return { ok: true, plan: validated.data, raw, mediaFailures };
            }
            lastError = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        } catch (err) {
            lastError = err instanceof Error ? err.message : "JSON 解析失败";
        }
    }

    return { ok: false, raw: lastRaw, error: lastError || "Plan 校验失败", mediaFailures };
}

function loadSkillsOf(trimmed: string): string[] | undefined {
    if (!trimmed.includes('"loadSkills"')) return undefined;
    try {
        const parsed = JSON.parse(extractJsonObject(trimmed)) as { loadSkills?: unknown };
        return Array.isArray(parsed.loadSkills) ? parsed.loadSkills.filter((n): n is string => typeof n === "string") : undefined;
    } catch {
        return undefined;
    }
}
