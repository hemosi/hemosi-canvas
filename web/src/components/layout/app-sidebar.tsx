import { Bot, Menu, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { HemosiLogo } from "@/components/layout/hemosi-logo";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { getActiveToolSlug, navigationBottomTools, navigationTools, type NavigationTool } from "@/constant/navigation-tools";
import { useCreateCanvas } from "@/hooks/use-create-canvas";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const COLLAPSED_KEY = "hemosi:sidebar_collapsed";

// CapCut-style left sidebar. Hidden on /canvas/:id so the editor keeps the full screen.
export function AppSidebar() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [manualCollapsed, setManualCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const { createCanvas, ready } = useCreateCanvas();
    const fullScreen = /^\/canvas\/[^/]+/.test(pathname);
    const activeToolSlug = getActiveToolSlug(pathname);

    const toggleCollapsed = () => {
        setManualCollapsed((value) => {
            localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
            return !value;
        });
    };

    // md..lg screens always show icons only; lg+ follows the manual toggle.
    const labelClass = cn("truncate", manualCollapsed ? "hidden" : "hidden lg:inline");
    const agentLabel = t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent");

    const renderItem = (tool: NavigationTool) => {
        const Icon = tool.icon;
        const active = tool.slug === activeToolSlug;
        const label = tool.slug === "storyboard" ? "分镜表" : t(`navigation.${tool.slug}`);
        return (
            <Tooltip key={tool.slug} title={label} placement="right" mouseEnterDelay={0.3} classNames={{ root: manualCollapsed ? undefined : "lg:hidden" }}>
                <Link
                    to={tool.path}
                    aria-label={label}
                    className={cn(
                        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition",
                        manualCollapsed ? "justify-center" : "justify-center lg:justify-start",
                        active ? "bg-hemosi-soft font-medium text-hemosi" : "text-stone-600 hover:bg-black/5 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/5 dark:hover:text-stone-100",
                    )}
                >
                    <Icon className="size-[18px] shrink-0" />
                    <span className={labelClass}>{label}</span>
                </Link>
            </Tooltip>
        );
    };

    return (
        <>
            {!fullScreen ? (
                <>
                    {/* Mobile top bar */}
                    <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-sidebar px-3 md:hidden">
                        <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-stone-600 dark:text-stone-300" onClick={() => setMobileNavOpen(true)} aria-label={t("topNav.openMenu")} title={t("topNav.menu")}>
                            <Menu className="size-5" />
                        </button>
                        <Link to="/" className="flex items-center gap-2 text-base font-semibold">
                            <HemosiLogo className="size-6" />
                            {t("meta.title")}
                        </Link>
                        <div className="ml-auto">
                            <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-stone-600 dark:text-stone-300" onClick={togglePanel} aria-label={agentLabel} title={agentLabel}>
                                <Bot className="size-5" />
                            </button>
                        </div>
                    </header>

                    {/* Desktop sidebar */}
                    <aside className={cn("hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar py-4 md:flex", manualCollapsed ? "w-[68px] px-2" : "w-[68px] px-2 lg:w-[220px] lg:px-3")}>
                        <Link to="/" className={cn("mb-5 flex items-center gap-2.5 px-1", manualCollapsed ? "justify-center" : "justify-center lg:justify-start")}>
                            <HemosiLogo />
                            <span className={cn("text-lg font-semibold tracking-tight", labelClass)}>{t("meta.title")}</span>
                        </Link>

                        <Tooltip title={t("sidebar.newCanvas")} placement="right" classNames={{ root: manualCollapsed ? undefined : "lg:hidden" }}>
                            <button
                                type="button"
                                disabled={!ready}
                                onClick={createCanvas}
                                aria-label={t("sidebar.newCanvas")}
                                className="mb-5 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-hemosi text-sm font-semibold text-[#0f1012] shadow-[0_6px_20px_-8px_var(--hemosi-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Plus className="size-[18px] shrink-0" />
                                <span className={labelClass}>{t("sidebar.newCanvas")}</span>
                            </button>
                        </Tooltip>

                        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">{navigationTools.map(renderItem)}</nav>

                        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                            {navigationBottomTools.map(renderItem)}
                            <Tooltip title={agentLabel} placement="right" classNames={{ root: manualCollapsed ? undefined : "lg:hidden" }}>
                                <button
                                    type="button"
                                    onClick={togglePanel}
                                    aria-label={agentLabel}
                                    className={cn(
                                        "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm transition",
                                        manualCollapsed ? "justify-center" : "justify-center lg:justify-start",
                                        panelOpen ? "bg-hemosi-soft text-hemosi" : "text-stone-600 hover:bg-black/5 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/5 dark:hover:text-stone-100",
                                    )}
                                >
                                    <Bot className="size-[18px] shrink-0" />
                                    <span className={labelClass}>{t("sidebar.agent")}</span>
                                </button>
                            </Tooltip>
                            <UserStatusActions showConfig={false} className={cn("mt-2 flex-wrap justify-center", manualCollapsed ? "flex-col" : "flex-col lg:flex-row lg:justify-start lg:px-2")} />
                            <button
                                type="button"
                                onClick={toggleCollapsed}
                                aria-label={t(manualCollapsed ? "sidebar.expand" : "sidebar.collapse")}
                                title={t(manualCollapsed ? "sidebar.expand" : "sidebar.collapse")}
                                className="mt-1 hidden h-8 cursor-pointer items-center justify-center rounded-lg text-stone-500 transition hover:bg-black/5 hover:text-stone-900 lg:flex dark:hover:bg-white/5 dark:hover:text-stone-100"
                            >
                                {manualCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                            </button>
                        </div>
                    </aside>
                </>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
