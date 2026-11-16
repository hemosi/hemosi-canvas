import { Lock, Plus, X } from "lucide-react";
import { settingImageNode } from "@/lib/canvas/storyboard-utils";
import type { CanvasNodeData } from "@/types/canvas";

/** 分镜表左侧的绑卡界面（画布世界坐标）。只在打开时出现；关联线按绑定画，不是节点连线。 */
export const BIND_PANEL_W = 240;
const PANEL_GAP = 80;
const HEADER_H = 44;
const SLOT_H = 52;

export const BIND_PANEL_EVENT = "hemosi:bind-panel";

const KIND_LABEL: Record<string, string> = { person: "角色", scene: "场景", prop: "物品" };

export function bindPanelOrigin(table: CanvasNodeData) {
    return { x: table.position.x - BIND_PANEL_W - PANEL_GAP, y: table.position.y };
}

/** 第 index 个卡槽左侧接口的世界坐标；index = settings.length 是「＋ 新增设定」。 */
export function bindSlotAnchor(table: CanvasNodeData, index: number) {
    const o = bindPanelOrigin(table);
    return { x: o.x, y: o.y + HEADER_H + index * SLOT_H + SLOT_H / 2 };
}

/** 关联线：已绑定的设定图 → 卡槽。 */
export function BindPanelLines({ table, nodes, color }: { table: CanvasNodeData; nodes: CanvasNodeData[]; color: string }) {
    const settings = table.metadata?.storyboard?.settings || [];
    return (
        <g>
            {settings.map((s, index) => {
                const image = settingImageNode(s, nodes);
                if (!image) return null;
                const a = { x: image.position.x + image.width, y: image.position.y + image.height / 2 };
                const b = bindSlotAnchor(table, index);
                const mid = (a.x + b.x) / 2;
                return <path key={s.id} d={`M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`} fill="none" stroke={s.locked ? "#10b981" : color} strokeWidth={2} strokeDasharray={s.locked ? undefined : "6 4"} />;
            })}
        </g>
    );
}

export function StoryboardBindPanel({ table, nodes, theme, onClose }: { table: CanvasNodeData; nodes: CanvasNodeData[]; theme: { panel: string; border: string; text: string; muted: string }; onClose: () => void }) {
    const settings = table.metadata?.storyboard?.settings || [];
    const o = bindPanelOrigin(table);
    const stop = { onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(), onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation() };
    const slotStyle = { height: SLOT_H, borderColor: theme.border };
    return (
        <div className="absolute rounded-xl border shadow-2xl" style={{ left: o.x, top: o.y, width: BIND_PANEL_W, background: theme.panel, borderColor: theme.border, color: theme.text, zIndex: 5 }} data-canvas-no-zoom {...stop}>
            <div className="flex items-center justify-between border-b px-3" style={{ height: HEADER_H, borderColor: theme.border }}>
                <div className="text-sm font-semibold">绑定设定图</div>
                <button type="button" className="rounded p-1 opacity-60 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    <X className="size-4" />
                </button>
            </div>
            {settings.map((s) => {
                const image = settingImageNode(s, nodes);
                return (
                    <div key={s.id} data-bind-slot={s.id} data-bind-table={table.id} className="relative flex items-center gap-2 border-b px-3" style={slotStyle} title={image ? "已绑定" : "从画布上的图片拉线到这里绑定"}>
                        <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2" style={{ borderColor: image ? "#10b981" : theme.muted, background: theme.panel }} />
                        {image?.metadata?.content ? <img src={image.metadata.content} alt="" className="size-9 shrink-0 rounded object-cover" draggable={false} /> : <span className="grid size-9 shrink-0 place-items-center rounded border border-dashed text-[10px]" style={{ borderColor: theme.muted, color: theme.muted }}>空</span>}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-xs">
                                <span className="mr-1 font-semibold opacity-70">{s.id}</span>
                                {s.name}
                            </div>
                            <div className="text-[10px]" style={{ color: theme.muted }}>
                                {KIND_LABEL[s.kind] || s.kind}
                                {image ? "" : " · 未绑定"}
                            </div>
                        </div>
                        {s.locked ? <Lock className="size-3 shrink-0 text-[#10b981]" /> : null}
                    </div>
                );
            })}
            <div data-bind-slot="__new__" data-bind-table={table.id} className="relative flex items-center gap-2 px-3 text-xs" style={{ height: SLOT_H, color: theme.muted }} title="把画布上的新图片拉线到这里，自动新增一个设定">
                <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2" style={{ borderColor: theme.muted, background: theme.panel }} />
                <Plus className="size-4" />
                新增设定（拉图片过来）
            </div>
        </div>
    );
}
