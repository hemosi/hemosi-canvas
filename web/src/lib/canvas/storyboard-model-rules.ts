import type { StoryboardData } from "@/lib/canvas/storyboard-types";
import { isBuiltinModelRuleText, type ModelRuleKind } from "@/lib/model-prompt-presets";
import { modelOptionName, modelPromptRule, type AiConfig } from "@/stores/use-config-store";

export type { ModelRuleKind };

/** A table's own rule overrides the model's; empty (or old built-in text) means "follow the model in Settings". */
export function tableRuleOverride(kind: ModelRuleKind, data: StoryboardData): string {
    const value = (kind === "image" ? data.imageModelRule : data.videoModelRule) || "";
    return isBuiltinModelRuleText(kind, value) ? "" : value.trim();
}

/**
 * The prompt rule the Agent uses for this table: the table's override if it has one, otherwise the rule bound to the
 * table's model entry in Settings → 渠道 (falling back to the default image/video model, then the generic rule).
 */
export function effectiveStoryboardRule(kind: ModelRuleKind, data: StoryboardData, config: AiConfig): { rule: string; source: "table" | "model" | "default"; modelName: string } {
    const model = (kind === "image" ? data.imageModel || config.imageModel : data.videoModel || config.videoModel) || "";
    const override = tableRuleOverride(kind, data);
    const bound = modelPromptRule(config, model, kind);
    const modelName = bound.modelName || modelOptionName(model);
    if (override) return { rule: override, source: "table", modelName };
    return { rule: bound.rule, source: bound.custom ? "model" : "default", modelName };
}

/** Record the storyboard's image/video model (the template follows it automatically). Returns null when nothing changed. */
export function syncStoryboardModelRules(data: StoryboardData, models: { imageModel?: string; videoModel?: string }): StoryboardData | null {
    let next = data;
    if (models.imageModel && data.imageModel !== models.imageModel) next = { ...next, imageModel: models.imageModel };
    if (models.videoModel && data.videoModel !== models.videoModel) next = { ...next, videoModel: models.videoModel };
    return next === data ? null : next;
}
