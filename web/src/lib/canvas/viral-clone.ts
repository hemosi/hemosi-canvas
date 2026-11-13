import localforage from "localforage";
import { saveAs } from "file-saver";

import { splitVideoIntoShots } from "@/lib/canvas/canvas-video-shots";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { createZip } from "@/lib/zip";
import { requestAudioGeneration } from "@/services/api/audio";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { defaultConfig, useConfigStore, withLocalProxy } from "@/stores/use-config-store";

export interface ViralCut {
    index: number;
    startSec: number;
    endSec: number;
    durationSec: number;
    frameDataUrl: string;
    keyframeBlob?: Blob;
}

export interface ViralVariable {
    key: string;
    label: string;
    value: string;
}

export interface ViralAnchorSpec {
    role: "character" | "scene" | "style";
    name: string;
    prompt: string;
}

export interface ViralBeat {
    id: string;
    shotNumber: number;
    startSec: number;
    endSec: number;
    role: string;
    /** Hypit 语义节拍核心：这一刀切镜/画面在响应哪句台词或情绪转折 */
    respondsTo: string;
    originalLine: string;
    newLine: string;
    imagePrompt: string;
    videoPrompt: string;
    keyframeDataUrl?: string;
    ttsAudioUrl?: string;
    ttsDurationSec?: number;
}

export interface ViralBlueprint {
    title: string;
    hookSummary: string;
    rhythmNote: string;
    variables: ViralVariable[];
    anchors: ViralAnchorSpec[];
    beats: ViralBeat[];
    variants?: ViralVariantRow[];
}

export interface ViralVariantRow {
    id: string;
    name: string;
    values: Record<string, string>;
}

const viralBlueprintStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "viral_blueprints",
});

export async function saveViralBlueprintDraft(projectId: string, nodeId: string, blueprint: ViralBlueprint): Promise<void> {
    const key = `clone:blueprint:${projectId}:${nodeId || "global"}`;
    await viralBlueprintStore.setItem(key, blueprint);
}

export async function loadViralBlueprintDraft(projectId: string, nodeId: string): Promise<ViralBlueprint | null> {
    const key = `clone:blueprint:${projectId}:${nodeId || "global"}`;
    return viralBlueprintStore.getItem<ViralBlueprint>(key);
}

export function applyVariantToBlueprint(blueprint: ViralBlueprint, variant: ViralVariantRow): ViralBlueprint {
    const mergedVars = blueprint.variables.map((v) => ({
        ...v,
        value: variant.values[v.key] !== undefined && variant.values[v.key] !== "" ? variant.values[v.key] : v.value,
    }));
    return {
        ...blueprint,
        title: `${blueprint.title} · ${variant.name}`,
        variables: mergedVars,
    };
}

