import { z } from "zod";

export const SettingKindSchema = z.enum(["person", "scene", "prop"]);
export type SettingKind = z.infer<typeof SettingKindSchema>;

export const SettingItemSchema = z.object({
    id: z.string().min(1),
    kind: SettingKindSchema,
    name: z.string(),
    desc: z.string(),
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
    settings: z.array(SettingItemSchema),
    rows: z.array(StoryboardRowSchema),
});
export type StoryboardData = z.infer<typeof StoryboardDataSchema>;

export type StoryboardAutopilotMode = "manual" | "auto";

/** 半自动 was removed; old tables that stored it (or nothing) read as 手动. */
export function autopilotModeOf(data: Pick<StoryboardData, "autopilotMode">): StoryboardAutopilotMode {
    return data.autopilotMode === "auto" ? "auto" : "manual";
}
