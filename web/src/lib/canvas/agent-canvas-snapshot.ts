import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const MAX_NODES = 300;
const clip = (s: string | undefined, n: number) => {
    const t = (s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Short name the agent and the user both use for a node: its @ref, else the title. */
export function agentNodeLabel(n: CanvasNodeData): string {
    return n.metadata?.refId ? `@${n.metadata.refId}` : `「${n.title || n.type}」#${n.id.slice(-4)}`;
}

/** The whole canvas as the agent reads it each turn: every node, every link, groups and layout. */
export function buildAgentCanvasSnapshot(nodes: CanvasNodeData[], connections: CanvasConnection[]): string {
    if (!nodes.length) return "【当前画布】空白画布，没有任何节点。";
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const groups = nodes.filter((n) => n.type === CanvasNodeType.Group);
    const label = (id: string) => {
        const n = byId.get(id);
        return n ? agentNodeLabel(n) : "(已删除节点)";
    };
    const upstreamOf = (id: string) => connections.filter((c) => c.toNodeId === id);
    const shown = nodes.filter((n) => n.type !== HemosiNodeType.Bookmark).slice(0, MAX_NODES);

    const nodeLines = shown.map((n) => {
        const m = n.metadata || {};
        const parts: string[] = [`${agentNodeLabel(n)} 类型=${n.type}`];
        if (n.title) parts.push(`标题=${clip(n.title, 40)}`);
        if (m.groupId && byId.get(m.groupId)) parts.push(`分组=${clip(byId.get(m.groupId)!.title, 20) || "未命名分组"}`);
        parts.push(`位置=(${Math.round(n.position.x)},${Math.round(n.position.y)})`);
        if (m.imageRole) parts.push(`身份=${m.imageRole}`);
        if (m.material) parts.push("素材文件");
        const prompt = m.rawPrompt || m.prompt;
        if (prompt && n.type !== CanvasNodeType.Text) parts.push(`提示词=${clip(prompt, 300)}`);
        if (n.type === CanvasNodeType.Text) {
            const fullText = (m.texts?.find((t) => t.id === m.primaryTextId)?.content || m.texts?.[0]?.content || m.content || m.prompt || "").trim();
            if (fullText) parts.push(`全文内容=\n"""\n${fullText}\n"""`);
        }
        if (m.model) parts.push(`模型=${m.model}`);
        if (m.size) parts.push(`比例=${m.size}`);
        if (m.seconds) parts.push(`时长=${m.seconds}s`);
        if (m.status) parts.push(`状态=${m.status === "success" ? "已生成" : m.status === "loading" ? "生成中" : m.status === "error" ? "失败" : "未生成"}`);
        if (m.status === "error" && m.errorDetails) parts.push(`错误=${clip(m.errorDetails, 80)}`);
        if ((n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) && m.content) parts.push("有结果");
        if (m.versions?.length) parts.push(`历史版本=${m.versions.length}`);
        if (m.shotNo) parts.push(`镜号=${m.shotNo}`);
        if (m.shotDescription) parts.push(`镜头=${clip(m.shotDescription, 120)}`);
        const ups = upstreamOf(n.id);
        if (ups.length) {
            const disabled = new Set(m.refDisabled || []);
            const order = m.refOrder || [];
            const sorted = [...ups].sort((a, b) => {
                const ia = order.indexOf(a.fromNodeId), ib = order.indexOf(b.fromNodeId);
                return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
            });
            parts.push(`上游输入=${sorted.map((c) => `${label(c.fromNodeId)}${disabled.has(c.fromNodeId) ? "(已关闭)" : ""}`).join(" ")}`);
        }
        return `- ${parts.join("；")}`;
    });

    const linkLines = connections
        .filter((c) => byId.has(c.fromNodeId) && byId.has(c.toNodeId))
        .map((c) => `${label(c.fromNodeId)} → ${label(c.toNodeId)}${c.kind ? `（${c.kind === "reference" ? "参考" : c.kind === "input" ? "输入" : "接续"}）` : ""}`);

    return [
        `【当前画布完整快照】共 ${nodes.length} 个节点、${connections.length} 条连线${groups.length ? `、${groups.length} 个分组` : ""}${nodes.length > MAX_NODES ? `（节点过多，只列前 ${MAX_NODES} 个）` : ""}。这就是用户左边看到的画布，以此为准，不要猜。`,
        "节点：",
        ...nodeLines,
        "连线（上游 → 下游）：",
        ...(linkLines.length ? linkLines : ["（没有连线）"]),
    ].join("\n");
}