/** 9. 导出标准 ZIP 素材包（含 shots/ 镜头参考帧与配音、captions.srt、blueprint.json、README.txt） */
export async function exportViralBlueprintZip(blueprint: ViralBlueprint): Promise<void> {
    const files: { name: string; data: BlobPart }[] = [];
    const srt = buildSrtFromBlueprint(blueprint);
    files.push({ name: "captions.srt", data: srt });
    files.push({ name: "blueprint.json", data: JSON.stringify(blueprint, null, 2) });

    const readmeLines = [
        `# ${blueprint.title}`,
        ``,
        `- 开场钩子分析：${blueprint.hookSummary}`,
        `- 剪辑节奏说明：${blueprint.rhythmNote}`,
        ``,
        `## 当前变量设定`,
        ...blueprint.variables.map((v) => `- {{${v.key}}} (${v.label})：${v.value}`),
        ``,
        `## 锚点设定`,
        ...blueprint.anchors.map((a) => `- [${a.role}] ${a.name}：${resolveTemplateVariables(a.prompt, blueprint.variables)}`),
        ``,
        `## 逐镜复刻脚本`,
        ...blueprint.beats.map((b) => {
            const no = String(b.shotNumber).padStart(2, "0");
            return [
                `### S${no} · ${b.role} (${b.startSec}s - ${b.endSec}s)`,
                `- 语义响应点：${b.respondsTo}`,
                `- 台词：${resolveTemplateVariables(b.newLine, blueprint.variables)}`,
                `- 首帧提示词：${resolveTemplateVariables(b.imagePrompt, blueprint.variables)}`,
                `- 视频运镜词：${resolveTemplateVariables(b.videoPrompt, blueprint.variables)}`,
                ``,
            ].join("\n");
        }),
    ];
    files.push({ name: "README.txt", data: readmeLines.join("\n") });

    for (const beat of blueprint.beats) {
        const shotPrefix = `shots/S${String(beat.shotNumber).padStart(2, "0")}`;
        if (beat.keyframeDataUrl) {
            try {
                const res = await fetch(beat.keyframeDataUrl);
                const blob = await res.blob();
                files.push({ name: `${shotPrefix}_keyframe.png`, data: blob });
            } catch {}
        }
        if (beat.ttsAudioUrl) {
            try {
                const res = await fetch(beat.ttsAudioUrl);
                const blob = await res.blob();
                const ext = blob.type.includes("mpeg") ? "mp3" : "wav";
                files.push({ name: `${shotPrefix}_tts.${ext}`, data: blob });
            } catch {}
        }
    }

    const zipBlob = await createZip(files);
    const safeTitle = (blueprint.title || "爆款复刻素材包").replace(/[\\/:*?"<>|]/g, "_");
    saveAs(zipBlob, `${safeTitle}.zip`);
}

export interface ViralAsrConfig {
    mode: "local_api" | "manual_srt";
    endpoint: string;
    model: string;
    apiKey?: string;
}

export interface ViralTtsConfig {
    mode: "custom_endpoint" | "canvas_channel";
    endpoint: string;
    voice: string;
    apiKey?: string;
}

export const DEFAULT_ASR_CONFIG: ViralAsrConfig = {
    mode: "local_api",
    endpoint: "http://127.0.0.1:8000/v1/audio/transcriptions",
    model: "whisper-1",
    apiKey: "",
};

export const DEFAULT_TTS_CONFIG: ViralTtsConfig = {
    mode: "custom_endpoint",
    endpoint: "http://127.0.0.1:9880/tts",
    voice: "default",
    apiKey: "",
};

/** 1. 纯本地视频切点与代表帧抽取（浏览器 Canvas 帧差法，0 网络流量） */
export async function extractLocalVideoCuts(
    videoSource: string,
    onProgress?: (ratio: number) => void,
): Promise<ViralCut[]> {
    const segments = await splitVideoIntoShots(videoSource, onProgress);
    const cuts: ViralCut[] = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const frameDataUrl = await readFileAsDataUrl(seg.keyframe);
        const startSec = Number(seg.start.toFixed(2));
        const endSec = Number(seg.end.toFixed(2));
        cuts.push({
            index: i + 1,
            startSec,
            endSec,
            durationSec: Number(Math.max(0.5, endSec - startSec).toFixed(2)),
            frameDataUrl,
            keyframeBlob: seg.keyframe,
        });
    }
    return cuts;
}

/** 2. 通用 ASR 语音转写接口（兼容本地 Faster-Whisper / FunASR / OpenAI /v1/audio/transcriptions） */
export async function transcribeVideoWithAdapter(
    videoSource: string,
    asrConfig: ViralAsrConfig,
): Promise<string> {
    if (!videoSource) throw new Error("当前没有可转写的源视频");
    const endpoint = asrConfig.endpoint.trim();
    if (!endpoint) throw new Error("请先填写 ASR 转写接口地址");

    const mediaRes = await fetch(withLocalProxy(videoSource));
    if (!mediaRes.ok) throw new Error(`读取源视频媒体失败 (HTTP ${mediaRes.status})`);
    const mediaBlob = await mediaRes.blob();
    const file = new File([mediaBlob], "source.mp4", { type: mediaBlob.type || "video/mp4" });

    const form = new FormData();
    form.append("file", file);
    if (asrConfig.model.trim()) form.append("model", asrConfig.model.trim());
    form.append("response_format", "srt");

    const headers: Record<string, string> = {};
    if (asrConfig.apiKey?.trim()) {
        headers.Authorization = `Bearer ${asrConfig.apiKey.trim()}`;
    }

    const res = await fetch(withLocalProxy(endpoint), {
        method: "POST",
        headers,
        body: form,
    });
    if (!res.ok) {
        const errTxt = await res.text().catch(() => "");
        throw new Error(`ASR 接口请求失败 (HTTP ${res.status})${errTxt ? `：${errTxt.slice(0, 120)}` : ""}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        const data = (await res.json()) as { text?: string; srt?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
        if (typeof data.srt === "string" && data.srt.trim()) return data.srt.trim();
        if (Array.isArray(data.segments) && data.segments.length > 0) {
            return data.segments
                .map((seg, idx) => `${idx + 1}\n${formatSrtTimecode(seg.start || 0)} --> ${formatSrtTimecode(seg.end || (seg.start || 0) + 2)}\n${(seg.text || "").trim()}\n`)
                .join("\n");
        }
        return (data.text || "").trim();
    }
    return (await res.text()).trim();
}

/** 3. 解析 SRT 字幕或纯文本台词，自动按时间轴对齐到镜头切点 */
export function parseSubtitlesToCuts(rawText: string, cuts: ViralCut[]): string[] {
    const trimmed = rawText.trim();
    if (!trimmed) return cuts.map((_, idx) => `第 ${idx + 1} 镜台词内容`);

    const srtBlocks = trimmed.split(/\r?\n\r?\n+/);
    const timedItems: Array<{ start: number; end: number; text: string }> = [];
    const timeRegex = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

    for (const block of srtBlocks) {
        const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const timeLineIdx = lines.findIndex((l) => timeRegex.test(l));
        if (timeLineIdx >= 0) {
            const m = timeRegex.exec(lines[timeLineIdx])!;
            const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
            const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
            const text = lines.slice(timeLineIdx + 1).join(" ").trim();
            if (text) timedItems.push({ start, end, text });
        }
    }

    if (timedItems.length > 0 && cuts.length > 0) {
        return cuts.map((cut) => {
            const matched = timedItems.filter((item) => item.end > cut.startSec + 0.1 && item.start < cut.endSec - 0.1);
            return matched.map((m) => m.text).join("，") || "";
        });
    }

    const plainLines = trimmed
        .split(/\r?\n|(?<=[。！？!?])/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (!cuts.length) return plainLines;
    return cuts.map((_, idx) => plainLines[idx] ?? plainLines[plainLines.length - 1] ?? "");
}

/** 4. 变量占位符实时替换（支持任意自定义 {{key}} 变量） */
export function resolveTemplateVariables(template: string, variables: ViralVariable[]): string {
    if (!template) return "";
    let out = template;
    for (const v of variables) {
        if (!v.key) continue;
        const val = v.value || `【${v.label || v.key}】`;
        out = out.replace(new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, "g"), val);
    }
    return out;
}

/** 5. 通用本地规则拆解（不依赖任何外部 API，按切点结构与台词生成通用可编辑蓝图） */
export function buildLocalHeuristicBlueprint(
    videoTitle: string,
    cuts: ViralCut[],
    rawTranscript: string,
): ViralBlueprint {
    const cleanTitle = (videoTitle || "参考视频").replace(/\.[a-z0-9]+$/i, "");
    const lines = parseSubtitlesToCuts(rawTranscript, cuts);
    const totalShots = Math.max(1, cuts.length);

    const variables: ViralVariable[] = [
        { key: "subject", label: "主体/主角设定", value: "画面核心人物或主体" },
        { key: "topic", label: "核心话题/场景", value: cleanTitle },
        { key: "highlight", label: "核心亮点/展示物", value: "关键细节与结果展示" },
    ];

    const anchors: ViralAnchorSpec[] = [
        {
            role: "character",
            name: "主体定妆锚点",
            prompt: "{{subject}}，主体特征清晰一致，光影自然，16:9 720p 定妆参考",
        },
        {
            role: "scene",
            name: "核心场景锚点",
            prompt: "围绕「{{topic}}」展开的主环境场景，空间层次分明，电影感景深",
        },
        {
            role: "style",
            name: "视觉风格锚点",
            prompt: "自然光学镜头质感，色调统一，运动连贯真实",
        },
    ];

    const beats: ViralBeat[] = (cuts.length ? cuts : [{ index: 1, startSec: 0, endSec: 5, durationSec: 5, frameDataUrl: "" }]).map((cut, i) => {
        const role =
            i === 0
                ? "开场钩子"
                : i === totalShots - 1
                  ? "收尾落点"
                  : i < totalShots / 2
                    ? "铺垫展开"
                    : "核心转折";
        const origLine = lines[i] || `第 ${i + 1} 镜台词`;
        return {
            id: `beat-${i + 1}`,
            shotNumber: i + 1,
            startSec: cut.startSec,
            endSec: cut.endSec,
            role,
            respondsTo: i === 0 ? "开场前3秒视觉与首句台词抓人注意力" : `响应台词「${origLine.slice(0, 18)}」的画面切点`,
            originalLine: origLine,
            newLine: origLine.includes("{{") ? origLine : origLine,
            imagePrompt: `16:9 720p，{{subject}}处于{{topic}}场景中，表现「${role}」，突出{{highlight}}，中近景`,
            videoPrompt: `16:9 720p，{{subject}}自然完成当前动作，顺向平稳运镜展现{{highlight}}，时长约 ${cut.durationSec} 秒`,
            keyframeDataUrl: cut.frameDataUrl,
        };
    });

    const avgSec = (cuts.reduce((s, c) => s + c.durationSec, 0) / totalShots).toFixed(1);
    return {
        title: `${cleanTitle} · 复刻蓝图`,
        hookSummary: `前 ${beats[0]?.endSec ?? 3} 秒切入核心钩子，全片平均镜头时长 ${avgSec} 秒。`,
        rhythmNote: `共 ${totalShots} 个镜头切点，按语义节拍对齐画面与台词。`,
        variables,
        anchors,
        beats,
    };
}

/** 6. 调用画布已配文本/多模态渠道做 AI 语义深拆 */
export async function analyzeBlueprintWithFreeLlm(
    videoTitle: string,
    cuts: ViralCut[],
    rawTranscript: string,
    includeKeyframes = false,
): Promise<ViralBlueprint> {
    const state = useConfigStore.getState();
    const config = { ...defaultConfig, ...state.config };
    const model = config.textModel || config.model;
    if (!model || !config.apiKey) {
        return buildLocalHeuristicBlueprint(videoTitle, cuts, rawTranscript);
    }

    const alignedLines = parseSubtitlesToCuts(rawTranscript, cuts);
    const shotsText = cuts
        .map((c, idx) => `镜头#${c.index} [${c.startSec}s - ${c.endSec}s, 时长${c.durationSec}s] 原台词: "${alignedLines[idx] || "无"}"`)
        .join("\n");

    const prompt = `你是专业短视频导演与结构拆解专家。请拆解以下参考视频的镜头切点与台词，输出一份可替换变量换壳生产的通用 JSON 蓝图。
要求：
1. 分析每处切镜在响应哪句台词或情绪转折（respondsTo）。
2. 将原片的主体、核心话题、关键亮点提炼为通用可替换变量（如 {{subject}}、{{topic}}、{{highlight}}，也可根据视频内容补充变量），并在 anchors 和 beats 的 newLine / imagePrompt / videoPrompt 中使用这些 {{变量名}} 占位符。

原视频标题：${videoTitle || "参考视频"}
镜头切点与时间轴：
${shotsText}

请只输出合法 JSON：
{
  "title": "复刻蓝图标题",
  "hookSummary": "开场钩子拆解说明",
  "rhythmNote": "全片剪辑节奏与情绪递进说明",
  "variables": [
    { "key": "subject", "label": "主体/主角设定", "value": "建议默认替换值" },
    { "key": "topic", "label": "核心话题/场景", "value": "建议默认替换值" },
    { "key": "highlight", "label": "核心亮点/展示物", "value": "建议默认替换值" }
  ],
  "anchors": [
    { "role": "character", "name": "主体锚点名", "prompt": "含 {{subject}} 的定妆描述" },
    { "role": "scene", "name": "场景锚点名", "prompt": "含 {{topic}} 的环境光影描述" },
    { "role": "style", "name": "风格锚点名", "prompt": "镜头光学与色调风格描述" }
  ],
  "beats": [
    {
      "shotNumber": 1,
      "role": "开场钩子/铺垫展开/核心转折/收尾落点",
      "respondsTo": "该切点响应的台词关键词或动作",
      "newLine": "含 {{变量}} 的新台词",
      "imagePrompt": "含 {{变量}} 的首帧生图提示词",
      "videoPrompt": "含 {{变量}} 的生视频运镜提示词"
    }
  ]
}`;

    const contentParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
        { type: "text", text: prompt },
    ];
    if (includeKeyframes) {
        for (const cut of cuts.slice(0, 6)) {
            if (cut.frameDataUrl) {
                contentParts.push({ type: "image_url", image_url: { url: cut.frameDataUrl } });
            }
        }
    }

    const messages: AiTextMessage[] = [{ role: "user", content: includeKeyframes ? contentParts : prompt }];
    const raw = await requestImageQuestion({ ...config, model }, messages, () => undefined);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("模型未返回有效 JSON，可使用「本地秒拆」");
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ViralBlueprint>;
    const fallback = buildLocalHeuristicBlueprint(videoTitle, cuts, rawTranscript);

    return {
        title: parsed.title || fallback.title,
        hookSummary: parsed.hookSummary || fallback.hookSummary,
        rhythmNote: parsed.rhythmNote || fallback.rhythmNote,
        variables: Array.isArray(parsed.variables) && parsed.variables.length ? parsed.variables : fallback.variables,
        anchors: Array.isArray(parsed.anchors) && parsed.anchors.length ? parsed.anchors : fallback.anchors,
        beats: fallback.beats.map((fb, idx) => {
            const b = parsed.beats?.[idx];
            return {
                ...fb,
                role: b?.role || fb.role,
                respondsTo: b?.respondsTo || fb.respondsTo,
                newLine: b?.newLine || fb.newLine,
                imagePrompt: b?.imagePrompt || fb.imagePrompt,
                videoPrompt: b?.videoPrompt || fb.videoPrompt,
            };
        }),
    };
}

/** 7. 通用 TTS 配音合成接口（支持「本地/自定义端点」与「画布已配音频渠道」双模式，并自动测算真实音频时长） */
export async function synthesizeBeatTtsWithAdapter(
    text: string,
    ttsConfig: ViralTtsConfig,
): Promise<{ audioUrl: string; durationSec: number }> {
    const cleanText = text
        .replace(/([a-zA-Z0-9])\s+([\u4e00-\u9fa5])/g, "$1$2")
        .replace(/([\u4e00-\u9fa5])\s+([a-zA-Z0-9])/g, "$1$2")
        .trim();

    let audioUrl = "";

    if (ttsConfig.mode === "canvas_channel") {
        const state = useConfigStore.getState();
        const config = { ...defaultConfig, ...state.config };
        const audioModel = config.audioModel || config.model;
        const result = await requestAudioGeneration(
            {
                ...config,
                model: audioModel,
                audioVoice: ttsConfig.voice || config.audioVoice || "alloy",
            },
            cleanText,
        );
        audioUrl = result.url;
    } else {
        const endpoint = ttsConfig.endpoint.trim();
        if (!endpoint) throw new Error("请先配置 TTS 接口地址");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (ttsConfig.apiKey?.trim()) {
            headers.Authorization = `Bearer ${ttsConfig.apiKey.trim()}`;
        }
        const voice = ttsConfig.voice.trim() || "default";
        const res = await fetch(withLocalProxy(endpoint), {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: "tts-1",
                text: cleanText,
                input: cleanText,
                voice,
                voice_id: voice,
                do_split: false,
            }),
        });
        if (!res.ok) throw new Error(`TTS 接口请求失败 (HTTP ${res.status})`);
        const blob = await res.blob();
        audioUrl = URL.createObjectURL(blob);
    }

    const durationSec = await new Promise<number>((resolve) => {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : 3);
        audio.onerror = () => resolve(3);
        audio.src = audioUrl;
    });
    return { audioUrl, durationSec };
}

function formatSrtTimecode(sec: number): string {
    const s = Math.max(0, sec);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** 8. 导出精准 SRT 字幕（优先使用 TTS 真实音频时长，无 TTS 时使用原片镜头时长） */
export function buildSrtFromBlueprint(blueprint: ViralBlueprint): string {
    let cursor = 0;
    return blueprint.beats
        .map((beat, idx) => {
            const line = resolveTemplateVariables(beat.newLine, blueprint.variables).trim();
            const dur = beat.ttsDurationSec && beat.ttsDurationSec > 0 ? beat.ttsDurationSec : Math.max(1, beat.endSec - beat.startSec);
            const start = beat.ttsDurationSec ? cursor : beat.startSec;
            const end = beat.ttsDurationSec ? cursor + dur : beat.endSec;
            cursor = end;
            return `${idx + 1}\n${formatSrtTimecode(start)} --> ${formatSrtTimecode(end)}\n${line || `镜头 ${idx + 1}`}\n`;
        })
        .join("\n");
}
