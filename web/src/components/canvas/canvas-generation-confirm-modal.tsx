import { useEffect, useState, type ReactNode } from "react";
import { Button, Checkbox, Modal } from "antd";
import { Music2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { videoResolutionLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode } from "@/types/canvas";

export type GenerationConfirmMedia = { id: string; url: string };

export type GenerationConfirmSummary = {
    mode: CanvasGenerationMode;
    model: string;
    channel: string;
    prompt: string;
    images: GenerationConfirmMedia[];
    videos: GenerationConfirmMedia[];
    audioCount: number;
    size?: string;
    quality?: string;
    resolution?: string;
    seconds?: string;
    count: number;
    draft?: boolean;
    seed?: string;
};

/** Collect what a generation request is about to send, from the resolved request config and its inputs. */
export function buildGenerationConfirmSummary(
    config: AiConfig,
    mode: CanvasGenerationMode,
    input: { prompt: string; images?: Array<{ id: string; dataUrl?: string; url?: string }>; videos?: Array<{ id: string; url?: string }>; audioCount?: number; count: number; draft?: boolean },
): GenerationConfirmSummary {
    return {
        mode,
        model: modelOptionName(config.model),
        channel: resolveModelChannel(config, config.model).name,
        prompt: input.prompt,
        images: (input.images || []).map((image) => ({ id: image.id, url: image.dataUrl || image.url || "" })),
        videos: (input.videos || []).map((video) => ({ id: video.id, url: video.url || "" })),
        audioCount: input.audioCount || 0,
        size: mode === "image" || mode === "video" ? config.size : undefined,
        quality: mode === "image" ? config.quality : undefined,
        resolution: mode === "video" ? config.vquality : undefined,
        seconds: mode === "video" ? config.videoSeconds : undefined,
        count: input.count,
        draft: input.draft,
        seed: config.seed?.trim() || undefined,
    };
}

export function CanvasGenerationConfirmModal({ summary, onConfirm, onCancel }: { summary: GenerationConfirmSummary | null; onConfirm: (dontAskAgain: boolean) => void; onCancel: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [dontAskAgain, setDontAskAgain] = useState(false);

    useEffect(() => {
        if (summary) setDontAskAgain(false);
    }, [summary]);

    const hasInputs = Boolean(summary && (summary.images.length || summary.videos.length || summary.audioCount));

    return (
        <Modal
            title={t("hemosi.confirm.title")}
            open={Boolean(summary)}
            centered
            width={520}
            onCancel={onCancel}
            destroyOnHidden
            footer={
                <div className="flex items-center justify-between gap-3">
                    <Checkbox checked={dontAskAgain} onChange={(event) => setDontAskAgain(event.target.checked)}>
                        <span className="text-xs">{t("hemosi.confirm.dontAskAgain")}</span>
                    </Checkbox>
                    <div className="flex gap-2">
                        <Button onClick={onCancel}>{t("hemosi.confirm.cancel")}</Button>
                        <Button type="primary" autoFocus onClick={() => onConfirm(dontAskAgain)}>
                            {t("hemosi.confirm.confirm")}
                        </Button>
                    </div>
                </div>
            }
        >
            {summary ? (
                <div className="space-y-2.5 pt-1 text-sm" data-canvas-shortcuts-ignore onWheelCapture={(event) => event.stopPropagation()}>
                    <Row label={t("hemosi.confirm.mode")} value={t(`hemosi.confirm.modes.${summary.mode}`)} />
                    <Row label={t("hemosi.confirm.model")} value={summary.model} />
                    <Row label={t("hemosi.confirm.channel")} value={summary.channel} />
                    {summary.draft ? <Row label={t("hemosi.confirm.draft")} value={<span style={{ color: "var(--hemosi-accent)" }}>{t("hemosi.confirm.draftValue")}</span>} /> : null}
                    {summary.size ? <Row label={t("hemosi.confirm.size")} value={summary.mode === "video" ? videoSizeLabel(summary.size) : imageSizeLabel(summary.size)} /> : null}
                    {summary.quality ? <Row label={t("hemosi.confirm.quality")} value={imageQualityLabel(summary.quality)} /> : null}
                    {summary.resolution ? <Row label={t("hemosi.confirm.resolution")} value={videoResolutionLabel(summary.resolution)} /> : null}
                    {summary.seconds ? <Row label={t("hemosi.confirm.seconds")} value={t("hemosi.confirm.secondsValue", { count: Number(summary.seconds) || 0 })} /> : null}
                    {summary.seed ? <Row label="种子" value={summary.seed} /> : null}
                    <Row label={t("hemosi.confirm.count")} value={t("hemosi.confirm.countValue", { count: summary.count })} />
                    <div>
                        <div className="mb-1 text-xs opacity-60">{t("hemosi.confirm.prompt")}</div>
                        <div className="thin-scrollbar max-h-48 min-h-12 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-[13px] leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {summary.prompt.trim() || <span className="opacity-50">{t("hemosi.confirm.emptyPrompt")}</span>}
                        </div>
                    </div>
                    <div>
                        <div className="mb-1 text-xs opacity-60">{t("hemosi.confirm.inputs")}</div>
                        {hasInputs ? (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                    {summary.images.length ? <span>{t("hemosi.confirm.images", { count: summary.images.length })}</span> : null}
                                    {summary.videos.length ? <span>{t("hemosi.confirm.videos", { count: summary.videos.length })}</span> : null}
                                    {summary.audioCount ? <span>{t("hemosi.confirm.audios", { count: summary.audioCount })}</span> : null}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {summary.images.map((image) => (
                                        <img key={image.id} src={image.url} alt="" className="size-14 rounded-md border object-cover" style={{ borderColor: theme.node.stroke }} />
                                    ))}
                                    {summary.videos.map((video) => (
                                        <video key={video.id} src={video.url} muted playsInline preload="metadata" className="size-14 rounded-md border object-cover" style={{ borderColor: theme.node.stroke }} />
                                    ))}
                                    {summary.audioCount ? (
                                        <span className="flex size-14 items-center justify-center rounded-md border" style={{ borderColor: theme.node.stroke }}>
                                            <Music2 className="size-5 opacity-60" />
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs opacity-50">{t("hemosi.confirm.noInputs")}</div>
                        )}
                    </div>
                    {dontAskAgain ? <div className="text-xs opacity-60">{t("hemosi.confirm.dontAskHint")}</div> : null}
                </div>
            ) : null}
        </Modal>
    );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3">
            <span className="text-xs leading-5 opacity-60">{label}</span>
            <span className="min-w-0 break-words leading-5">{value}</span>
        </div>
    );
}
