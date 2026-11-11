import axios from "axios";

import { inferVideoRatio } from "@/lib/media-size";
import { configSeed, withLocalProxy, type AiConfig } from "@/stores/use-config-store";

/**
 * Official vendor APIs that are neither OpenAI- nor Gemini-generateContent-shaped.
 * Each vendor has a pure body builder (unit-tested) plus create/poll calls that follow its official docs:
 * - BFL FLUX 2 (images): POST {base}/v1/{model} with x-key, poll the returned polling_url.
 * - Kling 4.0 (video):  POST {base}/{text-to-video|image-to-video}/{model}, poll GET {base}/tasks?task_ids=.
 * - Runway (video):     POST {base}/v1/{text_to_video|image_to_video} with X-Runway-Version, poll GET {base}/v1/tasks/{id}.
 * - Volcengine Ark Seedance (video): POST {base}/api/v3/contents/generations/tasks, poll GET …/tasks/{id}.
 * - Gemini Omni Flash (video): POST {base}/v1beta/interactions (background), poll GET …/interactions/{id}.
 * Errors are thrown with the vendor's own message; nothing falls back to another model.
 */

export type OfficialVideoProvider = "kling" | "runway" | "ark" | "omni";
export type ProviderState = { status: "pending" } | { status: "completed"; url?: string; blob?: Blob } | { status: "failed"; error: string };
type Options = { signal?: AbortSignal };
type FramesInput = { images: string[]; mode: "frames" | "reference" };

const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_PROMPT_LIMIT = 1000;

function trimBase(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "");
}

/** Raw base64 without the data: prefix (Kling / BFL accept plain base64 or a URL). */
export function stripDataUrl(dataUrl: string) {
    const index = dataUrl.indexOf("base64,");
    return index >= 0 ? dataUrl.slice(index + 7) : dataUrl;
}

function mimeOf(dataUrl: string) {
    return dataUrl.match(/^data:([^;]+);/)?.[1] || "image/png";
}

function ratioOf(size: string, fallback = "16:9") {
    const ratio = inferVideoRatio(size || fallback);
    return ratio === "auto" ? fallback : ratio;
}

function intSeconds(value: string, min: number, max: number) {
    const seconds = Math.round(Number(value) || 0);
    if (seconds < min || seconds > max) throw new Error(`该模型时长只支持 ${min}–${max} 秒，当前设置 ${value || "空"} 秒，请在本节点改时长`);
    return seconds;
}

function vendorError(error: unknown, vendor: string) {
    if (axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError")) return error;
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as Record<string, unknown> | string | undefined;
        const message =
            typeof data === "string"
                ? data.slice(0, 300)
                : (data?.message as string) || ((data?.error as Record<string, unknown>)?.message as string) || (typeof data?.error === "string" ? (data.error as string) : "") || (data?.detail as string) || (data?.failure as string) || "";
        return new Error(`${vendor}：${message || error.message}${error.response?.status ? `（HTTP ${error.response.status}）` : ""}`);
    }
    return error instanceof Error ? error : new Error(String(error));
}

// ---------- BFL FLUX (image) ----------

export function buildBflRequest(config: Pick<AiConfig, "baseUrl" | "model" | "seed" | "camera">, prompt: string, size: { width: number; height: number } | undefined, images: string[]) {
    const body: Record<string, unknown> = { prompt, output_format: "png", ...(size ? { width: size.width, height: size.height } : {}) };
    const seed = configSeed(config);
    if (seed !== undefined) body.seed = seed;
    images.slice(0, 8).forEach((image, index) => (body[index === 0 ? "input_image" : `input_image_${index + 1}`] = stripDataUrl(image)));
    return { url: `${trimBase(config.baseUrl)}/v1/${config.model.replace(/^\/+|^v1\//g, "")}`, body };
}

export async function requestBflImage(config: AiConfig, prompt: string, size: { width: number; height: number } | undefined, images: string[], options?: Options) {
    const { url, body } = buildBflRequest(config, prompt, size, images);
    const headers = { "x-key": config.apiKey, "Content-Type": "application/json", accept: "application/json" };
    try {
        const created = (await axios.post<{ id?: string; polling_url?: string }>(withLocalProxy(url), body, { headers, signal: options?.signal })).data;
        if (!created.polling_url) throw new Error("BFL 没有返回 polling_url");
        for (let attempt = 0; attempt < 400; attempt += 1) {
            await delay(1500, options?.signal);
            const state = (await axios.get<{ status?: string; result?: { sample?: string } }>(withLocalProxy(created.polling_url), { headers, signal: options?.signal })).data;
            if (state.status === "Ready" && state.result?.sample) {
                // Delivery URLs have no CORS; fetch through the local forwarding proxy when it is on.
                const blob = (await axios.get<Blob>(withLocalProxy(state.result.sample), { responseType: "blob", signal: options?.signal })).data;
                return blobToDataUrl(blob);
            }
            if (state.status && !["Pending", "Processing", "Queued", "Task not found"].includes(state.status)) throw new Error(`BFL 任务状态：${state.status}`);
        }
        throw new Error("BFL 生成超时（10 分钟）");
    } catch (error) {
        throw vendorError(error, "BFL");
    }
}

