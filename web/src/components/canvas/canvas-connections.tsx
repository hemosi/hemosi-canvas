import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    label,
    problem,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    label?: string;
    problem?: string | null;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const highlighted = active || hovered;
    const strokeColor = problem ? "#f87171" : highlighted ? theme.node.activeStroke : theme.node.muted;

    const handleSelect = (event: ReactMouseEvent<SVGElement>) => {
        event.stopPropagation();
        onSelect();
    };

    const handleContext = (event: ReactMouseEvent<SVGElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
    };

    return (
        <g
            data-connection-id={connection.id}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Wide 36px invisible hit corridor so clicking or right-clicking the wire is effortless at any zoom level */}
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="rgba(0,0,0,0.001)"
                strokeWidth="36"
                strokeLinecap="round"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleSelect}
                onContextMenu={handleContext}
            />
            <path
                d={pathD}
                stroke={strokeColor}
                strokeWidth={highlighted ? 3.5 : 2.2}
                strokeOpacity={highlighted ? 1 : 0.85}
                strokeDasharray={problem ? "6 5" : connection.kind === "continue" ? "2 6" : undefined}
                strokeLinecap="round"
                fill="none"
                style={{
                    filter: highlighted ? `drop-shadow(0 0 8px ${theme.node.activeStroke}88)` : undefined,
                    pointerEvents: "none",
                    transition: "stroke-width 120ms ease, stroke 120ms ease",
                }}
            />
            {label ? (
                <g
                    data-connection-id={connection.id}
                    transform={`translate(${(startX + endX) / 2}, ${(startY + endY) / 2})`}
                    style={{ cursor: "pointer", pointerEvents: "all" }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={handleSelect}
                    onContextMenu={handleContext}
                >
                    <title>{problem || label}</title>
                    <rect
                        x={-(label.length * 6 + 12)}
                        y={-11}
                        width={label.length * 12 + 24}
                        height={22}
                        rx={11}
                        fill={theme.canvas.background}
                        stroke={problem ? "#f87171" : highlighted ? theme.node.activeStroke : theme.node.muted}
                        strokeWidth={highlighted ? 1.8 : 1}
                        strokeOpacity={highlighted ? 1 : 0.65}
                    />
                    <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={11}
                        fontWeight={highlighted ? 600 : 400}
                        fill={problem ? "#f87171" : highlighted ? theme.node.activeStroke : theme.node.text}
                        opacity={highlighted ? 1 : 0.88}
                    >
                        {label}
                    </text>
                </g>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2.5" fill="none" strokeDasharray="5,5" style={{ pointerEvents: "none" }} />;
}
