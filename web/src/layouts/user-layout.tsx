import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const fullScreen = /^\/canvas\/[^/]+/.test(pathname);
    const closePanel = useAgentStore((state) => state.closePanel);

    // 离开画布回到首页或其它非画布页面时，Agent 面板自动收起
    useEffect(() => {
        if (!fullScreen) {
            closePanel();
        }
    }, [fullScreen, closePanel]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <div className={cn("flex min-w-0 flex-1 flex-col overflow-hidden", !fullScreen && "pt-12 md:pt-0")}>
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
