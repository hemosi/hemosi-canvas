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
import { buildAgentCanvasSnapshot } from "@/lib/canvas/agent-canvas-snapshot";

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

export const RowPatchSchema = z.object({
    code: z.string().optional(),
    duration: z.number().positive().optional(),
    shotSize: z.string().optional(),
    move: z.string().optional(),
    staticScreen: z.string().optional(),
    action: z.string().optional(),
    line: z.string().optional(),
    sfx: z.string().optional(),
    refs: z.string().optional(),
    note: z.string().optional(),
    imgPrompt: z.string().optional(),
    vidPrompt: z.string().optional(),
});

function inferSettingKind(kind: z.infer<typeof SettingKindSchema> | undefined, name: string): z.infer<typeof SettingKindSchema> {
    const trimmed = (name || "").trim();
    if (/^(P\d+|道具|物品)/i.test(trimmed)) return "prop";
    if (/^(S\d+|场景)/i.test(trimmed)) return "scene";
    if (/^(CH\d+|R\d+|角色|人物)/i.test(trimmed)) return "person";
    return kind || "person";
}

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
        patch: RowPatchSchema,
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
            kind: SettingKindSchema.optional(),
            name: z.string().min(1),
            desc: z.string().default(""),
            /** Prompt for the setting picture; a picture node is created with it and bound to the setting. */
            imgPrompt: z.string().default(""),
            /** 设定图的上游参考：@图n（基于画布已有图改出的新设定）或 @S1（如反打参考正打）；系统新建节点并连线。 */
            refs: z.string().default(""),
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
    z.object({
        id: z.string().min(1),
        kind: z.literal("canvas.node.update"),
        /** Target node refId (e.g. "@图5" or "图5") or node id. */
        target: z.string().min(1),
        title: z.string().optional(),
        prompt: z.string().optional(),
        content: z.string().optional(),
        duration: z.number().positive().optional(),
        size: z.string().optional(),
        refs: z.string().optional(),
    }),
]);
export type Change = z.infer<typeof ChangeSchema>;
export type AgentMode = "canvas" | "storyboard";

