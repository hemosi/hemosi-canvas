// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

import type { StoryboardData, StoryboardRow } from "../storyboard-types";
import type { CanvasNodeData } from "../../../types/canvas";

if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
}

const { ensureVideoInputsLoad } = await import("@/lib/canvas/storyboard-autopilot");
const { autopilotModeOf } = await import("@/lib/canvas/storyboard-types");
const { rowHealth } = await import("@/lib/canvas/storyboard-utils");
const { CanvasNodeType } = await import("@/types/canvas");

const node = (id: string, meta: Record<string, unknown> = {}): CanvasNodeData =>
    ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: meta }) as unknown as CanvasNodeData;

const row = (id: string, imageNodeId: string, refs = ""): StoryboardRow => ({
    id, code: id.toUpperCase(), duration: 5, shotSize: "", move: "", staticScreen: "", action: "", line: "", sfx: "", refs, note: "", imgPrompt: "p", vidPrompt: "v", imageNodeId, videoNodeId: `${id}-vid`,
});

describe("ensureVideoInputsLoad", () => {
    const data: StoryboardData = {
        schemaVersion: 1, imageModelRule: "", videoModelRule: "",
        settings: [{ id: "R1", kind: "person", name: "A", desc: "@图9" }],
        rows: [row("s1", "img1", "@R1"), row("s2", "img2")],
    };

    test("regenerates a broken image and stops once it loads", async () => {
        const nodes = new Map([["img1", node("img1", { content: "x" })], ["img2", node("img2")], ["set", node("set", { refId: "图9", content: "x" })]]);
        let calls = 0;
        const res = await ensureVideoInputsLoad({
            rows: data.rows, data,
            getNode: (id) => nodes.get(id), getNodes: () => [...nodes.values()],
            canLoadImage: async (n) => Boolean(n.metadata?.content),
            regenerate: async (tasks) => {
                calls++;
                expect(tasks.map((t) => t.nodeId)).toEqual(["img2"]);
                nodes.set("img2", node("img2", { content: "ok" }));
                return { canceled: false };
            },
        });
        expect(calls).toBe(1);
        expect(res.brokenRows).toEqual({});
    });

    test("after 3 failed tries the shot is reported broken (setting image included)", async () => {
        const nodes = new Map([["img1", node("img1", { content: "x" })], ["img2", node("img2", { content: "x" })], ["set", node("set", { refId: "图9" })]]);
        let calls = 0;
        const res = await ensureVideoInputsLoad({
            rows: data.rows, data,
            getNode: (id) => nodes.get(id), getNodes: () => [...nodes.values()],
            canLoadImage: async (n) => Boolean(n.metadata?.content),
            regenerate: async () => {
                calls++;
                return { canceled: false };
            },
        });
        expect(calls).toBe(3);
        expect(Object.keys(res.brokenRows)).toEqual(["s1"]);
        expect(res.brokenRows.s1).toEqual(["set"]);
    });
});

describe("storyboard helpers", () => {
    test("removed 半自动 reads as 手动", () => {
        expect(autopilotModeOf({ autopilotMode: "semi" })).toBe("manual");
        expect(autopilotModeOf({})).toBe("manual");
        expect(autopilotModeOf({ autopilotMode: "auto" })).toBe("auto");
    });

    test("a video made from a stale first frame is stale", () => {
        const map = new Map([
            ["img1", node("img1", { content: "x", inputsHash: "b", generatedInputsHash: "a" })],
            ["s1-vid", node("s1-vid", { content: "y" })],
        ]);
        expect(rowHealth(row("s1", "img1"), map)).toEqual({ image: "stale", video: "stale" });
    });
});
