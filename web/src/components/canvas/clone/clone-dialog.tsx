import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Select, Table } from "antd";
import { strToU8, zipSync } from "fflate";
import { Download, Loader2, Plus, Scissors, Trash2, Wand2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { describeBeats, detectCuts, extractWav, summarizeBlueprint } from "@/lib/canvas/clone/analyze";
import { BEAT_ROLES, attachTranscript, blueprintFromCuts, expandBlueprint, scriptText, toCsv, toSrt, variableNames, type CloneBeat, type CloneBlueprint } from "@/lib/canvas/clone/blueprint";
import { requestTranscription } from "@/services/api/transcribe";
import { loadBlueprint, saveBlueprint, useCloneStore } from "@/stores/canvas/use-clone-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { modelNotReadyReason, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

const { TextArea } = Input;

/**
 * 爆款复刻：选一个视频节点 → 本地拆解成蓝图（切镜头必做，转写和看画面可选，都走本机 OpenAI 兼容服务）→ 改蓝图、写 {{变量}} → 按变体展开到画布 / 导出素材包。
 */
export function CloneDialog() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const target = useCloneStore((state) => state.target);
    const close = useCloneStore((state) => state.close);
    const openTarget = useCloneStore((state) => state.open);
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvas = useAgentStore((state) => state.canvasContext);
    const [blueprint, setBlueprint] = useState<CloneBlueprint | null>(null);
    const [asrModel, setAsrModel] = useState(() => localStorage.getItem("hemosi:clone-asr") || "");
    const [visionModel, setVisionModel] = useState(() => localStorage.getItem("hemosi:clone-vision") || "");
    const [useAsr, setUseAsr] = useState(() => localStorage.getItem("hemosi:clone-use-asr") === "1");
    const [useVision, setUseVision] = useState(() => localStorage.getItem("hemosi:clone-use-vision") === "1");
    const [progress, setProgress] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const videos = (canvas?.snapshot.nodes || []).filter((node) => node.type === CanvasNodeType.Video && node.metadata?.content);
    const source = videos.find((node) => node.id === target?.nodeId);

    useEffect(() => {
        setBlueprint(null);
        if (target) void loadBlueprint(target.projectId, target.nodeId).then((saved) => setBlueprint(saved || null));
    }, [target]);

    const update = (next: CloneBlueprint) => {
        setBlueprint(next);
        if (target) void saveBlueprint(target.projectId, next);
    };
    const patchBeat = (id: string, patch: Partial<CloneBeat>) => blueprint && update({ ...blueprint, beats: blueprint.beats.map((beat) => (beat.id === id ? { ...beat, ...patch } : beat)) });
    const remember = (key: string, value: string) => localStorage.setItem(key, value);

    const analyze = async () => {
        if (!target || !source?.metadata?.content) return;
        const url = source.metadata.content;
        for (const [on, model, label] of [[useAsr, asrModel, "转写模型"], [useVision, visionModel, "看画面模型"]] as const) {
            const reason = on ? modelNotReadyReason(config, model) : "";
            if (reason) {
                message.error(`${label}不可用：${reason}`);
                return openConfigDialog(true);
            }
        }
        const controller = new AbortController();
        abortRef.current = controller;
        let current: CloneBlueprint | null = null;
        try {
            setProgress("切镜头 0%");
            const { cuts, duration } = await detectCuts(url, (ratio) => setProgress(`切镜头 ${Math.round(ratio * 100)}%`));
            if (controller.signal.aborted) return;
            current = blueprintFromCuts(source.id, source.title, cuts, duration);
            update(current);
            if (useAsr) {
                setProgress("抽音轨…");
                const wav = await extractWav(url);
                setProgress("语音转写…");
                const segments = await requestTranscription(config, asrModel, wav, controller.signal);
                current = { ...current, beats: attachTranscript(current.beats, segments), analyzedWith: { ...current.analyzedWith, asr: asrModel } };
                update(current);
            }
            if (useVision) {
                const beats = [...current.beats];
                await describeBeats(
                    config,
                    visionModel,
                    beats,
                    (index, patch) => {
                        beats[index] = { ...beats[index], ...patch };
                        current = { ...current!, beats: [...beats] };
                        update(current);
                        setProgress(`看画面 ${index + 1}/${beats.length}`);
                    },
                    controller.signal,
                );
                setProgress("总结钩子和风格…");
                const summary = await summarizeBlueprint(config, visionModel, beats, controller.signal);
                current = { ...current!, ...summary, analyzedWith: { ...current!.analyzedWith, vision: visionModel } };
                update(current);
            }
            message.success(`拆解完成：${current.beats.length} 个镜头`);
        } catch (error) {
            if (!controller.signal.aborted) Modal.error({ title: current ? "拆解中断（已完成的步骤保留在下方）" : "拆解失败", content: error instanceof Error ? error.message : String(error) });
        } finally {
            setProgress("");
            abortRef.current = null;
        }
    };

    const names = blueprint ? variableNames(blueprint) : [];
    const variants = blueprint?.variants.length ? blueprint.variants : [{}];

    const expand = () => {
        const ctx = useAgentStore.getState().canvasContext;
        if (!blueprint || !ctx) return;
        let snapshot = ctx.snapshot;
        variants.forEach((values, index) => {
            snapshot = ctx.applyOps(expandBlueprint(blueprint, values, snapshot, variants.length > 1 ? `变体 ${index + 1}` : "复刻"));
        });
        message.success(`已展开 ${variants.length} 组到画布`);
        close();
    };

    const exportPack = () => {
        if (!blueprint) return;
        const files: Record<string, Uint8Array> = { "blueprint.json": strToU8(JSON.stringify({ ...blueprint, beats: blueprint.beats.map(({ thumb: _thumb, ...beat }) => beat) }, null, 2)) };
        variants.forEach((values, index) => {
            const dir = variants.length > 1 ? `变体${index + 1}/` : "";
            files[`${dir}captions.srt`] = strToU8(toSrt(blueprint, values));
            files[`${dir}shots.csv`] = strToU8(toCsv(blueprint, values));
            files[`${dir}script.txt`] = strToU8(scriptText(blueprint, values));
        });
        files["README.txt"] = strToU8(
            [`源视频：${blueprint.sourceTitle}（${blueprint.duration.toFixed(1)} 秒，${blueprint.beats.length} 个镜头）`, `转写模型：${blueprint.analyzedWith.asr || "未用"}；看画面模型：${blueprint.analyzedWith.vision || "未用"}`, "captions.srt 是草稿：新台词按字数均分在原镜头时长里，不是精确对时，导入剪映后自己微调。", ...variants.map((values, index) => `变体 ${index + 1}：${names.map((name) => `${name}=${values[name] || "（未填）"}`).join("，") || "无变量"}`)].join("\n"),
        );
        const blob = new Blob([zipSync(files)], { type: "application/zip" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `复刻素材包-${blueprint.sourceTitle || "视频"}.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };

    const cellArea = (beat: CloneBeat, field: "line" | "visual" | "image" | "video", placeholder: string) => <TextArea autoSize={{ minRows: 2, maxRows: 6 }} variant="borderless" className="!px-0 !text-xs" value={beat[field]} placeholder={placeholder} onChange={(event) => patchBeat(beat.id, { [field]: event.target.value })} />;

    return (
        <Modal open={Boolean(target)} onCancel={() => (progress ? abortRef.current?.abort() : close())} title="爆款复刻" width={1180} footer={null} destroyOnHidden>
            <div className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="opacity-60">源视频</span>
                    <Select size="small" className="min-w-[220px]" value={source?.id} placeholder={videos.length ? "选一个视频节点" : "画布上还没有视频节点"} options={videos.map((node) => ({ value: node.id, label: node.title }))} onChange={(nodeId) => target && openTarget(target.projectId, nodeId)} />
                </div>

                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <Checkbox checked disabled>
                        切镜头
                    </Checkbox>
                    <span style={{ color: theme.node.muted }}>浏览器内逐帧比对，不联网，必做。</span>
                    <Checkbox checked={useAsr} onChange={(event) => (setUseAsr(event.target.checked), remember("hemosi:clone-use-asr", event.target.checked ? "1" : "0"))}>
                        语音转写
                    </Checkbox>
                    <div className="flex items-center gap-2">
                        <ModelPicker config={config} value={asrModel} capability="audio" onChange={(value) => (setAsrModel(value), remember("hemosi:clone-asr", value))} onMissingConfig={() => openConfigDialog(true)} className="w-64" placeholder="转写模型（如本机 whisper）" />
                        <span style={{ color: theme.node.muted }}>OpenAI 兼容 /v1/audio/transcriptions，本机服务不用填 Key</span>
                    </div>
                    <Checkbox checked={useVision} onChange={(event) => (setUseVision(event.target.checked), remember("hemosi:clone-use-vision", event.target.checked ? "1" : "0"))}>
                        看画面
                    </Checkbox>
                    <div className="flex items-center gap-2">
                        <ModelPicker config={config} value={visionModel} capability="text" onChange={(value) => (setVisionModel(value), remember("hemosi:clone-vision", value))} onMissingConfig={() => openConfigDialog(true)} className="w-64" placeholder="能看图的模型（如 Ollama qwen2.5vl）" />
                        <span style={{ color: theme.node.muted }}>每个镜头送 1 张中间帧，一次一个；先转写后看图，8G 显卡可中途换服务</span>
                    </div>
                    <div />
                    <div className="flex items-center gap-2">
                        {progress ? (
                            <>
                                <Loader2 className="size-3.5 animate-spin" />
                                <span>{progress}</span>
                                <Button size="small" onClick={() => abortRef.current?.abort()}>
                                    取消
                                </Button>
                            </>
                        ) : (
                            <Button size="small" type="primary" icon={<Scissors className="size-3.5" />} disabled={!source} onClick={() => void analyze()}>
                                {blueprint ? "重新拆解（会覆盖下面的蓝图）" : "开始拆解"}
                            </Button>
                        )}
                    </div>
                </div>

                {blueprint ? (
                    <>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <label className="flex flex-col gap-1">
                                <span className="opacity-60">钩子（开头怎么抓人）</span>
                                <Input size="small" value={blueprint.hook} onChange={(event) => update({ ...blueprint, hook: event.target.value })} />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="opacity-60">风格（展开时接在每条提示词后面）</span>
                                <Input size="small" value={blueprint.style} onChange={(event) => update({ ...blueprint, style: event.target.value })} />
                            </label>
                        </div>
                        <Table
                            size="small"
                            rowKey="id"
                            pagination={false}
                            scroll={{ y: 360 }}
                            dataSource={blueprint.beats}
                            columns={[
                                { title: "#", width: 40, render: (_, __, index) => index + 1 },
                                { title: "画面", width: 110, render: (_, beat) => (beat.thumb ? <img src={beat.thumb} alt="" className="w-24 rounded" /> : null) },
                                { title: "时间", width: 90, render: (_, beat) => <span className="text-xs tabular-nums">{beat.start.toFixed(1)}–{beat.end.toFixed(1)}s</span> },
                                { title: "作用", width: 100, render: (_, beat) => <Select size="small" variant="borderless" value={beat.role} options={BEAT_ROLES.map((role) => ({ value: role, label: role }))} onChange={(role) => patchBeat(beat.id, { role })} /> },
                                { title: "台词", render: (_, beat) => cellArea(beat, "line", "台词，可写 {{主角}}") },
                                { title: "画面描述", render: (_, beat) => cellArea(beat, "visual", "画面里有什么") },
                                { title: "图片提示词", render: (_, beat) => cellArea(beat, "image", "空着就用画面描述") },
                                { title: "视频提示词", render: (_, beat) => cellArea(beat, "video", "动作 + 运镜") },
                                { title: "", width: 40, render: (_, beat) => <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => update({ ...blueprint, beats: blueprint.beats.filter((item) => item.id !== beat.id) })} /> },
                            ]}
                        />

                        <div className="rounded-xl border p-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="font-medium">变体（{variants.length}）{names.length ? `：变量 ${names.map((name) => `{{${name}}}`).join(" ")}` : "：在上面任意格子写 {{名字}} 就会多出一列"}</span>
                                <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => update({ ...blueprint, variants: [...variants, {}] })}>
                                    加一行变体
                                </Button>
                            </div>
                            {variants.map((values, index) => (
                                <div key={index} className="mb-1.5 flex items-center gap-2">
                                    <span className="w-12 shrink-0 opacity-60">变体 {index + 1}</span>
                                    {names.map((name) => (
                                        <Input key={name} size="small" className="max-w-[200px]" placeholder={name} value={values[name] || ""} onChange={(event) => update({ ...blueprint, variants: variants.map((item, i) => (i === index ? { ...item, [name]: event.target.value } : item)) })} />
                                    ))}
                                    {variants.length > 1 ? <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => update({ ...blueprint, variants: variants.filter((_, i) => i !== index) })} /> : null}
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button icon={<Download className="size-4" />} onClick={exportPack}>
                                导出素材包
                            </Button>
                            <Button type="primary" icon={<Wand2 className="size-4" />} disabled={!blueprint.beats.length || Boolean(progress)} onClick={expand}>
                                展开到画布（{variants.length} 组）
                            </Button>
                        </div>
                    </>
                ) : null}
            </div>
        </Modal>
    );
}
