import { expect, test } from "bun:test";

// i18n / localforage touch browser globals at import time.
const memory = new Map<string, string>();
Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) },
    navigator: { userAgent: "bun" },
});

const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
const { connectionKindProblem, inferConnectionKind } = await import("../src/lib/canvas/canvas-connection-kind");
const { renumberShotRows, splitScript, shotRowMembers } = await import("../src/lib/canvas/canvas-shot-actions");
const { withPreviousVersion, restoreVersion } = await import("../src/lib/canvas/canvas-node-versions");
const { autoLayoutNodes } = await import("../src/lib/canvas/canvas-layout").catch(() => ({ autoLayoutNodes: null }));
type Node = import("../src/types/canvas").CanvasNodeData;

const node = (id: string, type: string, metadata: Node["metadata"] = {}, position = { x: 0, y: 0 }): Node => ({ id, type, title: id, position, width: 300, height: 200, metadata });
const link = (from: string, to: string, kind?: "reference" | "input" | "continue") => ({ id: `${from}-${to}`, fromNodeId: from, toNodeId: to, kind });

test("anchor text and images flow into every linked shot, and edits follow on the next run", () => {
    const anchor = node("anchor", "anchor", { anchorKind: "character", anchorText: "红色风衣，短发", anchorImages: [{ id: "a1", status: "success", content: "data:image/png;base64,AAA", naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: "image/png" }] });
    const shots = ["s1", "s2", "s3"].map((id) => node(id, "shot", { shotNo: 1, prompt: "她走进雨夜" }));
    const connections = shots.map((shot) => link("anchor", shot.id));
    shots.forEach((shot) => {
        const context = buildNodeGenerationContext(shot.id, [anchor, ...shots], connections, "她走进雨夜", { mode: "image" });
        expect(context.prompt).toContain("红色风衣，短发");
        expect(context.referenceImages).toHaveLength(1);
        expect(context.imageRoles?.[0]).toBe("character");
    });
    const edited = { ...anchor, metadata: { ...anchor.metadata, anchorText: "黑色西装，长发" } };
    const next = buildNodeGenerationContext("s2", [edited, ...shots], connections, "她走进雨夜", { mode: "image" });
    expect(next.prompt).toContain("黑色西装，长发");
    expect(next.prompt).not.toContain("红色风衣");
});

test("reference order and on/off switches on the target node decide what is sent", () => {
    const img = (id: string, role?: "firstFrame" | "lastFrame") => node(id, "image", { content: `blob:${id}`, imageRole: role });
    const nodes = [img("a"), img("b"), img("c"), node("t", "image", { refOrder: ["c", "a", "b"], refDisabled: ["b"] })];
    const context = buildNodeGenerationContext("t", nodes, [link("a", "t"), link("b", "t"), link("c", "t")], "x", { mode: "image" });
    expect(context.referenceImages.map((image) => image.id)).toEqual(["c", "a"]);
});

test("video runs put first/last frames in their slots and force frame mode", () => {
    const nodes = [node("ref", "image", { content: "blob:ref" }), node("last", "image", { content: "blob:last", imageRole: "lastFrame" }), node("first", "image", { content: "blob:first", imageRole: "firstFrame" }), node("v", "video")];
    const context = buildNodeGenerationContext("v", nodes, [link("ref", "v"), link("last", "v"), link("first", "v")], "go", { mode: "video" });
    expect(context.referenceImages.map((image) => image.id)).toEqual(["first", "last", "ref"]);
    expect(context.forceFrames).toBe(true);
    expect(context.prompt).toContain("首帧");
});

test("a continue link from a video becomes a last-frame request instead of a reference video", () => {
    const nodes = [node("v1", "video", { content: "blob:v1" }), node("v2", "video")];
    const context = buildNodeGenerationContext("v2", nodes, [link("v1", "v2", "continue")], "next", { mode: "video" });
    expect(context.continueVideos?.map((video) => video.id)).toEqual(["v1"]);
    expect(context.referenceVideos).toHaveLength(0);
    const asReference = buildNodeGenerationContext("v2", nodes, [link("v1", "v2", "reference")], "next", { mode: "video" });
    expect(asReference.referenceVideos).toHaveLength(1);
});

test("connection kinds are inferred and wrong ones are flagged", () => {
    expect(inferConnectionKind(node("t", "text"), node("i", "image"))).toBe("input");
    expect(inferConnectionKind(node("v", "video"), node("w", "video"))).toBe("continue");
    expect(inferConnectionKind(node("i", "image"), node("w", "video"))).toBe("reference");
    expect(connectionKindProblem("continue", node("i", "image"), node("w", "video"))).toBeTruthy();
    expect(connectionKindProblem("reference", node("a", "audio"), node("i", "image"))).toBeTruthy();
    expect(connectionKindProblem("reference", node("i", "image"), node("s", "shot"))).toBeNull();
});

test("script splits by paragraph / line and dragging renumbers the row", () => {
    expect(splitScript("第一场 雨夜\n她进门\n\n第二场 天台\n\n\n第三场 清晨", "paragraph")).toEqual(["第一场 雨夜\n她进门", "第二场 天台", "第三场 清晨"]);
    expect(splitScript("a\n\nb\nc", "line")).toEqual(["a", "b", "c"]);
    const shots = [node("s1", "shot", { shotNo: 1 }, { x: 0, y: 0 }), node("s2", "shot", { shotNo: 2 }, { x: 400, y: 0 }), node("s3", "shot", { shotNo: 3 }, { x: 800, y: 0 })];
    const dragged = shots.map((shot) => (shot.id === "s1" ? { ...shot, position: { x: 1200, y: 10 } } : shot));
    const renumbered = renumberShotRows(["s1"], dragged);
    expect(Object.fromEntries(renumbered.map((shot) => [shot.id, shot.metadata?.shotNo]))).toEqual({ s2: 1, s3: 2, s1: 3 });
    expect(shotRowMembers("s2", renumbered).map((shot) => shot.id)).toEqual(["s2", "s3", "s1"]);
});

test("regenerating keeps the old result as a version that can be restored", () => {
    const before = node("i", "image", { content: "blob:old", storageKey: "image:old", status: "success" });
    const after = { ...before, metadata: withPreviousVersion(before, { ...before.metadata, content: "blob:new", storageKey: "image:new" }) };
    expect(after.metadata?.versions).toHaveLength(1);
    const restored = restoreVersion(after as Node, after.metadata!.versions![0].id);
    expect(restored.metadata?.storageKey).toBe("image:old");
    expect(restored.metadata?.versions?.[0].storageKey).toBe("image:new");
});

test("auto layout puts nodes into columns by link depth without overlaps", () => {
    if (!autoLayoutNodes) return;
    const nodes = [node("a", "text"), node("b", "image"), node("c", "video"), node("d", "text")];
    const laid = autoLayoutNodes(nodes, [link("a", "b"), link("b", "c")], new Set(nodes.map((item) => item.id)));
    const x = Object.fromEntries(laid.map((item) => [item.id, item.position.x]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.c);
});
