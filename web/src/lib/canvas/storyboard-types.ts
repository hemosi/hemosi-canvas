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
});
export type StoryboardRow = z.infer<typeof StoryboardRowSchema>;

export const StoryboardDataSchema = z.object({
    schemaVersion: z.literal(1),
    imageModelRule: z.string(),
    videoModelRule: z.string(),
    settings: z.array(SettingItemSchema),
    rows: z.array(StoryboardRowSchema),
});
export type StoryboardData = z.infer<typeof StoryboardDataSchema>;

export type StoryboardAutopilotMode = "manual" | "semi" | "auto";
