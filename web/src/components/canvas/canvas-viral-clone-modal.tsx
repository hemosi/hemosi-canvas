import { useEffect, useState } from "react";
import { App, Input, Modal, Segmented, Spin, Tooltip } from "antd";
import { Clapperboard, CopyPlus, Download, FileArchive, FileText, Flame, Mic, Play, Plus, RefreshCw, Settings2, Sparkles, Trash2, Volume2, Wand2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    DEFAULT_ASR_CONFIG,
    DEFAULT_TTS_CONFIG,
    analyzeBlueprintWithFreeLlm,
    applyVariantToBlueprint,
    buildLocalHeuristicBlueprint,
    buildSrtFromBlueprint,
    exportViralBlueprintZip,
    extractLocalVideoCuts,
    loadViralBlueprintDraft,
    resolveTemplateVariables,
    saveViralBlueprintDraft,
    synthesizeBeatTtsWithAdapter,
    transcribeVideoWithAdapter,
    type ViralAsrConfig,
    type ViralBlueprint,
    type ViralCut,
    type ViralTtsConfig,
    type ViralVariantRow,
} from "@/lib/canvas/viral-clone";
import { useDirectorLoopStore } from "@/stores/canvas/use-director-loop-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

const ASR_CONFIG_STORAGE_KEY = "hemosi:viral-asr-config";
const TTS_CONFIG_STORAGE_KEY = "hemosi:viral-tts-config";

function loadStoredJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
    } catch {
        return fallback;
    }
}

export interface CanvasViralCloneModalProps {
    open: boolean;
    projectId: string;
    sourceNode: CanvasNodeData | null;
    onClose: () => void;
    onExpandToCanvas: (blueprint: ViralBlueprint, sourceNode: CanvasNodeData | null, batchOffsetY?: number, attachKeyframes?: boolean) => Promise<void>;
}

