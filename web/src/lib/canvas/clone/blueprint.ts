import { nanoid } from "nanoid";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildShotRow, nextShotNo } from "@/lib/canvas/canvas-shot-actions";
import { CanvasNodeType } from "@/types/canvas";

/**
 * 爆款蓝图：一条视频拆成一行行镜头。全是纯函数，不联网。
 * 变量写成 {{名字}}，可以出现在钩子、风格和每一格里；变体表一行一组值。
 */
export const BEAT_ROLES = ["钩子", "铺垫", "论证", "转折", "兑现", "行动号召"] as const;

export type CloneBeat = {
    id: string;
    start: number;
    end: number;
    role: string;
    /** 台词 */
    line: string;
    /** 画面描述（看懂了什么） */
    visual: string;
    /** 分镜图片提示词 */
    image: string;
    /** 分镜视频提示词 */
    video: string;
    /** 镜头中间帧缩略图（dataURL），只给人看，不当生成参考。 */
    thumb?: string;
};

export type CloneBlueprint = {
    sourceNodeId: string;
    sourceTitle: string;
    duration: number;
    hook: string;
    style: string;
    beats: CloneBeat[];
    variants: Array<Record<string, string>>;
    analyzedWith: { asr?: string; vision?: string };
};

export type CloneTranscriptSegment = { start: number; end: number; text: string };

export function blueprintFromCuts(sourceNodeId: string, sourceTitle: string, cuts: Array<{ start: number; end: number; thumb?: string }>, duration: number): CloneBlueprint {
    return {
        sourceNodeId,
        sourceTitle,
        duration,
        hook: "",
        style: "",
        beats: cuts.map((cut, index) => ({
            id: nanoid(6),
            start: round(cut.start),
            end: round(cut.end),
            role: index === 0 ? "钩子" : index === cuts.length - 1 && cuts.length > 2 ? "行动号召" : "铺垫",
            line: "",
            visual: "",
            image: "",
            video: "",
            thumb: cut.thumb,
        })),
        variants: [{}],
        analyzedWith: {},
    };
}

/** 每句转写挂到和它重叠最多的镜头上。 */
export function attachTranscript(beats: CloneBeat[], segments: CloneTranscriptSegment[]) {
    const lines = beats.map(() => [] as string[]);
    segments.forEach((segment) => {
        let best = -1;
        let bestOverlap = 0;
        beats.forEach((beat, index) => {
            const overlap = Math.min(beat.end, segment.end) - Math.max(beat.start, segment.start);
            if (overlap > bestOverlap) {
                best = index;
                bestOverlap = overlap;
            }
        });
        if (best < 0) best = Math.max(0, beats.findIndex((beat) => segment.start < beat.end));
        if (segment.text.trim()) lines[best]?.push(segment.text.trim());
    });
    return beats.map((beat, index) => ({ ...beat, line: lines[index].join(" ") || beat.line }));
}

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function variableNames(blueprint: CloneBlueprint) {
    const texts = [blueprint.hook, blueprint.style, ...blueprint.beats.flatMap((beat) => [beat.line, beat.visual, beat.image, beat.video])];
    return [...new Set(texts.flatMap((text) => [...text.matchAll(VAR_RE)].map((match) => match[1])))];
}

/** 换上变量值；没填值的变量留下名字本身，不留 {{ }}。 */
export function fillVariables(text: string, values: Record<string, string>) {
    return text.replace(VAR_RE, (_, name: string) => values[name]?.trim() || name);
}

const round = (value: number) => Math.round(value * 10) / 10;
const fmt = (value: number) => `${value.toFixed(1)}s`;

