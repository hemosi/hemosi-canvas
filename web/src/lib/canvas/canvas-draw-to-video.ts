import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { getNodeSpec } from "@/lib/canvas/node-registry";
import { findFreeRightPosition } from "@/lib/canvas/canvas-quick-grow";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type DrawToVideoRole = "firstFrame" | "reference";

/**
 * draw-to-video：草图 / 预演图（含导演台截图）一键喂给视频生成。
 * 把图片标成首帧或参考，在右侧新建一个视频节点并连上，提示词预填图上的预演描述。
 * 生成本身仍走视频节点的已有链路（确认卡、队列、记录），这里只搭节点与连线。
 */
export function drawToVideoOps(source: CanvasNodeData, nodes: CanvasNodeData[], role: DrawToVideoRole) {
    const spec = getNodeSpec(CanvasNodeType.Video);
    const position = findFreeRightPosition(source, spec, nodes);
    const videoId = `${CanvasNodeType.Video}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const roleText = role === "firstFrame" ? "以连入的图片为首帧" : "参考连入的图片构图与角色";
    const prompt = [source.metadata?.prompt?.trim(), `${roleText}生成视频，保持画面主体与构图。`].filter(Boolean).join("\n");
    const ops: CanvasAgentOp[] = [
        { type: "update_node", id: source.id, metadata: { imageRole: role } },
        { type: "add_node", id: videoId, nodeType: CanvasNodeType.Video, title: role === "firstFrame" ? "草图转视频·首帧" : "草图转视频·参考", position, metadata: { prompt, generationMode: "video", seconds: source.metadata?.seconds } },
        { type: "connect_nodes", fromNodeId: source.id, toNodeId: videoId },
    ];
    return { ops, videoId };
}

export function canDrawToVideo(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && Boolean(node.metadata?.content) && node.metadata?.status !== "loading";
}