export const PlanSchema = z.object({
    summary: z.string(),
    /** Skills the model asks to load (L2 SKILL.md); the app re-asks with them loaded. */
    loadSkills: z.array(z.string()).optional(),
    /** Reference files inside a skill folder the model asks to read on demand (L3, e.g. "references/script-engine.md"). */
    loadSkillFiles: z.array(z.string()).optional(),
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
    for (const ch of plan.changes) {
        if (!enabledIds.has(ch.id)) continue;

        if (ch.kind === "setting.add") {
            const resolvedKind = inferSettingKind(ch.setting.kind, ch.setting.name);
            const id = nextSettingId(resolvedKind, settings);
            settings.push({ id, kind: resolvedKind, name: ch.setting.name, desc: ch.setting.desc, prompt: ch.setting.imgPrompt || undefined, refs: ch.setting.refs || undefined, locked: false });
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
            const cleanPatch = Object.fromEntries(
                Object.entries(ch.patch).filter(([, v]) => v !== undefined),
            ) as Partial<StoryboardRow>;
            if (imgNode?.metadata?.manualPrompt && cleanPatch.imgPrompt !== undefined) {
                warnings.push(`跳过已手改首帧图提示词的 ${cur.code}`);
                delete cleanPatch.imgPrompt;
            }
            if (vidNode?.metadata?.manualPrompt && cleanPatch.vidPrompt !== undefined) {
                warnings.push(`跳过已手改视频提示词的 ${cur.code}`);
                delete cleanPatch.vidPrompt;
            }
            rows[idx] = { ...cur, ...cleanPatch };
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

function extractCanvasRefTokens(refsText: string, promptText: string): string[] {
    const out = new Set<string>(extractAtTokens(`${refsText} ${promptText}`));
    const tempRe = /(?:[@$](c\d+)|\b(c\d+)\b)/gi;
    let m: RegExpExecArray | null;
    while ((m = tempRe.exec(refsText)) !== null) {
        const token = m[1] || m[2];
        if (token) out.add(token);
    }
    return [...out];
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
        refToNode.set(n.id, n);
    }

    let offsetIdx = 0;
    for (const ch of params.plan.changes) {
        if (!params.enabledIds.has(ch.id)) continue;
        if (
            ch.kind !== "canvas.text.add" &&
            ch.kind !== "canvas.image.add" &&
            ch.kind !== "canvas.video.add" &&
            ch.kind !== "canvas.node.update"
        ) {
            continue;
        }

        const refTokens =
            ch.kind === "canvas.text.add"
                ? []
                : extractCanvasRefTokens(ch.refs || "", ch.prompt || "");
        const refNodes = refTokens
            .map((t) => refToNode.get(t) || refToNode.get(t.replace(/^[@$]/, "")))
            .filter((n): n is CanvasNodeData => Boolean(n));

        if (ch.kind === "canvas.node.update") {
            const cleanTarget = ch.target.replace(/^[@$]/, "").trim();
            const targetNode =
                refToNode.get(cleanTarget) ||
                nextNodes.find((n) => n.id === cleanTarget || n.metadata?.refId === cleanTarget);
            if (!targetNode) continue;
            const idx = nextNodes.findIndex((n) => n.id === targetNode.id);
            if (idx < 0) continue;

            const updated: CanvasNodeData = {
                ...targetNode,
                title: ch.title || targetNode.title,
                metadata: { ...targetNode.metadata },
            };

            if (updated.type === CanvasNodeType.Text) {
                const nextText = ch.content ?? ch.prompt;
                if (nextText !== undefined) {
                    const textId = updated.metadata?.primaryTextId || updated.metadata?.texts?.[0]?.id || nanoid();
                    const existingTexts = updated.metadata?.texts || [];
                    const nextTexts = existingTexts.some((t) => t.id === textId)
                        ? existingTexts.map((t) => (t.id === textId ? { ...t, content: nextText, status: "success" as const } : t))
                        : [{ id: textId, content: nextText, status: "success" as const }, ...existingTexts];
                    updated.metadata = {
                        ...updated.metadata,
                        content: nextText,
                        texts: nextTexts,
                        primaryTextId: textId,
                    };
                }
            } else if (updated.type === CanvasNodeType.Image || updated.type === CanvasNodeType.Video) {
                const nextPrompt = ch.prompt !== undefined ? ch.prompt : updated.metadata?.prompt || "";
                const nextSize =
                    ch.size ||
                    updated.metadata?.size ||
                    (updated.type === CanvasNodeType.Video ? presets?.videoSize || "16:9" : presets?.imageSize || "16:9");
                const existingUpstreamIds = nextConnections
                    .filter((c) => c.toNodeId === targetNode.id && (c.kind || "reference") === "reference")
                    .map((c) => c.fromNodeId);
                const finalRefIds =
                    ch.refs !== undefined && ch.refs.trim()
                        ? refNodes.filter((rn) => rn.type === CanvasNodeType.Image && rn.id !== targetNode.id).map((rn) => rn.id)
                        : existingUpstreamIds;

                // 已生成结果的节点改图一律新开卡（放旧图右侧并自动继承原参考图），保留旧图供对比抽卡；仅未生成的草稿才原地改。
                if (Boolean(targetNode.metadata?.content)) {
                    const forkPos = { x: targetNode.position.x + targetNode.width + 60, y: targetNode.position.y };
                    const allocated = allocateRefId(updated.type, nextNodes, nextCounters);
                    nextCounters = allocated.nextCounters;
                    const created = createCanvasNode(
                        updated.type,
                        forkPos,
                        updated.type === CanvasNodeType.Video
                            ? {
                                  refId: allocated.refId,
                                  prompt: nextPrompt,
                                  rawPrompt: nextPrompt,
                                  seconds: String(ch.duration || updated.metadata?.seconds || 5),
                                  model: presets?.videoModel || updated.metadata?.model,
                                  videoModel: presets?.videoModel || updated.metadata?.videoModel || updated.metadata?.model,
                                  size: nextSize,
                              }
                            : {
                                  refId: allocated.refId,
                                  prompt: nextPrompt,
                                  rawPrompt: nextPrompt,
                                  model: presets?.imageModel || updated.metadata?.model,
                                  size: nextSize,
                              },
                    );
                    created.title = ch.title || targetNode.title || (updated.type === CanvasNodeType.Video ? "视频" : "图片");
                    nextNodes.push(created);
                    refToNode.set(allocated.refId, created);
                    refToNode.set(created.id, created);
                    refToNode.set(ch.id, created);
                    refToNode.set(`$${ch.id}`, created);
                    for (const fromId of finalRefIds) {
                        nextConnections.push({
                            id: nanoid(),
                            fromNodeId: fromId,
                            toNodeId: created.id,
                            kind: "reference",
                        });
                    }
                    if (nextPrompt) {
                        createdTasks.push({
                            nodeId: created.id,
                            kind: updated.type === CanvasNodeType.Video ? "video" : "image",
                            label: `@${allocated.refId} ${created.title}`,
                            prompt: nextPrompt,
                        });
                    }
                    continue;
                }

                if (ch.prompt !== undefined) {
                    updated.metadata!.prompt = ch.prompt;
                    updated.metadata!.rawPrompt = ch.prompt;
                }
                updated.metadata!.size = nextSize;
                updated.metadata!.generationType = undefined;
                updated.metadata!.references = undefined;
                updated.metadata!.errorDetails = undefined;
                if (updated.type === CanvasNodeType.Video && ch.duration) {
                    updated.metadata!.seconds = String(ch.duration);
                }
                if (ch.refs !== undefined) {
                    nextConnections = nextConnections.filter(
                        (c) => !(c.toNodeId === updated.id && (c.kind || "reference") === "reference"),
                    );
                    for (const fromId of finalRefIds) {
                        nextConnections.push({
                            id: nanoid(),
                            fromNodeId: fromId,
                            toNodeId: updated.id,
                            kind: "reference",
                        });
                    }
                }
                const finalPrompt = updated.metadata?.prompt || "";
                if (finalPrompt) {
                    createdTasks.push({
                        nodeId: updated.id,
                        kind: updated.type === CanvasNodeType.Video ? "video" : "image",
                        label: `@${updated.metadata?.refId || updated.id} ${updated.title}`,
                        prompt: finalPrompt,
                    });
                }
            }

            nextNodes[idx] = updated;
            if (updated.metadata?.refId) refToNode.set(updated.metadata.refId, updated);
            refToNode.set(updated.id, updated);
            refToNode.set(ch.id, updated);
            refToNode.set(`$${ch.id}`, updated);
            continue;
        }

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
            refToNode.set(created.id, created);
            refToNode.set(ch.id, created);
            refToNode.set(`$${ch.id}`, created);
            continue;
        }

        if (ch.kind === "canvas.image.add") {
            const allocated = allocateRefId(CanvasNodeType.Image, nextNodes, nextCounters);
            nextCounters = allocated.nextCounters;
            const created = createCanvasNode(CanvasNodeType.Image, pos, {
                refId: allocated.refId,
                prompt: ch.prompt,
                ...(presets?.imageModel ? { model: presets.imageModel } : {}),
                // Per-node ch.size wins (e.g. 1:1 prop vs 16:9 scene); preset ratio is the fallback.
                size: ch.size || presets?.imageSize || "9:16",
            });
            created.title = ch.title || "图片";
            nextNodes.push(created);
            refToNode.set(allocated.refId, created);
            refToNode.set(created.id, created);
            refToNode.set(ch.id, created);
            refToNode.set(`$${ch.id}`, created);
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
            refToNode.set(created.id, created);
            refToNode.set(ch.id, created);
            refToNode.set(`$${ch.id}`, created);
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
    loaded: Array<{ name: string; body: string; fileList?: string[] }>;
    loadedFiles?: Array<{ path: string; content: string }>;
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
        /** Every link on the canvas, so the agent reads the board as the user sees it. */
        connections?: CanvasConnection[];
        /** Project aspect ratio selected in the UI (e.g. "16:9" or "9:16"). */
        projectAspectRatio?: string;
    },
): Promise<AiTextMessage[]> {
    const mode: AgentMode = options?.agentMode || "canvas";
    const sb = storyboardNode?.metadata?.storyboard;
    const activeRatio = sb?.aspectRatio || options?.projectAspectRatio || "16:9";
    const turnaroundLayoutHint =
        activeRatio === "9:16"
            ? "当前项目画幅为 9:16 竖屏（角色身份板/三视图可采用「上大头特写 + 下全身三视图」或横版 16:9 身份板，下游视频引用时按实际构图写上下或左右）"
            : "当前项目画幅为 16:9 横屏（角色身份板采用「左全身/面部特写 + 右三视图」，下游视频引用时写左/右对应区域）";
    const mediaNodes = nodes
        .filter((n) => (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video || n.type === CanvasNodeType.Text) && n.metadata?.refId)
        .map((n) => `@${n.metadata!.refId} (${n.title || n.type})`);

    const canvasSystemPrompt = [
        "你是 HemosiTV 画布助手，既可以和用户自然对话（看图、看视频、改写剧本、讨论创意），也可以根据用户要求直接在画布上生成或修改「文本节点」、「图片节点（含角色卡/场景图/道具图）」或「视频节点」。",
        `【当前项目画幅设置】：${activeRatio}（系统已在界面设置好，默认除独立道具图用 "1:1" 外，场景、人物、视频节点默认 size 均使用 "${activeRatio}"，无需再向用户追问横竖屏！${turnaroundLayoutHint}）`,
        "请输出合法 JSON 对象（不要加多余包裹），结构如下：",
        `{
  "summary": "你对用户的回复（当用户说“改”或“出卡”时，先给 changes 卡片，summary 解释最多一句话！）",
  "changes": [
    { "id": "c1", "kind": "canvas.text.add", "title": "文本标题", "content": "文本节点的完整内容" },
    { "id": "c2", "kind": "canvas.image.add", "title": "图片标题", "prompt": "生图提示词", "size": "${activeRatio}|1:1", "refs": "@图20（如需参考画布已有图片，填对应 @图n；无则填空字符串）" },
    { "id": "c3", "kind": "canvas.video.add", "title": "视频标题", "prompt": "生视频提示词", "duration": 5, "size": "${activeRatio}", "refs": "@图20（首帧/参考图 @图n）" },
    { "id": "c4", "kind": "canvas.node.update", "target": "@图5", "title": "可选新标题", "prompt": "修改后的提示词", "size": "${activeRatio}|1:1（可选）", "refs": "@图1（可选，不填则自动继承原节点参考图）" }
  ],
  "loadSkills": ["需要加载的 skill 名称（可省略）"],
  "loadSkillFiles": ["需要按需读取的 skill 内部参考文件路径，如 references/xxx.md（可省略）"]
}`,
        "铁律：",
        "1. 当用户只是聊天、提问、讨论剧情时，把回答写在 summary 中，changes 设为空数组 []。",
        "2. 当用户说“改”、“重出”、“出卡”或要求创建/修改节点时：**先给卡片（必须写入 changes 数组），summary 解释最多一句话**，严禁长篇大论自我检讨或光在文字里嘴炮不传 changes！",
        "3. 【改图自动新开卡对比 vs 草稿原地更新】修改画布已有节点（如 @图5）时，可用 `canvas.node.update`（`target: \"@图5\"`）或 `canvas.image.add`：若 @图5 已有生成结果，系统会自动在旧图旁边新开一张卡并继承原参考图（保留旧图供对比抽卡）；若 @图5 是尚未生成的草稿，系统会原地修改。",
        "4. 每轮都会给你【当前画布完整快照】：全部节点、上游输入和全部连线。回答和改图都以快照为准。",
        "5. 【DAG 分波次出图与正反打黄金公式】",
        "   - 拆景先定正反两面空间：正打（S01）与反打（S02）是摄影机原地转 180° 看到的相反方向，**反打严禁重复正打的主体标志物**（如正打拍加油站与油罐车，反打必须拍对面的荒漠公路、路牌与远山，绝不能在反打里再画一遍加油站站房和油罐车，否则必被模型水平镜像翻转！）。",
        "   - 波次 1（无参考图独立资产）：角色正面全身图、主场景正打（S01）、独立道具图（P01，固定 1:1）；",
        "   - 波次 2（带 refs 衍生资产）：S02 反打空镜（refs 填正打 @图n 以继承色调与材质）、角色身份板、换装图，必须等波次 1 出图后再弹出；",
        "   - 波次 3（视频节点）：必须等参考图片全部出图后再带 refs 弹出。",
        "7. 【视频提示词铁律（只写具体画面与具体动作，严禁写文档、严禁写编号代号、严禁抽象词）】：",
        "   - 传给视频模型后图片名称和编号已经变了，模型看不到任何 `@图5 / @图30 / 图1 / 图2 / CH01 / 角色A / 女主`！要让模型找到对应的参考图，必须**直接描绘出那张参考图里的画面特征**来称呼主体（如：`扎低马尾、穿深棕短款皮夹克和黑色短裤长靴的女孩（脸部与衣服和白底横版女孩三视图一致）`、`留络腮胡、穿红棕无袖皮马甲的壮汉（脸部与衣服和白底横版壮汉三视图一致）`、`两端黄铜包裹、中间亮着蓝光的玻璃圆筒管（与白底蓝光圆筒图一致）`）。",
        "   - **严禁写 `一、人物 / 二、站位 / 三、场景 / 四、镜头叙事 / 规则： / 负面排除：` 等文档标题和列表！**",
        "   - **严禁写 `压低重心戒备、跨步逼近、神情冷冽、交锋对峙、左右不颠倒` 等抽象词！** 只用一段大白话写清：谁站在哪边、身体哪个部位做什么具体动作（如往前迈一大步伸右手去抓玻璃管、把玻璃管收到胸前退开一步躲过、抬左手拨开对方手腕）、镜头怎么移动（如从正面中景缓慢往前推、跟着后退顺势摇到近景侧面）。",
        "   - 当用户说「下一步」时，直接输出下一步对应的 changes 卡片，严禁让用户自己去建空节点或重贴剧本！",
    ].join("\n");

    const storyboardSystemPrompt = [
        "你是 HemosiTV 分镜导演 Agent，负责和用户一起把一句话需求做成：故事梗概 → 设定（角色/场景/物品）→ 设定图 → 10 列分镜表（同时也支持生成或更新独立画布节点）。",
        "请输出 JSON 对象（不要加多余包裹），结构如下：",
        `{
  "summary": "你对用户的自然回复或修改说明（可用 markdown）",
  "changes": [
    { "id": "c1", "kind": "setting.add", "setting": { "kind": "person|scene|prop", "name": "名称（同一角色换装就拆成两个设定，如：林佳佳·皮夹克）", "desc": "外观要点 + 出现镜号（写 @图1 表示这张图就是设定图，直接绑定）", "imgPrompt": "100%正向纯视觉的设定图提示词", "refs": "可选：@图1 或 @S1，表示参考它另出一张新设定图（不占用被引用的图），无则空字符串" } },
    { "id": "c2", "kind": "setting.update", "settingId": "R1", "patch": { "desc": "…", "imgPrompt": "…" } },
    { "id": "c3", "kind": "setting.review", "settingId": "R1", "actual": "这张设定图实际画了什么（服装/发型/配色/背景/时间天气/载具外形）", "conflicts": "与梗概或设定描述冲突的地方，没有就填空字符串", "ok": true },
    { "id": "c4", "kind": "row.add", "row": { "code": "S01", "duration": 4, "shotSize": "全景", "move": "缓推", "staticScreen": "静态画面", "action": "单一动作", "line": "台词或——", "sfx": "音效或——", "refs": "@R1 @S1 @P1", "note": "[切镜] 备注", "imgPrompt": "100%正向纯视觉图片提示词", "vidPrompt": "视频提示词" } },
    { "id": "c5", "kind": "row.update", "rowId": "S01", "patch": { ... } },
    { "id": "c6", "kind": "row.remove", "rowId": "S01" },
    { "id": "c7", "kind": "row.move", "rowId": "S01", "to": 0 },
    { "id": "c8", "kind": "canvas.image.add", "title": "图片标题", "prompt": "100%正向纯视觉生图提示词", "size": "9:16|16:9|1:1", "refs": "@图1" },
    { "id": "c9", "kind": "canvas.node.update", "target": "@图5", "title": "可选新标题", "prompt": "原地更新后的提示词", "size": "16:9|9:16|1:1", "refs": "@图1" }
  ],
  "suggestRun": { "rowIds": ["S01"], "kind": "image|video|both" },
  "loadSkills": ["需要加载的 skill 名称（可省略）"],
  "loadSkillFiles": ["需要按需读取的 skill 内部参考文件路径，如 references/xxx.md（可省略）"]
}`,
        "【基础交互与画布操作规则】",
        "0. 用户只是讨论、写剧本或闲聊（或者尚未确认成片横竖屏画幅 16:9 vs 9:16、画风、核心角色造型，或当前已加载的 skill 要求分步确认）时，把回答写在 summary 里，changes 设为 []。用户附带了图片或视频（如 @图1、@视1）时，你已收到真实画面，请直接观察。",
        "【先设计、后分镜】看快照里的 settingsGate：",
        "1. settingsGate.ready=false（表里没有设定，或有设定未锁定，或你判断关键的人物/场景/物品/载具还没有设定）时，本轮只能输出 setting.add / setting.update / setting.review，严禁 row.add / row.update。",
        "   - 还没有设定：先确认已对齐画幅（16:9 vs 9:16）与画风；summary 先写故事梗概（按镜头节奏分段：开端-发展-高潮-结尾），再用 setting.add 列出全部设定：角色（每套服装/造型单独一个设定）、场景、物品和载具（包括敌方的）。desc 写外观要点和出现的镜号；imgPrompt 写 100% 正向纯视觉的设定图提示词（严禁任何元指令和不要/没有/无水印/无人等否定词）。系统会为每个设定建好图片节点并绑定。",
        "   - 本轮附带了设定图（标注为「设定 @R1 …」）：逐张观察，为每张输出 setting.review：actual 写图里实际画了什么，conflicts 写和梗概/设定描述对不上的地方。有冲突时 ok=false，并在 summary 里问用户是改图（你给出新的 imgPrompt 用 setting.update）还是改剧本，不要自己往下写分镜。",
        "   - 用户给的图数量和类型都不固定（可能 0 张，也可能多张角色/场景/物品/风格参考混在一起）：逐张看图判断它属于哪个设定。图本身就能当设定图（如角色三视图、定妆照、场景图）时，在该 setting.add 的 desc 里写上它的 @图n，系统会直接绑定这张图，不再新建空节点；只是参考（如风格图、局部参考）时不要绑定，把它的特征写进 imgPrompt。基于画布已有图改出新设定（如日常角色卡 @图1 → 剧情里的废土装）时，不要把 @图1 写进 desc，而是写进 refs：系统会新建一个以设定名命名的节点，并把 @图1 连线为它的上游参考图，原图不会被改动。同一空间的正反打场景，反打设定的 refs 写正打设定编号（如 \"@S1\"）：系统会先出正打，再带着正打图生成反打，反打 imgPrompt 里写明同一空间、相反机位。引用画布图片一律用 @图n，不要用节点 id。summary 里逐张说明每张图用在哪个设定、是直接用还是只作参考。",
        "   - 设定由用户点「锁定」确认（用户也可开启让你自动锁定：审核无冲突时 ok=true）。",
        "2. settingsGate.ready=true 后才能写分镜行，且只能引用已锁定的设定。",
        "【镜头连贯硬规则】",
        "3. 每一行 refs 必须列出本镜画面里出现的全部设定（@R/@S/@P），一个都不能漏——系统按 refs 把设定图连到首帧图，漏写的设定在画面里就会走样。",
        "4. 每一镜的 staticScreen 和 imgPrompt 必须从上一镜结尾接着写：人物位置、朝向、姿态、手里拿的东西、所在载具、光线天气时间都承接上一镜结尾状态；状态要变（如上车、换装、换地点）就单独加一镜交代过程。",
        "5. note 开头必须标 [接上镜]（同一空间的连续动作）或 [切镜]（景别/机位/场景变化）。不使用尾帧接首帧，一律靠同一套锁定的设定图和承接描述保持一致。",
        "6. staticScreen 只描述静态构图，一个字不提运动；action 只描述单一连贯动作；结合全剧上下文与提示词模板写出每镜的 imgPrompt（必须 100% 正向纯视觉描写，零元指令、零否定词）与 vidPrompt。",
        "7. 写完或改完分镜行后，summary 末尾必须有「衔接自检」：逐条列出你发现的断点（服装/道具/位置/光线跳变、缺少交代的动作、引用了未锁定或不存在的设定），没有就写「未发现断点」。",
    ].join("\n");

    const skillIndex = options?.skills?.index?.length
        ? `【可用 skill 索引（L1）】当用户需求匹配某个 skill 时，在 JSON 的 loadSkills 里写上名称，系统会把该 skill 的 SKILL.md 加载给你后继续回答：\n${options.skills.index.map((k) => `- ${k.name}：${k.description}`).join("\n")}`
        : "";
    const skillBodies = options?.skills?.loaded?.length
        ? `【已激活的 skill（L2 · 请严格遵循以下 skill 的工作流、分步规则与提示词规范；若 SKILL.md 中指示调用 read 读取某个 references/... 参考文件，请在 JSON 的 loadSkillFiles 中填入该文件路径，系统会自动读取后让你继续回答）】\n${options.skills.loaded
              .map((k) => {
                  const filesHint = k.fileList?.length
                      ? `\n\n【skill「${k.name}」文件夹内可按需读取的参考文件（L3 · 在 loadSkillFiles 中填路径即可读取）】\n${k.fileList.map((f) => `- ${k.name}/${f}`).join("\n")}`
                      : "";
                  return `### skill：${k.name}\n${k.body}${filesHint}`;
              })
              .join("\n\n")}`
        : "";
    const skillRefFiles = options?.skills?.loadedFiles?.length
        ? `【已按需读取的 skill 内部参考文件（L3）】\n${options.skills.loadedFiles.map((f) => `#### 参考文件：${f.path}\n${f.content}`).join("\n\n")}`
        : "";
    const systemEnforcementGuard = [
        "【系统级最高优先级执行协议（高于任何 Skill 内置模板与默认值，违者直接判错）】",
        `1. 项目当前画幅为 ${activeRatio}（界面已设定）：除独立道具图固定 "1:1" 外，其余节点默认使用 "${activeRatio}"，不要再追问横竖屏。${turnaroundLayoutHint}。`,
        "2. 用户说“改”或“出卡”时：先给卡片（changes 数组必填），summary 解释最多一句，严禁空谈检讨或漏传 changes。",
        "3. DAG 分波次出图与正反打防镜像铁律：波次 1 只弹无参考图的独立资产（角色全身图、主场景正打 S01、独立道具 P01[1:1]）；波次 2（反打 S02、角色身份板、换装）必须等波次 1 出图后带 `refs: \"@图n\"` 弹出；波次 3（视频节点）等参考图全部出图后再弹。",
        "4. 生图提示词双轨规则与反打黄金三要素：",
        "   - 没参考图（refs 为空）：只写画面里看得见的东西，不写“生成一张”等元指令，不用“不要/没有/无人/不拿”等否定词。",
        "   - 有参考图（refs 非空）：严禁写“禁止水平翻转/不是镜像/180度反打”，严禁重复点名正打里已有的主体建筑或车辆！反打必须按「10%边缘前景遮挡（如画面左侧边缘半根生锈加油棚铁柱）+ 90%对面全新景物（如荒漠公路、倾倒路牌与远山）+ 光源反转（如夕阳在镜头后方画外打顺光，长影投向远方，天空为干净暮色）」直给画面。",
        "5. 视频提示词（vidPrompt / canvas.video.add）铁律（高于任何 Skill 模板）：",
        "   - **严禁输出 `一、人物 / 二、站位 / 三、场景 / 四、镜头叙事 / 规则： / 负面排除：` 等文档标题和列表！严禁写 `角色 A / 角色 B / 女主` 或 `@图5 / @图30 / 图1 / 图2`！**",
        "   - 模型看不到图片名字或编号，必须**直接描绘参考图里的外貌画面**让模型找到对应的图（如：`扎低马尾、穿深棕短款皮夹克和黑色短裤长靴的女孩（脸部和衣服与白底横版女孩三视图一致）`、`留络腮胡、穿红棕无袖皮马甲的壮汉（脸部和衣服与白底横版壮汉三视图一致）`、`两端黄铜包裹、中间亮蓝光的玻璃圆筒管（与白底蓝光玻璃圆筒图一致）`）。",
        "   - **严禁抽象词汇**（如“压低重心戒备、神情冷冽、交锋对峙”），只用一段大白话具体描述谁在哪边、手脚身体怎么动、镜头怎么推拉摇移。",
        "6. 用户说「下一步」时，直接在 changes 中给出下一步卡片，严禁让用户自己去拉空节点或手动贴剧本；在分镜模式下，视频统一通过分镜表行（`row.add` / `row.update` 的 `vidPrompt` 与 `duration`）生成，不要单独调 `canvas.video.add` 乱建画布视频节点。",
    ].join("\n");
    const withSkills = (base: string) => [base, skillIndex, skillBodies, skillRefFiles, systemEnforcementGuard].filter(Boolean).join("\n\n");

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
            : "";
    const canvasBlock = `${buildAgentCanvasSnapshot(nodes, options?.connections || [])}\n\n`;

    const summaryBlock = options?.compressedSummary
        ? `【早期对话压缩摘要（auto compact）】\n${options.compressedSummary}\n\n`
        : "";

    const omittedBlock = auto?.omitted.length ? `【设定图超过 ${MAX_AUTO_SETTING_IMAGES} 张，以下没有附带给你（需要时让用户拾取）】${auto.omitted.join("、")}\n\n` : "";
    const userText = `${summaryBlock}${canvasBlock}${snapshotBlock}${omittedBlock}${
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

export type AgentSkill = { name: string; description: string; body: string; files?: Record<string, string> };

/** Names the model asked for that exist and are not loaded yet. */
export function skillsToAutoLoad(requested: string[] | undefined, available: AgentSkill[], loadedNames: string[]): string[] {
    const known = new Map(available.map((k) => [k.name.trim().toLowerCase(), k.name]));
    const loaded = new Set(loadedNames.map((n) => n.toLowerCase()));
    return [...new Set((requested || []).map((n) => known.get(n.trim().toLowerCase())).filter((n): n is string => Boolean(n) && !loaded.has(n!.toLowerCase())))];
}

/** Resolve L3 reference file paths requested by the model against skill.files. */
export function skillFilesToAutoLoad(
    requested: string[] | undefined,
    available: AgentSkill[],
    loadedNames: string[],
    alreadyLoadedPaths: Set<string>,
): Array<{ path: string; content: string; skillName: string }> {
    if (!requested?.length) return [];
    const loadedSet = new Set(loadedNames.map((n) => n.toLowerCase()));
    // Search already-loaded skills first, then remaining available skills
    const ordered = [
        ...available.filter((k) => loadedSet.has(k.name.toLowerCase())),
        ...available.filter((k) => !loadedSet.has(k.name.toLowerCase())),
    ];
    const out: Array<{ path: string; content: string; skillName: string }> = [];
    for (const raw of requested) {
        const clean = raw.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").trim();
        if (!clean) continue;
        const lower = clean.toLowerCase();
        for (const skill of ordered) {
            if (!skill.files) continue;
            const prefix = `${skill.name.toLowerCase()}/`;
            const relTarget = lower.startsWith(prefix) ? clean.slice(prefix.length) : clean;
            const matchedRel = Object.keys(skill.files).find(
                (rel) => rel.toLowerCase() === relTarget.toLowerCase() || rel.toLowerCase().endsWith(`/${relTarget.toLowerCase()}`),
            );
            if (matchedRel) {
                const fullKey = `${skill.name}/${matchedRel}`;
                if (!alreadyLoadedPaths.has(fullKey.toLowerCase())) {
                    alreadyLoadedPaths.add(fullKey.toLowerCase());
                    out.push({ path: fullKey, content: skill.files[matchedRel], skillName: skill.name });
                }
                break;
            }
        }
    }
    return out;
}

/** Auto-infer L3 reference files for loaded skills based on user instruction keywords so the model never skips reading them. */
function inferSkillFilesForInstruction(
    instruction: string,
    available: AgentSkill[],
    loadedNames: string[],
    alreadyLoadedPaths: Set<string>,
): Array<{ path: string; content: string; skillName: string }> {
    const text = instruction.toLowerCase();
    const candidates: string[] = [];
    if (/(剧本|梗概|大纲|故事|定盘|小说|改编)/.test(text)) {
        candidates.push("references/script-engine.md");
    }
    if (/(分镜|站位|角色|人物|身份板|三视图|场景|空镜|正打|反打|道具|设定|资产|出图|提示词|重写|修改|@图)/.test(text)) {
        candidates.push("references/storyboard-assets.md", "references/lighting-camera.md");
    }
    if (/(视频|抽卡|动态|动作|台词|h3|seedance|可灵|muse|镜头|@视)/.test(text)) {
        candidates.push("references/gacha-prompts.md");
    }
    if (/(废片|崩|变脸|塑料|口型|重抽|剪映|剪辑)/.test(text)) {
        candidates.push("references/diagnostics-editing.md");
    }
    if (!candidates.length) return [];
    return skillFilesToAutoLoad(candidates, available, loadedNames, alreadyLoadedPaths);
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
    connections?: CanvasConnection[];
    projectAspectRatio?: string;
}): Promise<
    | { ok: true; plan: Plan; raw: string; mediaFailures: string[]; autoLoadedSkills: string[] }
    | { ok: false; raw: string; error: string; mediaFailures: string[]; autoLoadedSkills: string[] }
> {
    const available = params.skills?.available || [];
    const mentionedInText = available
        .filter((k) => {
            const esc = k.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(?:^|[\\s/$])${esc}(?=$|[\\s，。！？、,.!?])`, "i").test(params.instruction);
        })
        .map((k) => k.name);
    let loadedNames = [...new Set([...(params.skills?.activeNames || []).filter((n) => available.some((k) => k.name === n)), ...mentionedInText])];
    const autoLoadedSkills: string[] = [...mentionedInText];
    const loadedFiles: Array<{ path: string; content: string }> = [];
    const loadedFileKeys = new Set<string>();

    // Pre-attach matched L3 reference files for any already-active skills so the model never skips reading them.
    for (const wf of inferSkillFilesForInstruction(params.instruction, available, loadedNames, loadedFileKeys)) {
        loadedFiles.push({ path: wf.path, content: wf.content });
        autoLoadedSkills.push(wf.path);
    }

    // Progressive disclosure: L1 (index) -> L2 (SKILL.md) -> L3 (references/* on demand).
    for (let round = 0; round < 3; round++) {
        const res = await requestPlanOnce(params, {
            index: available.filter((k) => !loadedNames.includes(k.name)).map(({ name, description }) => ({ name, description })),
            loaded: available
                .filter((k) => loadedNames.includes(k.name))
                .map(({ name, body, files }) => ({ name, body, fileList: files ? Object.keys(files) : undefined })),
            loadedFiles,
        });
        if (!res.ok || round === 2) return { ...res, autoLoadedSkills: [...new Set(autoLoadedSkills)] };
        const wantedSkills = skillsToAutoLoad(res.plan.loadSkills, available, loadedNames);
        const nextLoadedNames = [...loadedNames, ...wantedSkills];
        const wantedFiles = [
            ...skillFilesToAutoLoad(res.plan.loadSkillFiles, available, nextLoadedNames, loadedFileKeys),
            ...(wantedSkills.length ? inferSkillFilesForInstruction(params.instruction, available, nextLoadedNames, loadedFileKeys) : []),
        ];
        if (!wantedSkills.length && !wantedFiles.length) {
            return { ...res, autoLoadedSkills: [...new Set(autoLoadedSkills)] };
        }
        for (const sName of wantedSkills) {
            if (!loadedNames.includes(sName)) loadedNames.push(sName);
            autoLoadedSkills.push(sName);
        }
        for (const wf of wantedFiles) {
            if (!loadedNames.includes(wf.skillName)) loadedNames.push(wf.skillName);
            loadedFiles.push({ path: wf.path, content: wf.content });
            autoLoadedSkills.push(wf.path);
        }
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
            connections: params.connections,
            projectAspectRatio: params.projectAspectRatio,
            onMediaFailures: (failures) => {
                mediaFailures = failures;
            },
        },
    );

    let lastRaw = "";
    let lastError = "";
    const claimsCardAction = (text: string) =>
        /(已为你|已弹出|已生成|已创建|已新建|已更新|已原地更新|重新弹出|已重出|点击「应用|修改并立即运行|应用修改)/.test(text);

    for (let attempt = 0; attempt < 3; attempt++) {
        const retryMessages: AiTextMessage[] =
            attempt === 0
                ? messages
                : [
                      ...messages,
                      { role: "assistant", content: lastRaw },
                      {
                          role: "user",
                          content: `上次输出校验失败：${lastError}\n请严格修正并输出包含有效 changes 数组的合法 JSON 对象。`,
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
                const summaryText = summaryOnlyText(trimmed);
                const skillsWanted = loadSkillsOf(trimmed);
                if (!skillsWanted?.length && claimsCardAction(summaryText)) {
                    lastError = "你在回复中声称已弹出或修改了卡片，但没有输出 JSON 的 changes 数组！请把节点卡片放进 changes 数组中重发。";
                    continue;
                }
                return { ok: true, plan: { summary: summaryText, changes: [], loadSkills: skillsWanted }, raw, mediaFailures };
            }
            const parsed = JSON.parse(extractJsonObject(raw));
            const validated = PlanSchema.safeParse(parsed);
            if (validated.success) {
                const plan = validated.data;
                if (
                    plan.changes.length === 0 &&
                    !plan.loadSkills?.length &&
                    !plan.loadSkillFiles?.length &&
                    claimsCardAction(plan.summary)
                ) {
                    lastError = "你在 summary 中声称已弹出或修改了节点卡片，但 changes 数组为空 []！请直接把对应的节点写入 changes 数组后重新输出。";
                    continue;
                }
                const hasDocFormatVideoPrompt = plan.changes.some((c) => {
                    const vp =
                        c.kind === "canvas.video.add"
                            ? c.prompt
                            : c.kind === "row.add"
                              ? c.row.vidPrompt
                              : c.kind === "row.update"
                                ? c.patch.vidPrompt
                                : "";
                    return Boolean(vp && /(?:^|\n)\s*[一二三四五六七八]、\s*(?:人物|站位|场景|镜头|滤镜|画面|音频|负面)/.test(vp));
                });
                if (hasDocFormatVideoPrompt) {
                    lastError =
                        "视频提示词（vidPrompt / canvas.video.add）严禁使用「一、人物 / 二、站位 / 三、场景 / 四、镜头叙事」等八股文档标题和列表！请重写为一段自然连贯的电影镜头剧情描写：开头简单描绘图1（首帧）、图2、图3分别是什么外观，接着直接用连贯句子描写本段真实发生的剧情动作、人物交锋互动、运镜推进与光影音效。";
                    continue;
                }
                return { ok: true, plan, raw, mediaFailures };
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
