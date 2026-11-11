import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import type { CanvasNodeMetadata } from "@/types/canvas";

/** Node parameters a preset carries; applying one writes these onto the node only. */
export const PRESET_KEYS = ["model", "videoModel", "size", "videoSize", "quality", "count", "seconds", "vquality", "generateAudio", "watermark", "videoMode", "seed", "draft"] as const;
export type GenerationPresetParams = Pick<CanvasNodeMetadata, (typeof PRESET_KEYS)[number]>;
export type GenerationPreset = { id: string; name: string; mode: "image" | "video" | "shot"; params: GenerationPresetParams; createdAt: string };

type PresetStore = {
    presets: GenerationPreset[];
    addPreset: (name: string, mode: GenerationPreset["mode"], metadata: CanvasNodeMetadata | undefined) => GenerationPreset;
    deletePreset: (id: string) => void;
};

export function pickPresetParams(metadata: CanvasNodeMetadata | undefined): GenerationPresetParams {
    const params: Record<string, unknown> = {};
    PRESET_KEYS.forEach((key) => {
        if (metadata?.[key] !== undefined && metadata[key] !== "") params[key] = metadata[key];
    });
    return params as GenerationPresetParams;
}

/** Saved parameter combinations (model / ratio / duration / resolution / seed …), applied to one node at a time. */
export const useGenerationPresetStore = create<PresetStore>()(
    persist(
        (set) => ({
            presets: [],
            addPreset: (name, mode, metadata) => {
                const preset: GenerationPreset = { id: nanoid(), name, mode, params: pickPresetParams(metadata), createdAt: new Date().toISOString() };
                set((state) => ({ presets: [preset, ...state.presets] }));
                return preset;
            },
            deletePreset: (id) => set((state) => ({ presets: state.presets.filter((preset) => preset.id !== id) })),
        }),
        { name: "hemosi:generation_presets", partialize: (state) => ({ presets: state.presets }) },
    ),
);
