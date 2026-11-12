import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { BookmarkPlus, Group, Plus, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    onGroup,
    onUngroup,
    onSaveTemplate,
    onConnectStart,
    onQuickGrow,
    actions = [],
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onSaveTemplate?: () => void;
    onConnectStart?: (event: ReactMouseEvent, nodeId: string) => void;
    onQuickGrow?: (nodeId: string, clientX: number, clientY: number) => void;
    /** Batch actions on the selection (批量执行、重试失败、下载、删除、分镜整排操作…). */
    actions?: { id: string; label: string; title?: string; icon: ReactNode; onClick: () => void }[];
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const plusBtnRef = useRef<HTMLButtonElement>(null);
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar && (canGroup || canUngroup || Boolean(onSaveTemplate) || actions.length > 0);
    const primaryNode = nodes[0];

    const handlePlusMouseDown = (downEvent: ReactMouseEvent<HTMLButtonElement>) => {
        downEvent.stopPropagation();
        if (downEvent.button !== 0 || !primaryNode) return;
        const startX = downEvent.clientX;
        const startY = downEvent.clientY;
        let isDrag = false;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 3) {
                isDrag = true;
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
                onConnectStart?.(downEvent, primaryNode.id);
            }
        };

        const handleMouseUp = () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            if (!isDrag) {
                const rect = plusBtnRef.current?.getBoundingClientRect();
                if (rect) onQuickGrow?.(primaryNode.id, rect.right + 8, rect.top);
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    };

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showToolbar ? (
                <button
                    ref={plusBtnRef}
                    type="button"
                    title="拖拽批量连线到右侧节点，或点击新建节点并全部连入"
                    aria-label="批量连线"
                    data-quick-grow
                    className="pointer-events-auto absolute z-[70] flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border shadow-lg transition hover:scale-110 active:scale-95"
                    style={{
                        left: left + width + 10,
                        top: top + height / 2,
                        background: theme.toolbar.panel,
                        borderColor: "var(--hemosi-accent)",
                        color: "var(--hemosi-accent)",
                    }}
                    onMouseDown={handlePlusMouseDown}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    <Plus className="size-4" strokeWidth={2.5} />
                </button>
            ) : null}
            {showActions ? (
                <div
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: left + width / 2, top: top - 8 }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                    {onSaveTemplate ? <SelectionAction title={t("hemosi.templates.saveAs")} label={t("hemosi.templates.saveAs")} icon={<BookmarkPlus className="size-4" />} onClick={onSaveTemplate} /> : null}
                    {actions.map((action) => (
                        <SelectionAction key={action.id} title={action.title || action.label} label={action.label} icon={action.icon} onClick={action.onClick} />
                    ))}
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={onClick} aria-label={title}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1]">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
