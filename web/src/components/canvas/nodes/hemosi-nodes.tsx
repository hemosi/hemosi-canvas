import { useRef, type ChangeEvent, type ReactNode } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { Anchor, ChevronLeft, ChevronRight, Clapperboard, Eye, EyeOff, History, Image as ImageIcon, Loader2, Mic, Plus, Rows3, Video, X } from "lucide-react";

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
import { HemosiNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata, type CanvasShotRef } from "@/types/canvas";
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
    const imageInput = useRef<HTMLInputElement>(null);
    const voiceInput = useRef<HTMLInputElement>(null);
    const refs = getShotHost()?.downstreamCount(ctx.node.id) || 0;
    const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
        try {
            const added = await filesToImages(event.target.files);
            ctx.updateMetadata({ anchorImages: [...(ctx.getNode(ctx.node.id)?.metadata?.anchorImages || []), ...added] });
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
                        <button key={item} type="button" {...stop} className="rounded-md px-2 py-0.5" style={item === kind ? { background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text } : { color: ctx.theme.node.muted }} onClick={() => ctx.updateMetadata({ anchorKind: item })}>
                            {ANCHOR_KIND_LABEL[item]}
                        </button>
                    ))}
                </div>
                <span className="ml-auto shrink-0 opacity-60">{refs ? `已连 ${refs} 处` : "连给分镜/生成节点即生效"}</span>
            </div>
            <Field label={ANCHOR_HINT[kind].images}>
                <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-1">
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
            <Field label={kind === "style" ? "风格提示词" : "文字设定"}>
                <TextArea ctx={ctx} rows={kind === "character" ? 4 : 5} value={meta.anchorText || ""} placeholder={ANCHOR_HINT[kind].text} onChange={(anchorText) => ctx.updateMetadata({ anchorText })} />
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
        <div className="relative grid aspect-video min-w-0 flex-1 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.canvas.background }} title={error}>
            {media?.content ? kind === "image" ? <img src={media.content} alt="" className="size-full object-contain" draggable={false} /> : <video {...stop} src={media.content} controls className="size-full object-contain" /> : (
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
                <div className="ml-auto flex items-center gap-0.5">
                    <IconButton title="选中整排（同组或同一行的分镜）" onClick={() => host?.selectRow(ctx.node.id)}>
                        <Rows3 className="size-3.5" />
                    </IconButton>
                    <IconButton title={versions ? `历史版本 ${versions} 个：对比 / 还原` : "还没有历史版本"} disabled={!versions} onClick={() => host?.openVersions(ctx.node.id)}>
                        <span className="flex items-center gap-0.5"><History className="size-3.5" />{versions || ""}</span>
                    </IconButton>
                </div>
            </div>
            <Field label="画面描述">
                <TextArea ctx={ctx} rows={3} value={meta.shotDescription || ""} placeholder="这个镜头里发生什么…" onChange={(shotDescription) => patch({ shotDescription })} />
            </Field>
            <Field label="提示词（留空则用画面描述）">
                <TextArea ctx={ctx} rows={3} value={meta.prompt || ""} placeholder="给模型的完整提示词，锚点设定会自动拼进去" onChange={(prompt) => patch({ prompt })} />
            </Field>
            <Field label={`参考图 ${refs.filter((ref) => ref.enabled).length}/${refs.length}${upstreamRefs ? ` · 连入 ${upstreamRefs} 个` : ""}`}>
                <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                    {refs.map((ref, index) => (
                        <div key={ref.id} className="flex shrink-0 flex-col items-center gap-0.5">
                            <Thumb ctx={ctx} image={ref} dim={!ref.enabled}>
                                <span className="absolute left-0 top-0 rounded-br-md px-1 text-[9px]" style={{ background: "rgba(10,12,14,.72)", color: "#fff" }}>{index + 1}</span>
                                <button type="button" {...stop} className="absolute right-0.5 top-0.5 hidden rounded-full p-0.5 group-hover/thumb:block" style={{ background: "rgba(10,12,14,.72)", color: "#fff" }} title="移除" onClick={() => setRefs(refs.filter((item) => item.id !== ref.id))}>
                                    <X className="size-3" />
                                </button>
                            </Thumb>
                            <div className="flex items-center">
                                <IconButton title="前移" disabled={index === 0} onClick={() => moveRef(index, -1)}><ChevronLeft className="size-3" /></IconButton>
                                <IconButton title={ref.enabled ? "本次不用这张" : "启用"} onClick={() => setRefs(refs.map((item) => (item.id === ref.id ? { ...item, enabled: !item.enabled } : item)))}>{ref.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</IconButton>
                                <IconButton title="后移" disabled={index === refs.length - 1} onClick={() => moveRef(index, 1)}><ChevronRight className="size-3" /></IconButton>
                            </div>
                            <select {...stop} className="max-w-[56px] bg-transparent text-[10px] outline-none" value={ref.role || "reference"} onChange={(event) => setRefs(refs.map((item) => (item.id === ref.id ? { ...item, role: event.target.value as CanvasShotRef["role"] } : item)))}>
                                {IMAGE_ROLES.map((role) => <option key={role} value={role} style={{ background: ctx.theme.toolbar.panel }}>{IMAGE_ROLE_LABEL[role]}</option>)}
                            </select>
                        </div>
                    ))}
                    <button type="button" {...stop} className="grid size-14 shrink-0 place-items-center rounded-lg border border-dashed" style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.muted }} title="放入参考图（也可以把图片/锚点节点连进来）" onClick={() => fileInput.current?.click()}>
                        <Plus className="size-4" />
                    </button>
                </div>
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

const HEMOSI_DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: HemosiNodeType.Shot,
        title: "分镜",
        icon: <Clapperboard className="size-4" />,
        description: "镜头号 + 画面描述 + 提示词 + 参考图 + 图/视频结果",
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
        description: "角色 / 场景 / 风格：连给分镜或生成节点，改一处下游跟随",
        defaultSize: { width: 340, height: 400 },
        defaultMetadata: { status: "idle", anchorKind: "character", anchorImages: [] },
        minimapColor: "#f59e0b",
        hidePanel: true,
        resource: (node) => (node.metadata?.anchorText?.trim() || node.metadata?.anchorImages?.length ? { kind: "text", text: node.metadata?.anchorText || node.title } : null),
        Content: AnchorContent,
    },
];

let registered = false;
export function registerHemosiNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(HEMOSI_DEFINITIONS, "builtin");
}
