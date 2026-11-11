import { getNodeSpec } from "@/constant/canvas";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

/** Canvas-page actions that shot/anchor node content calls; registered by the canvas page while it is mounted. */
export type ShotHost = {
    generate: (nodeId: string, kind: "image" | "video") => Promise<boolean>;
    selectRow: (nodeId: string) => void;
    openVersions: (nodeId: string) => void;
    downstreamCount: (nodeId: string) => number;
};

let host: ShotHost | null = null;

export function setShotHost(next: ShotHost) {
    host = next;
    return () => {
        if (host === next) host = null;
    };
}

export function getShotHost() {
    return host;
}

const isShot = (node: CanvasNodeData) => node.type === HemosiNodeType.Shot;

/** Shots in the same row as `nodeId`: same group when grouped, otherwise shots whose vertical centres line up with it. */
export function shotRowMembers(nodeId: string, nodes: CanvasNodeData[]) {
    const self = nodes.find((node) => node.id === nodeId);
    if (!self || !isShot(self)) return [];
    const groupId = self.metadata?.groupId;
    const centerY = self.position.y + self.height / 2;
    const tolerance = Math.max(self.height / 2, 80);
    return nodes
        .filter((node) => isShot(node) && (groupId ? node.metadata?.groupId === groupId : !node.metadata?.groupId && Math.abs(node.position.y + node.height / 2 - centerY) < tolerance))
        .sort((a, b) => a.position.x - b.position.x);
}

/** Renumber the rows of the moved shots left to right, keeping each row's first number: dragging a shot reorders its shot number. */
export function renumberShotRows(movedIds: Iterable<string>, nodes: CanvasNodeData[]) {
    const updates = new Map<string, number>();
    const seen = new Set<string>();
    for (const id of movedIds) {
        if (seen.has(id)) continue;
        const row = shotRowMembers(id, nodes);
        row.forEach((node) => seen.add(node.id));
        if (row.length < 2) continue;
        const start = Math.min(...row.map((node) => node.metadata?.shotNo ?? 1));
        row.forEach((node, index) => {
            if ((node.metadata?.shotNo ?? 0) !== start + index) updates.set(node.id, start + index);
        });
    }
    if (!updates.size) return nodes;
    return nodes.map((node) => (updates.has(node.id) ? { ...node, metadata: { ...node.metadata, shotNo: updates.get(node.id) } } : node));
}

/** Split script text into shot descriptions: by blank-line paragraphs, or by non-empty lines. */
export function splitScript(text: string, by: "paragraph" | "line") {
    const parts = by === "paragraph" ? text.split(/\n\s*\n+/) : text.split(/\n+/);
    return parts.map((part) => part.trim()).filter(Boolean);
}

export function nextShotNo(nodes: CanvasNodeData[]) {
    return nodes.reduce((max, node) => (isShot(node) ? Math.max(max, node.metadata?.shotNo ?? 0) : max), 0) + 1;
}

export function downstreamNodeCount(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections.filter((connection) => connection.fromNodeId === nodeId && nodes.some((node) => node.id === connection.toNodeId && node.type !== CanvasNodeType.Group)).length;
}

/** A scene: one group holding a row of empty shots (one per script part, description filled in), left edge at `origin`. */
export function buildShotRow(parts: string[], origin: Position, startNo: number, groupTitle: string) {
    const spec = getNodeSpec(HemosiNodeType.Shot);
    const gap = 40;
    const shots = parts.map((text, index) => ({
        ...createCanvasNode(HemosiNodeType.Shot, { x: origin.x + index * (spec.width + gap) + spec.width / 2, y: origin.y + spec.height / 2 }, { shotNo: startNo + index, shotDescription: text, shotRefs: [] }),
        title: `镜头 ${startNo + index}`,
    }));
    const rect = getGroupWrapRect(shots);
    const group = { ...createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 }), title: groupTitle, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height };
    return [group, ...shots.map((shot) => ({ ...shot, metadata: { ...shot.metadata, groupId: group.id } }))];
}
