import { splitVideoIntoShots } from "@/lib/canvas/canvas-video-shots";
import { BEAT_ROLES, type CloneBeat } from "@/lib/canvas/clone/blueprint";
import { requestImageQuestion } from "@/services/api/image";
import { withLocalProxy, type AiConfig } from "@/stores/use-config-store";

/** 切镜头：浏览器内逐帧比对，不联网。每个镜头带一张缩小的中间帧。 */
export async function detectCuts(source: string, onProgress?: (ratio: number) => void) {
    const segments = await splitVideoIntoShots(source, onProgress);
    const cuts = await Promise.all(segments.map(async (segment) => ({ start: segment.start, end: segment.end, thumb: await shrink(segment.keyframe, 480) })));
    return { cuts, duration: segments[segments.length - 1]?.end || 0 };
}

async function shrink(blob: Blob, width: number) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
}

/** 抽音轨：解码后重采样成 16 kHz 单声道 WAV，给本地转写用。 */
export async function extractWav(source: string) {
    const response = await fetch(/^(blob|data):/i.test(source) ? source : withLocalProxy(source));
    if (!response.ok) throw new Error(`读取视频失败 HTTP ${response.status}`);
    const context = new AudioContext();
    let decoded: AudioBuffer;
    try {
        decoded = await context.decodeAudioData(await response.arrayBuffer());
    } catch {
        throw new Error("这条视频没有能解码的音轨");
    } finally {
        void context.close();
    }
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const node = offline.createBufferSource();
    node.buffer = decoded;
    node.connect(offline.destination);
    node.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const writeText = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
    return new Blob([view], { type: "audio/wav" });
}

function pickJson(text: string) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * 看画面：每个镜头送 1 张中间帧和它的台词给能看图的模型（默认本机 Ollama），一次一个镜头，顺序执行。
 * 某个镜头失败就抛出原文报错，已经写好的镜头保留在 onBeat 回调里。
 */
export async function describeBeats(config: AiConfig, model: string, beats: CloneBeat[], onBeat: (index: number, patch: Partial<CloneBeat>) => void, signal?: AbortSignal) {
    for (let index = 0; index < beats.length; index += 1) {
        const beat = beats[index];
        const prompt = `这是一条短视频的第 ${index + 1}/${beats.length} 个镜头（${beat.start.toFixed(1)}s–${beat.end.toFixed(1)}s）。台词：${beat.line || "（无）"}
只输出一个 JSON 对象，不要别的文字：
{"role": "这个镜头在整条视频里的作用，只能是 ${BEAT_ROLES.join("/")} 之一", "visual": "画面里有什么：人物、动作、场景、景别、机位（中文一句）", "image": "复刻这个镜头首帧的图片提示词（中文，具体到主体、场景、景别、光线、色调，不写真实人名）", "video": "这个镜头的视频提示词（中文，人物动作 + 运镜）"}`;
        const text = await requestImageQuestion({ ...config, model }, [{ role: "user", content: [{ type: "text", text: prompt }, ...(beat.thumb ? [{ type: "image_url" as const, image_url: { url: beat.thumb } }] : [])] }], () => undefined, { signal });
        const json = pickJson(text);
        if (!json) throw new Error(`第 ${index + 1} 个镜头：模型没有返回 JSON。原文：${text.slice(0, 300)}`);
        onBeat(index, {
            role: (BEAT_ROLES as readonly string[]).includes(str(json.role)) ? str(json.role) : beat.role,
            visual: str(json.visual) || beat.visual,
            image: str(json.image) || beat.image,
            video: str(json.video) || beat.video,
        });
    }
}

/** 最后一步：只看文字，总结钩子和整体风格。 */
export async function summarizeBlueprint(config: AiConfig, model: string, beats: CloneBeat[], signal?: AbortSignal) {
    const rows = beats.map((beat, index) => `${index + 1}. [${beat.role}] 画面：${beat.visual || "?"}；台词：${beat.line || "（无）"}`).join("\n");
    const text = await requestImageQuestion(
        { ...config, model },
        [{ role: "user", content: `下面是一条爆款短视频逐镜头的拆解：\n${rows}\n\n只输出一个 JSON 对象：{"hook": "开头怎么抓人（一句话）", "style": "整体画面与剪辑风格，能直接接在提示词后面（一句话，如：竖屏 9:16，手持跟拍，暖色日系，快切）"}` }],
        () => undefined,
        { signal },
    );
    const json = pickJson(text);
    if (!json) throw new Error(`总结失败：模型没有返回 JSON。原文：${text.slice(0, 300)}`);
    return { hook: str(json.hook), style: str(json.style) };
}
