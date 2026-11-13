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
const { allocateRefId, ensureNodeRefIds } = await import("@/lib/canvas/node-ref-id");
const { createEmptyStoryboardData, reconcileStoryboardGraph } = await import("@/lib/canvas/storyboard-utils");
const { CanvasNodeType, HemosiNodeType } = await import("@/types/canvas");

describe("node-ref-id", () => {
    test("allocates monotonic refIds and does not reuse deleted IDs", () => {
        const img1 = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { refId: "图1" });
        const img2 = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { refId: "图2" });
        const { refId, nextCounters } = allocateRefId(CanvasNodeType.Image, [img1, img2], { 图: 2 });
        expect(refId).toBe("图3");
        const next = allocateRefId(CanvasNodeType.Image, [img1], nextCounters);
        expect(next.refId).toBe("图4");
    });

    test("ensureNodeRefIds fills missing refIds", () => {
        const n1 = createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 });
        const { nodes, changed } = ensureNodeRefIds([n1]);
        expect(changed).toBe(true);
        expect(nodes[0].metadata?.refId).toBe("视1");
    });
});

describe("reconcileStoryboardGraph", () => {
    test("creates left setting image nodes, right first-frame & video nodes, and wires them", () => {
        const sbNode = createCanvasNode(HemosiNodeType.Storyboard, { x: 500, y: 300 }, { refId: "表1" });
        const data = {
            ...createEmptyStoryboardData(),
            settings: [{ id: "R1", kind: "person" as const, name: "角色1", desc: "黑色风衣" }],
            rows: [
                {
                    id: "row-1",
                    code: "S01",
                    duration: 4,
                    shotSize: "全景",
                    move: "缓推",
                    staticScreen: "街头雨夜",
                    action: "撑伞走过",
                    line: "",
                    sfx: "",
                    refs: "@R1",
                    note: "",
                    imgPrompt: "静态街头雨夜 @R1",
                    vidPrompt: "人物撑伞缓步走过",
                    imageNodeId: "",
                    videoNodeId: "",
                },
            ],
        };

        const res = reconcileStoryboardGraph({
            storyboardNodeId: sbNode.id,
            data,
            nodes: [sbNode],
            connections: [],
            refCounters: { 表: 1 },
            autoLayout: true,
        });

        expect(res.data.settings[0].desc).toContain("@图1");
        expect(res.data.rows[0].imageNodeId).toBeTruthy();
        expect(res.data.rows[0].videoNodeId).toBeTruthy();

        const imgNode = res.nodes.find((n) => n.id === res.data.rows[0].imageNodeId);
        const vidNode = res.nodes.find((n) => n.id === res.data.rows[0].videoNodeId);
        const settingImgNode = res.nodes.find((n) => n.metadata?.refId === "图1");

        expect(imgNode?.metadata?.prompt).toBe("静态街头雨夜 @R1");
        expect(vidNode?.metadata?.prompt).toBe("人物撑伞缓步走过");
        expect(vidNode?.metadata?.seconds).toBe("4");
        expect(settingImgNode?.type).toBe(CanvasNodeType.Image);

        expect(res.connections.some((c) => c.fromNodeId === settingImgNode!.id && c.toNodeId === imgNode!.id)).toBe(true);
        expect(res.connections.some((c) => c.fromNodeId === sbNode.id && c.toNodeId === imgNode!.id)).toBe(true);
        expect(res.connections.some((c) => c.fromNodeId === imgNode!.id && c.toNodeId === vidNode!.id)).toBe(true);
    });
});
