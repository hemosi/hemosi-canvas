import { z } from "zod";

export const SettingKindSchema = z.enum(["person", "scene", "prop"]);
export type SettingKind = z.infer<typeof SettingKindSchema>;

export const SettingItemSchema = z.object({
    id: z.string().min(1),
    kind: SettingKindSchema,
    name: z.string(),
    desc: z.string(),
    /** Image prompt for this setting's picture (设定图). Falls back to desc. */
    prompt: z.string().optional(),
    /** 绑定的画布图片节点 id（新建、点选或连线绑定后写入）；有它就不再靠 desc 里的 @图n 猜。 */
    imageNodeId: z.string().optional(),
    /** 生成设定图时作为上游参考图的来源：@图n（画布已有图）或 @S1 等设定编号（如正打→反打）；新建节点时自动连线，不会占用被引用的图。 */
    refs: z.string().optional(),
    /** Locked = approved by the user (or by the Agent when autoLockSettings is on). Rows are only written once all are locked. */
    locked: z.boolean().optional(),
    /** The Agent's look at the generated picture: what it actually shows and any conflict with the outline. */
    review: z.string().optional(),
});
export type SettingItem = z.infer<typeof SettingItemSchema>;

export const StoryboardRowSchema = z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    duration: z.number().positive(),
    shotSize: z.string(),
    move: z.string(),
    staticScreen: z.string(),
    action: z.string(),
    line: z.string(),
    sfx: z.string(),
    refs: z.string(),
    note: z.string(),
    imgPrompt: z.string(),
    vidPrompt: z.string(),
    imageNodeId: z.string(),
    videoNodeId: z.string(),
    manualPrompt: z.boolean().optional(),
    /** Why the last 一键出片 run failed this shot; the row shows red until a run succeeds. */
    runError: z.string().optional(),
});
export type StoryboardRow = z.infer<typeof StoryboardRowSchema>;

export const StoryboardDataSchema = z.object({
    schemaVersion: z.literal(1),
    imageModelRule: z.string(),
    videoModelRule: z.string(),
    /** Image/video model the storyboard generates with; picks the built-in prompt template preset. */
    imageModel: z.string().optional(),
    videoModel: z.string().optional(),
    /** One aspect ratio for the whole table: first frames and videos share it. Only new nodes take it; a node's own size is kept. */
    aspectRatio: z.string().optional(),
    /** 一键出片 mode of this table. Anything but "auto" (including the removed 半自动) reads as manual. */
    autopilotMode: z.string().optional(),
    /** Let the Agent lock a setting itself when its review finds no conflict. Off by default: the user locks. */
    autoLockSettings: z.boolean().optional(),
    settings: z.array(SettingItemSchema),
    rows: z.array(StoryboardRowSchema),
});
export type StoryboardData = z.infer<typeof StoryboardDataSchema>;

export type StoryboardAutopilotMode = "manual" | "auto";

/** 半自动 was removed; old tables that stored it (or nothing) read as 手动. */
export function autopilotModeOf(data: Pick<StoryboardData, "autopilotMode">): StoryboardAutopilotMode {
    return data.autopilotMode === "auto" ? "auto" : "manual";
}
