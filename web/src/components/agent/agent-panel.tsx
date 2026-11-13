import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <aside
                className="relative flex h-full shrink-0 flex-col items-center justify-center gap-3 border-l p-6 text-center"
                data-canvas-shortcuts-ignore
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <div className="text-sm font-medium">导演 Agent 已升级为独立「分镜表」</div>
                <div className="text-xs opacity-60">
                    旧版表单式 Agent 已下线，新版支持幽灵预览、方案逐条勾选、事务级撤销与本地优先流水线。
                </div>
                <button
                    type="button"
                    onClick={() => navigate("/storyboard")}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
                >
                    前往分镜表 (/storyboard)
                </button>
            </aside>
        </motion.div>
    );
}