// ---------- Kling 4.0 (video) ----------

export function buildKlingRequest(config: Pick<AiConfig, "baseUrl" | "model" | "size" | "videoSeconds" | "vquality" | "videoWatermark">, prompt: string, input: FramesInput) {
    if (input.mode === "reference" && input.images.length) throw new Error("可灵 4.0 图生视频只接受首帧/中间帧/尾帧；多张参考图（非首尾帧）请换支持参考图的模型（如 Seedance 2.5、Gemini Omni），或把图片身份设为首帧/尾帧");
    const frames = input.images.slice(0, 10);
    const types = frames.length === 1 ? ["first_frame"] : frames.map((_, index) => (index === 0 ? "first_frame" : index === frames.length - 1 ? "last_frame" : "middle_frame"));
    const contents = [{ type: "prompt", text: prompt }, ...frames.map((image, index) => ({ type: types[index], url: stripDataUrl(image), id: `frame_${index + 1}` }))];
    const resolution = Number(String(config.vquality).replace(/p$/i, "")) >= 1080 ? "1080p" : "720p";
    const settings: Record<string, unknown> = { resolution, duration: intSeconds(config.videoSeconds, 3, 30) };
    if (!frames.length) settings.aspect_ratio = ratioOf(config.size);
    const path = frames.length ? "image-to-video" : "text-to-video";
    return { url: `${trimBase(config.baseUrl)}/${path}/${config.model}`, body: { contents, settings, options: { watermark_info: { enabled: config.videoWatermark === "true" } } } };
}

type KlingEnvelope<T> = { code?: number; message?: string; data?: T };
type KlingTask = { id?: string; status?: string; message?: string; outputs?: Array<{ type?: string; url?: string }> };

async function createKling(config: AiConfig, prompt: string, input: FramesInput, options?: Options) {
    const { url, body } = buildKlingRequest(config, prompt, input);
    const response = (await axios.post<KlingEnvelope<KlingTask>>(withLocalProxy(url), body, { headers: bearer(config), signal: options?.signal })).data;
    if (response.code && response.code !== 0) throw new Error(`可灵：${response.message || response.code}`);
    if (!response.data?.id) throw new Error("可灵没有返回任务 ID");
    return response.data.id;
}

async function pollKling(config: AiConfig, id: string, options?: Options): Promise<ProviderState> {
    const response = (await axios.get<KlingEnvelope<KlingTask[]>>(withLocalProxy(`${trimBase(config.baseUrl)}/tasks`), { params: { task_ids: id }, headers: bearer(config), signal: options?.signal })).data;
    if (response.code && response.code !== 0) throw new Error(`可灵：${response.message || response.code}`);
    const task = response.data?.[0];
    if (task?.status === "succeeded") {
        const url = task.outputs?.find((item) => item.type === "video" && item.url)?.url;
        return url ? { status: "completed", url } : { status: "failed", error: "可灵任务成功但没有视频地址" };
    }
    if (task?.status === "failed") return { status: "failed", error: `可灵：${task.message || "生成失败"}` };
    return { status: "pending" };
}

// ---------- Runway (video) ----------

const RUNWAY_RATIOS: Record<string, string> = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960", "4:3": "1104:832", "3:4": "832:1104", "21:9": "1584:672" };

export function buildRunwayRequest(config: Pick<AiConfig, "baseUrl" | "model" | "size" | "videoSeconds" | "seed">, prompt: string, input: FramesInput) {
    if (prompt.length > RUNWAY_PROMPT_LIMIT) throw new Error(`Runway 提示词上限 ${RUNWAY_PROMPT_LIMIT} 字符，当前 ${prompt.length}；请精简提示词/锚点设定，或换模型`);
    if (input.mode === "reference" && input.images.length) throw new Error("Runway 图生视频只接受首帧/尾帧，多张参考图请换支持参考图的模型（如 Seedance 2.5、Gemini Omni）");
    const ratio = ratioOf(config.size);
    const runwayRatio = RUNWAY_RATIOS[ratio];
    if (!runwayRatio) throw new Error(`Runway 不支持 ${ratio} 画幅（支持 ${Object.keys(RUNWAY_RATIOS).join("、")}）`);
    const body: Record<string, unknown> = { model: config.model, promptText: prompt, ratio: runwayRatio, duration: intSeconds(config.videoSeconds, 2, 10) };
    const seed = configSeed(config);
    if (seed !== undefined) body.seed = seed;
    if (input.images.length) {
        body.promptImage = input.images.length === 1 ? input.images[0] : [{ uri: input.images[0], position: "first" }, { uri: input.images[input.images.length - 1], position: "last" }];
        return { url: `${trimBase(config.baseUrl)}/v1/image_to_video`, body };
    }
    if (ratio !== "16:9" && ratio !== "9:16") throw new Error("Runway 文生视频只支持 16:9 / 9:16；其它画幅请先放一张首帧图");
    return { url: `${trimBase(config.baseUrl)}/v1/text_to_video`, body };
}

