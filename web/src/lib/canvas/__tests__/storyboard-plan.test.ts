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
const { applyPlan, PlanSchema, previewPlan } = await import("@/lib/canvas/storyboard-plan");
const { createEmptyStoryboardData } = await import("@/lib/canvas/storyboard-utils");
const { HemosiNodeType } = await import("@/types/canvas");

describe("storyboard-plan", () => {
    test("previewPlan & applyPlan handle setting.add, row.add, row.update and missing target warning", () => {
        const sbNode = createCanvasNode(HemosiNodeType.Storyboard, { x: 500, y: 300 }, { refId: "表1" });
        const plan = PlanSchema.parse({
            summary: "新增角色与 1 镜分镜",
            changes: [
                {
                    id: "c1",
                    kind: "setting.add",
                    setting: { kind: "person", name: "侦探", desc: "风衣墨镜" },
                },
                {
                    id: "c2",
                    kind: "row.add",
                    row: {
                        code: "S01",
                        duration: 4,
                        shotSize: "全景",
                        move: "缓推",
                        staticScreen: "雨夜街道",
                        action: "走过积水",
                        line: "——",
                        sfx: "雨声",
                        refs: "@R1",
                        note: "开场",
                        imgPrompt: "雨夜街道静态构图 @R1",
                        vidPrompt: "人物走过积水",
                    },
                },
                {
                    id: "c3",
                    kind: "row.update",
                    rowId: "S99",
                    patch: { action: "不存在的行" },
                },
            ],
        });

        const preview = previewPlan(
            createEmptyStoryboardData(),
            plan,
            new Set(["c1", "c2", "c3"]),
            [sbNode],
            sbNode,
        );
        expect(preview.next.settings).toHaveLength(1);
        expect(preview.next.rows).toHaveLength(1);
        expect(preview.warnings).toContain("目标行 S99 不存在");
        expect(preview.diff.ghostNodes.length).toBe(3);

        // Partial selection: only apply c1 + c2
        const applied = applyPlan({
            storyboardNodeId: sbNode.id,
            data: createEmptyStoryboardData(),
            plan,
            enabledIds: new Set(["c1", "c2"]),
            nodes: [sbNode],
            connections: [],
            refCounters: { 表: 1 },
        });

        expect(applied.data.settings[0].desc).toContain("@图1");
        expect(applied.data.rows[0].imageNodeId).toBeTruthy();
        expect(applied.data.rows[0].videoNodeId).toBeTruthy();
        expect(applied.nodes.length).toBe(4); // sbNode + settingImg + firstFrameImg + video
    });
});
