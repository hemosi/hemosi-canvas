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
const { applyPlan, PlanSchema, pickAutoSettingImages, previewPlan, skillsToAutoLoad } = await import("@/lib/canvas/storyboard-plan");
const { createEmptyStoryboardData, settingsGate } = await import("@/lib/canvas/storyboard-utils");
const { CanvasNodeType, HemosiNodeType } = await import("@/types/canvas");

/** A table whose settings gate is open: one locked setting. */
const lockedTable = () => ({ ...createEmptyStoryboardData(), settings: [{ id: "R1", kind: "person" as const, name: "主角", desc: "", locked: true }] });

describe("storyboard-plan", () => {
    test("previewPlan & applyPlan handle setting.add, row.add, row.update and missing target warning", () => {
        const sbNode = createCanvasNode(HemosiNodeType.Storyboard, { x: 500, y: 300 }, { refId: "表1" });
        const plan = PlanSchema.parse({
            summary: "新增角色与 1 镜分镜",
            changes: [
                {
                    id: "c1",
                    kind: "setting.add",
                    setting: { kind: "person", name: "侦探", desc: "风衣墨镜", imgPrompt: "侦探全身定妆照" },
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
            lockedTable(),
            plan,
            new Set(["c1", "c2", "c3"]),
            [sbNode],
            sbNode,
        );
        expect(preview.next.settings).toHaveLength(2);
        expect(preview.next.rows).toHaveLength(1);
        expect(preview.warnings).toContain("目标行 S99 不存在");
        expect(preview.diff.ghostNodes.length).toBe(3);

        // Partial selection: only apply c1 + c2
        const applied = applyPlan({
            storyboardNodeId: sbNode.id,
            data: lockedTable(),
            plan,
            enabledIds: new Set(["c1", "c2"]),
            nodes: [sbNode],
            connections: [],
            refCounters: { 表: 1 },
        });

        expect(applied.data.settings[0].desc).toContain("@图1");
        expect(applied.data.rows[0].imageNodeId).toBeTruthy();
        expect(applied.data.rows[0].videoNodeId).toBeTruthy();
        expect(applied.nodes.length).toBe(5); // sbNode + 2 settingImgs + firstFrameImg + video
        // setting.add creates a picture node with the image prompt, bound to the setting
        const detective = applied.data.settings.find((st) => st.name === "侦探")!;
        const bound = applied.nodes.find((n) => n.type === CanvasNodeType.Image && detective.desc.includes(`@${n.metadata?.refId}`));
        expect(bound?.metadata?.prompt).toBe("侦探全身定妆照");
    });

    test("先设计后分镜: rows are not written until every setting is locked", () => {
        const plan = PlanSchema.parse({
            summary: "梗概",
            changes: [
                { id: "c1", kind: "setting.add", setting: { kind: "scene", name: "废土", imgPrompt: "空镜" } },
                { id: "c2", kind: "row.add", row: { refs: "@S1", note: "[切镜]" } },
            ],
        });
        const preview = previewPlan(createEmptyStoryboardData(), plan, new Set(["c1", "c2"]), []);
        expect(preview.next.rows).toHaveLength(0);
        expect(preview.next.settings[0].locked).toBe(false);
        expect(preview.warnings.some((w) => w.includes("没有写入"))).toBe(true);
        expect(settingsGate(preview.next.settings).ready).toBe(false);
        expect(settingsGate([{ id: "S1", kind: "scene", name: "", desc: "", locked: true }]).ready).toBe(true);
    });

    test("setting.review records what the picture shows; auto-lock only when the table allows it and there is no conflict", () => {
        const base = { ...createEmptyStoryboardData(), settings: [{ id: "R1", kind: "person" as const, name: "林", desc: "" }] };
        const plan = (conflicts: string) => PlanSchema.parse({ summary: "", changes: [{ id: "r", kind: "setting.review", settingId: "R1", actual: "红背心", conflicts, ok: !conflicts }] });
        expect(previewPlan(base, plan(""), new Set(["r"]), []).next.settings[0].locked).toBeUndefined();
        const auto = { ...base, autoLockSettings: true };
        expect(previewPlan(auto, plan(""), new Set(["r"]), []).next.settings[0].locked).toBe(true);
        const bad = previewPlan(auto, plan("剧本是皮夹克"), new Set(["r"]), []);
        expect(bad.next.settings[0].locked).toBeUndefined();
        expect(bad.next.settings[0].review).toContain("冲突：剧本是皮夹克");
    });

    test("setting pictures auto-attached to the Agent: capped, locked ones only once the gate is open", () => {
        const nodes = Array.from({ length: 10 }, (_, i) => createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { refId: `图${i + 1}`, content: "data:image/png;base64,x" }));
        const settings = nodes.map((_, i) => ({ id: `R${i + 1}`, kind: "person" as const, name: `角色${i + 1}`, desc: `@图${i + 1}`, locked: i < 9 }));
        const before = pickAutoSettingImages(settings, nodes);
        expect(before.ids).toHaveLength(8);
        expect(before.ids[0]).toBe(nodes[9].id); // unlocked first, to be reviewed
        expect(before.omitted).toHaveLength(2);
        const after = pickAutoSettingImages(settings.map((st) => ({ ...st, locked: true })), nodes, 3);
        expect(after.ids).toHaveLength(3);
        expect([...after.labels.values()][0]).toContain("已锁定");
    });

    test("skills the model asks for are loaded once, by name, case-insensitive", () => {
        const available = [{ name: "导演风格", description: "d", body: "b" }, { name: "Cyberpunk", description: "d", body: "b" }];
        expect(skillsToAutoLoad(["cyberpunk", "不存在", "导演风格"], available, ["导演风格"])).toEqual(["Cyberpunk"]);
        expect(skillsToAutoLoad(undefined, available, [])).toEqual([]);
    });
});
