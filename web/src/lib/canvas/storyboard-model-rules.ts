import type { StoryboardData } from "@/lib/canvas/storyboard-types";
import { DEFAULT_IMAGE_MODEL_RULE, DEFAULT_VIDEO_MODEL_RULE } from "@/lib/canvas/storyboard-utils";
import { modelOptionName } from "@/stores/use-config-store";

export type ModelRuleKind = "image" | "video";

type ModelRulePreset = {
    id: string;
    label: string;
    /** Lower-case keywords matched against the model name (channel prefix stripped). */
    match: string[];
    rule: string;
};

/** Built-in prompt-writing rules per image model family; first match wins. */
const IMAGE_MODEL_RULE_PRESETS: ModelRulePreset[] = [
    {
        id: "sd",
        label: "SD / SDXL / Civitai",
        match: ["sdxl", "stable-diffusion", "stable_diffusion", "sd1", "sd3", "sd-", "civitai", "pony", "illustrious", "noobai", "checkpoint", "lora"],
        rule: "【图片提示词规范 · SD/SDXL/Civitai】用英文逗号分隔的短标签写，不写长句：先质量词（masterpiece, best quality, highly detailed）→ 景别机位（close-up / full body / low angle）→ 主体外观（发型、服装、表情，与参考设定一致）→ 场景道具 → 光影色调 → 画风/摄影质感；重点词可加权如 (red scarf:1.2)；纯静态首帧，不写镜头运动；不要写文字/字幕。",
    },
    {
        id: "flux",
        label: "FLUX",
        match: ["flux"],
        rule: "【图片提示词规范 · FLUX】用英文自然语言完整句描述，主体放在最前：景别与机位 → 主体外观细节（与参考图一致）→ 动作姿态的静止瞬间 → 环境与空间层次 → 光线方向与色调 → 镜头/胶片质感；不用负面词和权重括号；纯静态首帧，不写镜头运动。",
    },
    {
        id: "midjourney",
        label: "Midjourney",
        match: ["midjourney", "mj-", "niji"],
        rule: "【图片提示词规范 · Midjourney】英文短语为主、信息密度高：主体与外观 → 场景 → 构图景别 → 光影氛围 → 风格/摄影参考，末尾按需加参数（如 --ar 9:16 --style raw）；纯静态首帧，不写镜头运动。",
    },
    {
        id: "gpt-image",
        label: "GPT Image / DALL·E",
        match: ["gpt-image", "gpt_image", "dall-e", "dalle", "gpt-4o-image"],
        rule: "【图片提示词规范 · GPT Image】用中文或英文自然段完整描述：画面用途（电影分镜首帧）→ 景别机位 → 主体外观（严格对齐参考图的脸、发型、服装）→ 环境道具与空间层次 → 光影与色调 → 摄影质感；需要画面内文字时写清内容和位置，否则写明“无文字”；纯静态，不写镜头运动。",
    },
    {
        id: "gemini-image",
        label: "Nano Banana / Gemini / Imagen",
        match: ["nano-banana", "nano_banana", "banana", "gemini", "imagen"],
        rule: "【图片提示词规范 · Gemini/Imagen】用自然段叙述而非关键词堆砌：先说“基于参考图保持人物/场景一致”，再写景别机位 → 主体外观与静止姿态 → 环境与空间层次 → 光影色调 → 摄影质感与画幅；纯静态首帧，不写镜头运动。",
    },
    {
        id: "seedream",
        label: "Seedream / 即梦 / 豆包",
        match: ["seedream", "jimeng", "doubao", "即梦"],
        rule: "【图片提示词规范 · Seedream/即梦】用中文自然语言：主体（外观细节与参考图一致）+ 静止姿态 + 场景环境 + 景别机位 + 光影色调 + 画面风格/质感，短句分号分隔；画面内需要文字时用引号写明内容；纯静态首帧，不写镜头运动。",
    },
    {
        id: "qwen-image",
        label: "通义千问 Qwen Image",
        match: ["qwen-image", "qwen_image", "wanx", "wan-image"],
        rule: "【图片提示词规范 · Qwen Image】用中文完整描述：景别机位 → 主体外观（与参考设定一致）→ 环境道具 → 光影色调 → 风格质感；画面文字用引号写明；纯静态首帧，不写镜头运动。",
    },
];

