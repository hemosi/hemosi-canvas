// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
}

const { effectiveStoryboardRule } = await import("@/lib/canvas/storyboard-model-rules");
const { createEmptyStoryboardData } = await import("@/lib/canvas/storyboard-utils");
const { defaultConfig, normalizeChannelModels } = await import("@/stores/use-config-store");
const { DEFAULT_VIDEO_MODEL_RULE } = await import("@/lib/model-prompt-presets");

describe("prompt rules bound to the model entry in Settings", () => {
    const config = {
        ...defaultConfig,
        channels: [{ id: "c1", name: "AI Studio", baseUrl: "", apiKey: "", apiFormat: "gemini" as const, models: [{ name: "my-image-model", capability: "image" as const, promptRule: "我的写法" }] }],
        imageModel: "c1::my-image-model",
    };

    test("table follows the model's rule, then a per-table override wins", () => {
        const data = createEmptyStoryboardData();
        expect(effectiveStoryboardRule("image", data, config)).toMatchObject({ rule: "我的写法", source: "model" });
        expect(effectiveStoryboardRule("image", { ...data, imageModelRule: "本表专用" }, config)).toMatchObject({ rule: "本表专用", source: "table" });
        expect(effectiveStoryboardRule("video", data, config)).toMatchObject({ rule: DEFAULT_VIDEO_MODEL_RULE, source: "default" });
    });

    test("built-in presets only seed a new entry; a saved (even empty) rule is kept", () => {
        const [seeded] = normalizeChannelModels([{ name: "kling-v2", capability: "video" }]);
        expect(seeded.promptRule).toContain("可灵");
        const [kept] = normalizeChannelModels([{ name: "kling-v2", capability: "video", promptRule: "" }]);
        expect(kept.promptRule).toBe("");
    });
});
