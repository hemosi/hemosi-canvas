import { describe, expect, test } from "bun:test";
const memory = new Map<string, string>();
Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) },
    navigator: { userAgent: "bun" },
});
const { cutsFromDiffs, frameDiff } = await import("../src/lib/canvas/canvas-video-shots");

describe("视频拆分镜", () => {
    test("diff spikes become cuts, short shots merge", () => {
        const times = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
        const diffs = [0.01, 0.02, 0.5, 0.01, 0.4, 0.02, 0.01, 0.3, 0.01];
        expect(cutsFromDiffs(times, diffs, 6)).toEqual([
            { start: 0, end: 1.5 },
            { start: 1.5, end: 2.5 },
            { start: 2.5, end: 4 },
            { start: 4, end: 6 },
        ]);
        expect(cutsFromDiffs(times, diffs.map(() => 0), 6)).toEqual([{ start: 0, end: 6 }]);
    });
    test("frameDiff is 0 for equal frames and 1 for black vs white", () => {
        const black = new Uint8ClampedArray([0, 0, 0, 255]);
        const white = new Uint8ClampedArray([255, 255, 255, 255]);
        expect(frameDiff(black, black)).toBe(0);
        expect(frameDiff(black, white)).toBeCloseTo(1);
    });
});
