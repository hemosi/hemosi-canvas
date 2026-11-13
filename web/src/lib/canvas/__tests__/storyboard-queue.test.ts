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

const { createCanvasNode } = await import("@/lib/canvas/canvas-node-factory");
const { deriveNodeHealth } = await import("@/lib/canvas/storyboard-utils");
const { isLocalChannelUrl, runWithConcurrency } = await import("@/lib/canvas/storyboard-queue");
const { CanvasNodeType } = await import("@/types/canvas");

describe("storyboard-queue", () => {
    test("detects local/LAN channel URLs for serial concurrency 1", () => {
        expect(isLocalChannelUrl("http://127.0.0.1:8080/v1")).toBe(true);
        expect(isLocalChannelUrl("http://localhost:3000")).toBe(true);
        expect(isLocalChannelUrl("http://192.168.1.50:8000")).toBe(true);
        expect(isLocalChannelUrl("https://api.openai.com/v1")).toBe(false);
    });

    test("runWithConcurrency respects max concurrency limit", async () => {
        let active = 0;
        let maxActive = 0;
        const items = [1, 2, 3, 4, 5, 6];
        const res = await runWithConcurrency(items, 2, async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 10));
            active--;
        });
        expect(res.completed).toBe(6);
        expect(res.canceled).toBe(false);
        expect(maxActive).toBeLessThanOrEqual(2);
    });
});

describe("deriveNodeHealth", () => {
    test("returns stale when generatedInputsHash differs from inputsHash", () => {
        const node = createCanvasNode(
            CanvasNodeType.Video,
            { x: 0, y: 0 },
            { content: "https://example.com/a.mp4", status: "success", inputsHash: "h2", generatedInputsHash: "h1" },
        );
        expect(deriveNodeHealth(node)).toBe("stale");
        const fresh = { ...node, metadata: { ...node.metadata, generatedInputsHash: "h2" } };
        expect(deriveNodeHealth(fresh)).toBe("ok");
    });
});
