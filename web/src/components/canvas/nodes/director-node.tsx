import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { App } from "antd";
import { Box, Loader2, Sparkles, Video } from "lucide-react";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { activeShot, buildDirectorUserPrompt, DIRECTOR_SYSTEM_PROMPT, emptyDirectorScene, parseDirectorScene, type DirectorScene } from "@/lib/canvas/director-scene";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

/** 3D 场景节点类型；场景 JSON 存在 metadata.directorScene，随画布保存与项目包导出。 */
export const DIRECTOR_NODE_TYPE = "scene3d";

const DirectorStage = lazy(() => import("@/components/canvas/director/director-stage"));

const stop = { onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation() };

export function readDirectorScene(node: CanvasNodeData): DirectorScene {
    return node.metadata?.directorScene || emptyDirectorScene();
}

/** 用设置里配置的文本模型（项目已有的 LLM 调用链路）把一句话变成场景 JSON；有场景时在其上修改。 */
export async function runDirectorAgent(ctx: CanvasNodeContext, current: DirectorScene, instruction: string, edit: boolean, onDelta?: (text: string) => void) {
    const { text } = await ctx.ai.generateText(buildDirectorUserPrompt(instruction, edit ? current : undefined), { system: DIRECTOR_SYSTEM_PROMPT, onDelta });
    return parseDirectorScene(text, { panorama: current.panorama, preview: current.preview, groundColor: current.groundColor, showGround: current.showGround, aspect: current.aspect });
}

/** storageKey 优先解析成当前会话的 blob 地址（导入项目包 / 重开后旧 blob 地址失效）。 */
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
    const { message } = App.useApp();
    const scene = readDirectorScene(ctx.node);
    const shot = activeShot(scene);
    const preview = useResolvedImage(scene.preview || scene.panorama);
    const [open, setOpen] = useState(false);
    const [instruction, setInstruction] = useState("");
    const [busy, setBusy] = useState(false);
    const build = async () => {
        if (!instruction.trim() || busy) return;
        setBusy(true);
        try {
            const next = await runDirectorAgent(ctx, scene, instruction, Boolean(ctx.node.metadata?.directorScene));
            ctx.updateMetadata({ directorScene: next, prompt: next.description });
            ctx.updateNode({ title: next.title });
            setInstruction("");
            message.success(`场景已搭好：${next.subjects.length} 个主体、${next.shots.length} 个机位`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "场景生成失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex size-full flex-col gap-2 overflow-hidden p-3 text-xs" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center gap-1.5">
                <Box className="size-4 shrink-0" style={{ color: "var(--hemosi-accent)" }} />
                <span className="truncate font-medium">{scene.title}</span>
                <span className="ml-auto shrink-0 opacity-60">
                    {scene.subjects.length} 主体 · {scene.shots.length} 机位 · {shot.duration}s
                </span>
            </div>
            <button type="button" {...stop} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.canvas.background }} onClick={() => setOpen(true)} title="打开导演台">
                {preview ? <img src={preview} alt="" className="size-full object-cover" draggable={false} /> : <span className="flex flex-col items-center gap-1 opacity-50"><Video className="size-5" />打开导演台</span>}
                {scene.description ? <span className="absolute inset-x-0 bottom-0 line-clamp-2 px-2 py-1 text-left text-[11px]" style={{ background: "rgba(10,12,14,.65)", color: "#fff" }}>{scene.description}</span> : null}
            </button>
            <div className="flex gap-1.5">
                <input
                    {...stop}
                    data-canvas-no-zoom
                    className="min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1.5 outline-none"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
                    placeholder={ctx.node.metadata?.directorScene ? "一句话修改：镜头改成环绕…" : "一句话搭场景：雨夜巷口两人对峙，镜头缓慢推近…"}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") void build();
                    }}
                />
                <button type="button" {...stop} disabled={busy || !instruction.trim()} className="flex shrink-0 items-center gap-1 rounded-lg px-2 font-medium disabled:opacity-40" style={{ background: "var(--hemosi-accent)", color: "#0a0c0e" }} onClick={() => void build()} title="用设置里的文本模型搭建 / 修改场景">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} AI
                </button>
            </div>
            <button type="button" {...stop} className="rounded-lg border py-1.5 font-medium hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: "var(--hemosi-accent)" }} onClick={() => setOpen(true)}>
                打开导演台
            </button>
            {open
                ? createPortal(
                      <Suspense fallback={<div className="fixed inset-0 z-[1000] grid place-items-center" style={{ background: ctx.theme.canvas.background, color: ctx.theme.node.text }}><Loader2 className="size-6 animate-spin" /></div>}>
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
        title: "3D 场景",
        icon: <Box className="size-4" />,
        description: "导演台：一句话搭 3D 场景，摆主体与机位、调运镜，截图 / 录制回画布",
        defaultSize: { width: 380, height: 360 },
        defaultMetadata: { status: "idle" },
        minimapColor: "#84cc16",
        hidePanel: true,
        resource: (node) => (node.metadata?.directorScene?.preview?.content ? { kind: "image", url: node.metadata.directorScene.preview.content } : node.metadata?.directorScene?.description ? { kind: "text", text: node.metadata.directorScene.description } : null),
        Content: DirectorNodeContent,
    },
];

let registered = false;
export function registerDirectorNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(DIRECTOR_DEFINITIONS, "builtin");
}
