import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type TranscriptSegment = { start: number; end: number; text: string };

/**
 * OpenAI 兼容的语音转写（/v1/audio/transcriptions）。默认用法是本机服务（如 speaches / faster-whisper），不填 Key 也能跑。
 * 返回带时间的句子；服务只给纯文字时整段算一句。
 */
export async function requestTranscription(config: AiConfig, model: string, audio: Blob, signal?: AbortSignal): Promise<TranscriptSegment[]> {
    const requestConfig = resolveModelRequestConfig(config, model);
    const form = new FormData();
    form.append("file", audio, "audio.wav");
    form.append("model", requestConfig.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    const response = await fetch(buildApiUrl(requestConfig.baseUrl, "/audio/transcriptions"), {
        method: "POST",
        headers: requestConfig.apiKey.trim() ? { Authorization: `Bearer ${requestConfig.apiKey}` } : {},
        body: form,
        signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`转写失败 HTTP ${response.status}：${raw.slice(0, 500)}`);
    let json: { text?: string; duration?: number; segments?: Array<{ start?: number; end?: number; text?: string }> };
    try {
        json = JSON.parse(raw);
    } catch {
        return raw.trim() ? [{ start: 0, end: Number.MAX_SAFE_INTEGER, text: raw.trim() }] : [];
    }
    if (Array.isArray(json.segments) && json.segments.length) return json.segments.map((item) => ({ start: Number(item.start) || 0, end: Number(item.end) || 0, text: String(item.text || "") }));
    return json.text?.trim() ? [{ start: 0, end: json.duration || Number.MAX_SAFE_INTEGER, text: json.text.trim() }] : [];
}
