import { useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { Anchor, ArrowLeftRight, Bookmark, ChevronLeft, ChevronRight, Clapperboard, Columns2, Crosshair, Eye, EyeOff, History, Image as ImageIcon, Loader2, Mic, Plus, Rows3, Video, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CanvasDraftToggle } from "@/components/canvas/canvas-draft-toggle";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { CanvasVideoSettingsPopover } from "@/components/canvas/canvas-video-settings-popover";
import { CanvasNodeParamExtras } from "@/components/canvas/canvas-node-param-extras";
import { LightingEditor } from "@/components/canvas/canvas-cinematography-popover";
import { CAMERA_ANGLES, lightingSummary, multiAngleCameras, resolveNodeLighting } from "@/lib/canvas/canvas-cinematography";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { ANCHOR_KINDS, ANCHOR_KIND_LABEL, IMAGE_ROLES, IMAGE_ROLE_LABEL } from "@/lib/canvas/canvas-reference-roles";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, HemosiNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata, type CanvasShotRef } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

const stop = { onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation() };

async function filesToImages(files: FileList | null): Promise<CanvasNodeImage[]> {
    const list = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    return Promise.all(
        list.map(async (file) => {
            const uploaded = await uploadImage(file);
            return { id: nanoid(), status: "success" as const, content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
        }),
    );
}

function Field({ label, children, extra }: { label: string; children: ReactNode; extra?: ReactNode }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] opacity-60">
                <span>{label}</span>
                {extra}
            </div>
            {children}
        </div>
    );
}

function TextArea({ ctx, value, placeholder, rows, onChange }: { ctx: CanvasNodeContext; value: string; placeholder: string; rows: number; onChange: (value: string) => void }) {
    return (
        <textarea
            {...stop}
            data-canvas-no-zoom
            className="thin-scrollbar w-full resize-none rounded-lg border bg-transparent px-2 py-1.5 text-xs leading-5 outline-none"
            style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
        />
    );
}

function Thumb({ ctx, image, children, dim }: { ctx: CanvasNodeContext; image: CanvasNodeImage; children?: ReactNode; dim?: boolean }) {
    return (
        <div className="group/thumb relative size-14 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: ctx.theme.node.stroke, opacity: dim ? 0.4 : 1 }}>
            <img src={image.content} alt="" className="size-full object-cover" draggable={false} />
            {children}
        </div>
    );
}

function IconButton({ title, onClick, children, disabled }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
    return (
        <button type="button" {...stop} title={title} disabled={disabled} className="rounded p-0.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={onClick}>
            {children}
        </button>
    );
}

// ---------------------------------------------------------------- Anchor

const ANCHOR_HINT = {
    character: { images: "定妆照（可多张多角度）", text: "外形、年龄、发型、服装、标志性特征…" },
    scene: { images: "场景参考图", text: "地点、时代、陈设、光线、氛围…" },
    style: { images: "风格样图", text: "风格提示词：画风、色调、镜头质感…" },
} as const;

function AnchorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const meta = ctx.node.metadata || {};
    const kind = meta.anchorKind || "character";
    const images = meta.anchorImages || [];
    const textValue = meta.anchorText || "";
    const imageInput = useRef<HTMLInputElement>(null);
    const voiceInput = useRef<HTMLInputElement>(null);
    const refs = getShotHost()?.downstreamCount(ctx.node.id) || 0;
    const upstreamImages = ctx
        .getUpstream()
        .filter((n) => n.type === CanvasNodeType.Image && n.metadata?.content);

    const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
        try {
            const added = await filesToImages(event.target.files);
            const cur = ctx.getNode(ctx.node.id)?.metadata?.anchorImages || [];
            ctx.updateMetadata({ anchorImages: [...cur, ...added] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片读取失败");
        } finally {
            event.target.value = "";
        }
    };
    const addVoice = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const uploaded = await uploadMediaFile(file, "audio");
        ctx.updateMetadata({ anchorVoice: { content: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, name: file.name } });
    };
    return (
        <div className="flex size-full flex-col gap-2 overflow-auto p-3 text-xs" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center gap-2">
                <Anchor className="size-4 shrink-0" style={{ color: "var(--hemosi-accent)" }} />
                <div className="flex rounded-lg border p-0.5" style={{ borderColor: ctx.theme.node.stroke }}>
                    {ANCHOR_KINDS.map((item) => (
                        <button
                            key={item}
                            type="button"
                            {...stop}
                            className="rounded-md px-2 py-0.5"
                            style={item === kind ? { background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text } : { color: ctx.theme.node.muted }}
                            onClick={() => ctx.updateMetadata({ anchorKind: item })}
                        >
                            {ANCHOR_KIND_LABEL[item]}
                        </button>
                    ))}
                </div>
                <span className="ml-auto shrink-0 opacity-60">{refs ? `已连 ${refs} 处` : "连给分镜/生成节点即生效"}</span>
            </div>
            <Field label={ANCHOR_HINT[kind].images}>
                <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                    {upstreamImages.map((upNode) => (
                        <Thumb key={`up-${upNode.id}`} ctx={ctx} image={{ id: upNode.id, status: "success", content: upNode.metadata?.content || "", naturalWidth: upNode.metadata?.naturalWidth || 0, naturalHeight: upNode.metadata?.naturalHeight || 0, bytes: upNode.metadata?.bytes || 0, mimeType: upNode.metadata?.mimeType || "image/png" }}>
                            <span className="absolute left-0 top-0 rounded-br-md px-1 text-[9px]" style={{ background: "rgba(0,208,196,.85)", color: "#061010" }}>连入</span>
                        </Thumb>
                    ))}
                    {images.map((image, index) => (
                        <Thumb key={image.id} ctx={ctx} image={image}>
                            <span className="absolute left-0 top-0 rounded-br-md px-1 text-[9px]" style={{ background: "rgba(10,12,14,.72)", color: "#fff" }}>{index + 1}</span>
                            <button type="button" {...stop} className="absolute right-0.5 top-0.5 hidden rounded-full p-0.5 group-hover/thumb:block" style={{ background: "rgba(10,12,14,.72)", color: "#fff" }} title="移除" onClick={() => ctx.updateMetadata({ anchorImages: images.filter((item) => item.id !== image.id) })}>
                                <X className="size-3" />
                            </button>
                        </Thumb>
                    ))}
                    <button type="button" {...stop} className="grid size-14 shrink-0 place-items-center rounded-lg border border-dashed" style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.muted }} title="上传图片" onClick={() => imageInput.current?.click()}>
                        <Plus className="size-4" />
                    </button>
                </div>
            </Field>
            <Field label="简介说明 / 固定设定词（连线后自动注入下游提示词）">
                <TextArea ctx={ctx} rows={kind === "character" ? 4 : 5} value={textValue} placeholder={ANCHOR_HINT[kind].text} onChange={(anchorText) => ctx.updateMetadata({ anchorText })} />
            </Field>
            {kind === "character" ? (
                <Field label="声线（可选）" extra={meta.anchorVoice ? <IconButton title="移除声线" onClick={() => ctx.updateMetadata({ anchorVoice: undefined })}><X className="size-3" /></IconButton> : null}>
                    {meta.anchorVoice?.content ? (
                        <audio {...stop} src={meta.anchorVoice.content} controls className="h-8 w-full" />
                    ) : (
                        <button type="button" {...stop} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5" style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.muted }} onClick={() => voiceInput.current?.click()}>
                            <Mic className="size-3.5" /> 上传声线音频
                        </button>
                    )}
                </Field>
            ) : null}
            {kind === "scene" ? (
                <Field label="场景灯光（连到的分镜共用，跨镜头一致）">
                    <div {...stop}>
                        <LightingEditor value={meta.lighting} onChange={(lighting) => ctx.updateMetadata({ lighting })} />
                    </div>
                </Field>
            ) : null}
            <input ref={imageInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void addImages(event)} />
            <input ref={voiceInput} type="file" accept="audio/*" className="hidden" onChange={(event) => void addVoice(event)} />
        </div>
    );
}

// ---------------------------------------------------------------- Shot

