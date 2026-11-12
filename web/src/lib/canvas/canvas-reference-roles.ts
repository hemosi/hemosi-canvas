import type { NodeGenerationResourceInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, HemosiNodeType, type CanvasAnchorKind, type CanvasAudioRole, type CanvasConnection, type CanvasImageRole, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const IMAGE_ROLES: CanvasImageRole[] = ["reference", "firstFrame", "lastFrame", "character", "scene", "style"];
export const IMAGE_ROLE_LABEL: Record<CanvasImageRole, string> = { reference: "参考图", firstFrame: "首帧", lastFrame: "尾帧", character: "角色定妆", scene: "场景参考", style: "风格参考" };
export const AUDIO_ROLES: CanvasAudioRole[] = ["voice", "bgm", "sfx"];
export const AUDIO_ROLE_LABEL: Record<CanvasAudioRole, string> = { voice: "配音", bgm: "BGM", sfx: "音效" };
export const ANCHOR_KINDS: CanvasAnchorKind[] = ["character", "scene", "style"];
export const ANCHOR_KIND_LABEL: Record<CanvasAnchorKind, string> = { character: "角色", scene: "场景", style: "风格" };

/** The text an anchor puts into every prompt it feeds: collects all filled-in slots (character / scene / style) or legacy single slot. */
export function anchorPromptBlock(node: CanvasNodeData) {
    const meta = node.metadata || {};
    const slots = meta.anchorSlots;
    if (slots) {
        const parts: string[] = [];
        const labels: string[] = [];
        for (const k of ANCHOR_KINDS) {
            const t = (slots[k]?.text || "").trim();
            if (!t) continue;
            const hint = k === "character" ? "保持该角色外形、服装与参考定妆照一致" : k === "scene" ? "保持场景布局、陈设与参考图一致" : "整体画面风格遵循以下风格设定与样图";
            labels.push(ANCHOR_KIND_LABEL[k]);
            parts.push(`【${ANCHOR_KIND_LABEL[k]}设定】${hint}：\n${t}`);
        }
        if (!parts.length) return null;
        return { label: `${labels.join("+")}锚点·${node.title || "设定"}`, text: parts.join("\n\n") };
    }
    const kind = meta.anchorKind || "character";
    const text = (meta.anchorText || "").trim();
    if (!text) return null;
    const label = `${ANCHOR_KIND_LABEL[kind]}锚点·${node.title || ANCHOR_KIND_LABEL[kind]}`;
    const hint = kind === "character" ? "保持该角色外形、服装与参考定妆照一致" : kind === "scene" ? "保持场景布局、陈设与参考图一致" : "整体画面风格遵循以下风格设定与样图";
    return { label, text: `${hint}：\n${text}` };
}

const baseId = (nodeId: string) => nodeId.split("#")[0];

/**
 * Apply a generation node's reference order (refOrder) and switches (refDisabled) to its upstream inputs.
 * Anchor sub-resources (`<anchorId>#<imageId>`) follow their anchor's position and can be switched one by one.
 * For video runs, first frames go first and last frames second so they land in the first/last-frame slots.
 */
export function orderReferenceInputs(inputs: NodeGenerationResourceInput[], meta: CanvasNodeMetadata | undefined, video: boolean) {
    const disabled = new Set(meta?.refDisabled || []);
    const order = meta?.refOrder || [];
    const rank = (input: NodeGenerationResourceInput) => {
        const index = order.indexOf(input.nodeId);
        const parent = order.indexOf(baseId(input.nodeId));
        return index >= 0 ? index : parent >= 0 ? parent : order.length;
    };
    const enabled = inputs.filter((input) => !disabled.has(input.nodeId) && !disabled.has(baseId(input.nodeId)));
    const sorted = enabled.map((input, index) => ({ input, index })).sort((a, b) => rank(a.input) - rank(b.input) || a.index - b.index).map((item) => item.input);
    if (!video) return sorted;
    const frameRank = (input: NodeGenerationResourceInput) => (input.role === "firstFrame" ? 0 : input.role === "lastFrame" ? 1 : 2);
    return sorted.map((input, index) => ({ input, index })).sort((a, b) => frameRank(a.input) - frameRank(b.input) || a.index - b.index).map((item) => item.input);
}

export type ReferenceSlot = { id: string; title: string; kind: "image" | "video" | "audio" | "text" | "anchor"; previewUrl?: string; role?: CanvasImageRole; audioRole?: CanvasAudioRole; enabled: boolean };

/** Upstream references of a generation node in the order the generation will use them, for the reference strip UI. */
export function listReferenceSlots(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): ReferenceSlot[] {
    const disabled = new Set(node.metadata?.refDisabled || []);
    const order = node.metadata?.refOrder || [];
    const upstream = connections.filter((connection) => connection.toNodeId === node.id).map((connection) => nodes.find((item) => item.id === connection.fromNodeId)).filter((item): item is CanvasNodeData => Boolean(item) && item!.type !== CanvasNodeType.Config);
    const slots = upstream.flatMap((source): ReferenceSlot[] => {
        const meta = source.metadata || {};
        if (source.type === CanvasNodeType.Image && meta.content) return [{ id: source.id, title: source.title, kind: "image", previewUrl: meta.content, role: meta.imageRole, enabled: !disabled.has(source.id) }];
        if (source.type === CanvasNodeType.Video && meta.content) return [{ id: source.id, title: source.title, kind: "video", previewUrl: meta.content, enabled: !disabled.has(source.id) }];
        if (source.type === CanvasNodeType.Audio && meta.content) return [{ id: source.id, title: source.title, kind: "audio", audioRole: meta.audioRole, enabled: !disabled.has(source.id) }];
        if (source.type === HemosiNodeType.Anchor) return [{ id: source.id, title: `${ANCHOR_KIND_LABEL[meta.anchorKind || "character"]}·${source.title}`, kind: "anchor", previewUrl: meta.anchorImages?.[0]?.content, enabled: !disabled.has(source.id) }];
        if (source.type === HemosiNodeType.Shot && (meta.shotImage?.content || meta.shotVideo?.content)) return [{ id: source.id, title: source.title, kind: meta.shotVideo?.content ? "video" : "image", previewUrl: meta.shotImage?.content, enabled: !disabled.has(source.id) }];
        if (source.type === CanvasNodeType.Text && (meta.content || meta.prompt)) return [{ id: source.id, title: source.title, kind: "text", enabled: !disabled.has(source.id) }];
        return [];
    });
    const rank = (slot: ReferenceSlot) => (order.includes(slot.id) ? order.indexOf(slot.id) : order.length);
    return slots.map((slot, index) => ({ slot, index })).sort((a, b) => rank(a.slot) - rank(b.slot) || a.index - b.index).map((item) => item.slot);
}

/** Move a slot one step left/right; returns the new refOrder. */
export function moveReferenceSlot(slots: ReferenceSlot[], id: string, delta: -1 | 1) {
    const ids = slots.map((slot) => slot.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return ids;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return ids;
}

/** Which slot of a video generation each image lands in: 首帧 / 尾帧 / 参考. Mirrors orderReferenceInputs + video API frame mode. */
export function videoFrameSlots(slots: ReferenceSlot[]) {
    const images = slots.filter((slot) => slot.enabled && (slot.kind === "image" || slot.kind === "anchor"));
    const sorted = [...images].sort((a, b) => (a.role === "firstFrame" ? 0 : a.role === "lastFrame" ? 1 : 2) - (b.role === "firstFrame" ? 0 : b.role === "lastFrame" ? 1 : 2));
    const framed = sorted.some((slot) => slot.role === "firstFrame" || slot.role === "lastFrame") || sorted.length <= 2;
    if (!framed) return { first: undefined, last: undefined, references: sorted };
    const first = sorted.find((slot) => slot.role === "firstFrame") || sorted.find((slot) => slot.role !== "lastFrame");
    const last = sorted.find((slot) => slot.role === "lastFrame") || (sorted.length === 2 ? sorted.find((slot) => slot !== first) : undefined);
    return { first, last, references: [] as ReferenceSlot[] };
}
