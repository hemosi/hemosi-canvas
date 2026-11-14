import type { NodeGenerationResourceInput } from "@/components/canvas/canvas-node-generation";
import { planVideoImageSend, videoSendPlanLabel } from "@/lib/video-send-plan";
import { CanvasNodeType, HemosiNodeType, type CanvasAudioRole, type CanvasConnection, type CanvasImageRole, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const IMAGE_ROLES: CanvasImageRole[] = ["reference", "firstFrame", "lastFrame", "character", "scene", "style"];
export const IMAGE_ROLE_LABEL: Record<CanvasImageRole, string> = { reference: "参考图", firstFrame: "首帧", lastFrame: "尾帧", character: "角色定妆", scene: "场景参考", style: "风格参考" };
export const AUDIO_ROLES: CanvasAudioRole[] = ["voice", "bgm", "sfx"];
export const AUDIO_ROLE_LABEL: Record<CanvasAudioRole, string> = { voice: "配音", bgm: "BGM", sfx: "音效" };

const baseId = (nodeId: string) => nodeId.split("#")[0];

/**
 * Apply a generation node's reference order (refOrder) and switches (refDisabled) to its upstream inputs.
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

export type ReferenceSlot = { id: string; title: string; kind: "image" | "video" | "audio" | "text"; previewUrl?: string; role?: CanvasImageRole; audioRole?: CanvasAudioRole; enabled: boolean };

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

/** Which slot of a video generation each image lands in: 首帧 / 尾帧 / 参考 / 不发送. Same rule the request uses (planVideoImageSend). */
export function videoFrameSlots(slots: ReferenceSlot[]) {
    const images = slots.filter((slot) => slot.enabled && slot.kind === "image");
    const plan = planVideoImageSend(images.map((slot) => slot.role));
    return {
        plan,
        label: videoSendPlanLabel(plan, images.length),
        first: plan.first !== undefined ? images[plan.first] : undefined,
        last: plan.last !== undefined ? images[plan.last] : undefined,
        references: plan.references.map((i) => images[i]),
        dropped: plan.dropped.map((i) => images[i]),
    };
}
