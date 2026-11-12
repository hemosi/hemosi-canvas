import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Camera, Loader2, Maximize2 } from "lucide-react";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { emptyDirectorScene, type DirectorScene } from "@/lib/canvas/director-scene";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

/** 3D 场景节点类型（集成 jiguang132/storyai-3d-director-desk） */
export const DIRECTOR_NODE_TYPE = "scene3d";

const DirectorStage = lazy(() => import("@/components/canvas/director/director-stage"));

const stop = { onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation() };

export function readDirectorScene(node: CanvasNodeData): DirectorScene {
    return node.metadata?.directorScene || emptyDirectorScene();
}

export function useResolvedImage(media?: { content: string; storageKey?: string }) {
    const [url, setUrl] = useState(media?.content || "");
    useEffect(() => {
        let alive = true;
        if (!media?.storageKey) setUrl(media?.content || "");
        else void resolveImageUrl(media.storageKey, media.content).then((resolved) => alive && setUrl(resolved));
        return () => {
            alive = false;
        };
    }, [media?.content, media?.storageKey]);
    return url;
}

function DirectorNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const scene = readDirectorScene(ctx.node);
    const preview = useResolvedImage(scene.preview || scene.panorama);
    const [open, setOpen] = useState(false);

    return (
        <div className="flex size-full flex-col gap-2.5 overflow-hidden p-3 text-xs" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: "rgba(0, 208, 196, 0.16)", color: "var(--hemosi-accent, #00d0c4)" }}>
                    <Box className="size-3.5" />
                </span>
                <span className="truncate font-semibold">{ctx.node.title || "3D 导演工作台"}</span>
                <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: ctx.theme.node.fill, color: "var(--hemosi-accent, #00d0c4)" }}>
                    人偶骨骼 · 多机位构图
                </span>
            </div>

            <button
                type="button"
                {...stop}
                className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-xl border transition hover:border-[#00d0c4]"
                style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.canvas.background }}
                onClick={() => setOpen(true)}
                title="点击进入 3D 导演工作台"
            >
                {preview ? (
                    <img src={preview} alt="" className="size-full object-cover transition duration-300 group-hover/stage:scale-[1.02]" draggable={false} />
                ) : (
                    <div className="flex flex-col items-center gap-2 p-4 text-center opacity-70">
                        <div className="grid size-11 place-items-center rounded-2xl border" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill, color: "var(--hemosi-accent, #00d0c4)" }}>
                            <Camera className="size-5" />
                        </div>
                        <div className="font-medium text-white/90">点击打开 3D 导演工作台</div>
                        <div className="text-[11px] opacity-65">内置关节人偶、群演阵列、3D 道具、全景背景球与多机位焦段取景</div>
                    </div>
                )}
            </button>

            <button
                type="button"
                {...stop}
                className="flex items-center justify-center gap-1.5 rounded-xl py-2 font-semibold transition hover:opacity-90"
                style={{ background: "var(--hemosi-accent, #00d0c4)", color: "#061414" }}
                onClick={() => setOpen(true)}
            >
                <Maximize2 className="size-3.5" />
                <span>进入 3D 导演工作台</span>
            </button>

            {open
                ? createPortal(
                      <Suspense
                          fallback={
                              <div className="fixed inset-0 z-[1100] grid place-items-center bg-black/90 text-white">
                                  <Loader2 className="size-6 animate-spin text-[#00d0c4]" />
                              </div>
                          }
                      >
                          <DirectorStage ctx={ctx} onClose={() => setOpen(false)} />
                      </Suspense>,
                      document.body,
                  )
                : null}
        </div>
    );
}

const DIRECTOR_DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: DIRECTOR_NODE_TYPE,
        title: "3D 导演台",
        icon: <Box className="size-4" />,
        defaultSize: { width: 360, height: 320 },
        defaultMetadata: { status: "idle" },
        minimapColor: "#00d0c4",
        hidePanel: true,
        resource: (node) =>
            node.metadata?.directorScene?.preview?.content
                ? { kind: "image", url: node.metadata.directorScene.preview.content }
                : null,
        Content: DirectorNodeContent,
    },
];

let registered = false;
export function registerDirectorNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(DIRECTOR_DEFINITIONS, "builtin");
}
