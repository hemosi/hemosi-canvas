import { useState } from "react";
import { Button, Input, Popover, Tooltip } from "antd";
import { Bookmark, Dice5, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useGenerationPresetStore, type GenerationPreset } from "@/stores/use-generation-preset-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { CanvasCinematographyButton } from "./canvas-cinematography-popover";

/** Seed input and parameter presets for one generation node; changes only touch this node. */
export function CanvasNodeParamExtras({ node, mode, onChange, inheritedLighting, onSplitAngles }: { node: CanvasNodeData; mode: GenerationPreset["mode"]; onChange: (nodeId: string, patch: CanvasNodeMetadata) => void; inheritedLighting?: string; onSplitAngles?: (angles: string[]) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const presets = useGenerationPresetStore((state) => state.presets).filter((preset) => preset.mode === mode);
    const addPreset = useGenerationPresetStore((state) => state.addPreset);
    const deletePreset = useGenerationPresetStore((state) => state.deletePreset);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");

    const content = (
        <div className="w-64 space-y-2" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="text-xs opacity-60">一键套用到本节点</div>
            <div className="thin-scrollbar max-h-48 space-y-1 overflow-auto">
                {presets.length ? (
                    presets.map((preset) => (
                        <div key={preset.id} className="flex items-center gap-1">
                            <button
                                type="button"
                                className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10"
                                title={Object.entries(preset.params).map(([key, value]) => `${key}: ${value}`).join("\n")}
                                onClick={() => {
                                    onChange(node.id, { ...preset.params });
                                    setOpen(false);
                                }}
                            >
                                {preset.name}
                            </button>
                            <button type="button" className="rounded p-1 opacity-60 hover:opacity-100" title="删除预设" onClick={() => deletePreset(preset.id)}>
                                <Trash2 className="size-3" />
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="py-2 text-xs opacity-50">还没有预设</div>
                )}
            </div>
            <div className="flex gap-1 border-t pt-2" style={{ borderColor: theme.toolbar.border }}>
                <Input size="small" value={name} placeholder="把当前参数存为…" onChange={(event) => setName(event.target.value)} />
                <Button
                    size="small"
                    type="primary"
                    disabled={!name.trim()}
                    onClick={() => {
                        addPreset(name.trim(), mode, node.metadata);
                        setName("");
                    }}
                >
                    保存
                </Button>
            </div>
        </div>
    );

    return (
        <div className="flex shrink-0 items-center gap-1">
            <Tooltip title="种子：留空为随机；填同一个数可复现构图（需模型支持）">
                <span className="flex h-10 items-center gap-1 rounded-full px-2" style={{ color: theme.node.text }}>
                    <Dice5 className="size-3.5 opacity-60" />
                    <input
                        className="w-16 bg-transparent text-xs outline-none"
                        inputMode="numeric"
                        placeholder="随机"
                        value={node.metadata?.seed || ""}
                        onChange={(event) => onChange(node.id, { seed: event.target.value.replace(/[^\d-]/g, "") || undefined })}
                    />
                </span>
            </Tooltip>
            <CanvasCinematographyButton camera={node.metadata?.camera} lighting={node.metadata?.lighting} inheritedLighting={inheritedLighting} onCameraChange={(camera) => onChange(node.id, { camera })} onLightingChange={(lighting) => onChange(node.id, { lighting })} onSplitAngles={onSplitAngles} />
            <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topLeft" content={content}>
                <Tooltip title="参数预设">
                    <Button type="text" className="!h-10 !w-10 !min-w-10 !rounded-full !p-0" style={{ color: theme.node.text }} icon={<Bookmark className="size-3.5" />} />
                </Tooltip>
            </Popover>
        </div>
    );
}