export function scriptText(blueprint: CloneBlueprint, values: Record<string, string>) {
    const head = [blueprint.hook && `钩子：${fillVariables(blueprint.hook, values)}`, blueprint.style && `风格：${fillVariables(blueprint.style, values)}`].filter(Boolean);
    const rows = blueprint.beats.map((beat, index) => `镜头${index + 1}（${fmt(beat.start)}–${fmt(beat.end)}，${beat.role}）：${fillVariables(beat.line, values) || "（无台词）"}`);
    return [...head, ...(head.length ? [""] : []), ...rows].join("\n");
}

/**
 * 展开成画布操作：一个台词稿文本节点 + 一组分镜。放在画布现有内容下方，不连源视频（只学结构，不拿原片当参考）。
 */
export function expandBlueprint(blueprint: CloneBlueprint, values: Record<string, string>, snapshot: CanvasAgentSnapshot, label: string) {
    const left = snapshot.nodes.length ? Math.min(...snapshot.nodes.map((node) => node.position.x)) : 0;
    const bottom = snapshot.nodes.reduce((max, node) => Math.max(max, node.position.y + node.height), 0);
    const origin = { x: left, y: snapshot.nodes.length ? bottom + 160 : 0 };
    const style = fillVariables(blueprint.style, values);
    const withStyle = (text: string) => (style && text ? `${text}，${style}` : text);
    const parts = blueprint.beats.map((beat) => withStyle(fillVariables(beat.image || beat.visual, values)) || `镜头：${fillVariables(beat.line, values)}`);
    const textId = `clone-script-${nanoid(6)}`;
    const script = scriptText(blueprint, values);
    const ops: CanvasAgentOp[] = [{ type: "add_node", id: textId, nodeType: CanvasNodeType.Text, title: `台词稿 · ${label}`, position: origin, width: 420, height: 520, metadata: { content: script, prompt: script, status: "success" } }];
    const [group, ...shots] = buildShotRow(parts, { x: origin.x + 500, y: origin.y }, nextShotNo(snapshot.nodes), `复刻 · ${blueprint.sourceTitle} · ${label}`);
    ops.push({ type: "add_node", id: group.id, nodeType: group.type, title: group.title, position: group.position, width: group.width, height: group.height, metadata: group.metadata });
    shots.forEach((node, index) => {
        const beat = blueprint.beats[index];
        const video = withStyle(fillVariables(beat.video, values));
        ops.push({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata: { ...node.metadata, ...(video ? { prompt: video } : {}), seconds: String(Math.max(1, Math.round(beat.end - beat.start))) } });
    });
    ops.push({ type: "connect_nodes", fromNodeId: textId, toNodeId: group.id });
    return ops;
}

function srtTime(seconds: number) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const pad = (value: number, size = 2) => String(value).padStart(size, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** 字幕草稿：每个镜头的新台词按标点切句，在原镜头时长里按字数分时间。 */
export function toSrt(blueprint: CloneBlueprint, values: Record<string, string>) {
    const cues: string[] = [];
    blueprint.beats.forEach((beat) => {
        const sentences = fillVariables(beat.line, values)
            .split(/(?<=[。！？!?；;，,])/)
            .map((item) => item.trim())
            .filter(Boolean);
        const total = sentences.reduce((sum, item) => sum + item.length, 0);
        let time = beat.start;
        sentences.forEach((sentence) => {
            const end = time + ((beat.end - beat.start) * sentence.length) / total;
            cues.push(`${cues.length + 1}\n${srtTime(time)} --> ${srtTime(end)}\n${sentence}\n`);
            time = end;
        });
    });
    return cues.join("\n");
}

export function toCsv(blueprint: CloneBlueprint, values: Record<string, string>) {
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = blueprint.beats.map((beat, index) => [String(index + 1), fmt(beat.start), fmt(beat.end), beat.role, fillVariables(beat.line, values), fillVariables(beat.visual, values), fillVariables(beat.image, values), fillVariables(beat.video, values)].map(cell).join(","));
    return `\uFEFF镜头,开始,结束,作用,台词,画面描述,图片提示词,视频提示词\n${rows.join("\n")}`;
}
