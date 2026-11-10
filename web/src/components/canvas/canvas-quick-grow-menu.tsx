import { useEffect } from "react";
import { Image as ImageIcon, Type, Video, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { QuickGrowKind } from "@/lib/canvas/canvas-quick-grow";
import { useThemeStore } from "@/stores/use-theme-store";

const ICONS: Record<QuickGrowKind, typeof Type> = { text: Type, image: ImageIcon, video: Video, edit: Wand2 };

export function CanvasQuickGrowMenu({ x, y, kinds, onSelect, onClose }: { x: number; y: number; kinds: QuickGrowKind[]; onSelect: (kind: QuickGrowKind) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = () => onClose();
        const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    return (
        <div
            className="fixed z-[90] min-w-36 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: x, top: y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            role="menu"
        >
            <div className="px-3 pb-1 pt-1.5 text-[11px] opacity-50">{t("hemosi.quickGrow.add")}</div>
            {kinds.map((kind) => {
                const Icon = ICONS[kind];
                return (
                    <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--hemosi-accent-soft)] hover:text-[var(--hemosi-accent)]"
                        onClick={() => onSelect(kind)}
                    >
                        <Icon className="size-4" />
                        <span>{t(`hemosi.quickGrow.${kind}`)}</span>
                    </button>
                );
            })}
        </div>
    );
}
