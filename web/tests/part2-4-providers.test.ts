import { afterEach, expect, spyOn, test } from "bun:test";

// i18n / localforage / config touch browser globals at import time.
const memory = new Map<string, string>();
Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) },
    navigator: { userAgent: "bun" },
});

const axios = (await import("axios")).default;
const { buildNodeGenerationContext, withCinematography } = await import("../src/components/canvas/canvas-node-generation");
const { buildArkRequest, buildBflRequest, buildKlingRequest, buildOmniRequest, buildRunwayRequest } = await import("../src/services/api/official-providers");
const { createVideoGenerationTask } = await import("../src/services/api/video");
const { requestGeneration } = await import("../src/services/api/image");
const { runModelPlugin } = await import("../src/services/api/model-plugin");
const { cameraPromptText, lightingPromptText, resolveNodeLighting } = await import("../src/lib/canvas/canvas-cinematography");
const { buildGenerationConfirmSummary } = await import("../src/components/canvas/canvas-generation-confirm-modal");
const { defaultConfig, modelNotReadyReason } = await import("../src/stores/use-config-store");
type Node = import("../src/types/canvas").CanvasNodeData;
type AiConfig = import("../src/stores/use-config-store").AiConfig;

const node = (id: string, type: string, metadata: Node["metadata"] = {}): Node => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });
const camera = { body: "arri-alexa-35", focalLength: 35, aperture: 2, angle: "low", shotSize: "medium", movement: "push-in", movementSpeed: "slow" as const };
const lighting = { brightness: -30, colorTemp: 3200, key: { enabled: true, direction: "left", intensity: 70, quality: "soft" as const }, rim: { enabled: true, intensity: 50, color: "cool blue" } };

const channelConfig = (apiFormat: AiConfig["apiFormat"], model: string, baseUrl: string): AiConfig => ({
    ...defaultConfig,
    proxyEnabled: false,
    channels: [{ id: "c", name: "官方", baseUrl, apiKey: "test-key", apiFormat, models: [{ name: model, capability: apiFormat === "bfl" || model.includes("image") ? "image" : "video" }] }],
    model: `c::${model}`,
    videoModel: `c::${model}`,
    imageModel: `c::${model}`,
    videoSeconds: "8",
    size: "16:9",
    vquality: "1080",
});

afterEach(() => {
    (axios.post as unknown as { mockRestore?: () => void }).mockRestore?.();
});

test("camera and lighting become prompt text with lens, aperture, angle, move, colour temperature, key and rim light", () => {
    const cameraText = cameraPromptText(camera);
    expect(cameraText).toContain("ARRI Alexa 35");
    expect(cameraText).toContain("35mm");
    expect(cameraText).toContain("f/2");
    expect(cameraText).toContain("low-angle");
    expect(cameraText).toContain("slow camera dollies in");
    const lightingText = lightingPromptText(lighting);
    expect(lightingText).toContain("3200K");
    expect(lightingText).toContain("key light from camera left at 70% intensity");
    expect(lightingText).toContain("rim light");
});

test("lighting on a group is shared by every shot in it, identically; a node override wins; a scene anchor feeds linked shots", () => {
    const group = node("g", "group", { lighting });
    const shots = ["s1", "s2", "s3"].map((id) => node(id, "shot", { groupId: "g", prompt: `镜头 ${id}` }));
    const contexts = shots.map((shot) => buildNodeGenerationContext(shot.id, [group, ...shots], [], shot.metadata!.prompt!, { mode: "image" }));
    const blocks = contexts.map((context) => context.prompt.slice(context.prompt.indexOf("【灯光 Lighting】")));
    expect(blocks[0]).toContain("3200K");
    expect(new Set(blocks).size).toBe(1);
    expect(contexts[0].lightingSource?.kind).toBe("group");

    const override = node("s4", "shot", { groupId: "g", lighting: { colorTemp: 6500 } });
    expect(resolveNodeLighting("s4", [group, override], []).lighting?.colorTemp).toBe(6500);

    const anchor = node("scene", "anchor", { anchorKind: "scene", anchorText: "雨夜小巷", lighting: { mood: "neon", colorTemp: 7000 } });
    const loose = node("s5", "shot", { prompt: "x" });
    const viaAnchor = buildNodeGenerationContext("s5", [anchor, loose], [{ id: "l", fromNodeId: "scene", toNodeId: "s5" }], "x", { mode: "video" });
    expect(viaAnchor.prompt).toContain("neon");
    expect(viaAnchor.lightingSource?.kind).toBe("anchor");
});

