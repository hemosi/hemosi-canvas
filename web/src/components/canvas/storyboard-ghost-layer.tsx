import type { GhostPreviewNode } from "@/lib/canvas/storyboard-plan";

export function StoryboardGhostLayer({ ghosts }: { ghosts: GhostPreviewNode[] }) {
    if (!ghosts.length) return null;

    return (
        <div className="pointer-events-none absolute inset-0 z-[45]">
            <svg className="absolute inset-0 size-full overflow-visible">
                {ghosts.map((g) => {
                    if (g.fromX === undefined || g.fromY === undefined) return null;
                    const toX = g.x;
                    const toY = g.y + g.height / 2;
                    const mid = (toX - g.fromX) / 2;
                    return (
                        <path
                            key={`${g.key}-wire`}
                            d={`M${g.fromX} ${g.fromY}C${g.fromX + mid} ${g.fromY},${toX - mid} ${toY},${toX} ${toY}`}
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            opacity={0.75}
                        />
                    );
                })}
            </svg>
            {ghosts.map((g) => (
                <div
                    key={g.key}
                    className="absolute flex flex-col justify-between rounded-2xl border-2 border-dashed border-sky-400/80 bg-sky-500/10 p-3 text-xs text-sky-500 backdrop-blur-[1px]"
                    style={{
                        left: g.x,
                        top: g.y,
                        width: g.width,
                        height: g.height,
                    }}
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{g.label}</span>
                        <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px]">待应用</span>
                    </div>
                    <div className="text-[11px] opacity-75">
                        {g.kind === "setting-image" ? "待建参考图片节点" : g.kind === "first-frame" ? "待建首帧图节点" : "待建视频节点"}
                    </div>
                </div>
            ))}
        </div>
    );
}