function runwayHeaders(config: AiConfig) {
    return { ...bearer(config), "X-Runway-Version": RUNWAY_VERSION };
}

async function createRunway(config: AiConfig, prompt: string, input: FramesInput, options?: Options) {
    const { url, body } = buildRunwayRequest(config, prompt, input);
    const created = (await axios.post<{ id?: string }>(withLocalProxy(url), body, { headers: runwayHeaders(config), signal: options?.signal })).data;
    if (!created.id) throw new Error("Runway 没有返回任务 ID");
    return created.id;
}

async function pollRunway(config: AiConfig, id: string, options?: Options): Promise<ProviderState> {
    const task = (await axios.get<{ status?: string; output?: string[]; failure?: string; failureCode?: string }>(withLocalProxy(`${trimBase(config.baseUrl)}/v1/tasks/${id}`), { headers: runwayHeaders(config), signal: options?.signal })).data;
    if (task.status === "SUCCEEDED") return task.output?.[0] ? { status: "completed", url: task.output[0] } : { status: "failed", error: "Runway 任务成功但没有输出" };
    if (task.status === "FAILED" || task.status === "CANCELLED") return { status: "failed", error: `Runway：${task.failure || task.failureCode || task.status}` };
    return { status: "pending" };
}

// ---------- Volcengine Ark Seedance (video) ----------

export function buildArkRequest(config: Pick<AiConfig, "baseUrl" | "model" | "size" | "videoSeconds" | "vquality" | "videoGenerateAudio" | "videoWatermark" | "seed" | "camera">, prompt: string, input: FramesInput) {
    const frames = input.mode === "frames";
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    input.images.forEach((image, index) => content.push({ type: "image_url", image_url: { url: image }, role: frames ? (index === 0 ? "first_frame" : "last_frame") : "reference_image" }));
    const resolution = `${Math.min(1080, Number(String(config.vquality).replace(/p$/i, "")) || 720)}p`;
    const body: Record<string, unknown> = {
        model: config.model,
        content,
        // First/last-frame tasks must use adaptive (the output follows the first frame).
        ratio: frames && input.images.length ? "adaptive" : ratioOf(config.size),
        duration: intSeconds(config.videoSeconds, 4, 30),
        resolution: resolution === "1080p" || resolution === "480p" ? resolution : "720p",
        generate_audio: config.videoGenerateAudio !== "false",
        watermark: config.videoWatermark === "true",
    };
    const seed = configSeed(config);
    if (seed !== undefined) body.seed = seed;
    // Native camera control: Seedance's camera_fixed locks the camera (not accepted on reference-image tasks).
    if (config.camera?.movement && input.mode !== "reference") body.camera_fixed = config.camera.movement === "static";
    return { url: `${trimBase(config.baseUrl)}/api/v3/contents/generations/tasks`, body };
}

async function createArk(config: AiConfig, prompt: string, input: FramesInput, options?: Options) {
    const { url, body } = buildArkRequest(config, prompt, input);
    const created = (await axios.post<{ id?: string }>(withLocalProxy(url), body, { headers: bearer(config), signal: options?.signal })).data;
    if (!created.id) throw new Error("火山方舟没有返回任务 ID");
    return created.id;
}

async function pollArk(config: AiConfig, id: string, options?: Options): Promise<ProviderState> {
    const task = (await axios.get<{ status?: string; content?: { video_url?: string }; error?: { message?: string; code?: string } }>(withLocalProxy(`${trimBase(config.baseUrl)}/api/v3/contents/generations/tasks/${id}`), { headers: bearer(config), signal: options?.signal })).data;
    if (task.status === "succeeded") return task.content?.video_url ? { status: "completed", url: task.content.video_url } : { status: "failed", error: "Seedance 任务成功但没有视频地址" };
    if (task.status === "failed" || task.status === "expired" || task.status === "cancelled") return { status: "failed", error: `Seedance：${task.error?.message || task.error?.code || task.status}` };
    return { status: "pending" };
}

// ---------- Gemini Omni Flash (video, Interactions API) ----------

export function isGeminiOmniModel(model: string) {
    return /^(models\/)?gemini-omni/i.test(model.trim());
}