test("text-only generations do not get a camera block", () => {
    const shot = node("s", "text", { camera });
    expect(buildNodeGenerationContext("s", [shot], [], "写一段", { mode: "text" }).prompt).toBe("写一段");
});

test("confirm card lists the camera and lighting the request carries", () => {
    const shot = node("s", "shot", { camera, lighting });
    const context = buildNodeGenerationContext("s", [shot], [], "雨夜", { mode: "video" });
    const summary = buildGenerationConfirmSummary(withCinematography(channelConfig("ark", "doubao-seedance-2-5-260628", "https://ark.cn-beijing.volces.com"), context), "video", { prompt: context.prompt, count: 1 });
    expect(summary.camera).toContain("35mm");
    expect(summary.camera).toContain("推");
    expect(summary.lighting).toContain("3200K");
    expect(summary.prompt).toContain("【摄像机 Camera】");
});

test("Seedance request body really carries the camera prompt, native camera_fixed and first/last frame roles", async () => {
    const shot = node("s", "shot", { camera: { ...camera, movement: "static" }, lighting });
    const context = buildNodeGenerationContext("s", [shot], [], "她回头", { mode: "video" });
    const config = withCinematography(channelConfig("ark", "doubao-seedance-2-5-260628", "https://ark.cn-beijing.volces.com"), context);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    spyOn(axios, "post").mockImplementation(async (url: string, body: unknown) => {
        calls.push({ url, body: body as Record<string, unknown> });
        return { data: { id: "cgt-1" } } as never;
    });
    const task = await createVideoGenerationTask(config, context.prompt, [{ id: "f", name: "f.png", type: "image/png", dataUrl: "data:image/png;base64,AAAA" }]);
    expect(task).toEqual({ id: "cgt-1", provider: "ark", model: "c::doubao-seedance-2-5-260628" });
    expect(calls[0].url).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    const body = calls[0].body as { content: Array<{ text?: string; role?: string }>; camera_fixed: boolean; ratio: string; duration: number; resolution: string };
    expect(body.content[0].text).toContain("static locked-off camera");
    expect(body.content[0].text).toContain("3200K");
    expect(body.content[1].role).toBe("first_frame");
    expect(body.camera_fixed).toBe(true);
    expect(body.ratio).toBe("adaptive");
    expect(body).toMatchObject({ duration: 8, resolution: "1080p" });
});

test("OpenAI image request body carries the camera/lighting prompt; plugin scripts receive them as params", async () => {
    const shot = node("s", "shot", { camera, lighting });
    const context = buildNodeGenerationContext("s", [shot], [], "海报", { mode: "image" });
    const config = withCinematography(channelConfig("openai", "gpt-image-2.6-sunburst", "https://api.openai.com"), context);
    let sent: Record<string, unknown> = {};
    spyOn(axios, "post").mockImplementation(async (_url: string, body: unknown) => {
        sent = body as Record<string, unknown>;
        return { data: { data: [{ b64_json: "AAAA" }] } } as never;
    });
    await requestGeneration({ ...config, count: "1" }, context.prompt).catch(() => undefined);
    expect(String(sent.prompt)).toContain("35mm");
    expect(String(sent.prompt)).toContain("rim light");
    expect(sent.model).toBe("gpt-image-2.6-sunburst");

    const seen = await runModelPlugin<{ camera: unknown; lighting: unknown; prompt: string }>({ capability: "image", script: "return { camera: params.camera, lighting: params.lighting, prompt };", config, prompt: context.prompt, images: [], params: { camera: config.camera, lighting: config.lighting } });
    expect(seen.camera).toEqual(camera);
    expect((seen.lighting as { colorTemp: number }).colorTemp).toBe(3200);
});

