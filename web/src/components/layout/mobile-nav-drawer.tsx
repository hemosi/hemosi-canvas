import { Drawer } from "antd";
import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { HemosiLogo } from "@/components/layout/hemosi-logo";
import { navigationBottomTools, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useCreateCanvas } from "@/hooks/use-create-canvas";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const { createCanvas, ready } = useCreateCanvas();

    return (
        <Drawer
            title={
                <span className="flex items-center gap-2">
                    <HemosiLogo className="size-6" />
                    <span>{t("meta.title")}</span>
                </span>
            }
            placement="left"
            size={260}
            open={open}
            onClose={onClose}
            className="md:hidden"
        >
            <button
                type="button"
                disabled={!ready}
                onClick={() => {
                    onClose();
                    createCanvas();
                }}
                className="mb-4 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-hemosi text-sm font-semibold text-[#0f1012] transition hover:brightness-110 disabled:opacity-50"
            >
                <Plus className="size-4" />
                {t("sidebar.newCanvas")}
            </button>
            <div className="space-y-1">
                {[...navigationTools, ...navigationBottomTools].map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={tool.path}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-hemosi-soft font-medium text-hemosi" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/5 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