/** Built-in prompt-writing rules per video model family; first match wins. */
const VIDEO_MODEL_RULE_PRESETS: ModelRulePreset[] = [
    {
        id: "seedance",
        label: "Seedance / 即梦 / 豆包",
        match: ["seedance", "jimeng", "doubao", "即梦"],
        rule: "【视频提示词规范 · Seedance/即梦】中文写：主体 + 单一连贯动作（含幅度和速度）+ 运镜（推/拉/摇/移/跟/环绕，写明方向）+ 环境动态 + 情绪节奏；动作和首帧画面衔接，不重复描述首帧已有的外观；多段动作时按时间先后写清。",
    },
    {
        id: "kling",
        label: "可灵 Kling",
        match: ["kling", "可灵"],
        rule: "【视频提示词规范 · 可灵】中文写：主体 + 运动（一个核心动作，写清起止）+ 场景 + 镜头语言（缓推/横摇/跟拍/升降）+ 光影与氛围；基于首帧图时只写变化部分，不重写外观；避免多主体同时大动作。",
    },
    {
        id: "veo",
        label: "Google Veo",
        match: ["veo"],
        rule: "【视频提示词规范 · Veo】用英文电影化自然段：Shot type & camera movement → subject action (one clear action) → setting & environmental motion → lighting & mood；台词用引号写出并标明说话人，音效与环境声单独一句（SFX: ...）；以首帧图为起点，不重写外观。",
    },
    {
        id: "sora",
        label: "Sora",
        match: ["sora"],
        rule: "【视频提示词规范 · Sora】用英文自然段描述一个镜头：机位与运镜 → 主体单一连贯动作 → 环境物理动态（风、烟、光影）→ 色调与情绪；动作要符合物理，节奏清楚；以首帧图为起点，不重复外观描述。",
    },
    {
        id: "hailuo",
        label: "海螺 Hailuo / MiniMax",
        match: ["hailuo", "minimax", "海螺", "t2v-01", "i2v-01"],
        rule: "【视频提示词规范 · 海螺】中文写：主体 + 单一动作 + 场景动态 + 情绪；运镜用方括号指令写在对应位置，如 [推进]、[左摇]、[跟随]、[固定]，一个镜头最多两个运镜指令；以首帧图为起点，不重写外观。",
    },
    {
        id: "wan",
        label: "通义万相 Wan",
        match: ["wan2", "wan-", "wan_", "wanx", "万相"],
        rule: "【视频提示词规范 · 万相】中文写：主体 + 场景 + 运动（一个核心动作）+ 镜头语言（景别、运镜方向与速度）+ 氛围光影 + 风格；以首帧图为起点只写变化，避免多动作堆叠。",
    },
    {
        id: "runway",
        label: "Runway",
        match: ["runway", "gen-3", "gen3", "gen-4", "gen4"],
        rule: "【视频提示词规范 · Runway】英文，运镜放最前：[camera movement]: [subject's single action]. [environmental motion, lighting, mood]. 只写画面会发生的变化，不重写首帧外观，不写否定句。",
    },
    {
        id: "vidu",
        label: "Vidu",
        match: ["vidu"],
        rule: "【视频提示词规范 · Vidu】中文简洁写：主体 + 单一动作 + 运镜 + 环境动态 + 氛围；基于首帧/参考图时保持主体一致，只写动作与镜头变化。",
    },
];

const presetsOf = (kind: ModelRuleKind) => (kind === "image" ? IMAGE_MODEL_RULE_PRESETS : VIDEO_MODEL_RULE_PRESETS);
const defaultRuleOf = (kind: ModelRuleKind) => (kind === "image" ? DEFAULT_IMAGE_MODEL_RULE : DEFAULT_VIDEO_MODEL_RULE);

/** The built-in rule for a model; falls back to the generic default rule when no family matches. */
export function modelRulePreset(kind: ModelRuleKind, model?: string): { id: string; label: string; rule: string } {
    const name = modelOptionName(model || "").toLowerCase();
    const hit = name ? presetsOf(kind).find((p) => p.match.some((m) => name.includes(m))) : undefined;
    return hit ? { id: hit.id, label: hit.label, rule: hit.rule } : { id: "default", label: "通用", rule: defaultRuleOf(kind) };
}

/** True when the rule is empty or still one of the built-in presets, i.e. the user has not edited it. */
export function isBuiltinModelRule(kind: ModelRuleKind, rule: string | undefined): boolean {
    const value = (rule || "").trim();
    return !value || value === defaultRuleOf(kind) || presetsOf(kind).some((p) => p.rule === value);
}

/**
 * Record the storyboard's image/video model and switch each prompt template to that model's preset,
 * unless the user edited the template. Returns null when nothing changed.
 */
export function syncStoryboardModelRules(data: StoryboardData, models: { imageModel?: string; videoModel?: string }): StoryboardData | null {
    let next = data;
    if (models.imageModel) {
        const rule = isBuiltinModelRule("image", data.imageModelRule) ? modelRulePreset("image", models.imageModel).rule : data.imageModelRule;
        if (data.imageModel !== models.imageModel || rule !== data.imageModelRule) next = { ...next, imageModel: models.imageModel, imageModelRule: rule };
    }
    if (models.videoModel) {
        const rule = isBuiltinModelRule("video", data.videoModelRule) ? modelRulePreset("video", models.videoModel).rule : data.videoModelRule;
        if (data.videoModel !== models.videoModel || rule !== data.videoModelRule) next = { ...next, videoModel: models.videoModel, videoModelRule: rule };
    }
    return next === data ? null : next;
}
