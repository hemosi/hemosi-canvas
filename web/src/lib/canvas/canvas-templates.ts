import i18n from "@/i18n";
import { getNodeSpec } from "@/constant/canvas";
import { stripGeneratedResult } from "@/lib/canvas/canvas-node-clone";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

export type CanvasTemplate = {
    id: string;
    name: string;
    /** Built-in templates resolve their name and description through i18n keys. */
    nameKey?: string;
    descriptionKey?: string;
    builtin?: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    createdAt: string;
};

export function templateName(template: CanvasTemplate) {
    return template.nameKey ? i18n.t(template.nameKey) : template.name;
}

export function templateDescription(template: CanvasTemplate) {
    return template.descriptionKey ? i18n.t(template.descriptionKey) : "";
}

/** Selected nodes (plus the members of selected groups) and the connections between them, generated media stripped. */
export function buildTemplateFromSelection(selectedIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set(selectedIds);
    nodes.forEach((node) => {
        if (node.metadata?.groupId && ids.has(node.metadata.groupId)) ids.add(node.id);
    });
    const picked = nodes.filter((node) => ids.has(node.id));
    const templateNodes = picked.map((node): CanvasNodeData => {
        const metadata = stripGeneratedResult(node.metadata, { keepTextContent: node.type === CanvasNodeType.Text });
        delete metadata.references;
        if (metadata.groupId && !ids.has(metadata.groupId)) delete metadata.groupId;
        return { ...node, position: { ...node.position }, metadata };
    });
    const templateConnections = connections.filter((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId)).map((connection) => ({ ...connection }));
    return { nodes: templateNodes, connections: templateConnections };
}

/** Fresh copy of a template centred on `center`, with new node and connection ids. */
export function instantiateTemplate(template: CanvasTemplate, center: Position) {
    const bounds = template.nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const dx = center.x - (bounds.left + bounds.right) / 2;
    const dy = center.y - (bounds.top + bounds.bottom) / 2;
    const stamp = Date.now();
    const idMap = new Map<string, string>();
    template.nodes.forEach((node, index) => idMap.set(node.id, `${node.type}-${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`));
    const nodes = template.nodes.map((node): CanvasNodeData => {
        const metadata: CanvasNodeMetadata = { ...(node.metadata || {}) };
        if (metadata.groupId) metadata.groupId = idMap.get(metadata.groupId);
        return { ...node, id: idMap.get(node.id)!, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata };
    });
    const connections = template.connections.flatMap((connection, index): CanvasConnection[] => {
        const fromNodeId = idMap.get(connection.fromNodeId);
        const toNodeId = idMap.get(connection.toNodeId);
        return fromNodeId && toNodeId ? [{ id: `conn-${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`, fromNodeId, toNodeId }] : [];
    });
    return { nodes, connections };
}

function templateNode(id: string, type: CanvasNodeType, x: number, y: number, titleKey: string, metadata: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    return { id, type, title: i18n.t(titleKey), position: { x, y }, width: spec.width, height: spec.height, metadata: { ...spec.metadata, ...metadata, status: "idle" } };
}

const T = "hemosi.templates.builtin";

/** Built-in templates; built lazily so titles and prompts follow the current language. */
export function getBuiltinTemplates(): CanvasTemplate[] {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const shots = ["wide", "medium", "close", "detail"] as const;
    return [
        {
            id: "builtin-text-image-edit",
            name: "",
            nameKey: `${T}.textImageEdit.name`,
            descriptionKey: `${T}.textImageEdit.description`,
            builtin: true,
            createdAt,
            nodes: [
                templateNode("t", CanvasNodeType.Text, 0, 0, `${T}.textImageEdit.textTitle`, { content: i18n.t(`${T}.textImageEdit.text`), fontSize: 14 }),
                templateNode("g", CanvasNodeType.Image, 440, 0, `${T}.textImageEdit.imageTitle`, { prompt: i18n.t(`${T}.textImageEdit.imagePrompt`) }),
                templateNode("e", CanvasNodeType.Image, 880, 0, `${T}.textImageEdit.editTitle`, { prompt: i18n.t(`${T}.textImageEdit.editPrompt`) }),
            ],
            connections: [
                { id: "c1", fromNodeId: "t", toNodeId: "g" },
                { id: "c2", fromNodeId: "g", toNodeId: "e" },
            ],
        },
        {
            id: "builtin-image-to-video",
            name: "",
            nameKey: `${T}.imageToVideo.name`,
            descriptionKey: `${T}.imageToVideo.description`,
            builtin: true,
            createdAt,
            nodes: [
                templateNode("i", CanvasNodeType.Image, 0, 0, `${T}.imageToVideo.imageTitle`, {}),
                templateNode("v", CanvasNodeType.Video, 440, 2, `${T}.imageToVideo.videoTitle`, { prompt: i18n.t(`${T}.imageToVideo.videoPrompt`) }),
            ],
            connections: [{ id: "c1", fromNodeId: "i", toNodeId: "v" }],
        },
        {
            id: "builtin-storyboard-four",
            name: "",
            nameKey: `${T}.storyboard.name`,
            descriptionKey: `${T}.storyboard.description`,
            builtin: true,
            createdAt,
            nodes: [
                templateNode("s", CanvasNodeType.Text, 0, 405, `${T}.storyboard.textTitle`, { content: i18n.t(`${T}.storyboard.text`), fontSize: 14 }),
                ...shots.map((shot, index) => templateNode(`shot-${shot}`, CanvasNodeType.Image, 440, index * 270, `${T}.storyboard.${shot}Title`, { prompt: i18n.t(`${T}.storyboard.${shot}Prompt`) })),
            ],
            connections: shots.map((shot, index) => ({ id: `c${index + 1}`, fromNodeId: "s", toNodeId: `shot-${shot}` })),
        },
    ];
}