export function CanvasViralCloneModal({
    open,
    projectId,
    sourceNode,
    onClose,
    onExpandToCanvas,
}: CanvasViralCloneModalProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const [extracting, setExtracting] = useState(false);
    const [extractRatio, setExtractRatio] = useState(0);
    const [cuts, setCuts] = useState<ViralCut[]>([]);
    const [rawTranscript, setRawTranscript] = useState("");
    const [includeKeyframes, setIncludeKeyframes] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [blueprint, setBlueprint] = useState<ViralBlueprint | null>(null);

    const [showApiConfig, setShowApiConfig] = useState(false);
    const [asrConfig, setAsrConfig] = useState<ViralAsrConfig>(() => loadStoredJson(ASR_CONFIG_STORAGE_KEY, DEFAULT_ASR_CONFIG));
    const [ttsConfig, setTtsConfig] = useState<ViralTtsConfig>(() => loadStoredJson(TTS_CONFIG_STORAGE_KEY, DEFAULT_TTS_CONFIG));

    const [ttsLoadingShot, setTtsLoadingShot] = useState<number | null>(null);
    const [batchTtsLoading, setBatchTtsLoading] = useState(false);
    const [expanding, setExpanding] = useState(false);
    const [attachKeyframes, setAttachKeyframes] = useState(false);
    const [variants, setVariants] = useState<ViralVariantRow[]>([]);
    const [showVariants, setShowVariants] = useState(false);

    const videoUrl = sourceNode?.metadata?.content || "";
    const videoTitle = sourceNode?.title || "参考视频";
    const nodeKey = sourceNode?.id || "global";

    useEffect(() => {
        if (!open || !blueprint) return;
        void saveViralBlueprintDraft(projectId, nodeKey, { ...blueprint, variants });
    }, [open, projectId, nodeKey, blueprint, variants]);

    const updateAsrConfig = (patch: Partial<ViralAsrConfig>) => {
        setAsrConfig((prev) => {
            const next = { ...prev, ...patch };
            localStorage.setItem(ASR_CONFIG_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const updateTtsConfig = (patch: Partial<ViralTtsConfig>) => {
        setTtsConfig((prev) => {
            const next = { ...prev, ...patch };
            localStorage.setItem(TTS_CONFIG_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    useEffect(() => {
        if (!open) return;
        if (!videoUrl) {
            const fallbackCuts: ViralCut[] = [
                { index: 1, startSec: 0, endSec: 3, durationSec: 3, frameDataUrl: "" },
                { index: 2, startSec: 3, endSec: 7, durationSec: 4, frameDataUrl: "" },
                { index: 3, startSec: 7, endSec: 12, durationSec: 5, frameDataUrl: "" },
            ];
            setCuts(fallbackCuts);
            setBlueprint(buildLocalHeuristicBlueprint(videoTitle, fallbackCuts, ""));
            return;
        }
        let cancelled = false;
        setExtracting(true);
        setExtractRatio(0);
        extractLocalVideoCuts(videoUrl, (r) => {
            if (!cancelled) setExtractRatio(r);
        })
            .then(async (res) => {
                if (cancelled) return;
                setCuts(res);
                const cached = await loadViralBlueprintDraft(projectId, nodeKey);
                if (cached && cached.beats.length === res.length) {
                    setBlueprint(cached);
                    if (cached.variants) setVariants(cached.variants);
                } else {
                    setBlueprint(buildLocalHeuristicBlueprint(videoTitle, res, rawTranscript));
                }
            })
            .catch((err) => {
                if (cancelled) return;
                message.warning(`本地抽帧提示：${err instanceof Error ? err.message : String(err)}，已启用默认三段结构`);
                const fallbackCuts: ViralCut[] = [
                    { index: 1, startSec: 0, endSec: 3, durationSec: 3, frameDataUrl: "" },
                    { index: 2, startSec: 3, endSec: 7, durationSec: 4, frameDataUrl: "" },
                    { index: 3, startSec: 7, endSec: 12, durationSec: 5, frameDataUrl: "" },
                ];
                setCuts(fallbackCuts);
                setBlueprint(buildLocalHeuristicBlueprint(videoTitle, fallbackCuts, rawTranscript));
            })
            .finally(() => {
                if (!cancelled) setExtracting(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, videoUrl, videoTitle]);

    const handleRunAsr = async () => {
        setTranscribing(true);
        try {
            const text = await transcribeVideoWithAdapter(videoUrl, asrConfig);
            setRawTranscript(text);
            if (cuts.length) {
                setBlueprint(buildLocalHeuristicBlueprint(videoTitle, cuts, text));
            }
            message.success("已通过 ASR 接口完成语音转写并对齐镜头");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "ASR 转写失败，请检查接口配置");
        } finally {
            setTranscribing(false);
        }
    };

    const handleLocalInstantAnalyze = () => {
        const bp = buildLocalHeuristicBlueprint(videoTitle, cuts, rawTranscript);
        setBlueprint(bp);
        message.success("已按镜头切点与台词生成蓝图（免 API）");
    };

    const handleFreeLlmAnalyze = async () => {
        setAnalyzing(true);
        try {
            const bp = await analyzeBlueprintWithFreeLlm(videoTitle, cuts, rawTranscript, includeKeyframes);
            setBlueprint(bp);
            message.success("已完成 AI 语义节拍拆解");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "AI 拆解失败，已保留当前蓝图");
        } finally {
            setAnalyzing(false);
        }
    };

    const handleImportSrtFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const txt = String(reader.result || "");
            setRawTranscript(txt);
            if (cuts.length) {
                setBlueprint(buildLocalHeuristicBlueprint(videoTitle, cuts, txt));
            }
            message.success(`已导入字幕《${file.name}》并对齐镜头切点`);
        };
        reader.readAsText(file, "utf-8");
    };

    const updateVariable = (index: number, patch: { key?: string; label?: string; value?: string }) => {
        if (!blueprint) return;
        setBlueprint({
            ...blueprint,
            variables: blueprint.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)),
        });
    };

    const addVariable = () => {
        if (!blueprint) return;
        const nextIdx = blueprint.variables.length + 1;
        setBlueprint({
            ...blueprint,
            variables: [...blueprint.variables, { key: `var_${nextIdx}`, label: `自定义变量${nextIdx}`, value: "" }],
        });
    };

    const removeVariable = (index: number) => {
        if (!blueprint) return;
        setBlueprint({
            ...blueprint,
            variables: blueprint.variables.filter((_, i) => i !== index),
        });
    };

    const updateBeatField = (shotNumber: number, field: "newLine" | "imagePrompt" | "videoPrompt" | "respondsTo", value: string) => {
        if (!blueprint) return;
        setBlueprint({
            ...blueprint,
            beats: blueprint.beats.map((b) => (b.shotNumber === shotNumber ? { ...b, [field]: value } : b)),
        });
    };

    const handleTtsForBeat = async (shotNumber: number, autoPlay = true) => {
        if (!blueprint) return;
        const beat = blueprint.beats.find((b) => b.shotNumber === shotNumber);
        if (!beat) return;
        const finalLine = resolveTemplateVariables(beat.newLine, blueprint.variables).trim();
        if (!finalLine) return void message.warning("该镜头还没有台词");
        setTtsLoadingShot(shotNumber);
        try {
            const { audioUrl, durationSec } = await synthesizeBeatTtsWithAdapter(finalLine, ttsConfig);
            setBlueprint((prev) =>
                prev
                    ? {
                          ...prev,
                          beats: prev.beats.map((b) =>
                              b.shotNumber === shotNumber ? { ...b, ttsAudioUrl: audioUrl, ttsDurationSec: durationSec } : b,
                          ),
                      }
                    : prev,
            );
            if (autoPlay) {
                const audio = new Audio(audioUrl);
                void audio.play().catch(() => undefined);
            }
            message.success(`镜头 #${shotNumber} 配音完成（时长 ${durationSec}s）`);
        } catch (err) {
            message.error(`TTS 合成失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setTtsLoadingShot(null);
        }
    };

    const handleBatchTtsAll = async () => {
        if (!blueprint) return;
        setBatchTtsLoading(true);
        try {
            for (const beat of blueprint.beats) {
                await handleTtsForBeat(beat.shotNumber, false);
            }
            message.success("已完成全片配音与真实时长校准");
        } finally {
            setBatchTtsLoading(false);
        }
    };

    const handleExportSrt = () => {
        if (!blueprint) return;
        const srt = buildSrtFromBlueprint(blueprint);
        const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${blueprint.title.replace(/[\\/:*?"<>|]/g, "_")}.srt`;
        a.click();
        URL.revokeObjectURL(a.href);
        message.success("已导出精准 SRT 字幕文件");
    };

    const handleSendToDirectorGroup = () => {
        if (!blueprint) return;
        const vars = blueprint.variables;
        const charAnchor = blueprint.anchors.find((a) => a.role === "character");
        const sceneAnchor = blueprint.anchors.find((a) => a.role === "scene");

        useDirectorLoopStore.getState().initFromPlan(projectId, {
            filmTitle: blueprint.title,
            idea: {
                protagonist: vars[0]?.value || charAnchor?.name || "核心主体",
                background: vars[1]?.value || sceneAnchor?.name || "主场景",
                theme: blueprint.hookSummary,
                story: blueprint.rhythmNote,
            },
            budgetMaxClips: Math.max(8, blueprint.beats.length * 2),
            unitPriceYuan: 0,
            anchors: blueprint.anchors.map((a) => ({
                kind: a.role,
                title: a.name,
                description: resolveTemplateVariables(a.prompt, vars),
            })),
            segments: blueprint.beats.map((b, idx) => ({
                title: `镜 ${b.shotNumber} · ${b.role}`,
                summary: `[响应: ${b.respondsTo}] ${resolveTemplateVariables(b.newLine, vars)}`,
                prompt: resolveTemplateVariables(b.videoPrompt, vars),
                isKey: idx === 0 || idx === blueprint.beats.length - 1,
                dependsOnIndex: idx > 0 ? idx - 1 : undefined,
                genMode: "ref_direct" as const,
                dialogueSource: "tts" as const,
                dialogueLine: resolveTemplateVariables(b.newLine, vars),
                drawCount: 2 as const,
                seconds: Math.max(5, Math.min(10, Math.round(b.endSec - b.startSec) || 5)),
                shotsList: [resolveTemplateVariables(b.imagePrompt, vars)],
            })),
        });
        message.success("已将爆款复刻蓝图装入画布「导演组」");
        onClose();
    };

    const handleExpandNodes = async () => {
        if (!blueprint) return;
        setExpanding(true);
        try {
            await onExpandToCanvas(blueprint, sourceNode, 0, attachKeyframes);
            onClose();
        } finally {
            setExpanding(false);
        }
    };

    const handleBatchExpandVariants = async () => {
        if (!blueprint || !variants.length) return;
        setExpanding(true);
        try {
            for (let i = 0; i < variants.length; i++) {
                const resolvedBp = applyVariantToBlueprint(blueprint, variants[i]);
                await onExpandToCanvas(resolvedBp, sourceNode, i * 680, attachKeyframes);
            }
            message.success(`已批量展开 ${variants.length} 组变体分镜工作组`);
            onClose();
        } finally {
            setExpanding(false);
        }
    };

    const handleExportZipPackage = async () => {
        if (!blueprint) return;
        try {
            await exportViralBlueprintZip(blueprint);
            message.success("已导出 ZIP 分镜素材包（含镜头参考帧、配音、SRT 与蓝图 JSON）");
        } catch (err) {
            message.error(`导出素材包失败：${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const addVariantRow = () => {
        if (!blueprint) return;
        const idx = variants.length + 1;
        const initValues: Record<string, string> = {};
        blueprint.variables.forEach((v) => {
            initValues[v.key] = v.value;
        });
        setVariants((prev) => [...prev, { id: `var-row-${Date.now()}-${idx}`, name: `变体 #${idx}`, values: initValues }]);
        setShowVariants(true);
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={1000}
            centered
            title={
                <div className="flex items-center justify-between pr-8">
                    <div className="flex items-center gap-2 text-base font-semibold" style={{ color: theme.node.text }}>
                        <Flame className="size-4 text-amber-500" />
                        <span>爆款复刻工作台（本地优先 · 通用可扩展接口）</span>
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-normal transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.text }}
                        onClick={() => setShowApiConfig((v) => !v)}
                    >
                        <Settings2 className="size-3.5" />
                        <span>{showApiConfig ? "收起 ASR / TTS 接口配置" : "配置 ASR / TTS 接口"}</span>
                    </button>
                </div>
            }
        >
            <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto pr-1 text-xs" style={{ color: theme.node.text }} data-canvas-shortcuts-ignore>
                {/* 可折叠的通用 ASR / TTS 接口配置面板 */}
                {showApiConfig && (
                    <div className="grid grid-cols-1 gap-3 rounded-xl border p-3 md:grid-cols-2" style={{ borderColor: theme.toolbar.border }}>
                        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: theme.toolbar.border }}>
                            <div className="font-semibold">ASR 语音转写接口（兼容本地 Whisper / OpenAI /v1/audio/transcriptions）</div>
                            <Input
                                size="small"
                                addonBefore="接口地址"
                                value={asrConfig.endpoint}
                                onChange={(e) => updateAsrConfig({ endpoint: e.target.value })}
                                placeholder="http://127.0.0.1:8000/v1/audio/transcriptions"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    size="small"
                                    addonBefore="模型"
                                    value={asrConfig.model}
                                    onChange={(e) => updateAsrConfig({ model: e.target.value })}
                                    placeholder="whisper-1"
                                />
                                <Input.Password
                                    size="small"
                                    addonBefore="Key"
                                    value={asrConfig.apiKey || ""}
                                    onChange={(e) => updateAsrConfig({ apiKey: e.target.value })}
                                    placeholder="本地服务可留空"
                                />
                            </div>
                        </div>

                        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: theme.toolbar.border }}>
                            <div className="flex items-center justify-between">
                                <span className="font-semibold">TTS 配音合成接口</span>
                                <Segmented
                                    size="small"
                                    value={ttsConfig.mode}
                                    onChange={(val) => updateTtsConfig({ mode: val as ViralTtsConfig["mode"] })}
                                    options={[
                                        { label: "本地/自定义端点", value: "custom_endpoint" },
                                        { label: "画布音频渠道", value: "canvas_channel" },
                                    ]}
                                />
                            </div>
                            {ttsConfig.mode === "custom_endpoint" ? (
                                <>
                                    <Input
                                        size="small"
                                        addonBefore="接口地址"
                                        value={ttsConfig.endpoint}
                                        onChange={(e) => updateTtsConfig({ endpoint: e.target.value })}
                                        placeholder="http://127.0.0.1:9880/tts 或 /v1/audio/speech"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <Input
                                            size="small"
                                            addonBefore="音色 ID"
                                            value={ttsConfig.voice}
                                            onChange={(e) => updateTtsConfig({ voice: e.target.value })}
                                            placeholder="default / alloy"
                                        />
                                        <Input.Password
                                            size="small"
                                            addonBefore="Key"
                                            value={ttsConfig.apiKey || ""}
                                            onChange={(e) => updateTtsConfig({ apiKey: e.target.value })}
                                            placeholder="本地服务可留空"
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-1.5 pt-1">
                                    <Input
                                        size="small"
                                        addonBefore="指定音色"
                                        value={ttsConfig.voice}
                                        onChange={(e) => updateTtsConfig({ voice: e.target.value })}
                                        placeholder="留空则使用画布默认音频音色"
                                    />
                                    <div className="opacity-65">直接复用 HemosiTV 全局设置中已配置的音频生成渠道。</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 第一栏：本地切点抽帧 + 字幕/ASR获取 */}
                <div className="rounded-xl border p-3" style={{ borderColor: theme.toolbar.border }}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                            ① 镜头切点与台词提取（已识别 {cuts.length} 个切点）
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                disabled={transcribing || !videoUrl}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => void handleRunAsr()}
                            >
                                <Mic className="size-3.5" /> {transcribing ? "正在转写…" : "调 ASR 接口转写"}
                            </button>
                            <label className="cursor-pointer rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10">
                                <input
                                    type="file"
                                    accept=".srt,.txt,.vtt"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleImportSrtFile(f);
                                        e.currentTarget.value = "";
                                    }}
                                />
                                <span className="inline-flex items-center gap-1">
                                    <FileText className="size-3.5" /> 导入 .SRT / 文本
                                </span>
                            </label>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={handleLocalInstantAnalyze}
                            >
                                <RefreshCw className="size-3.5" /> 本地规则秒拆（免 API）
                            </button>
                            <button
                                type="button"
                                disabled={analyzing}
                                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium text-amber-500 transition hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => void handleFreeLlmAnalyze()}
                            >
                                <Wand2 className="size-3.5" /> {analyzing ? "正在拆解…" : "AI 语义深拆（复用画布渠道）"}
                            </button>
                        </div>
                    </div>

                    {extracting ? (
                        <div className="flex items-center gap-2 py-4">
                            <Spin size="small" />
                            <span>正在本地做帧差切点检测… {Math.round(extractRatio * 100)}%（零网络上传）</span>
                        </div>
                    ) : (
                        <div className="flex gap-2 overflow-x-auto pb-2">
                            {cuts.map((cut) => (
                                <div
                                    key={cut.index}
                                    className="flex w-32 shrink-0 flex-col overflow-hidden rounded-lg border"
                                    style={{ borderColor: theme.toolbar.border }}
                                >
                                    {cut.frameDataUrl ? (
                                        <img src={cut.frameDataUrl} alt={`镜${cut.index}`} className="h-16 w-full object-cover" />
                                    ) : (
                                        <div className="flex h-16 w-full items-center justify-center opacity-40">
                                            镜头 #{cut.index}
                                        </div>
                                    )}
                                    <div className="px-1.5 py-1 text-[11px] opacity-80">
                                        #{cut.index} · {cut.startSec}s–{cut.endSec}s
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-2 flex items-start gap-2">
                        <Input.TextArea
                            rows={2}
                            value={rawTranscript}
                            onChange={(e) => setRawTranscript(e.target.value)}
                            placeholder="粘贴原视频台词、导入 .SRT 字幕，或点击上方「调 ASR 接口转写」自动提取；随后点击「本地规则秒拆」或「AI 语义深拆」…"
                        />
                        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 pt-1 opacity-80">
                            <input
                                type="checkbox"
                                checked={includeKeyframes}
                                onChange={(e) => setIncludeKeyframes(e.target.checked)}
                            />
                            <span>AI深拆附带关键帧</span>
                        </label>
                    </div>
                </div>

                {/* 第二栏：通用动态变量面板（支持自由增删改 {{变量}}） */}
                {blueprint && (
                    <div className="rounded-xl border p-3" style={{ borderColor: theme.toolbar.border }}>
                        <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold">
                                    ② 参数化变量面板（在下方台词或提示词中使用 <code className="text-amber-500">{"{{变量键}}"}</code> 即可实时联动替换）
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={addVariable}
                                >
                                    <Plus className="size-3.5" /> 新增变量
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={addVariantRow}
                                >
                                    <CopyPlus className="size-3.5" /> 添加批量变体 ({variants.length})
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                            {blueprint.variables.map((v, idx) => (
                                <div key={idx} className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: theme.toolbar.border }}>
                                    <div className="flex items-center gap-1">
                                        <Input
                                            size="small"
                                            value={v.label}
                                            onChange={(e) => updateVariable(idx, { label: e.target.value })}
                                            placeholder="变量名称"
                                        />
                                        <Input
                                            size="small"
                                            value={v.key}
                                            onChange={(e) => updateVariable(idx, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                                            placeholder="key"
                                            className="w-28 font-mono"
                                        />
                                        <button
                                            type="button"
                                            className="rounded p-1 opacity-60 hover:opacity-100"
                                            onClick={() => removeVariable(idx)}
                                            title="删除变量"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                    <Input
                                        size="small"
                                        value={v.value}
                                        onChange={(e) => updateVariable(idx, { value: e.target.value })}
                                        placeholder={`输入 {{${v.key}}} 的替换内容…`}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* 锚点设定快速编辑 + 批量变体矩阵（M5） */}
                        <div className="mt-2.5 grid grid-cols-1 gap-2 border-t pt-2.5 md:grid-cols-3" style={{ borderColor: theme.toolbar.border }}>
                            {blueprint.anchors.map((anchor, aIdx) => (
                                <Input
                                    key={aIdx}
                                    size="small"
                                    addonBefore={anchor.name}
                                    value={anchor.prompt}
                                    onChange={(e) =>
                                        setBlueprint({
                                            ...blueprint,
                                            anchors: blueprint.anchors.map((a, i) => (i === aIdx ? { ...a, prompt: e.target.value } : a)),
                                        })
                                    }
                                />
                            ))}
                        </div>

                        {showVariants && variants.length > 0 && (
                            <div className="mt-2.5 space-y-1.5 border-t pt-2.5" style={{ borderColor: theme.toolbar.border }}>
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold">批量变体矩阵（一次展开多组不同主体/话题的复刻工作组）</span>
                                    <button
                                        type="button"
                                        disabled={expanding}
                                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 font-medium text-amber-500 transition hover:bg-black/5 dark:hover:bg-white/10"
                                        style={{ borderColor: theme.toolbar.border }}
                                        onClick={() => void handleBatchExpandVariants()}
                                    >
                                        <Sparkles className="size-3" /> 批量展开 {variants.length} 组变体到画布
                                    </button>
                                </div>
                                {variants.map((row, rIdx) => (
                                    <div key={row.id} className="flex flex-wrap items-center gap-1.5">
                                        <Input
                                            size="small"
                                            className="w-28"
                                            value={row.name}
                                            onChange={(e) =>
                                                setVariants((prev) => prev.map((item, i) => (i === rIdx ? { ...item, name: e.target.value } : item)))
                                            }
                                        />
                                        {blueprint.variables.map((v) => (
                                            <Input
                                                key={v.key}
                                                size="small"
                                                className="min-w-[160px] flex-1"
                                                addonBefore={v.label}
                                                value={row.values[v.key] ?? ""}
                                                onChange={(e) =>
                                                    setVariants((prev) =>
                                                        prev.map((item, i) =>
                                                            i === rIdx ? { ...item, values: { ...item.values, [v.key]: e.target.value } } : item,
                                                        ),
                                                    )
                                                }
                                            />
                                        ))}
                                        <button
                                            type="button"
                                            className="rounded p-1 opacity-60 hover:opacity-100"
                                            onClick={() => setVariants((prev) => prev.filter((_, i) => i !== rIdx))}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* 第三栏：逐镜语义响应与提示词列表 */}
                {blueprint && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                            <span className="font-semibold">
                                ③ 逐镜复刻脚本（共 {blueprint.beats.length} 镜 · 实时预览变量替换结果）
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={batchTtsLoading}
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={() => void handleBatchTtsAll()}
                                >
                                    <Volume2 className="size-3.5" /> {batchTtsLoading ? "正在批量配音…" : "一键合成全片配音"}
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={handleExportSrt}
                                >
                                    <Download className="size-3.5" /> 导出 .SRT 字幕
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={() => void handleExportZipPackage()}
                                >
                                    <FileArchive className="size-3.5" /> 导出 ZIP 素材包
                                </button>
                            </div>
                        </div>

                        {blueprint.beats.map((beat) => {
                            const resolvedLine = resolveTemplateVariables(beat.newLine, blueprint.variables);
                            const resolvedImg = resolveTemplateVariables(beat.imagePrompt, blueprint.variables);
                            const resolvedVid = resolveTemplateVariables(beat.videoPrompt, blueprint.variables);
                            return (
                                <div
                                    key={beat.id}
                                    className="grid grid-cols-1 gap-2 rounded-xl border p-2.5 md:grid-cols-[128px_1fr]"
                                    style={{ borderColor: theme.toolbar.border }}
                                >
                                    <div className="flex flex-col gap-1">
                                        {beat.keyframeDataUrl ? (
                                            <img
                                                src={beat.keyframeDataUrl}
                                                alt={`镜${beat.shotNumber}`}
                                                className="h-16 w-full rounded object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-16 w-full items-center justify-center rounded border opacity-40" style={{ borderColor: theme.toolbar.border }}>
                                                镜 #{beat.shotNumber}
                                            </div>
                                        )}
                                        <span className="font-semibold">
                                            镜 #{beat.shotNumber} · {beat.role}
                                        </span>
                                        <span className="opacity-60">
                                            {beat.startSec}s–{beat.endSec}s
                                            {beat.ttsDurationSec ? ` (配音: ${beat.ttsDurationSec}s)` : ""}
                                        </span>
                                        <Tooltip title="通过当前配置的 TTS 接口合成该镜语音并测算真实时长">
                                            <button
                                                type="button"
                                                disabled={ttsLoadingShot === beat.shotNumber}
                                                className="inline-flex items-center justify-center gap-1 rounded border py-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                                style={{ borderColor: theme.toolbar.border }}
                                                onClick={() => void handleTtsForBeat(beat.shotNumber)}
                                            >
                                                {beat.ttsAudioUrl ? <Play className="size-3" /> : <Volume2 className="size-3" />}
                                                <span>{ttsLoadingShot === beat.shotNumber ? "合成中…" : "合成配音"}</span>
                                            </button>
                                        </Tooltip>
                                    </div>

                                    <div className="grid grid-cols-1 gap-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="shrink-0 opacity-65">语义响应点：</span>
                                            <Input
                                                size="small"
                                                value={beat.respondsTo}
                                                onChange={(e) => updateBeatField(beat.shotNumber, "respondsTo", e.target.value)}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="shrink-0 opacity-65">换壳新台词：</span>
                                            <Input
                                                size="small"
                                                value={beat.newLine}
                                                onChange={(e) => updateBeatField(beat.shotNumber, "newLine", e.target.value)}
                                            />
                                            <span className="shrink-0 text-[11px] opacity-60">➔ {resolvedLine.slice(0, 24)}</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                                            <Input
                                                size="small"
                                                addonBefore="首帧图词"
                                                value={beat.imagePrompt}
                                                onChange={(e) => updateBeatField(beat.shotNumber, "imagePrompt", e.target.value)}
                                                title={resolvedImg}
                                            />
                                            <Input
                                                size="small"
                                                addonBefore="视频运镜"
                                                value={beat.videoPrompt}
                                                onChange={(e) => updateBeatField(beat.shotNumber, "videoPrompt", e.target.value)}
                                                title={resolvedVid}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 底部操作栏 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 opacity-80">
                        <input
                            type="checkbox"
                            checked={attachKeyframes}
                            onChange={(e) => setAttachKeyframes(e.target.checked)}
                        />
                        <span>展开时把原视频关键帧挂入分镜参考槽</span>
                    </label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="rounded-lg px-3 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={onClose}
                        >
                            关闭
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ borderColor: theme.toolbar.border }}
                            onClick={handleSendToDirectorGroup}
                        >
                            <Clapperboard className="size-3.5" /> 送入「导演组」批量抽卡
                        </button>
                        <button
                            type="button"
                            disabled={expanding}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-semibold text-amber-500 transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ borderColor: theme.toolbar.border }}
                            onClick={() => void handleExpandNodes()}
                        >
                            <Sparkles className="size-3.5" /> {expanding ? "正在展开…" : "一键展开到画布（锚点+分镜）"}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
