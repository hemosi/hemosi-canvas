import { useState } from "react";
import { GripVertical, Lock, Plus, Trash2, Unlock, X } from "lucide-react";
import { settingDisplayName, settingImageNode } from "@/lib/canvas/storyboard-utils";
import type { SettingItem } from "@/lib/canvas/storyboard-types";
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

export function StoryboardBindPanel({ table, nodes, theme, onClose, onChangeSettings }: { table: CanvasNodeData; nodes: CanvasNodeData[]; theme: { panel: string; border: string; text: string; muted: string }; onClose: () => void; onChangeSettings: (settings: SettingItem[]) => void }) {
    const settings = table.metadata?.storyboard?.settings || [];
    const rows = table.metadata?.storyboard?.rows || [];
    const [dragId, setDragId] = useState<string | null>(null);
    const move = (fromId: string, toId: string) => {
        if (fromId === toId) return;
        const list = [...settings];
        const from = list.findIndex((s) => s.id === fromId);
        const to = list.findIndex((s) => s.id === toId);
        if (from < 0 || to < 0) return;
        const [item] = list.splice(from, 1);
        list.splice(to, 0, item);
        onChangeSettings(list);
    };
    const remove = (s: SettingItem) => {
        const token = new RegExp(`@${s.id}(?![0-9])`);
        const used = rows.filter((r) => token.test(JSON.stringify(r))).length;
        const tip = used ? `镜头里还有 ${used} 处引用 @${s.id}，删除后这些引用会失效。确定删除设定「${s.name}」？` : `删除设定「${s.name}」？（图片节点保留）`;
        if (!window.confirm(tip)) return;
        onChangeSettings(settings.filter((x) => x.id !== s.id));
    };
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
                    <div
                        key={s.id}
                        data-bind-slot={s.id}
                        data-bind-table={table.id}
                        className="group relative flex items-center gap-2 border-b pl-1 pr-2"
                        style={{ ...slotStyle, opacity: dragId === s.id ? 0.4 : 1 }}
                        title={image ? "已绑定；按住左侧把手拖动排序" : "从画布上的图片拉线到这里绑定"}
                        onPointerEnter={() => {
                            if (dragId && dragId !== s.id) {
                                move(dragId, s.id);
                            }
                        }}
                        onDragOver={(e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onDrop={(e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            e.stopPropagation();
                            move(dragId, s.id);
                            setDragId(null);
                        }}
                    >
                        <span
                            draggable
                            className="nodrag nopan cursor-grab p-1 opacity-50 hover:opacity-100 active:cursor-grabbing"
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                setDragId(s.id);
                                const onUp = () => {
                                    setDragId(null);
                                    window.removeEventListener("pointerup", onUp, true);
                                };
                                window.addEventListener("pointerup", onUp, true);
                            }}
                            onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", s.id);
                                setDragId(s.id);
                            }}
                            onDragEnd={() => setDragId(null)}
                        >
                            <GripVertical className="size-3.5" />
                        </span>
                        <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2" style={{ borderColor: image ? "#10b981" : theme.muted, background: theme.panel }} />
                        {image?.metadata?.content ? <img src={image.metadata.content} alt="" className="size-9 shrink-0 rounded object-cover" draggable={false} /> : <span className="grid size-9 shrink-0 place-items-center rounded border border-dashed text-[10px]" style={{ borderColor: theme.muted, color: theme.muted }}>空</span>}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-xs">
                                <span className="mr-1 font-semibold opacity-70">{s.id}</span>
                                {settingDisplayName(s, nodes)}
                            </div>
                            <div className="text-[10px]" style={{ color: theme.muted }}>
                                {KIND_LABEL[s.kind] || s.kind}
                                {image ? "" : " · 未绑定"}
                            </div>
                        </div>
                        <button type="button" className="shrink-0 rounded p-1 opacity-0 transition hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-70" title="删除这个设定" onClick={() => remove(s)}>
                            <Trash2 className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            className="shrink-0 rounded p-1 transition hover:bg-black/10 dark:hover:bg-white/10"
                            style={{ color: s.locked ? "#10b981" : theme.muted }}
                            title={s.locked ? "已锁定，点击解锁" : image?.metadata?.content ? "锁定这个设定（确认设定图没问题）" : "还没有设定图，不能锁定"}
                            disabled={!s.locked && !image?.metadata?.content}
                            onClick={() => onChangeSettings(settings.map((x) => (x.id === s.id ? { ...x, locked: !x.locked } : x)))}
                        >
                            {s.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                        </button>
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
