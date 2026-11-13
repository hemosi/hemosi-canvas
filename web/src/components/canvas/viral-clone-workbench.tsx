import { useState } from "react";
import { App, Modal, Tabs } from "antd";
import { Download, Eye, Flame, Loader2, Play, Sparkles } from "lucide-react";

import {
    analyzeVideoWithGemini,
    createEmptyCloneProject,
    exportCloneProjectZip,
    findGeminiChannelModel,
    rewatchSegmentWithGemini,
    type CloneProject,
} from "@/lib/canvas/clone-project";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function ViralCloneWorkbench({
    open,
    sourceNode,
    onClose,
    onSaveProject,
}: {
    open: boolean;
    sourceNode: CanvasNodeData | null;
    onClose: () => void;
    onSaveProject?: (nodeId: string, project: CloneProject) => void;
}) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const gemini = findGeminiChannelModel(config);

    const existing = sourceNode?.metadata?.cloneProject as CloneProject | undefined;
    const [project, setProject] = useState<CloneProject>(() => existing || createEmptyCloneProject(sourceNode?.title || "爆款复刻工程"));
    const [busy, setBusy] = useState<string | null>(null);
    const [userBrief, setUserBrief] = useState("");
    const [previewPlaying, setPreviewPlaying] = useState(false);

    const videoUrl = sourceNode?.type === CanvasNodeType.Video ? sourceNode.metadata?.content : undefined;

    const updateProject = (next: CloneProject) => {
        setProject(next);
        if (sourceNode && onSaveProject) onSaveProject(sourceNode.id, next);
    };

    const handleAnalyze = () => {
        if (!videoUrl || !gemini.ready || !gemini.model) return;
        Modal.confirm({
            title: "确认拆解原片",
            centered: true,
            content: (
                <div className="space-y-1 text-xs">
                    <div>原片：{sourceNode?.title || "视频节点"}</div>
                    <div>模型：{gemini.channelName}</div>
                    <div>说明：将上传原片到 Gemini File API 并由 Gemini 进行结构与画面拆解。</div>
                </div>
            ),
            okText: "开始拆解",
            cancelText: "取消",
            onOk: async () => {
                setBusy("正在上传并拆解原片…");
                try {
                    const next = await analyzeVideoWithGemini({
                        config,
                        model: gemini.model!,
                        videoUrl,
                    });
                    updateProject(next);
                    message.success(`拆解完成，共 ${next.segments.length} 段`);
                } catch (err) {
                    message.error(err instanceof Error ? err.message : "拆解失败");
                } finally {
                    setBusy(null);
                }
            },
        });
    };

    const handleRewatch = async (segId: string) => {
        const seg = project.segments.find((s) => s.id === segId);
        if (!seg || !videoUrl || !gemini.ready || !gemini.model) return;
        setBusy(`正在高帧率重看第 ${seg.index} 段…`);
        try {
            const patch = await rewatchSegmentWithGemini({
                config,
                model: gemini.model,
                videoUrl,
                segment: seg,
            });
            updateProject({
                ...project,
                segments: project.segments.map((s) => (s.id === segId ? { ...s, ...patch } : s)),
            });
            message.success(`第 ${seg.index} 段细看已更新`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "重看失败");
        } finally {
            setBusy(null);
        }
    };

    const handleExport = async () => {
        try {
            await exportCloneProjectZip(project);
            message.success("已导出复刻工程包 (.zip)");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "导出失败");
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <Flame className="size-4 text-amber-500" />
                    <span>爆款复刻工作区</span>
                    {busy ? (
                        <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-500">
                            <Loader2 className="size-3 animate-spin" /> {busy}
                        </span>
                    ) : null}
                </div>
            }
            open={open}
            centered
            width={920}
            footer={null}
            onCancel={onClose}
        >
            <div className="flex flex-col gap-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 p-2.5 dark:border-white/10">
                    <div>
                        <span className="opacity-65">源视频：</span>
                        <span className="font-medium">{sourceNode?.title || "未选择视频节点"}</span>
                        {!gemini.ready ? (
                            <span className="ml-3 text-red-500">{gemini.reason}</span>
                        ) : (
                            <span className="ml-3 text-emerald-500">Gemini 就绪：{gemini.channelName}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!videoUrl || !gemini.ready || Boolean(busy)}
                            title={!gemini.ready ? gemini.reason : !videoUrl ? "请先选择带视频产物的节点" : "用 Gemini 拆解原片"}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
                            onClick={handleAnalyze}
                        >
                            <Sparkles className="size-3.5" /> Gemini 拆解原片
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-black/15 px-3 py-1.5 font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                            onClick={() => void handleExport()}
                        >
                            <Download className="size-3.5" /> 导出工程包
                        </button>
                    </div>
                </div>

                <Tabs
                    items={[
                        {
                            key: "script",
                            label: "脚本与改写",
                            children: (
                                <div className="space-y-3">
                                    <div className="flex gap-2">
                                        <input
                                            className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-2.5 py-1.5 outline-none dark:border-white/15"
                                            placeholder="填入你的产品/话题/人设与要改的部分..."
                                            value={userBrief}
                                            onChange={(e) => setUserBrief(e.target.value)}
                                        />
                                    </div>
                                    {project.segments.length === 0 ? (
                                        <div className="rounded-xl border border-dashed p-8 text-center opacity-60">
                                            暂无分段，请先点击右上角「Gemini 拆解原片」
                                        </div>
                                    ) : (
                                        <div className="thin-scrollbar max-h-80 space-y-2 overflow-y-auto pr-1">
                                            {project.segments.map((seg) => (
                                                <div
                                                    key={seg.id}
                                                    className="rounded-xl border border-black/10 p-2.5 dark:border-white/10"
                                                >
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <span className="font-semibold">
                                                            #{seg.index} · {seg.role} ({seg.startSec}s - {seg.endSec}s)
                                                        </span>
                                                        <button
                                                            type="button"
                                                            disabled={!videoUrl || !gemini.ready || Boolean(busy)}
                                                            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                                                            onClick={() => void handleRewatch(seg.id)}
                                                        >
                                                            <Eye className="size-3" /> 重看此段
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <div className="mb-0.5 opacity-60">原片台词</div>
                                                            <div className="rounded bg-black/5 p-1.5 dark:bg-white/5">{seg.originalLine}</div>
                                                        </div>
                                                        <div>
                                                            <div className="mb-0.5 opacity-60">改写台词</div>
                                                            <textarea
                                                                rows={2}
                                                                className="w-full rounded border border-black/15 bg-transparent p-1.5 outline-none dark:border-white/15"
                                                                value={seg.newLine}
                                                                onChange={(e) =>
                                                                    updateProject({
                                                                        ...project,
                                                                        segments: project.segments.map((s) =>
                                                                            s.id === seg.id ? { ...s, newLine: e.target.value } : s,
                                                                        ),
                                                                    })
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: "preview",
                            label: "实时预览",
                            children: (
                                <div className="space-y-3">
                                    <div className="flex h-64 flex-col items-center justify-center rounded-xl bg-black text-white">
                                        {project.segments.length === 0 ? (
                                            <span className="opacity-60">拆解或改写脚本后可在此按预估时长预览字幕与画面挂点</span>
                                        ) : (
                                            <div className="px-6 text-center">
                                                <div className="mb-2 text-xs text-amber-400">实时合成预览（非成片渲染）</div>
                                                <div className="text-base font-semibold">
                                                    {project.segments[0]?.newLine || project.segments[0]?.originalLine}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg border border-black/15 px-3 py-1.5 dark:border-white/15"
                                        onClick={() => setPreviewPlaying((p) => !p)}
                                    >
                                        <Play className="size-3.5" /> {previewPlaying ? "暂停预览" : "播放预览"}
                                    </button>
                                </div>
                            ),
                        },
                        {
                            key: "tracks",
                            label: "轨道",
                            children: (
                                <div className="space-y-2 py-2">
                                    <div className="rounded-lg border border-black/10 p-2.5 dark:border-white/10">
                                        <div className="mb-1 font-medium">主画面 / B-roll 轨道</div>
                                        <div className="flex gap-1 overflow-x-auto">
                                            {project.segments.map((s) => (
                                                <div
                                                    key={s.id}
                                                    className="shrink-0 rounded bg-sky-500/15 px-2 py-1 text-[11px]"
                                                >
                                                    #{s.index} {s.role} ({Math.max(1, s.endSec - s.startSec)}s)
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "variants",
                            label: "变体",
                            children: (
                                <div className="space-y-2 py-2">
                                    <button
                                        type="button"
                                        className="rounded-lg border border-black/15 px-3 py-1.5 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                                        onClick={() =>
                                            updateProject({
                                                ...project,
                                                variants: [
                                                    ...project.variants,
                                                    {
                                                        id: `var-${Date.now()}`,
                                                        name: `变体 ${project.variants.length + 1}`,
                                                        values: Object.fromEntries(project.variables.map((v) => [v.key, v.value])),
                                                        status: "idle",
                                                    },
                                                ],
                                            })
                                        }
                                    >
                                        ＋ 新增变体行
                                    </button>
                                    {project.variants.map((v) => (
                                        <div key={v.id} className="flex items-center justify-between rounded-lg border border-black/10 p-2 dark:border-white/10">
                                            <span className="font-medium">{v.name}</span>
                                            <span className="opacity-65">{v.status}</span>
                                        </div>
                                    ))}
                                </div>
                            ),
                        },
                    ]}
                />
            </div>
        </Modal>
    );
}
