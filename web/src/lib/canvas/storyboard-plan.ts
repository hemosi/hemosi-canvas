import { nanoid } from "nanoid";
import { z } from "zod";

import { SettingKindSchema, type SettingItem, type StoryboardData, type StoryboardRow } from "@/lib/canvas/storyboard-types";
import {
    extractAtTokens,
    nextSettingId,
    nextShotCode,
    reconcileStoryboardGraph,
} from "@/lib/canvas/storyboard-utils";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
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
]);
export type Change = z.infer<typeof ChangeSchema>;

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

export function applyPlan(params: {
    storyboardNodeId: string;
    data: StoryboardData;
    plan: Plan;
    enabledIds: Set<string>;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    refCounters?: Record<string, number>;
    removeOrphanDownstream?: boolean;
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

    // Ensure added rows have fresh unique IDs on commit
    const finalRows = next.rows.map((r) =>
        r.id.startsWith("row-c") || diff.addedRowIds.includes(r.id) ? { ...r, id: `row-${nanoid(8)}` } : r,
    );

    const reconciled = reconcileStoryboardGraph({
        storyboardNodeId: params.storyboardNodeId,
        data: { ...next, rows: finalRows },
        nodes: nextNodes,
        connections: nextConnections,
        refCounters: params.refCounters,
        autoLayout: true,
    });

    return {
        ...reconciled,
        warnings,
        diff,
    };
}

export function buildStoryboardAgentMessages(
    storyboardNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    instruction: string,
    selectedRowId?: string | null,
): AiTextMessage[] {
    const sb = storyboardNode.metadata?.storyboard;
    const imageNodes = nodes
        .filter((n) => n.type === CanvasNodeType.Image && n.metadata?.refId)
        .map((n) => `@${n.metadata!.refId} (${n.title || "图片"})`);

    const snapshot = {
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
        selectedRowId: selectedRowId || null,
        availableImages: imageNodes,
    };

    const systemPrompt = [
        "你是 HemosiTV 导演 Agent。请根据当前分镜表快照与用户指令，输出严格合法的 JSON 格式修改方案（Plan）。",
        "输出必须是纯 JSON 对象（不要 markdown 代码块或多余文字），结构如下：",
        `{
  "summary": "一句话说明本次修改",
  "changes": [
    { "id": "c1", "kind": "setting.add", "setting": { "kind": "person|scene|prop", "name": "名称", "desc": "外观描述" } },
    { "id": "c2", "kind": "row.add", "row": { "code": "S01", "duration": 4, "shotSize": "全景", "move": "缓推", "staticScreen": "静态画面", "action": "单一动作", "line": "台词或——", "sfx": "音效或——", "refs": "@R1 / @S1", "note": "备注", "imgPrompt": "图片提示词", "vidPrompt": "视频提示词" } },
    { "id": "c3", "kind": "row.update", "rowId": "S01或rowId", "patch": { ... } },
    { "id": "c4", "kind": "row.remove", "rowId": "S01或rowId" },
    { "id": "c5", "kind": "row.move", "rowId": "S01或rowId", "to": 0 }
  ],
  "suggestRun": { "rowIds": ["S01"], "kind": "image|video|both" }
}`,
        "铁律：",
        "1. staticScreen 只描述静态构图，一个字不提运动；action 只描述单一连贯动作。",
        "2. 必须结合全剧上下文以及 imageModelRule / videoModelRule 直接写出每镜的 imgPrompt（图片提示词）与 vidPrompt（视频提示词）。",
        "3. 引用角色/场景/图片节点时使用 @R1、@S1、@图n。",
    ].join("\n");

    return [
        { role: "system", content: systemPrompt },
        {
            role: "user",
            content: `【当前分镜表快照】\n${JSON.stringify(snapshot, null, 2)}\n\n【用户指令】\n${instruction}`,
        },
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
    storyboardNode: CanvasNodeData;
    nodes: CanvasNodeData[];
    instruction: string;
    selectedRowId?: string | null;
    signal?: AbortSignal;
}): Promise<{ ok: true; plan: Plan; raw: string } | { ok: false; raw: string; error: string }> {
    const messages = buildStoryboardAgentMessages(
        params.storyboardNode,
        params.nodes,
        params.instruction,
        params.selectedRowId,
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
                          content: `上次输出校验失败：${lastError}\n请严格修正并只输出合法 JSON 对象。`,
                      },
                  ];

        let raw = "";
        raw = await requestImageQuestion(
            params.config,
            retryMessages,
            () => {},
            { signal: params.signal },
        );
        lastRaw = raw;

        try {
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
