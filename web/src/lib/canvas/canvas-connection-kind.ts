import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasConnectionKind, type CanvasNodeData } from "@/types/canvas";

export const CONNECTION_KINDS: CanvasConnectionKind[] = ["reference", "input", "continue"];
export const CONNECTION_KIND_LABEL: Record<CanvasConnectionKind, string> = { reference: "参考", input: "输入", continue: "续作" };

const isText = (node: CanvasNodeData) => node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Config;
const isVideo = (node: CanvasNodeData) => node.type === CanvasNodeType.Video;
/** Nodes that run a generation and therefore take inputs. */
export const isGenerationTarget = (node: CanvasNodeData) => [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text, CanvasNodeType.Audio, CanvasNodeType.Config, HemosiNodeType.Shot].includes(node.type as never) || !Object.values(CanvasNodeType).includes(node.type as CanvasNodeType);

/** Kind implied by the two ends: text feeds a prompt (输入), video into a video is a continuation (续作), everything else is a reference (参考). */
export function inferConnectionKind(from: CanvasNodeData, to: CanvasNodeData): CanvasConnectionKind {
    if (isText(from)) return "input";
    if (from.type === HemosiNodeType.Shot && to.type === HemosiNodeType.Shot) return "continue";
    if (isVideo(from) && (isVideo(to) || to.type === HemosiNodeType.Shot)) return "continue";
    return "reference";
}

export function connectionKindOf(connection: CanvasConnection, from?: CanvasNodeData, to?: CanvasNodeData): CanvasConnectionKind {
    return connection.kind || (from && to ? inferConnectionKind(from, to) : "reference");
}

/** Why a link of this kind between these nodes cannot work, or null when it is fine. */
export function connectionKindProblem(kind: CanvasConnectionKind, from: CanvasNodeData, to: CanvasNodeData): string | null {
    if (to.type === CanvasNodeType.Group) return "分组不能作为连线终点";
    if (kind === "input" && !isText(from) && from.type !== HemosiNodeType.Shot) return "「输入」只能从文本/配置节点连出（把文字喂给提示词）";
    if (kind === "continue" && !(isVideo(from) || from.type === HemosiNodeType.Shot)) return "「续作」只能从视频（或分镜）连出";
    if (kind === "continue" && !(isVideo(to) || to.type === HemosiNodeType.Shot || to.type === CanvasNodeType.Config)) return "「续作」只能连到视频生成节点或分镜";
    if (kind === "reference" && isText(from)) return "文本节点是提示词来源，应标为「输入」";
    if (from.type === CanvasNodeType.Audio && (to.type === CanvasNodeType.Image || to.type === CanvasNodeType.Text)) return "音频不能喂给图片/文本生成，只能连给视频节点作声音来源";
    if (isVideo(from) && to.type === CanvasNodeType.Image) return "图片生成不接受视频参考";
    if (!isGenerationTarget(to)) return "目标节点不会发起生成，这条线不会生效";
    return null;
}
