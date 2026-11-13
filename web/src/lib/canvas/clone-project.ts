import { z } from "zod";

import { exportViralArchiveZip, type ViralExportFile } from "@/lib/canvas/viral-clone";
import { requestImageQuestion, uploadGeminiFile, type AiTextMessage } from "@/services/api/image";
import { modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export const WordTimestampSchema = z.object({
    word: z.string(),
    startSec: z.number(),
    endSec: z.number(),
});

export const CueAnchorSchema = z.object({
    id: z.string(),
    kind: z.enum(["broll", "overlay", "sfx", "caption-highlight"]),
    startWordIndex: z.number().int().nonnegative(),
    endWordIndex: z.number().int().nonnegative(),
    label: z.string(),
    payload: z.string().default(""),
});

export const CloneSegmentSchema = z.object({
    id: z.string(),
    index: z.number().int().positive(),
    role: z.string(),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    originalLine: z.string(),
    newLine: z.string(),
    visualNote: z.string().default(""),
    brollNote: z.string().default(""),
    imagePrompt: z.string().default(""),
    videoPrompt: z.string().default(""),
    words: z.array(WordTimestampSchema).default([]),
    aligned: z.boolean().default(false),
    cues: z.array(CueAnchorSchema).default([]),
    assetStatus: z.enum(["idle", "ready", "reused", "error"]).default("idle"),
    generatedVideoUrl: z.string().optional(),
});

export const CloneVariableSchema = z.object({
    key: z.string(),
    label: z.string(),
    value: z.string(),
});

export const CloneVariantSchema = z.object({
    id: z.string(),
    name: z.string(),
    values: z.record(z.string(), z.string()),
    status: z.enum(["idle", "running", "ok", "error"]).default("idle"),
    error: z.string().optional(),
});

export const CloneProjectSchema = z.object({
    schemaVersion: z.literal(1),
    meta: z.object({
        title: z.string(),
        aspectRatio: z.string().default("9:16"),
        fps: z.number().default(30),
        language: z.string().default("zh-CN"),
        genre: z.string().default("短视频"),
        sourceHash: z.string().optional(),
        sourceDurationSec: z.number().optional(),
    }),
    hook: z.object({
        summary: z.string().default(""),
        rhythmNote: z.string().default(""),
    }),
    characters: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            desc: z.string(),
            isRealPersonInSource: z.boolean().default(false),
            boundImageNodeId: z.string().optional(),
        }),
    ).default([]),
    segments: z.array(CloneSegmentSchema).default([]),
    variables: z.array(CloneVariableSchema).default([]),
    variants: z.array(CloneVariantSchema).default([]),
    builds: z.array(
        z.object({
            id: z.string(),
            createdAt: z.string(),
            reusedCount: z.number(),
            generatedCount: z.number(),
            outputUrl: z.string().optional(),
        }),
    ).default([]),
});

export type CloneProject = z.infer<typeof CloneProjectSchema>;
export type CloneSegment = z.infer<typeof CloneSegmentSchema>;

export function createEmptyCloneProject(title = "爆款复刻工程"): CloneProject {
    return {
        schemaVersion: 1,
        meta: { title, aspectRatio: "9:16", fps: 30, language: "zh-CN", genre: "短视频" },
        hook: { summary: "", rhythmNote: "" },
        characters: [],
        segments: [],
        variables: [],
        variants: [],
        builds: [],
    };
}

export function findGeminiChannelModel(config: AiConfig): {
    ready: boolean;
    model?: string;
    channelName?: string;
    reason?: string;
} {
    const textModels = selectableModelsByCapability(config, "text");
    for (const m of textModels) {
        const resolved = resolveModelRequestConfig(config, m);
        if (resolved.apiFormat === "gemini" && resolved.apiKey) {
            return { ready: true, model: m, channelName: modelOptionName(m) };
        }
    }
    return { ready: false, reason: "未配置 Gemini 文本/多模态渠道与 API Key" };
}

function extractJson(raw: string): string {
    const t = raw.trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) return fence[1].trim();
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

