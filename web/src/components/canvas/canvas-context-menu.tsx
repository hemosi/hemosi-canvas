import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, BookmarkPlus, ChevronsDownUp, ChevronsUpDown, ClipboardCopy, Download, Flame, GalleryHorizontalEnd, GalleryHorizontal, Group, Link2, Lock, LockOpen, Trash2, Ungroup } from "lucide-react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ContextMenuState } from "@/types/canvas";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { copyImageSourceToClipboard } from "./canvas-image-toolbar-tools";

export function CanvasNodeContextMenu({
    menu,
    node,
    canCaptureVideoFrame,
    canGroup,
    canUngroup,
    onClose,
    onCaptureVideoFrame,
    onDuplicate,
    onGroup,
    onUngroup,
    onDelete,
    onSaveTemplate,
    onToggleLock,
    onToggleCollapse,
    onDownload,
    connectionItems,
}: {
    menu: ContextMenuState;
    node?: CanvasNodeData | null;
    canCaptureVideoFrame: boolean;
    canGroup?: boolean;
    canUngroup?: boolean;
    onClose: () => void;
    onCaptureVideoFrame: (position: VideoFramePosition) => void;
    onDuplicate: (withConnections: boolean) => void;
    onGroup?: () => void;
    onUngroup?: () => void;
    onDelete: () => void;
    onSaveTemplate?: () => void;
    onToggleLock?: () => void;
    onToggleCollapse?: () => void;
    onDownload?: () => void;
    connectionItems?: ReactNode;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const primaryImageId = node?.metadata?.primaryImageId;
    const imageSrc = node?.type === "image" ? (node.metadata?.images?.find((i) => i.id === primaryImageId)?.content || node.metadata?.images?.[0]?.content || node.metadata?.content) : undefined;
    const primaryTextId = node?.metadata?.primaryTextId;
    const textContent = node?.type === "text" ? (node.metadata?.texts?.find((i) => i.id === primaryTextId)?.content || node.metadata?.texts?.[0]?.content || node.metadata?.content || node.metadata?.prompt || "").trim() : "";
    const handleCopyImage = async () => {
        if (!imageSrc) return;
        onClose();
        try {
            await copyImageSourceToClipboard(imageSrc);
            message.success("已复制到粘贴板");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "复制图片失败");
        }
    };
    const handleCopyText = async () => {
        if (!textContent) return;
        onClose();
        try {
            await navigator.clipboard.writeText(textContent);
            message.success("已复制到粘贴板");
        } catch {
            message.error("复制文本失败");
        }
    };

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {canCaptureVideoFrame ? (
                <>
                    <MenuButton icon={<BetweenHorizontalStart className="size-4" />} label={t("canvas.videoFrames.first")} onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton icon={<GalleryHorizontalEnd className="size-4" />} label={t("canvas.videoFrames.last")} onClick={() => onCaptureVideoFrame("last")} />
                    <MenuButton icon={<GalleryHorizontal className="size-4" />} label={t("canvas.videoFrames.current")} onClick={() => onCaptureVideoFrame("current")} />
                    <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                </>
            ) : null}
            {menu.type === "node" && imageSrc ? <MenuButton icon={<ClipboardCopy className="size-4" />} label="复制到粘贴板" onClick={() => void handleCopyImage()} /> : null}
            {menu.type === "node" && textContent ? <MenuButton icon={<ClipboardCopy className="size-4" />} label="复制到粘贴板" onClick={() => void handleCopyText()} /> : null}
            {menu.type === "node" && canGroup ? <MenuButton icon={<Group className="size-4" />} label={t("canvas.nodeToolbar.group")} onClick={onGroup} /> : null}
            {menu.type === "node" && canUngroup ? <MenuButton icon={<Ungroup className="size-4" />} label={t("canvas.nodeToolbar.ungroup")} onClick={onUngroup} /> : null}
            {menu.type === "node" ? <MenuButton icon={<Link2 className="size-4" />} label={t("p1.menu.duplicateWithLinks")} onClick={() => onDuplicate(true)} /> : null}
            {menu.type === "node" && onToggleLock ? <MenuButton icon={node?.metadata?.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />} label={t(node?.metadata?.locked ? "p1.menu.unlock" : "p1.menu.lock")} onClick={onToggleLock} /> : null}
            {menu.type === "node" && onToggleCollapse && node?.type !== "group" ? <MenuButton icon={node?.metadata?.collapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />} label={t(node?.metadata?.collapsed ? "p1.menu.expand" : "p1.menu.collapse")} onClick={onToggleCollapse} /> : null}
            {menu.type === "node" && onDownload ? <MenuButton icon={<Download className="size-4" />} label={t("p1.menu.download")} onClick={onDownload} /> : null}
            {menu.type === "node" && onSaveTemplate ? <MenuButton icon={<BookmarkPlus className="size-4" />} label={t("hemosi.templates.saveAs")} onClick={onSaveTemplate} /> : null}
            {menu.type === "connection" ? connectionItems : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.controls.delete")} onClick={onDelete} danger />
        </div>
    );
}

export function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