function geminiApiBase(baseUrl: string) {
    const base = trimBase(baseUrl);
    return /\/v1(beta)?$/i.test(base) ? base : `${base}/v1beta`;
}

export function buildOmniRequest(config: Pick<AiConfig, "baseUrl" | "model" | "size" | "videoSeconds" | "vquality">, prompt: string, input: FramesInput) {
    const ratio = ratioOf(config.size);
    if (ratio !== "16:9" && ratio !== "9:16") throw new Error(`Gemini Omni 只支持 16:9 / 9:16 画幅，当前 ${ratio}`);
    const max = input.mode === "frames" && input.images.length >= 2 ? 10 : 15;
    const images = input.images.map((image) => ({ type: "image", data: stripDataUrl(image), mime_type: mimeOf(image) }));
    const quality = String(config.vquality).replace(/p$/i, "");
    const resolution = quality === "2160" || quality === "4k" ? "4k" : Number(quality) >= 1080 ? "1080p" : Number(quality) > 0 && Number(quality) <= 480 ? "360p" : "720p";
    return {
        url: `${geminiApiBase(config.baseUrl)}/interactions`,
        body: {
            model: config.model.replace(/^models\//, ""),
            input: [...images, { type: "text", text: prompt }],
            response_format: { type: "video", aspect_ratio: ratio, resolution, duration: `${intSeconds(config.videoSeconds, 3, max)}s` },
            background: true,
        },
    };
}

type OmniInteraction = { id?: string; status?: string; error?: { message?: string }; steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; uri?: string; mime_type?: string }> }> };

function omniHeaders(config: AiConfig) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

async function createOmni(config: AiConfig, prompt: string, input: FramesInput, options?: Options) {
    const { url, body } = buildOmniRequest(config, prompt, input);
    const created = (await axios.post<OmniInteraction>(withLocalProxy(url), body, { headers: omniHeaders(config), signal: options?.signal })).data;
    if (!created.id) throw new Error("Gemini Omni 没有返回 interaction ID");
    return created.id;
}

async function pollOmni(config: AiConfig, id: string, options?: Options): Promise<ProviderState> {
    const state = (await axios.get<OmniInteraction>(withLocalProxy(`${geminiApiBase(config.baseUrl)}/interactions/${id}`), { headers: omniHeaders(config), signal: options?.signal })).data;
    if (state.status === "failed" || state.status === "cancelled") return { status: "failed", error: `Gemini Omni：${state.error?.message || state.status}` };
    if (state.status !== "completed") return { status: "pending" };
    const video = state.steps?.filter((step) => step.type === "model_output").flatMap((step) => step.content || []).find((item) => item.type === "video");
    if (video?.data) return { status: "completed", blob: base64ToBlob(video.data, video.mime_type || "video/mp4") };
    if (video?.uri) return { status: "completed", url: video.uri.includes("key=") ? video.uri : `${video.uri}${video.uri.includes("?") ? "&" : "?"}key=${config.apiKey}` };
    return { status: "failed", error: "Gemini Omni 完成但没有视频输出" };
}

// ---------- dispatch ----------

export function officialVideoProviderOf(config: Pick<AiConfig, "apiFormat" | "model">): OfficialVideoProvider | null {
    if (config.apiFormat === "kling" || config.apiFormat === "runway" || config.apiFormat === "ark") return config.apiFormat;
    if (config.apiFormat === "gemini" && isGeminiOmniModel(config.model)) return "omni";
    return null;
}

export async function createOfficialVideoTask(provider: OfficialVideoProvider, config: AiConfig, prompt: string, input: FramesInput, options?: Options) {
    try {
        if (provider === "kling") return await createKling(config, prompt, input, options);
        if (provider === "runway") return await createRunway(config, prompt, input, options);
        if (provider === "ark") return await createArk(config, prompt, input, options);
        return await createOmni(config, prompt, input, options);
    } catch (error) {
        throw vendorError(error, VENDOR_NAMES[provider]);
    }
}

export async function pollOfficialVideoTask(provider: OfficialVideoProvider, config: AiConfig, id: string, options?: Options): Promise<ProviderState> {
    try {
        if (provider === "kling") return await pollKling(config, id, options);
        if (provider === "runway") return await pollRunway(config, id, options);
        if (provider === "ark") return await pollArk(config, id, options);
        return await pollOmni(config, id, options);
    } catch (error) {
        throw vendorError(error, VENDOR_NAMES[provider]);
    }
}

const VENDOR_NAMES: Record<OfficialVideoProvider, string> = { kling: "可灵", runway: "Runway", ark: "火山方舟 Seedance", omni: "Gemini Omni" };

function bearer(config: AiConfig) {
    return { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
}

function base64ToBlob(base64: string, type: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}