test("Kling 4.0 / Runway / Gemini Omni / BFL bodies follow each official shape", () => {
    const base = { size: "16:9", videoSeconds: "8", vquality: "1080", videoWatermark: "false", videoGenerateAudio: "true", seed: "42" };
    const kling = buildKlingRequest({ ...base, baseUrl: "https://api-singapore.klingai.com", model: "kling-4.0" }, "p", { images: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"], mode: "frames" });
    expect(kling.url).toBe("https://api-singapore.klingai.com/image-to-video/kling-4.0");
    expect(kling.body.contents.map((item) => item.type)).toEqual(["prompt", "first_frame", "last_frame"]);
    expect(kling.body.settings).toEqual({ resolution: "1080p", duration: 8 });
    const klingText = buildKlingRequest({ ...base, baseUrl: "https://api-singapore.klingai.com", model: "kling-4.0" }, "p", { images: [], mode: "frames" });
    expect(klingText.url).toEndWith("/text-to-video/kling-4.0");
    expect(klingText.body.settings).toMatchObject({ aspect_ratio: "16:9" });
    expect(() => buildKlingRequest({ ...base, baseUrl: "x", model: "kling-4.0" }, "p", { images: ["a", "b", "c"], mode: "reference" })).toThrow();

    const runway = buildRunwayRequest({ ...base, baseUrl: "https://api.dev.runwayml.com", model: "gen4.5" }, "p", { images: ["data:image/png;base64,AAA"], mode: "frames" });
    expect(runway.url).toBe("https://api.dev.runwayml.com/v1/image_to_video");
    expect(runway.body).toMatchObject({ model: "gen4.5", ratio: "1280:720", duration: 8, seed: 42, promptImage: "data:image/png;base64,AAA" });
    expect(() => buildRunwayRequest({ ...base, baseUrl: "x", model: "gen4.5" }, "x".repeat(1001), { images: [], mode: "frames" })).toThrow(/1000/);

    const omni = buildOmniRequest({ ...base, baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-omni-1.2-flash" }, "p", { images: ["data:image/jpeg;base64,AAA"], mode: "frames" });
    expect(omni.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(omni.body).toMatchObject({ model: "gemini-omni-1.2-flash", background: true, response_format: { type: "video", aspect_ratio: "16:9", resolution: "1080p", duration: "8s" } });
    expect(omni.body.input[0]).toEqual({ type: "image", data: "AAA", mime_type: "image/jpeg" });

    const bfl = buildBflRequest({ baseUrl: "https://api.bfl.ai", model: "flux-2-max", seed: "7" }, "p", { width: 1024, height: 576 }, ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
    expect(bfl.url).toBe("https://api.bfl.ai/v1/flux-2-max");
    expect(bfl.body).toMatchObject({ prompt: "p", width: 1024, height: 576, seed: 7, input_image: "AAA", input_image_2: "BBB" });

    const ark = buildArkRequest({ ...base, baseUrl: "https://ark.cn-beijing.volces.com", model: "doubao-seedance-2-5-260628" }, "p", { images: ["a", "b", "c"], mode: "reference" });
    expect(ark.body.content.slice(1).map((item) => item.role)).toEqual(["reference_image", "reference_image", "reference_image"]);
    expect(ark.body.ratio).toBe("16:9");
});

test("a missing Key or a removed model is reported, never swapped for another model", () => {
    const config = channelConfig("kling", "kling-4.0", "https://api-singapore.klingai.com");
    expect(modelNotReadyReason(config, "c::kling-4.0")).toBe("");
    const noKey = { ...config, channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })) };
    expect(modelNotReadyReason(noKey, "c::kling-4.0")).toContain("还没填 API Key");
    expect(modelNotReadyReason(config, "gone::veo-3.1")).toContain("不在任何渠道里");
});