function shotParamsNode(node: CanvasNodeData, kind: "image" | "video"): CanvasNodeData {
    const meta = node.metadata || {};
    return kind === "video" ? { ...node, metadata: { ...meta, model: meta.videoModel, size: meta.videoSize || meta.size } } : node;
}

export function shotGenerationConfig(config: AiConfig, node: CanvasNodeData, kind: "image" | "video") {
    return buildGenerationConfig(config, shotParamsNode(node, kind), kind);
}

function ResultSlot({ ctx, kind }: { ctx: CanvasNodeContext; kind: "image" | "video" }) {
    const meta = ctx.node.metadata || {};
    const status = meta.shotStatus?.[kind];
    const error = kind === "image" ? meta.shotStatus?.imageError : meta.shotStatus?.videoError;
    const media = kind === "image" ? meta.shotImage : meta.shotVideo;
    return (
        <div className="relative flex h-36 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.canvas.background }} title={error}>
            {media?.content ? kind === "image" ? <img src={media.content} alt="" className="max-h-full max-w-full object-contain" draggable={false} /> : <video {...stop} data-canvas-video src={media.content} controls className="max-h-full max-w-full object-contain" /> : (
                <span className="flex flex-col items-center gap-1 opacity-50">
                    {kind === "image" ? <ImageIcon className="size-4" /> : <Video className="size-4" />}
                    {kind === "image" ? "图片结果" : "视频结果"}
                </span>
            )}
            {status === "loading" ? (
                <span className="absolute inset-0 grid place-items-center" style={{ background: "rgba(10,12,14,.5)", color: "#fff" }}>
                    <Loader2 className="size-5 animate-spin" />
                </span>
            ) : null}
            {status === "error" ? <span className="absolute inset-x-0 bottom-0 line-clamp-2 px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(127,29,29,.85)", color: "#fff" }}>失败：{error}</span> : null}
        </div>
    );
}

function ShotContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const meta = ctx.node.metadata || {};
    const refs = meta.shotRefs || [];
    const fileInput = useRef<HTMLInputElement>(null);
    const imageConfig = shotGenerationConfig(config, ctx.node, "image");
    const videoConfig = shotGenerationConfig(config, ctx.node, "video");
    const host = getShotHost();
    const busy = meta.shotStatus?.image === "loading" || meta.shotStatus?.video === "loading";
    const setRefs = (shotRefs: CanvasShotRef[]) => ctx.updateMetadata({ shotRefs });
    const moveRef = (index: number, delta: -1 | 1) => {
        const next = [...refs];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setRefs(next);
    };
    const addRefs = async (event: ChangeEvent<HTMLInputElement>) => {
        try {
            const added = (await filesToImages(event.target.files)).map((image) => ({ ...image, enabled: true }));
            ctx.updateMetadata({ shotRefs: [...(ctx.getNode(ctx.node.id)?.metadata?.shotRefs || []), ...added] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片读取失败");
        } finally {
            event.target.value = "";
        }
    };
    const upstreamRefs = ctx.getUpstream().filter((node) => node.type !== HemosiNodeType.Shot || node.metadata?.shotImage).length;
    const versions = meta.versions?.length || 0;
    const patch = (value: CanvasNodeMetadata) => ctx.updateMetadata(value);

    return (
        <div className="flex size-full flex-col gap-2 overflow-auto p-3 text-xs" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-center gap-1.5">
                <Clapperboard className="size-4 shrink-0" style={{ color: "var(--hemosi-accent)" }} />
                <span className="opacity-60">镜头</span>
                <input {...stop} className="w-10 rounded border bg-transparent px-1 text-center text-sm font-semibold outline-none" style={{ borderColor: ctx.theme.node.stroke }} inputMode="numeric" value={meta.shotNo ?? ""} onChange={(event) => patch({ shotNo: Number(event.target.value.replace(/\D/g, "")) || undefined })} />
                {upstreamRefs ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] opacity-75">已连入 {upstreamRefs} 处设定/参考</span> : null}
                <div className="ml-auto flex items-center gap-0.5">
                    <IconButton title="选中整排（同组或同一行的分镜）" onClick={() => host?.selectRow(ctx.node.id)}>
                        <Rows3 className="size-3.5" />
                    </IconButton>
                    <IconButton title={versions ? `历史版本 ${versions} 个：对比 / 还原` : "还没有历史版本"} disabled={!versions} onClick={() => host?.openVersions(ctx.node.id)}>
                        <span className="flex items-center gap-0.5"><History className="size-3.5" />{versions || ""}</span>
                    </IconButton>
                </div>
            </div>
            <Field label="图片提示词（生成首帧画面）">
                <TextArea ctx={ctx} rows={3} value={meta.shotDescription || ""} placeholder="描述这一镜的静态首帧画面（点击下方「生成图片」生出左下方首帧图）…" onChange={(shotDescription) => patch({ shotDescription })} />
            </Field>
            <Field label="视频提示词（把左下方图片结果作为首帧生成视频）">
                <TextArea ctx={ctx} rows={3} value={meta.prompt || ""} placeholder="描述这一镜的人物动作与镜头运镜（留空则共用上方图片提示词）…" onChange={(prompt) => patch({ prompt })} />
            </Field>
            <div className="space-y-1.5" {...stop}>
                <div className="flex items-center gap-1">
                    <span className="w-8 shrink-0 opacity-60">图片</span>
                    <ModelPicker config={imageConfig} value={imageConfig.model} capability="image" onChange={(model) => patch({ model })} onMissingConfig={() => openConfigDialog(true)} className="min-w-0 flex-1" />
                    <CanvasImageSettingsPopover config={imageConfig} buttonClassName="!h-8 shrink-0 !justify-start !rounded-full !px-2 inline-flex items-center gap-1" onConfigChange={(key, value) => patch(key === "count" ? {} : { [key]: value })} />
                </div>
                <div className="flex items-center gap-1">
                    <span className="w-8 shrink-0 opacity-60">视频</span>
                    <ModelPicker config={videoConfig} value={videoConfig.model} capability="video" onChange={(videoModel) => patch({ videoModel })} onMissingConfig={() => openConfigDialog(true)} className="min-w-0 flex-1" />
                    <CanvasVideoSettingsPopover
                        config={videoConfig}
                        buttonClassName="!h-8 shrink-0 !justify-start !rounded-full !px-2 inline-flex items-center gap-1"
                        onConfigChange={(key, value) => patch(key === "size" ? { videoSize: value } : key === "videoSeconds" ? { seconds: value } : key === "videoGenerateAudio" ? { generateAudio: value } : key === "videoWatermark" ? { watermark: value } : { [key]: value })}
                    />
                </div>
                <div className="flex items-center gap-1">
                    <CanvasDraftToggle className="h-8" checked={Boolean(meta.draft)} onChange={(draft) => patch({ draft })} />
                    <CanvasNodeParamExtras
                        node={ctx.node}
                        mode="shot"
                        onChange={(_, value) => patch(value)}
                        inheritedLighting={lightingSummary(resolveNodeLighting(ctx.node.id, ctx.getNodes(), ctx.getConnections()).lighting)}
                        onSplitAngles={(angles) =>
                            ctx.applyOps(
                                multiAngleCameras(meta.camera, angles).map((camera, index) => ({
                                    type: "add_node" as const,
                                    nodeType: ctx.node.type,
                                    title: `${ctx.node.title} · ${CAMERA_ANGLES.find((item) => item.value === camera.angle)?.label || camera.angle}`,
                                    position: { x: ctx.node.position.x + (index + 1) * (ctx.node.width + 40), y: ctx.node.position.y + ctx.node.height + 60 },
                                    width: ctx.node.width,
                                    height: ctx.node.height,
                                    metadata: { shotNo: meta.shotNo, shotDescription: meta.shotDescription, prompt: meta.prompt, shotRefs: meta.shotRefs, model: meta.model, videoModel: meta.videoModel, size: meta.size, videoSize: meta.videoSize, seconds: meta.seconds, lighting: meta.lighting, camera },
                                })),
                            )
                        }
                    />
                </div>
            </div>
            <div className="flex gap-1.5">
                <ResultSlot ctx={ctx} kind="image" />
                <ResultSlot ctx={ctx} kind="video" />
            </div>
            <div className="flex gap-1.5">
                <button type="button" {...stop} disabled={busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 font-medium disabled:opacity-40" style={{ background: "var(--hemosi-accent)", color: "#0a0c0e" }} onClick={() => void host?.generate(ctx.node.id, "image")}>
                    <ImageIcon className="size-3.5" /> {meta.shotImage ? "重新生成图" : "生成图片"}
                </button>
                <button type="button" {...stop} disabled={busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 font-medium disabled:opacity-40" style={{ borderColor: "var(--hemosi-accent)", color: ctx.theme.node.text }} title={meta.shotImage ? "图片结果作为首帧" : "没有图片结果时按参考图/提示词直接生成"} onClick={() => void host?.generate(ctx.node.id, "video")}>
                    <Video className="size-3.5" /> {meta.shotVideo ? "重新生成视频" : "生成视频"}
                </button>
            </div>
            <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void addRefs(event)} />
        </div>
    );
}

// ---------------------------------------------------------------- Bookmark (极简书签 🔖)

function BookmarkContent({ ctx }: { ctx: CanvasNodeContext }) {
    const meta = ctx.node.metadata || {};
    const bookmarks = ctx.getNodes().filter((n) => n.type === HemosiNodeType.Bookmark);
    const index = Math.max(0, bookmarks.findIndex((n) => n.id === ctx.node.id));
    const shortcutKey = meta.bookmarkKey ?? String((index % 9) + 1);

    return (
        <div className="flex size-full items-center justify-between gap-2 px-3.5 text-xs select-none cursor-grab active:cursor-grabbing" style={{ color: ctx.theme.node.text }}>
            <span className="flex items-center gap-1.5 font-medium opacity-75">
                <Bookmark className="size-3.5 shrink-0" style={{ color: "var(--hemosi-accent, #00d0c4)" }} />
                <span>快捷键</span>
            </span>
            <input
                {...stop}
                type="text"
                data-canvas-no-zoom
                value={shortcutKey}
                placeholder="1"
                maxLength={2}
                className="h-7 w-12 rounded-lg border bg-transparent text-center font-mono text-xs font-bold uppercase outline-none focus:border-[#00d0c4]"
                style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill, color: "var(--hemosi-accent, #00d0c4)" }}
                onChange={(e) => {
                    const val = e.target.value.trim().slice(-1);
                    ctx.updateMetadata({ bookmarkKey: val });
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
            />
        </div>
    );
}

// ---------------------------------------------------------------- Image Comparer (rgthree-comfy style)

function extractNodeImage(node: CanvasNodeData | undefined): { url: string; width?: number; height?: number; title?: string } | null {
    if (!node) return null;
    if (node.type === HemosiNodeType.Shot && node.metadata?.shotImage?.content) {
        return { url: node.metadata.shotImage.content, width: node.metadata.shotImage.naturalWidth, height: node.metadata.shotImage.naturalHeight, title: node.title };
    }
    if (node.type === HemosiNodeType.Anchor && node.metadata?.anchorImages?.[0]?.content) {
        const img = node.metadata.anchorImages[0];
        return { url: img.content, width: img.naturalWidth, height: img.naturalHeight, title: node.title };
    }
    const primaryId = node.metadata?.primaryImageId;
    const primary = node.metadata?.images?.find((i) => i.id === primaryId) || node.metadata?.images?.[0];
    const url = primary?.content || node.metadata?.content;
    if (!url || node.type === "video" || node.type === "audio" || node.type === "text") return null;
    return { url, width: primary?.naturalWidth || node.metadata?.naturalWidth, height: primary?.naturalHeight || node.metadata?.naturalHeight, title: node.title };
}

function ImageCompareContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const meta = ctx.node.metadata || {};
    const [sliderPct, setSliderPct] = useState(50);
    const [dragging, setDragging] = useState(false);
    const viewRef = useRef<HTMLDivElement>(null);
    const inputARef = useRef<HTMLInputElement>(null);
    const inputBRef = useRef<HTMLInputElement>(null);

    const upstreamImages = ctx.getUpstream().map(extractNodeImage).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const rawA = upstreamImages[0] || (meta.compareImageA?.content ? { url: meta.compareImageA.content, width: meta.compareImageA.naturalWidth, height: meta.compareImageA.naturalHeight, title: "本地图 A" } : null);
    const rawB = upstreamImages[1] || (meta.compareImageB?.content ? { url: meta.compareImageB.content, width: meta.compareImageB.naturalWidth, height: meta.compareImageB.naturalHeight, title: "本地图 B" } : null);
    const swapped = Boolean(meta.compareSwap);
    const imgA = swapped ? rawB : rawA;
    const imgB = swapped ? rawA : rawB;
    const mode = meta.compareMode || "hover";

    const updateSliderFromEvent = (clientX: number) => {
        const rect = viewRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setSliderPct(Math.max(0, Math.min(100, pct)));
    };

    const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (mode === "hover" || dragging) {
            updateSliderFromEvent(event.clientX);
        }
    };

    const uploadSide = async (side: "A" | "B", event: ChangeEvent<HTMLInputElement>) => {
        try {
            const list = await filesToImages(event.target.files);
            if (list[0]) {
                ctx.updateMetadata(side === "A" ? { compareImageA: list[0] } : { compareImageB: list[0] });
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "读取图片失败");
        } finally {
            event.target.value = "";
        }
    };

    return (
        <div className="flex size-full flex-col gap-2 p-2.5 text-xs select-none" style={{ color: ctx.theme.node.text }}>
            {/* 顶部控制条 */}
            <div className="flex items-center gap-1.5 px-0.5" {...stop}>
                <Columns2 className="size-4 shrink-0" style={{ color: "var(--hemosi-accent, #00d0c4)" }} />
                <span className="font-semibold">双图对比</span>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-[11px] transition hover:opacity-85"
                    style={{ borderColor: ctx.theme.node.stroke }}
                    onClick={() => inputARef.current?.click()}
                    title="上传或替换图 A（也可直接把左侧图片节点连线进来）"
                >
                    + 图A
                </button>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-[11px] transition hover:opacity-85"
                    style={{ borderColor: ctx.theme.node.stroke }}
                    onClick={() => inputBRef.current?.click()}
                    title="上传或替换图 B（也可直接把第 2 个图片节点连线进来）"
                >
                    + 图B
                </button>
                <button
                    type="button"
                    className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition hover:opacity-85"
                    style={{ borderColor: ctx.theme.node.stroke }}
                    onClick={() => ctx.updateMetadata({ compareSwap: !swapped })}
                    title="互换 A / B 左右图层"
                >
                    <ArrowLeftRight className="size-3" />
                    互换
                </button>
                <button
                    type="button"
                    className="ml-auto rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: ctx.theme.node.fill, color: "var(--hemosi-accent, #00d0c4)" }}
                    onClick={() => ctx.updateMetadata({ compareMode: mode === "hover" ? "drag" : "hover" })}
                    title="切换鼠标悬停拉帘 / 按住拖动拉帘"
                >
                    {mode === "hover" ? "悬停拉帘" : "按住拉帘"}
                </button>
            </div>

            {/* 核心拉帘对比视窗 */}
            <div
                ref={viewRef}
                {...(mode === "drag" ? stop : {})}
                className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-black/60 cursor-ew-resize"
                style={{ borderColor: ctx.theme.node.stroke }}
                onMouseMove={handleMouseMove}
                onMouseDown={(event) => {
                    if (mode === "drag") {
                        event.stopPropagation();
                        setDragging(true);
                        updateSliderFromEvent(event.clientX);
                    }
                }}
                onMouseUp={() => setDragging(false)}
                onMouseLeave={() => setDragging(false)}
            >
                {!imgA && !imgB ? (
                    <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center opacity-55">
                        <Columns2 className="size-7 opacity-45" />
                        <div>连入 2 个图片节点，或点击上方「+ 图A」「+ 图B」上传</div>
                    </div>
                ) : (
                    <>
                        {/* 底层：图 B（右侧可见） */}
                        {imgB ? (
                            <img src={imgB.url} alt="B" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" />
                        ) : null}
                        {/* 顶层：图 A（左侧裁剪 0 ~ sliderPct%） */}
                        {imgA ? (
                            <img
                                src={imgA.url}
                                alt="A"
                                draggable={false}
                                className="pointer-events-none absolute inset-0 size-full object-contain"
                                style={{ clipPath: imgB ? `inset(0 ${100 - sliderPct}% 0 0)` : undefined }}
                            />
                        ) : null}

                        {/* 分割线与拉手 */}
                        {imgA && imgB ? (
                            <div
                                className="pointer-events-none absolute inset-y-0 z-20 w-0.5"
                                style={{ left: `${sliderPct}%`, background: "var(--hemosi-accent, #00d0c4)", boxShadow: "0 0 10px rgba(0,208,196,0.8)" }}
                            >
                                <div
                                    className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[11px] font-bold shadow-lg"
                                    style={{ background: "#081212", borderColor: "var(--hemosi-accent, #00d0c4)", color: "var(--hemosi-accent, #00d0c4)" }}
                                >
                                    ⟷
                                </div>
                            </div>
                        ) : null}

                        {/* 左上角 A 角标 & 右上角 B 角标 */}
                        {imgA ? (
                            <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-[#2ef5e8] backdrop-blur-sm">
                                A {imgA.width && imgA.height ? `· ${imgA.width}×${imgA.height}` : ""}
                            </span>
                        ) : null}
                        {imgB ? (
                            <span className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                                B {imgB.width && imgB.height ? `· ${imgB.width}×${imgB.height}` : ""}
                            </span>
                        ) : null}
                    </>
                )}
            </div>
            <input ref={inputARef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadSide("A", e)} />
            <input ref={inputBRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadSide("B", e)} />
        </div>
    );
}

const HEMOSI_DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: HemosiNodeType.Shot,
        title: "分镜",
        icon: <Clapperboard className="size-4" />,
        defaultSize: { width: 380, height: 720 },
        defaultMetadata: { status: "idle", shotRefs: [] },
        minimapColor: "#22d3ee",
        hidePanel: true,
        resource: (node) => (node.metadata?.shotVideo?.content ? { kind: "video", url: node.metadata.shotVideo.content } : node.metadata?.shotImage?.content ? { kind: "image", url: node.metadata.shotImage.content } : null),
        Content: ShotContent,
    },
    {
        type: HemosiNodeType.Anchor,
        title: "锚点",
        icon: <Anchor className="size-4" />,
        defaultSize: { width: 340, height: 400 },
        defaultMetadata: { status: "idle", anchorKind: "character", anchorImages: [] },
        minimapColor: "#f59e0b",
        hidePanel: true,
        resource: (node) => {
            const meta = node.metadata;
            const slots = meta?.anchorSlots;
            const hasSlot = slots && (["character", "scene", "style"] as const).some((k) => Boolean(slots[k]?.text?.trim() || slots[k]?.images?.length));
            return hasSlot || meta?.anchorText?.trim() || meta?.anchorImages?.length || meta?.anchorVoice?.content
                ? { kind: "text", text: meta?.anchorText || node.title }
                : { kind: "text", text: node.title || "锚点" };
        },
        Content: AnchorContent,
    },
    {
        type: HemosiNodeType.ImageCompare,
        title: "图片对比",
        icon: <Columns2 className="size-4" />,
        defaultSize: { width: 460, height: 420 },
        defaultMetadata: { status: "idle", compareMode: "hover" },
        minimapColor: "#38bdf8",
        hidePanel: true,
        resource: (node) => {
            const img = node.metadata?.compareSwap ? node.metadata?.compareImageB : node.metadata?.compareImageA;
            return img?.content ? { kind: "image", url: img.content } : null;
        },
        Content: ImageCompareContent,
    },
    {
        type: HemosiNodeType.Bookmark,
        title: "书签",
        icon: <Bookmark className="size-4" />,
        defaultSize: { width: 156, height: 48 },
        defaultMetadata: { status: "idle", bookmarkZoom: 1 },
        minimapColor: "#00d0c4",
        hidePanel: true,
        hasSourceHandle: false,
        Content: BookmarkContent,
    },
];

let registered = false;
export function registerHemosiNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(HEMOSI_DEFINITIONS, "builtin");
}
