import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

export type QuickGrowKind = "text" | "image" | "video" | "edit";

/** Node types that can grow a downstream node with the "+" handle. */
export function canQuickGrow(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
}

/** Menu entries offered for a source node; an image with content offers 改图 instead of plain image generation. */
export function quickGrowKinds(node: CanvasNodeData): QuickGrowKind[] {
    const hasImage = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    if (node.type === CanvasNodeType.Audio) return ["text", "video"];
    return hasImage ? ["text", "edit", "video"] : ["text", "image", "video"];
}

export function quickGrowNodeType(kind: QuickGrowKind) {
    if (kind === "text") return CanvasNodeType.Text;
    if (kind === "video") return CanvasNodeType.Video;
    return CanvasNodeType.Image;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: CanvasNodeData, gap: number) {
    return a.x < b.position.x + b.width + gap && a.x + a.width + gap > b.position.x && a.y < b.position.y + b.height + gap && a.y + a.height + gap > b.position.y;
}

/**
 * Top-left position for a new node placed to the right of `source`, vertically centred on it.
 * Steps down (then up) in node-height increments until the slot does not overlap any existing node.
 */
export function findFreeRightPosition(source: CanvasNodeData, size: { width: number; height: number }, nodes: CanvasNodeData[], gapX = 96, gap = 24): Position {
    const x = source.position.x + source.width + gapX;
    const baseY = source.position.y + source.height / 2 - size.height / 2;
    const others = nodes.filter((node) => node.id !== source.id && node.type !== CanvasNodeType.Group);
    const step = size.height + gap;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const offset = attempt === 0 ? 0 : Math.ceil(attempt / 2) * step * (attempt % 2 === 1 ? 1 : -1);
        const candidate = { x, y: baseY + offset, width: size.width, height: size.height };
        if (!others.some((node) => overlaps(candidate, node, gap))) return { x, y: candidate.y };
    }
    return { x, y: baseY };
}
