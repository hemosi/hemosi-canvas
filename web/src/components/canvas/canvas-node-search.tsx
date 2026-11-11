import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { searchNodes } from "@/lib/canvas/canvas-layout";
import { getNodeSpec } from "@/constant/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { HemosiNodeType, type CanvasNodeData } from "@/types/canvas";

/** Ctrl+F box: type to filter nodes, Enter / click jumps to the node and flashes it. */
export function CanvasNodeSearch({ nodes, onLocate, onClose }: { nodes: CanvasNodeData[]; onLocate: (nodeId: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const results = useMemo(() => searchNodes(nodes, query).slice(0, 50), [nodes, query]);
    useEffect(() => inputRef.current?.focus(), []);
    useEffect(() => setActive(0), [query]);
    const locate = (index: number) => {
        const node = results[index];
        if (node) onLocate(node.id);
    };
    return (
        <div className="absolute left-1/2 top-16 z-[95] w-[420px] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2">
                <Search className="size-4 opacity-60" />
                <input
                    ref={inputRef}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    placeholder="搜索节点标题、文字、提示词、镜头号…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onClose();
                        if (event.key === "ArrowDown") setActive((value) => Math.min(value + 1, results.length - 1));
                        if (event.key === "ArrowUp") setActive((value) => Math.max(value - 1, 0));
                        if (event.key === "Enter") locate(active);
                    }}
                />
                <span className="text-xs opacity-50">{query ? `${results.length} 个` : `${nodes.length} 个节点`}</span>
                <button type="button" className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}>
                    <X className="size-3.5" />
                </button>
            </div>
            {results.length ? (
                <div className="thin-scrollbar max-h-80 overflow-auto border-t py-1" style={{ borderColor: theme.toolbar.border }}>
                    {results.map((node, index) => (
                        <button key={node.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm" style={index === active ? { background: theme.toolbar.activeBg } : undefined} onMouseEnter={() => setActive(index)} onClick={() => locate(index)}>
                            <span className="shrink-0 text-xs opacity-50">{getNodeSpec(node.type).title}</span>
                            <span className="min-w-0 flex-1 truncate">{node.type === HemosiNodeType.Shot ? `#${node.metadata?.shotNo ?? "?"} ${node.metadata?.shotDescription?.split("\n")[0] || node.title}` : node.title}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** Pulse a node's outline so it stands out after the viewport moved to it. */
export function flashNode(nodeId: string) {
    let tries = 0;
    const run = () => {
        const element = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] > div.rounded-3xl`);
        if (!element) return void (tries++ < 20 && window.setTimeout(run, 60));
        element.animate([{ boxShadow: "0 0 0 0 rgba(34,211,238,0)" }, { boxShadow: "0 0 0 8px rgba(34,211,238,.85)" }, { boxShadow: "0 0 0 0 rgba(34,211,238,0)" }], { duration: 700, iterations: 3 });
    };
    window.setTimeout(run, 480);
}