export async function analyzeVideoWithGemini(params: {
    config: AiConfig;
    model: string;
    videoUrl: string;
    signal?: AbortSignal;
}): Promise<CloneProject> {
    const res = await fetch(params.videoUrl, { signal: params.signal });
    if (!res.ok) throw new Error("无法读取源视频文件");
    const blob = await res.blob();
    const mimeType = blob.type || "video/mp4";
    const runConfig: AiConfig = { ...params.config, model: params.model, textModel: params.model };
    const fileUri = await uploadGeminiFile(runConfig, blob, mimeType, params.signal);

    const messages: AiTextMessage[] = [
        {
            role: "system",
            content:
                "你是专业短视频导演。请仔细观看原片，输出纯 JSON 格式的爆款复刻工程（schemaVersion: 1），包含 meta/hook/characters/segments/variables。每个 segment 包含 index, role, startSec, endSec, originalLine, newLine, visualNote, brollNote, imagePrompt, videoPrompt。",
        },
        {
            role: "user",
            content: [
                { type: "video", video: { url: fileUri, mimeType } },
                { type: "text", text: "请拆解这条原片的钩子、分段、台词、B-roll、画面与节奏，并输出 JSON。" },
            ],
        },
    ];

    const raw = await requestImageQuestion(runConfig, messages, () => {}, { signal: params.signal });
    const parsed = JSON.parse(extractJson(raw));
    return CloneProjectSchema.parse({ schemaVersion: 1, ...parsed });
}

export async function rewatchSegmentWithGemini(params: {
    config: AiConfig;
    model: string;
    videoUrl: string;
    segment: CloneSegment;
    signal?: AbortSignal;
}): Promise<Partial<CloneSegment>> {
    const res = await fetch(params.videoUrl, { signal: params.signal });
    if (!res.ok) throw new Error("无法读取源视频文件");
    const blob = await res.blob();
    const mimeType = blob.type || "video/mp4";
    const runConfig: AiConfig = { ...params.config, model: params.model, textModel: params.model };
    const fileUri = await uploadGeminiFile(runConfig, blob, mimeType, params.signal);

    const messages: AiTextMessage[] = [
        {
            role: "user",
            content: [
                {
                    type: "video",
                    video: {
                        url: fileUri,
                        mimeType,
                        startOffsetSec: params.segment.startSec,
                        endOffsetSec: params.segment.endSec,
                        fps: 2,
                    },
                },
                {
                    type: "text",
                    text: `请高帧率细看第 ${params.segment.index} 段（${params.segment.startSec}s - ${params.segment.endSec}s），输出 JSON：{ "visualNote": "...", "brollNote": "...", "originalLine": "..." }。`,
                },
            ],
        },
    ];

    const raw = await requestImageQuestion(runConfig, messages, () => {}, { signal: params.signal });
    return JSON.parse(extractJson(raw)) as Partial<CloneSegment>;
}

function formatSrtTime(sec: number): string {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const rem = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

export function buildSrtFromCloneProject(project: CloneProject): string {
    return project.segments
        .map((seg, i) => {
            const text = seg.newLine || seg.originalLine || "";
            return `${i + 1}\n${formatSrtTime(seg.startSec)} --> ${formatSrtTime(seg.endSec)}\n${text}\n`;
        })
        .join("\n");
}

export async function exportCloneProjectZip(project: CloneProject): Promise<void> {
    const unaligned = project.segments.filter((s) => !s.aligned).map((s) => `#${s.index}`);
    const readme = [
        `# ${project.meta.title}`,
        `画幅: ${project.meta.aspectRatio} | 帧率: ${project.meta.fps}`,
        `钩子分析: ${project.hook.summary}`,
        unaligned.length ? `未逐词对齐段落（按整句时间生成字幕）: ${unaligned.join(", ")}` : "全部段落已对齐",
        "",
        "## 变量",
        ...project.variables.map((v) => `- ${v.key} (${v.label}): ${v.value}`),
    ].join("\n");

    const files: ViralExportFile[] = [
        { name: "project.json", data: JSON.stringify(project, null, 2) },
        { name: "captions.srt", data: buildSrtFromCloneProject(project) },
        { name: "README.txt", data: readme },
    ];

    for (const seg of project.segments) {
        if (seg.generatedVideoUrl) {
            try {
                const res = await fetch(seg.generatedVideoUrl);
                if (res.ok) {
                    files.push({
                        name: `shots/S${String(seg.index).padStart(2, "0")}.mp4`,
                        data: await res.blob(),
                    });
                }
            } catch {}
        }
    }

    await exportViralArchiveZip(project.meta.title, files);
}
