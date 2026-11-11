import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import { ArrowLeft, Clapperboard, Download, GitFork, Music2, Plus, Trash2, Upload } from "lucide-react";
import dayjs from "dayjs";

import { registerHemosiNodes } from "@/components/canvas/nodes/hemosi-nodes";
import { registerDirectorNodes } from "@/components/canvas/nodes/director-node";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { buildShotRow, splitScript } from "@/lib/canvas/canvas-shot-actions";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore, type WorkspaceMaterial } from "@/stores/canvas/use-workspace-store";
import { CanvasNodeType, HemosiNodeType } from "@/types/canvas";

registerHemosiNodes();
registerDirectorNodes();

type MaterialView = { key: string; kind: WorkspaceMaterial["kind"]; name: string; storageKey: string; source: string; materialId?: string; canvasId?: string };

function MaterialThumb({ item }: { item: MaterialView }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let alive = true;
        void (item.storageKey.startsWith("image:") ? resolveImageUrl(item.storageKey, "") : resolveMediaUrl(item.storageKey, "")).then((value) => alive && setUrl(value));
        return () => {
            alive = false;
        };
    }, [item.storageKey]);
    if (!url) return <div className="aspect-video w-full rounded-lg bg-black/10 dark:bg-white/10" />;
    if (item.kind === "image") return <img src={url} alt={item.name} className="aspect-video w-full rounded-lg object-cover" />;
    if (item.kind === "video") return <video src={url} className="aspect-video w-full rounded-lg bg-black object-contain" controls preload="metadata" />;
    return (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-black/10 p-2 dark:bg-white/10">
            <Music2 className="size-5 opacity-60" />
            <audio src={url} controls className="w-full" />
        </div>
    );
}

