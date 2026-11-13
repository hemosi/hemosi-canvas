import { CanvasNodeType, HemosiNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

const REF_PREFIX_MAP: Record<string, string> = {
    [CanvasNodeType.Image]: "图",
    [CanvasNodeType.Video]: "视",
    [CanvasNodeType.Text]: "文",
    [CanvasNodeType.Audio]: "音",
    [CanvasNodeType.Config]: "配",
    [CanvasNodeType.Group]: "组",
    [HemosiNodeType.Storyboard]: "表",
    [HemosiNodeType.Shot]: "镜",
    [HemosiNodeType.Bookmark]: "签",
    [HemosiNodeType.ImageCompare]: "比",
    [HemosiNodeType.ViralClone]: "复",
};

export function refPrefixForType(type: CanvasNodeTypeId): string {
    return REF_PREFIX_MAP[type] || "节";
}

function parseSuffixNumber(refId: string | undefined, prefix: string): number {
    if (!refId || !refId.startsWith(prefix)) return 0;
    const num = Number(refId.slice(prefix.length));
    return Number.isInteger(num) && num > 0 ? num : 0;
}

/** Allocate a monotonic short refId (e.g. 图1, 视1, 表1); deleted IDs are never reused. */
export function allocateRefId(
    type: CanvasNodeTypeId,
    nodes: CanvasNodeData[],
    counters: Record<string, number> = {},
): { refId: string; nextCounters: Record<string, number> } {
    const prefix = refPrefixForType(type);
    const maxExisting = nodes.reduce((max, node) => Math.max(max, parseSuffixNumber(node.metadata?.refId, prefix)), 0);
    const nextNum = Math.max(counters[prefix] ?? 0, maxExisting) + 1;
    return {
        refId: `${prefix}${nextNum}`,
        nextCounters: { ...counters, [prefix]: nextNum },
    };
}

/** Ensure every node in a project has a stable metadata.refId and return updated counters. */
export function ensureNodeRefIds(
    nodes: CanvasNodeData[],
    counters: Record<string, number> = {},
): { nodes: CanvasNodeData[]; counters: Record<string, number>; changed: boolean } {
    let nextCounters = { ...counters };
    let changed = false;

    for (const node of nodes) {
        const prefix = refPrefixForType(node.type);
        const num = parseSuffixNumber(node.metadata?.refId, prefix);
        if (num > (nextCounters[prefix] ?? 0)) {
            nextCounters[prefix] = num;
        }
    }

    const nextNodes = nodes.map((node) => {
        if (node.metadata?.refId) return node;
        changed = true;
        const allocated = allocateRefId(node.type, nodes, nextCounters);
        nextCounters = allocated.nextCounters;
        return {
            ...node,
            metadata: { ...node.metadata, refId: allocated.refId },
        };
    });

    return { nodes: nextNodes, counters: nextCounters, changed };
}
