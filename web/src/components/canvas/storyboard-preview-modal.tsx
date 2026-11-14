import { useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { Download, Film, Loader2, Play } from "lucide-react";
import { saveAs } from "file-saver";

import { probeSidecarHealth, sidecarComposeProvider, type SidecarHealth } from "@/lib/canvas/local-sidecar";

export type PreviewClip = {
    code: string;
    duration: number;
    url: string;
};

export function StoryboardPreviewModal({
    open,
    clips,
    onClose,
}: {
    open: boolean;
    clips: PreviewClip[];
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const [idx, setIdx] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [composing, setComposing] = useState(false);
    const [health, setHealth] = useState<SidecarHealth | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setIdx(0);
        setPlaying(false);
        void probeSidecarHealth().then(setHealth);
    }, [open]);

    const current = clips[idx];

    const handleEnded = () => {
        if (idx + 1 < clips.length) {
            setIdx(idx + 1);
            setPlaying(true);
        } else {
            setPlaying(false);
        }
    };

    useEffect(() => {
        if (playing && videoRef.current) {
            void videoRef.current.play().catch(() => {});
        }
    }, [idx, playing]);

    const handleComposeMp4 = async () => {
        if (!clips.length || composing) return;
        setComposing(true);
        try {
            const mp4Blob = await sidecarComposeProvider.run(clips.map((c) => ({ videoUrl: c.url })));
            saveAs(mp4Blob, `分镜合成_${Date.now()}.mp4`);
            message.success("已合成并导出真实 MP4");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "合成失败");
        } finally {
            setComposing(false);
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <Film className="size-4 text-sky-500" />
                    <span>预览拼接</span>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-normal opacity-75 dark:bg-white/10">
                        顺序预览 · 非成片渲染
                    </span>
                </div>
            }
            open={open}
            centered
            width={680}
            footer={null}
            onCancel={onClose}
            modalRender={(node) => (
                <div
                    data-canvas-no-zoom
                    onMouseDownCapture={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {node}
                </div>
            )}
        >
            <div className="flex flex-col gap-3 py-2 text-xs">
                {clips.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed opacity-60">
                        暂无已生成的视频片段
                    </div>
                ) : (
                    <>
                        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-black">
                            {current ? (
                                <video
                                    ref={videoRef}
                                    key={current.url}
                                    src={current.url}
                                    controls
                                    className="size-full object-contain"
                                    onEnded={handleEnded}
                                />
                            ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                            {clips.map((c, i) => (
                                <button
                                    key={`${c.code}-${i}`}
                                    type="button"
                                    className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                                        i === idx ? "bg-sky-500 text-white" : "bg-black/5 hover:bg-black/10 dark:bg-white/10"
                                    }`}
                                    onClick={() => {
                                        setIdx(i);
                                        setPlaying(true);
                                    }}
                                >
                                    {c.code} · {c.duration}s
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <div className="flex items-center justify-between border-t border-black/10 pt-3 dark:border-white/10">
                    <div className="text-[11px] opacity-70">
                        本地合成服务：
                        {health === null
                            ? "检测中…"
                            : health.status === "up"
                              ? "可用 (ffmpeg)"
                              : `不可用（${health.reason || "未启动"}）`}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!clips.length}
                            className="inline-flex items-center gap-1 rounded-lg border border-black/15 px-3 py-1.5 font-medium transition hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                            onClick={() => {
                                setIdx(0);
                                setPlaying(true);
                            }}
                        >
                            <Play className="size-3.5" /> 顺序预览
                        </button>
                        <button
                            type="button"
                            disabled={!clips.length || composing || health?.status !== "up"}
                            title={health?.status !== "up" ? health?.reason || "本地合成服务不可用" : "使用本地 ffmpeg 合成真实 MP4"}
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-white transition hover:bg-sky-600 disabled:opacity-40"
                            onClick={() => void handleComposeMp4()}
                        >
                            {composing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                            合成导出 MP4
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