/** 项目页: all canvases of the project, its script, and every material (archived files plus media used on its canvases). */
export default function ProjectDetailPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const { id = "" } = useParams<{ id: string }>();
    const fileRef = useRef<HTMLInputElement>(null);
    const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === id));
    const hydrated = useWorkspaceStore((state) => state.hydrated);
    const allCanvases = useCanvasStore((state) => state.projects);
    const canvases = useMemo(() => allCanvases.filter((canvas) => canvas.workspaceId === id), [allCanvases, id]);
    const [filter, setFilter] = useState<"all" | WorkspaceMaterial["kind"]>("all");
    const [script, setScript] = useState("");
    useEffect(() => setScript(workspace?.script || ""), [workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!workspace || script === workspace.script) return;
        const timer = window.setTimeout(() => useWorkspaceStore.getState().updateWorkspace(id, { script }), 400);
        return () => window.clearTimeout(timer);
    }, [id, script, workspace]);

    const materials = useMemo<MaterialView[]>(() => {
        const seen = new Set<string>();
        const list: MaterialView[] = [];
        (workspace?.materials || []).forEach((material) => {
            seen.add(material.storageKey);
            list.push({ key: material.id, kind: material.kind, name: material.name, storageKey: material.storageKey, source: material.canvasId ? `拖入「${canvases.find((canvas) => canvas.id === material.canvasId)?.title || "画布"}」` : "项目素材", materialId: material.id, canvasId: material.canvasId });
        });
        canvases.forEach((canvas) =>
            canvas.nodes.forEach((node) => {
                const meta = node.metadata || {};
                const media = [
                    ...(node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio ? [{ kind: node.type, storageKey: meta.storageKey }] : []),
                    ...(node.type === HemosiNodeType.Shot ? [{ kind: "image", storageKey: meta.shotImage?.storageKey }, { kind: "video", storageKey: meta.shotVideo?.storageKey }] : []),
                    ...(meta.anchorImages || []).map((image) => ({ kind: "image", storageKey: image.storageKey })),
                ];
                media.forEach(({ kind, storageKey }) => {
                    if (!storageKey || seen.has(storageKey)) return;
                    seen.add(storageKey);
                    list.push({ key: storageKey, kind: kind as WorkspaceMaterial["kind"], name: node.title, storageKey, source: `画布「${canvas.title}」`, canvasId: canvas.id });
                });
            }),
        );
        return list;
    }, [canvases, workspace?.materials]);
    const shown = filter === "all" ? materials : materials.filter((item) => item.kind === filter);

    if (!hydrated) return <main className="flex h-full items-center justify-center text-sm text-stone-500">加载中…</main>;
    if (!workspace)
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4 text-sm text-stone-500">
                项目不存在或已删除
                <Button onClick={() => navigate("/projects")}>返回项目列表</Button>
            </main>
        );

    const newCanvas = (title = `${workspace.title} · 第 ${canvases.length + 1} 张`) => useCanvasStore.getState().createProject(title, workspace.id);
    const scriptToShots = () => {
        const parts = splitScript(script, "paragraph");
        if (!parts.length) return void message.warning("剧本是空的");
        const canvasId = newCanvas(`${workspace.title} · 分镜`);
        const text = { ...createCanvasNode(CanvasNodeType.Text, { x: 170, y: 120 }, { content: script }), title: "剧本" };
        useCanvasStore.getState().updateProject(canvasId, { nodes: [text, ...buildShotRow(parts, { x: 520, y: 0 }, 1, "第 1 场 · 分镜")] });
        message.success(`已按段落拆成 ${parts.length} 个分镜`);
        navigate(`/canvas/${canvasId}`);
    };
    const uploadMaterials = async (files: FileList | null) => {
        const list = Array.from(files || []);
        try {
            const added = await Promise.all(
                list.map(async (file) => {
                    if (file.type.startsWith("image/")) {
                        const image = await uploadImage(file);
                        return { kind: "image" as const, name: file.name, storageKey: image.storageKey || "", mimeType: image.mimeType, bytes: image.bytes, width: image.width, height: image.height };
                    }
                    const media = await uploadMediaFile(file, file.type.startsWith("video/") ? "video" : "audio");
                    return { kind: file.type.startsWith("video/") ? ("video" as const) : ("audio" as const), name: file.name, storageKey: media.storageKey, mimeType: media.mimeType, bytes: media.bytes, width: media.width, height: media.height, durationMs: media.durationMs };
                }),
            );
            useWorkspaceStore.getState().addMaterials(workspace.id, added);
            message.success(`已归档 ${added.length} 个素材`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };
    const exportPackage = async () => {
        const hide = message.loading("正在打包…", 0);
        try {
            await exportCanvasProjects(canvases, `${workspace.title}-项目包`, [workspace]);
        } finally {
            hide();
        }
    };
    const deleteProject = () =>
        modal.confirm({
            title: `删除项目「${workspace.title}」？`,
            content: `会同时删除其中 ${canvases.length} 张画布和 ${workspace.materials.length} 个归档素材。建议先导出项目包。`,
            okButtonProps: { danger: true },
            okText: "删除",
            cancelText: "取消",
            onOk: () => {
                useCanvasStore.getState().deleteProjects(canvases.map((canvas) => canvas.id));
                useWorkspaceStore.getState().deleteWorkspace(workspace.id);
                useAssetStore.getState().cleanupImages();
                navigate("/projects");
            },
        });

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div className="min-w-0">
                        <button type="button" className="flex items-center gap-1 text-xs text-stone-500 hover:underline" onClick={() => navigate("/projects")}>
                            <ArrowLeft className="size-3" /> 全部项目
                        </button>
                        <Input variant="borderless" className="!mt-2 !px-0 !text-3xl !font-semibold" value={workspace.title} onChange={(event) => useWorkspaceStore.getState().updateWorkspace(workspace.id, { title: event.target.value })} />
                        <p className="text-xs text-stone-500">{canvases.length} 张画布 · {materials.length} 个素材 · 创建于 {dayjs(workspace.createdAt).format("YYYY-MM-DD")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button icon={<Download className="size-4" />} onClick={() => void exportPackage()}>
                            导出项目包
                        </Button>
                        <Button danger icon={<Trash2 className="size-4" />} onClick={deleteProject}>
                            删除项目
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => navigate(`/canvas/${newCanvas()}`)}>
                            新建画布
                        </Button>
                    </div>
                </header>

                <section>
                    <h2 className="mb-3 text-lg font-semibold">画布</h2>
                    {canvases.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {canvases.map((canvas) => (
                                <div key={canvas.id} className="flex flex-col justify-between rounded-2xl bg-[#f1eee8] p-4 dark:bg-white/5">
                                    <button type="button" className="text-left" onClick={() => navigate(`/canvas/${canvas.id}`)}>
                                        <div className="truncate font-semibold">{canvas.title}</div>
                                        <div className="mt-1 text-xs text-stone-500">
                                            {canvas.nodes.length} 个节点 · {canvas.nodes.filter((node) => node.type === HemosiNodeType.Shot).length} 个分镜 · 更新于 {dayjs(canvas.updatedAt).format("MM-DD HH:mm")}
                                        </div>
                                        {canvas.forkedFrom ? <div className="mt-1 text-xs text-stone-500">分支自「{allCanvases.find((item) => item.id === canvas.forkedFrom)?.title || "已删除的画布"}」</div> : null}
                                    </button>
                                    <div className="mt-3 flex gap-1">
                                        <Tooltip title="复制一份做新方向，原画布不动">
                                            <Button size="small" type="text" icon={<GitFork className="size-3.5" />} onClick={() => useCanvasStore.getState().forkProject(canvas.id)}>
                                                Fork
                                            </Button>
                                        </Tooltip>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => modal.confirm({ title: `删除画布「${canvas.title}」？`, okButtonProps: { danger: true }, okText: "删除", cancelText: "取消", onOk: () => { useCanvasStore.getState().deleteProjects([canvas.id]); useAssetStore.getState().cleanupImages(); } })}>
                                            删除
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-stone-500">还没有画布。可以按集/按场各开一张。</p>
                    )}
                </section>

                <section>
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-lg font-semibold">剧本</h2>
                        <Button icon={<Clapperboard className="size-4" />} onClick={scriptToShots}>
                            按段落拆成分镜（新画布）
                        </Button>
                    </div>
                    <Input.TextArea value={script} autoSize={{ minRows: 6, maxRows: 24 }} placeholder="把整部剧本贴在这里，空行分段；自动保存。" onChange={(event) => setScript(event.target.value)} />
                    <p className="mt-1 text-xs text-stone-500">{script.replace(/\s/g, "").length} 字 · {splitScript(script, "paragraph").length} 段</p>
                </section>

                <section>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold">素材</h2>
                        <div className="flex items-center gap-2">
                            <Segmented size="small" value={filter} onChange={(value) => setFilter(value as typeof filter)} options={[{ label: "全部", value: "all" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }]} />
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                                归档外部文件
                            </Button>
                        </div>
                    </div>
                    {shown.length ? (
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {shown.map((item) => (
                                <div key={item.key} className="space-y-1">
                                    <MaterialThumb item={item} />
                                    <div className="flex items-center justify-between gap-1 text-xs">
                                        <span className="truncate" title={item.name}>{item.name}</span>
                                        {item.materialId ? (
                                            <button type="button" className="shrink-0 text-stone-500 hover:text-red-500" title="从项目素材中移除" onClick={() => useWorkspaceStore.getState().removeMaterial(workspace.id, item.materialId!)}>
                                                <Trash2 className="size-3" />
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="truncate text-[11px] text-stone-500">{item.source}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-stone-500">外部平台生成回来的图片/视频拖进本项目的任一画布，会自动归档到这里。</p>
                    )}
                </section>
            </div>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(event) => void uploadMaterials(event.target.files)} />
        </main>
    );
}
