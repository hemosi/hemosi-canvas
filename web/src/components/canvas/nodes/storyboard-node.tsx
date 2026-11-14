import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Film, GripVertical, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { App, Modal } from "antd";
import { nanoid } from "nanoid";

import { StoryboardPreviewModal, type PreviewClip } from "@/components/canvas/storyboard-preview-modal";
import { getShotHost } from "@/lib/canvas/canvas-shot-actions";
import { effectiveStoryboardRule } from "@/lib/canvas/storyboard-model-rules";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { canLoadImageNode, collectAutopilotTasks, runStoryboardAutopilot, type AutopilotState } from "@/lib/canvas/storyboard-autopilot";
import { autopilotModeOf, type SettingItem, type SettingKind, type StoryboardAutopilotMode, type StoryboardData, type StoryboardRow } from "@/lib/canvas/storyboard-types";
import {
    createEmptyStoryboardData,
    nextSettingId,
    nextShotCode,
    resolveRowReferenceImageNodeIds,
    rowHealth,
    settingImagesSignature,
    type NodeHealth,
} from "@/lib/canvas/storyboard-utils";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const stop = {
    onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onWheel: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};

const HEALTH_COLOR: Record<NodeHealth, string> = {
    ok: "#34d399",
    stale: "#f59e0b",
    error: "#f87171",
    running: "#38bdf8",
    idle: "#9ca3af",
};

const KIND_BADGE: Record<SettingKind, string> = {
    person: "角色",
    scene: "场景",
    prop: "物品",
};

