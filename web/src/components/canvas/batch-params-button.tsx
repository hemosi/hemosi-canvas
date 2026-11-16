import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const RATIOS = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];

/** 尚未出内容的节点（含生成失败的），已出图/视频的不动。 */
export const isUngenerated = (node: CanvasNodeData) => !node.metadata?.content && node.metadata?.status !== "loading";

type Kind = "image" | "video";

/** 画布右上角：批量改「还没生成」的图片/视频节点的模型和画幅。 */
export function BatchParamsButton({ nodes, config, onApply }: { nodes: CanvasNodeData[]; config: AiConfig; onApply: (kind: Kind, patch: { model?: string; size?: string }) => void }) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>("image");
    const [model, setModel] = useState("");
    const [size, setSize] = useState("");
    const count = useMemo(() => nodes.filter((n) => n.type === (kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video) && isUngenerated(n)).length, [nodes, kind]);
    return (
        <div className="pointer-events-auto absolute right-4 top-16 z-50">
            <button type="button" title="批量修改未生成节点的模型/画幅" className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 text-xs text-white/90 backdrop-blur-md hover:border-[#00d0c4] hover:text-[#00d0c4]" onClick={() => setOpen((v) => !v)}>
                <SlidersHorizontal className="size-3.5" />
                <span>批量改参数</span>
            </button>
            {open ? (
                <div className="absolute right-0 top-11 w-72 space-y-2.5 rounded-2xl border border-white/15 bg-[#0d1114]/95 p-3 text-xs text-gray-200 shadow-2xl backdrop-blur-xl" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                        {(["image", "video"] as Kind[]).map((k) => (
                            <button key={k} type="button" className={`flex-1 rounded-lg border px-2 py-1 ${kind === k ? "border-[#00d0c4] text-[#00d0c4]" : "border-white/15"}`} onClick={() => (setKind(k), setModel(""))}>
                                {k === "image" ? "图片" : "视频"}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0 opacity-70">模型</span>
                        <div className="min-w-0 flex-1">
                            <ModelPicker config={config} capability={kind} fullWidth value={model} onChange={setModel} placeholder="不改" />
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0 opacity-70">画幅</span>
                        <select className="flex-1 rounded-md border border-white/15 bg-transparent px-1.5 py-1" value={size} onChange={(e) => setSize(e.target.value)}>
                            <option value="">不改</option>
                            {RATIOS.map((r) => (
                                <option key={r} value={r} className="bg-[#0d1114]">
                                    {r}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        disabled={!count || (!model && !size)}
                        className="w-full rounded-lg bg-[#00d0c4] px-2 py-1.5 font-medium text-black disabled:opacity-40"
                        onClick={() => {
                            onApply(kind, { model: model || undefined, size: size || undefined });
                            setOpen(false);
                        }}
                    >
                        修改 {count} 个未生成的{kind === "image" ? "图片" : "视频"}节点
                    </button>
                    <div className="opacity-50">已生成内容的节点不会改动。</div>
                </div>
            ) : null}
        </div>
    );
}
