import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

/** 尚未出内容的节点（含生成失败的），已出图/视频的不动。 */
export const isUngenerated = (node: CanvasNodeData) => !node.metadata?.content && node.metadata?.status !== "loading";

type Kind = "image" | "video";

/** 设置面板的配置键 → 节点 metadata 键（与节点提示词栏一致）。 */
function toNodePatch(key: string, value: string): CanvasNodeMetadata {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value } as CanvasNodeMetadata;
}

/** 底部工具栏弹出：批量改「还没生成」的图片/视频节点参数，界面与节点自己的设置一致；只改动过的项才写入。 */
export function BatchParamsPanel({ nodes, config, onApply, onClose }: { nodes: CanvasNodeData[]; config: AiConfig; onApply: (kind: Kind, patch: CanvasNodeMetadata) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [kind, setKind] = useState<Kind>("image");
    const [touched, setTouched] = useState<{ image: Record<string, string>; video: Record<string, string> }>({ image: {}, video: {} });
    const current = touched[kind];
    const ungeneratedOfKind = useMemo(
        () => nodes.filter((n) => n.type === (kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video) && isUngenerated(n)),
        [nodes, kind],
    );
    const count = ungeneratedOfKind.length;
    const baseModel = kind === "image" ? config.imageModel || config.model : config.videoModel;
    const firstVideoSeconds = ungeneratedOfKind[0]?.metadata?.seconds;
    const draftConfig = {
        ...config,
        ...(kind === "video" && firstVideoSeconds ? { videoSeconds: String(firstVideoSeconds) } : {}),
        model: current.model || baseModel,
        ...current,
    } as AiConfig;
    const set = (key: string, value: string) => setTouched((prev) => ({ ...prev, [kind]: { ...prev[kind], [key]: value } }));
    const changed = Object.keys(current).length;

    return (
        <div
            className="thin-scrollbar pointer-events-auto absolute bottom-[84px] left-1/2 z-40 max-h-[70vh] w-[360px] -translate-x-1/2 space-y-3 overflow-y-auto rounded-2xl border p-3 shadow-2xl backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            data-canvas-no-zoom
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">批量改未生成节点</div>
                <button type="button" className="rounded p-1 opacity-60 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    <X className="size-4" />
                </button>
            </div>
            <div className="flex gap-1 text-xs">
                {(["image", "video"] as Kind[]).map((k) => (
                    <button key={k} type="button" className="flex-1 rounded-lg border px-2 py-1" style={{ borderColor: kind === k ? theme.node.activeStroke : theme.node.stroke, color: kind === k ? theme.node.activeStroke : theme.node.text }} onClick={() => setKind(k)}>
                        {k === "image" ? "图片" : "视频"}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
                <span className="shrink-0 opacity-70">模型</span>
                <div className="min-w-0 flex-1">
                    <ModelPicker config={config} capability={kind} fullWidth value={current.model || ""} onChange={(model) => set("model", model)} placeholder="不改" />
                </div>
            </div>
            {kind === "image" ? (
                <ImageSettingsPanel config={draftConfig} theme={theme} showTitle={false} className="w-full space-y-4" onConfigChange={(key, value) => set(key, value)} />
            ) : (
                <VideoSettingsPanel config={draftConfig} theme={theme} showTitle={false} className="w-full space-y-4" onConfigChange={(key, value) => set(key, value)} />
            )}
            <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: theme.toolbar.border }}>
                <button
                    type="button"
                    disabled={!count || !changed}
                    className="w-full rounded-lg px-2 py-2 text-xs font-medium disabled:opacity-40"
                    style={{ background: "var(--hemosi-accent)", color: "#0a0c0e" }}
                    onClick={() => {
                        const patch = Object.entries(current).reduce<CanvasNodeMetadata>((acc, [key, value]) => ({ ...acc, ...toNodePatch(key, value) }), {});
                        onApply(kind, patch);
                        setTouched((prev) => ({ ...prev, [kind]: {} }));
                        onClose();
                    }}
                >
                    {changed ? `把改动的 ${changed} 项应用到 ${count} 个未生成的${kind === "image" ? "图片" : "视频"}节点` : "先改上面的参数"}
                </button>
                <div className="text-[11px] opacity-50">只写入你动过的项；已生成内容的节点不会改动。</div>
            </div>
        </div>
    );
}