export function StoryboardContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const data: StoryboardData = ctx.node.metadata?.storyboard || createEmptyStoryboardData();
    const [tplOpen, setTplOpen] = useState(false);
    const [activeTplTab, setActiveTplTab] = useState<"image" | "video" | null>("image");
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [autopilot, setAutopilot] = useState<AutopilotState | null>(null);
    const autopilotAbortRef = useRef<AbortController | null>(null);
    const [editingSetting, setEditingSetting] = useState<SettingItem | null>(null);
    const [atMenu, setAtMenu] = useState<{
        rowId: string;
        field: keyof StoryboardRow;
        query: string;
        pos: { left: number; top: number };
        cursor: number;
    } | null>(null);

    const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const dragIndexRef = useRef<number | null>(null);

    const host = getShotHost();
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((s) => s.openConfigDialog);
    const allNodes = host?.getAllNodes?.() || [];
    const nodeMap = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

    const commit = (nextData: StoryboardData, autoLayout = false) => {
        if (host?.commitStoryboard) {
            host.commitStoryboard(ctx.node.id, nextData, autoLayout);
        } else {
            ctx.updateMetadata({ storyboard: nextData });
        }
    };

    const mode = autopilotModeOf(data);
    const setMode = (next: StoryboardAutopilotMode) => commit({ ...data, autopilotMode: next });
    const totalSec = data.rows.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    const readyVideos = data.rows.filter((r) => rowHealth(r, nodeMap).video === "ok").length;
    const staleCount = data.rows.filter((r) => {
        const health = rowHealth(r, nodeMap);
        return health.image === "stale" || health.video === "stale";
    }).length;
    const failedRows = data.rows.filter((r) => r.runError);

    // A setting image changed (regenerated, replaced): re-hash the rows so first frames/videos using it show 过期.
    const settingSig = settingImagesSignature(data.settings, allNodes);
    const settingSigRef = useRef(settingSig);
    useEffect(() => {
        if (settingSigRef.current === settingSig) return;
        settingSigRef.current = settingSig;
        commit(data, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settingSig]);

    /** 一键出片 for the whole table, or only `rowIds` (只重跑失败的). Order is always 设定图 → 首帧 → 视频. */
    const startAutopilot = (rowIds?: string[]) => {
        if (!host?.runStoryboardBatch) return;
        const pending = collectAutopilotTasks(data, host.getAllNodes?.() || [], rowIds);
        const counts = [
            pending.settingTasks.length ? `设定图 ${pending.settingTasks.length} 张` : "",
            pending.firstFrameTasks.length ? `首帧图 ${pending.firstFrameTasks.length} 张` : "",
            pending.videoTasks.length ? `视频 ${pending.videoTasks.length} 条` : "",
        ].filter(Boolean);
        if (!counts.length) {
            if (rowIds) commit({ ...data, rows: data.rows.map((r) => (rowIds.includes(r.id) ? { ...r, runError: undefined } : r)) });
            message.info("设定图、首帧图和视频都已就绪");
            return;
        }
        const modeLabel = mode === "auto" ? "全自动" : "手动";
        Modal.confirm({
            title: rowIds ? `只重跑失败的 ${rowIds.length} 镜` : "一键出片确认",
            centered: true,
            content: `「${modeLabel}」模式将按顺序生成：${counts.join(" → ")}，共 ${
                pending.settingTasks.length + pending.firstFrameTasks.length + pending.videoTasks.length
            } 项，画幅 ${data.aspectRatio || "按各节点自己的尺寸"}，每项按它的模型生成，会产生费用。每一步完成后才开始下一步；生成视频前会检查首帧图和设定图能否正常加载，不能就重生（最多 ${3} 次），仍失败的镜头跳过视频并标红。${
                mode === "manual" ? "手动模式下每一步开始前还会弹出生成确认卡（含模型与渠道）。" : ""
            }`,
            okText: "开始出片",
            cancelText: "取消",
            onOk: () => {
                const controller = new AbortController();
                autopilotAbortRef.current = controller;
                void runStoryboardAutopilot({
                    data,
                    rowIds,
                    getNode: (id) => (host.getAllNodes?.() || []).find((n) => n.id === id),
                    getNodes: () => host.getAllNodes?.() || [],
                    runBatch: host.runStoryboardBatch!,
                    onProgress: setAutopilot,
                    signal: controller.signal,
                    confirmEachStage: mode === "manual",
                    canLoadImage: canLoadImageNode,
                }).then((res) => {
                    // Mark failed shots red; shots that ran without failing are cleared.
                    if (res.status === "completed") {
                        const latest: StoryboardData = (host.getAllNodes?.() || []).find((n) => n.id === ctx.node.id)?.metadata?.storyboard || data;
                        const ran = new Set(rowIds || latest.rows.map((r) => r.id));
                        const errors = res.rowErrors || {};
                        commit({ ...latest, rows: latest.rows.map((r) => (ran.has(r.id) ? { ...r, runError: errors[r.id] } : r)) });
                    }
                    if (res.failedCodes.length) message.warning(res.stage);
                    else if (res.status === "completed") message.success(res.stage);
                });
            },
        });
    };

    const addRow = () => {
        const code = nextShotCode(data.rows);
        const newRow: StoryboardRow = {
            id: `row-${nanoid(8)}`,
            code,
            duration: 5,
            shotSize: "",
            move: "",
            staticScreen: "",
            action: "",
            line: "",
            sfx: "",
            refs: "",
            note: "",
            imgPrompt: "",
            vidPrompt: "",
            imageNodeId: "",
            videoNodeId: "",
        };
        const next: StoryboardData = { ...data, rows: [...data.rows, newRow] };
        commit(next, true);
        setExpandedRowId(newRow.id);
    };

    const removeRow = (rowId: string) => {
        const next: StoryboardData = { ...data, rows: data.rows.filter((r) => r.id !== rowId) };
        if (expandedRowId === rowId) setExpandedRowId(null);
        commit(next, true);
    };

    const moveRow = (fromIdx: number, toIdx: number) => {
        if (fromIdx === toIdx || toIdx < 0 || toIdx >= data.rows.length) return;
        const rows = [...data.rows];
        const [moved] = rows.splice(fromIdx, 1);
        rows.splice(toIdx, 0, moved);
        commit({ ...data, rows }, true);
    };

    const patchRow = (rowId: string, patch: Partial<StoryboardRow>) => {
        const next: StoryboardData = {
            ...data,
            rows: data.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
        };
        commit(next, false);
    };

    const addSetting = (kind: SettingKind) => {
        const id = nextSettingId(kind, data.settings);
        const item: SettingItem = { id, kind, name: `${KIND_BADGE[kind]} ${id.slice(1)}`, desc: "" };
        commit({ ...data, settings: [...data.settings, item] }, true);
        setEditingSetting(item);
    };

    const saveSetting = () => {
        if (!editingSetting) return;
        const next: StoryboardData = {
            ...data,
            settings: data.settings.map((s) => (s.id === editingSetting.id ? editingSetting : s)),
        };
        commit(next, true);
        setEditingSetting(null);
    };

    const removeSetting = (id: string) => {
        commit({ ...data, settings: data.settings.filter((s) => s.id !== id) }, true);
        setEditingSetting(null);
    };

    const atCandidates = useMemo(() => {
        const imageNodes = allNodes
            .filter((n) => n.type === CanvasNodeType.Image && n.metadata?.refId)
            .map((n) => ({ token: n.metadata!.refId!, label: `${n.metadata!.refId} ${n.title || "图片"}` }));
        const settingTokens = data.settings.map((s) => ({
            token: s.id,
            label: `${s.id} ${s.name}`,
        }));
        const rowTokens = data.rows.map((r) => ({
            token: r.code,
            label: `${r.code} ${r.staticScreen.slice(0, 12)}`,
        }));
        const all = [...settingTokens, ...imageNodes, ...rowTokens];
        if (!atMenu?.query) return all;
        const q = atMenu.query.toLowerCase();
        return all.filter((item) => item.token.toLowerCase().includes(q) || item.label.toLowerCase().includes(q));
    }, [allNodes, atMenu?.query, data.rows, data.settings]);

    const handleCellInput = (
        rowId: string,
        field: keyof StoryboardRow,
        el: HTMLTextAreaElement,
    ) => {
        activeTextareaRef.current = el;
        const cursor = el.selectionStart ?? el.value.length;
        const before = el.value.slice(0, cursor);
        const match = /@([^\s@]*)$/.exec(before);
        if (!match) {
            setAtMenu(null);
            return;
        }
        const rect = el.getBoundingClientRect();
        setAtMenu({
            rowId,
            field,
            query: match[1],
            pos: { left: rect.left, top: rect.bottom + 4 },
            cursor,
        });
    };

    const insertAtToken = (token: string) => {
        if (!atMenu || !activeTextareaRef.current) return;
        const el = activeTextareaRef.current;
        const val = el.value;
        const before = val.slice(0, atMenu.cursor).replace(/@([^\s@]*)$/, `@${token} `);
        const after = val.slice(atMenu.cursor);
        const nextVal = before + after;
        patchRow(atMenu.rowId, { [atMenu.field]: nextVal });
        setAtMenu(null);
    };

    const handleRowHover = (row: StoryboardRow | null) => {
        if (!host?.setStoryboardHover) return;
        if (!row) {
            host.setStoryboardHover([]);
            return;
        }
        const refImgIds = resolveRowReferenceImageNodeIds(row, data.settings, allNodes);
        host.setStoryboardHover([ctx.node.id, ...refImgIds, row.imageNodeId, row.videoNodeId].filter(Boolean));
    };

    const theme = ctx.theme;
    const border = theme.node.stroke;
    const muted = theme.node.muted;

    return (
        <div
            className="flex size-full flex-col overflow-hidden text-xs select-text"
            style={{ color: theme.node.text }}
            onMouseLeave={() => handleRowHover(null)}
        >
            {/* Header */}
            <div
                className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
                style={{ borderColor: border }}
            >
                <div className="flex items-center gap-2">
                    {ctx.node.metadata?.refId ? (
                        <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: theme.toolbar.activeBg }}
                        >
                            {ctx.node.metadata.refId}
                        </span>
                    ) : null}
                    <span className="font-semibold">分镜表</span>
                    <span className="rounded px-1.5 py-0.5 text-[11px] opacity-75" style={{ border: `1px solid ${border}` }}>
                        {data.rows.length} 镜 · {totalSec}s
                    </span>
                    <span className="rounded px-1.5 py-0.5 text-[11px] opacity-75" style={{ border: `1px solid ${border}` }}>
                        已出 {readyVideos}/{data.rows.length}
                    </span>
                    {staleCount > 0 ? (
                        <button
                            type="button"
                            className="rounded px-2 py-0.5 text-[11px] font-medium text-amber-500 transition hover:bg-amber-500/10"
                            style={{ border: `1px solid ${border}` }}
                            onClick={() => {
                                const tasks = data.rows.flatMap((r) => {
                                    const list: Array<{ nodeId: string; kind: "image" | "video"; label: string; prompt: string }> = [];
                                    const health = rowHealth(r, nodeMap);
                                    if (health.image === "stale") {
                                        list.push({ nodeId: r.imageNodeId, kind: "image", label: `${r.code} · 首帧图`, prompt: r.imgPrompt });
                                    }
                                    if (health.video === "stale") {
                                        list.push({ nodeId: r.videoNodeId, kind: "video", label: `${r.code} · 视频`, prompt: r.vidPrompt });
                                    }
                                    return list;
                                });
                                if (tasks.length) void host?.runStoryboardBatch?.(tasks, { title: "重生过期分镜" });
                            }}
                        >
                            重生过期 {staleCount}
                        </button>
                    ) : null}
                    {failedRows.length > 0 && autopilot?.status !== "running" ? (
                        <button
                            type="button"
                            className="rounded px-2 py-0.5 text-[11px] font-medium text-red-500 transition hover:bg-red-500/10"
                            style={{ border: `1px solid ${border}` }}
                            title={failedRows.map((r) => `${r.code}：${r.runError}`).join("\n")}
                            onClick={() => startAutopilot(failedRows.map((r) => r.id))}
                        >
                            只重跑失败的 {failedRows.length}
                        </button>
                    ) : null}
                </div>

                <div className="flex items-center gap-1.5" {...stop}>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => setTplOpen((v) => !v)}
                    >
                        提示词模板 {tplOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={addRow}
                    >
                        <Plus className="size-3" /> 分镜
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        title="整理关联节点位置"
                        onClick={() => commit(data, true)}
                    >
                        <LayoutGrid className="size-3" /> 整理
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => setPreviewOpen(true)}
                    >
                        <Film className="size-3" /> 预览 / 合成
                    </button>
                    <select
                        className="rounded border px-1.5 py-0.5 text-[11px] outline-none"
                        style={{ borderColor: border, background: theme.node.panel, color: theme.node.text }}
                        value={data.aspectRatio || ""}
                        title="本表画幅：首帧图和视频共用；只用于新建的节点，已有节点的尺寸不改"
                        onChange={(e) => commit({ ...data, aspectRatio: e.target.value || undefined })}
                    >
                        <option value="" style={{ background: theme.node.panel, color: theme.node.text }}>
                            画幅未定
                        </option>
                        {["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"].map((ratio) => (
                            <option key={ratio} value={ratio} style={{ background: theme.node.panel, color: theme.node.text }}>
                                {ratio}
                            </option>
                        ))}
                    </select>
                    <select
                        className="rounded border px-1.5 py-0.5 text-[11px] outline-none"
                        style={{ borderColor: border, background: theme.node.panel, color: theme.node.text }}
                        value={mode}
                        title="手动：设定图/首帧/视频每一步开跑前各确认一次；全自动：开始时确认一次，之后连跑"
                        onChange={(e) => setMode(e.target.value as StoryboardAutopilotMode)}
                    >
                        <option value="manual" style={{ background: theme.node.panel, color: theme.node.text }}>
                            手动
                        </option>
                        <option value="auto" style={{ background: theme.node.panel, color: theme.node.text }}>
                            全自动
                        </option>
                    </select>
                    {autopilot?.status === "running" ? (
                        <button
                            type="button"
                            className="rounded bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-red-600"
                            onClick={() => autopilotAbortRef.current?.abort()}
                        >
                            停止 ({autopilot.completed}/{autopilot.total})
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="rounded bg-sky-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-sky-600 disabled:opacity-40"
                            disabled={data.rows.length === 0}
                            onClick={() => startAutopilot()}
                        >
                            一键出片
                        </button>
                    )}
                </div>
            </div>

            {/* Collapsible Model Prompt Template Accordion */}
            {tplOpen ? (
                <div
                    data-canvas-no-zoom
                    className="flex shrink-0 flex-col gap-1.5 border-b px-3 py-2"
                    style={{ borderColor: border, background: theme.node.panel }}
                    {...stop}
                >
                    {(["image", "video"] as const).map((key) => {
                        const eff = effectiveStoryboardRule(key, data, config);
                        return {
                            key,
                            label: key === "image" ? "图片提示词模板" : "视频提示词模板",
                            value: eff.rule,
                            source: eff.source === "table" ? "本表自定义" : `跟随模型设置${eff.modelName ? ` · ${eff.modelName}` : ""}${eff.source === "default" ? "（通用写法）" : ""}`,
                            edited: eff.source === "table",
                            onChange: (v: string) => commit(key === "image" ? { ...data, imageModelRule: v } : { ...data, videoModelRule: v }),
                        };
                    }).map((item) => {
                        const isExpanded = activeTplTab === item.key;
                        return (
                            <div
                                key={item.key}
                                className="rounded-lg border"
                                style={{ borderColor: border }}
                            >
                                <div
                                    className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5"
                                    onClick={() => setActiveTplTab(isExpanded ? null : item.key)}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                        {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                                        <span className="shrink-0 text-[11px] font-medium">{item.label}</span>
                                        <span
                                            className="shrink-0 text-[10px] opacity-60"
                                            title="默认跟随「设置 → 渠道 → 编辑 → 提示词写法」里给这个模型配的写法；在这里改只影响本表"
                                        >
                                            {item.source}
                                        </span>
                                        {!isExpanded ? (
                                            <span className="truncate text-[11px] opacity-60">
                                                {item.value || "点击展开输入提示词模板..."}
                                            </span>
                                        ) : null}
                                    </div>
                                    {isExpanded ? (
                                        <div className="flex shrink-0 items-center gap-1">
                                            {item.edited ? (
                                                <button
                                                    type="button"
                                                    className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        item.onChange("");
                                                    }}
                                                >
                                                    恢复跟随模型
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                                title="在设置里改这个模型的默认写法（所有分镜表共用）"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openConfigDialog(false, "channels");
                                                }}
                                            >
                                                去设置里改
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                                {isExpanded ? (
                                    <div className="border-t px-2.5 py-2" style={{ borderColor: border }}>
                                        <textarea
                                            data-canvas-no-zoom
                                            rows={6}
                                            className="thin-scrollbar w-full resize-y rounded border bg-transparent px-2.5 py-1.5 text-xs leading-5 outline-none"
                                            style={{ borderColor: border, color: theme.node.text }}
                                            placeholder={`填写${item.label}...`}
                                            value={item.value}
                                            onChange={(e) => item.onChange(e.target.value)}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* Settings Bar */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5" style={{ borderColor: border }} {...stop}>
                {data.settings.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ border: `1px solid ${border}` }}
                        title={s.desc || s.name}
                        onClick={() => setEditingSetting(s)}
                    >
                        <span className="font-semibold opacity-70">{s.id}</span>
                        <span>{s.name}</span>
                    </button>
                ))}
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: muted }}
                    onClick={() => addSetting("person")}
                >
                    ＋ 角色
                </button>
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: muted }}
                    onClick={() => addSetting("scene")}
                >
                    ＋ 场景
                </button>
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: muted }}
                    onClick={() => addSetting("prop")}
                >
                    ＋ 物品
                </button>
            </div>

            {/* 10-Column Storyboard Table */}
            <div data-canvas-no-zoom className="thin-scrollbar min-h-0 flex-1 overflow-auto" {...stop}>
                {data.rows.length === 0 ? (
                    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 opacity-60">
                        <span>暂无分镜，点击右上角「＋ 分镜」或通过右侧导演 Agent 生成</span>
                    </div>
                ) : (
                    <table className="w-full border-collapse text-left text-[11px]">
                        <thead className="sticky top-0 z-10" style={{ background: theme.node.fill }}>
                            <tr className="border-b" style={{ borderColor: border, color: muted }}>
                                <th className="w-[74px] px-2 py-1.5 font-medium">镜号</th>
                                <th className="w-[46px] px-1.5 py-1.5 font-medium">时长</th>
                                <th className="w-[56px] px-1.5 py-1.5 font-medium">景别</th>
                                <th className="w-[56px] px-1.5 py-1.5 font-medium">运镜</th>
                                <th className="min-w-[140px] px-1.5 py-1.5 font-medium">画面内容</th>
                                <th className="min-w-[120px] px-1.5 py-1.5 font-medium">人物动作</th>
                                <th className="min-w-[110px] px-1.5 py-1.5 font-medium">台词</th>
                                <th className="w-[84px] px-1.5 py-1.5 font-medium">音效</th>
                                <th className="w-[96px] px-1.5 py-1.5 font-medium">角色 / 场景</th>
                                <th className="w-[86px] px-1.5 py-1.5 font-medium">备注</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map((row, idx) => {
                                const isOpen = expandedRowId === row.id;
                                const { image: imgHealth, video: vidHealth } = rowHealth(row, nodeMap);
                                return (
                                    <>
                                        <tr
                                            key={row.id}
                                            draggable
                                            onDragStart={() => {
                                                dragIndexRef.current = idx;
                                            }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={() => {
                                                if (dragIndexRef.current !== null) {
                                                    moveRow(dragIndexRef.current, idx);
                                                    dragIndexRef.current = null;
                                                }
                                            }}
                                            onMouseEnter={() => handleRowHover(row)}
                                            className="border-b align-top transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                                            style={{ borderColor: border }}
                                        >
                                            <td className="px-2 py-1.5">
                                                <div className="flex items-center gap-1">
                                                    <GripVertical className="size-3 shrink-0 cursor-grab opacity-40" />
                                                    <button
                                                        type="button"
                                                        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
                                                        onClick={() => setExpandedRowId(isOpen ? null : row.id)}
                                                    >
                                                        {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                                        <span className={row.runError ? "text-red-500" : undefined} title={row.runError ? `上次出片失败：${row.runError}` : undefined}>
                                                            {row.code}
                                                        </span>
                                                    </button>
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 pl-4">
                                                    <span
                                                        className="inline-block size-2 rounded-full"
                                                        style={{ background: HEALTH_COLOR[imgHealth] }}
                                                        title={imgHealth === "stale" ? "首帧图已过期（引用的设定图或提示词变了）" : "首帧图状态"}
                                                    />
                                                    <span className="h-[1px] w-2 opacity-40" style={{ background: muted }} />
                                                    <span
                                                        className="inline-block size-2 rounded-full"
                                                        style={{ background: HEALTH_COLOR[vidHealth] }}
                                                        title={vidHealth === "stale" ? "视频已过期（首帧或其设定图变了）" : "视频状态"}
                                                    />
                                                </div>
                                                <div className="mt-1 flex items-center gap-0.5 pl-3 opacity-60">
                                                    <button
                                                        type="button"
                                                        className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                                                        title="上移"
                                                        onClick={() => moveRow(idx, idx - 1)}
                                                    >
                                                        <ArrowUp className="size-2.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                                                        title="下移"
                                                        onClick={() => moveRow(idx, idx + 1)}
                                                    >
                                                        <ArrowDown className="size-2.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="rounded p-0.5 hover:bg-black/5 hover:text-red-500 dark:hover:bg-white/10"
                                                        title="删除"
                                                        onClick={() => removeRow(row.id)}
                                                    >
                                                        <Trash2 className="size-2.5" />
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={60}
                                                    className="w-full rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.duration}
                                                    onChange={(e) => patchRow(row.id, { duration: Math.max(1, Number(e.target.value) || 5) })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={2}
                                                    className="w-full resize-none rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.shotSize}
                                                    onChange={(e) => patchRow(row.id, { shotSize: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={2}
                                                    className="w-full resize-none rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.move}
                                                    onChange={(e) => patchRow(row.id, { move: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.staticScreen}
                                                    onInput={(e) => handleCellInput(row.id, "staticScreen", e.currentTarget)}
                                                    onChange={(e) => patchRow(row.id, { staticScreen: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.action}
                                                    onInput={(e) => handleCellInput(row.id, "action", e.currentTarget)}
                                                    onChange={(e) => patchRow(row.id, { action: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.line}
                                                    onInput={(e) => handleCellInput(row.id, "line", e.currentTarget)}
                                                    onChange={(e) => patchRow(row.id, { line: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.sfx}
                                                    onChange={(e) => patchRow(row.id, { sfx: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.refs}
                                                    onInput={(e) => handleCellInput(row.id, "refs", e.currentTarget)}
                                                    onChange={(e) => patchRow(row.id, { refs: e.target.value })}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <textarea
                                                    rows={3}
                                                    className="w-full resize-y rounded bg-transparent px-1 py-0.5 outline-none focus:ring-1"
                                                    value={row.note}
                                                    onChange={(e) => patchRow(row.id, { note: e.target.value })}
                                                />
                                            </td>
                                        </tr>
                                        {isOpen ? (
                                            <tr key={`${row.id}-fold`} className="border-b" style={{ borderColor: border }}>
                                                <td colSpan={10} className="px-3 py-2">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: border }}>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-medium">图片提示词</span>
                                                                <div className="flex items-center gap-1.5">
                                                                    {nodeMap.get(row.imageNodeId)?.metadata?.manualPrompt ? (
                                                                        <button
                                                                            type="button"
                                                                            className="text-[10px] text-amber-500 hover:underline"
                                                                            onClick={() => {
                                                                                host?.updateMetadata(row.imageNodeId, { manualPrompt: false });
                                                                                commit(data, false);
                                                                            }}
                                                                        >
                                                                            已手改 · 重算
                                                                        </button>
                                                                    ) : null}
                                                                    <button
                                                                        type="button"
                                                                        className="rounded px-2 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                                                                        onClick={() =>
                                                                            void host?.runStoryboardBatch?.(
                                                                                [{ nodeId: row.imageNodeId, kind: "image", label: `${row.code} · 首帧图`, prompt: row.imgPrompt }],
                                                                                { title: `生成 ${row.code} 首帧图` },
                                                                            )
                                                                        }
                                                                    >
                                                                        生成图片
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <textarea
                                                                rows={3}
                                                                className="w-full resize-y rounded border bg-transparent px-2 py-1 font-mono text-[11px] outline-none"
                                                                style={{ borderColor: border }}
                                                                value={row.imgPrompt}
                                                                onInput={(e) => handleCellInput(row.id, "imgPrompt", e.currentTarget)}
                                                                onChange={(e) => patchRow(row.id, { imgPrompt: e.target.value })}
                                                            />
                                                        </div>
                                                        <div className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: border }}>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-medium">视频提示词</span>
                                                                <div className="flex items-center gap-1.5">
                                                                    {nodeMap.get(row.videoNodeId)?.metadata?.manualPrompt ? (
                                                                        <button
                                                                            type="button"
                                                                            className="text-[10px] text-amber-500 hover:underline"
                                                                            onClick={() => {
                                                                                host?.updateMetadata(row.videoNodeId, { manualPrompt: false });
                                                                                commit(data, false);
                                                                            }}
                                                                        >
                                                                            已手改 · 重算
                                                                        </button>
                                                                    ) : null}
                                                                    <button
                                                                        type="button"
                                                                        className="rounded px-2 py-0.5 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                                                                        onClick={() =>
                                                                            void host?.runStoryboardBatch?.(
                                                                                [{ nodeId: row.videoNodeId, kind: "video", label: `${row.code} · 视频`, prompt: row.vidPrompt }],
                                                                                { title: `生成 ${row.code} 视频` },
                                                                            )
                                                                        }
                                                                    >
                                                                        生成视频
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <textarea
                                                                rows={3}
                                                                className="w-full resize-y rounded border bg-transparent px-2 py-1 font-mono text-[11px] outline-none"
                                                                style={{ borderColor: border }}
                                                                value={row.vidPrompt}
                                                                onInput={(e) => handleCellInput(row.id, "vidPrompt", e.currentTarget)}
                                                                onChange={(e) => patchRow(row.id, { vidPrompt: e.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : null}
                                    </>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Timeline Bar */}
            {data.rows.length > 0 ? (
                <div className="flex shrink-0 items-center gap-1 border-t px-3 py-1.5" style={{ borderColor: border }} {...stop}>
                    {data.rows.map((row) => {
                        const vidHealth = rowHealth(row, nodeMap).video;
                        return (
                            <button
                                key={row.id}
                                type="button"
                                className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:opacity-90"
                                style={{
                                    flex: Math.max(1, row.duration || 1),
                                    borderLeft: `3px solid ${HEALTH_COLOR[vidHealth]}`,
                                    background: expandedRowId === row.id ? theme.toolbar.activeBg : "transparent",
                                }}
                                onClick={() => setExpandedRowId(row.id)}
                            >
                                {row.code} · {row.duration}s
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {/* @ Autocomplete Popup */}
            {atMenu && atCandidates.length > 0 ? (
                <div
                    className="fixed z-[200] max-h-44 w-56 overflow-auto rounded-lg border p-1 shadow-lg"
                    style={{
                        left: atMenu.pos.left,
                        top: atMenu.pos.top,
                        background: theme.node.panel,
                        borderColor: border,
                        color: theme.node.text,
                    }}
                    {...stop}
                >
                    {atCandidates.map((item) => (
                        <button
                            key={item.token}
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => insertAtToken(item.token)}
                        >
                            <span className="font-semibold">@{item.token}</span>
                            <span className="truncate opacity-70">{item.label}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {/* Setting Edit Modal */}
            <StoryboardPreviewModal
                open={previewOpen}
                clips={data.rows
                    .map((r): PreviewClip | null => {
                        const vn = nodeMap.get(r.videoNodeId);
                        const url = vn?.metadata?.content;
                        return url ? { code: r.code, duration: r.duration, url } : null;
                    })
                    .filter((c): c is PreviewClip => Boolean(c))}
                onClose={() => setPreviewOpen(false)}
            />
            <Modal
                title={editingSetting ? `设定 @${editingSetting.id}` : ""}
                open={Boolean(editingSetting)}
                centered
                width={420}
                okText="保存"
                cancelText="取消"
                onCancel={() => setEditingSetting(null)}
                onOk={saveSetting}
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
                footer={(_, { OkBtn, CancelBtn }) => (
                    <div className="flex items-center justify-between">
                        {editingSetting ? (
                            <button
                                type="button"
                                className="text-xs text-red-500 hover:underline"
                                onClick={() => removeSetting(editingSetting.id)}
                            >
                                删除设定
                            </button>
                        ) : <span />}
                        <div className="flex gap-2">
                            <CancelBtn />
                            <OkBtn />
                        </div>
                    </div>
                )}
            >
                {editingSetting ? (
                    <div className="flex flex-col gap-3 py-2 text-xs">
                        <div className="flex flex-col gap-1">
                            <span>名称</span>
                            <input
                                className="rounded border bg-transparent px-2 py-1 outline-none"
                                value={editingSetting.name}
                                onChange={(e) => setEditingSetting({ ...editingSetting, name: e.target.value })}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span>描述</span>
                            <textarea
                                rows={3}
                                className="rounded border bg-transparent px-2 py-1 outline-none"
                                placeholder="外观描述，支持 @图n 绑定参考图"
                                value={editingSetting.desc}
                                onChange={(e) => setEditingSetting({ ...editingSetting, desc: e.target.value })}
                            />
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
