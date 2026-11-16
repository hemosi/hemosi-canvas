import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const GAP_X = 120;
const GAP_Y = 48;

/**
 * 一键整理: lay the chosen nodes out in columns by link depth (sources left, results right), each column stacked
 * top to bottom in its current vertical order, with 分镜表 pinned to the top of its column as the anchor. A chosen group moves as one block with its members.
 */
export function autoLayoutNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], ids: Set<string>) {
    const chosen = nodes.filter((node) => ids.has(node.id));
    const groupIds = new Set(chosen.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
    const units = chosen.filter((node) => !(node.metadata?.groupId && groupIds.has(node.metadata.groupId)));
    if (units.length < 2) return nodes;
    const unitOf = new Map<string, string>();
    nodes.forEach((node) => {
        if (units.some((unit) => unit.id === node.id)) unitOf.set(node.id, node.id);
        else if (node.metadata?.groupId && groupIds.has(node.metadata.groupId)) unitOf.set(node.id, node.metadata.groupId);
    });
    const edges = connections.flatMap((connection) => {
        const from = unitOf.get(connection.fromNodeId);
        const to = unitOf.get(connection.toNodeId);
        return from && to && from !== to ? [[from, to] as const] : [];
    });
    const depth = new Map(units.map((unit) => [unit.id, 0]));
    // Longest-path depth; bounded passes keep cycles from looping forever.
    for (let pass = 0; pass < units.length; pass += 1) {
        let changed = false;
        edges.forEach(([from, to]) => {
            const next = (depth.get(from) || 0) + 1;
            if (next > (depth.get(to) || 0) && next < units.length) {
                depth.set(to, next);
                changed = true;
            }
        });
        if (!changed) break;
    }
    const left = Math.min(...units.map((unit) => unit.position.x));
    const top = Math.min(...units.map((unit) => unit.position.y));
    const delta = new Map<string, { x: number; y: number }>();
    // 分镜表单独置顶成一排，其余节点整体排在它下面，不和分镜表混在同一列。
    const tables = units.filter((unit) => unit.type === HemosiNodeType.Storyboard).sort((a, b) => a.position.x - b.position.x);
    let tableX = left;
    tables.forEach((unit) => {
        delta.set(unit.id, { x: tableX - unit.position.x, y: top - unit.position.y });
        tableX += unit.width + GAP_X;
    });
    const bodyTop = tables.length ? top + Math.max(...tables.map((unit) => unit.height)) + GAP_Y * 2 : top;
    const columns = new Map<number, CanvasNodeData[]>();
    units.filter((unit) => unit.type !== HemosiNodeType.Storyboard).forEach((unit) => columns.set(depth.get(unit.id) || 0, [...(columns.get(depth.get(unit.id) || 0) || []), unit]));
    let x = left;
    [...columns.keys()].sort((a, b) => a - b).forEach((column) => {
        const members = columns.get(column)!.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        let y = bodyTop;
        members.forEach((unit) => {
            delta.set(unit.id, { x: x - unit.position.x, y: y - unit.position.y });
            y += unit.height + GAP_Y;
        });
        x += Math.max(...members.map((unit) => unit.width)) + GAP_X;
    });
    return nodes.map((node) => {
        const unit = unitOf.get(node.id);
        const move = unit ? delta.get(unit) : undefined;
        return move ? { ...node, position: { x: node.position.x + move.x, y: node.position.y + move.y } } : node;
    });
}

/** 选中状态的「整理」：选中的节点按原来的上下顺序竖排成一列，左边对齐；分组整体移动。 */
export function stackNodesVertically(nodes: CanvasNodeData[], ids: Set<string>) {
    const chosen = nodes.filter((node) => ids.has(node.id));
    const groupIds = new Set(chosen.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
    const units = chosen.filter((node) => !(node.metadata?.groupId && groupIds.has(node.metadata.groupId))).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    if (units.length < 2) return nodes;
    const left = Math.min(...units.map((unit) => unit.position.x));
    let y = Math.min(...units.map((unit) => unit.position.y));
    const delta = new Map<string, { x: number; y: number }>();
    units.forEach((unit) => {
        delta.set(unit.id, { x: left - unit.position.x, y: y - unit.position.y });
        y += unit.height + GAP_Y;
    });
    return nodes.map((node) => {
        const move = delta.get(node.id) || (node.metadata?.groupId ? delta.get(node.metadata.groupId) : undefined);
        return move ? { ...node, position: { x: node.position.x + move.x, y: node.position.y + move.y } } : node;
    });
}

/** Nodes whose title or text matches the query (title, text, prompt, shot description). */
export function searchNodes(nodes: CanvasNodeData[], query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((node) => {
        const meta = node.metadata || {};
        const shot = meta.shotNo !== undefined ? `镜头 ${meta.shotNo} #${meta.shotNo}` : "";
        return [node.title, meta.content?.startsWith("blob:") || meta.content?.startsWith("data:") ? "" : meta.content, meta.prompt, meta.shotDescription, shot].some((value) => value?.toLowerCase().includes(q));
    });
}
