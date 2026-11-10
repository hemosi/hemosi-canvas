import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { cn } from "@/lib/utils";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const fullScreen = /^\/canvas\/[^/]+/.test(pathname);

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
