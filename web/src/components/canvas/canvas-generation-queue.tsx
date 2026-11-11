import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Empty, Segmented, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { LocateFixed, RotateCcw, SlidersHorizontal, Square } from "lucide-react";

import { useGenerationLogStore, type GenerationRecord } from "@/stores/canvas/use-generation-log-store";
import { HemosiNodeType, type CanvasNodeData } from "@/types/canvas";

export type QueueItem = { key: string; node: CanvasNodeData; kind?: "image" | "video"; state: "queued" | "running" | "error"; error?: string; startedAt?: string; label: string };

function elapsed(from?: string, to?: string) {
    if (!from) return "";
    const seconds = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
    return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

/** Everything running or failed on this canvas, from node state plus the run records (for start times). */
export function collectQueueItems(nodes: CanvasNodeData[], records: GenerationRecord[]): QueueItem[] {
    const running = new Map<string, GenerationRecord>();
    records.forEach((record) => {
        if (record.status !== "running") return;
        [record.nodeId, record.resultNodeId].forEach((id) => id && !running.has(id) && running.set(id, record));
    });
    return nodes.flatMap((node): QueueItem[] => {
        const meta = node.metadata || {};
        const label = node.type === HemosiNodeType.Shot ? `镜头 ${meta.shotNo ?? "?"} · ${node.title}` : node.title;
        if (node.type === HemosiNodeType.Shot) {
            return (["image", "video"] as const).flatMap((kind): QueueItem[] => {
                const status = meta.shotStatus?.[kind];
                const record = records.find((item) => item.nodeId === node.id && item.mode === kind && item.status === "running");
                if (status === "loading") return [{ key: `${node.id}:${kind}`, node, kind, state: "running", startedAt: record?.startedAt, label: `${label}（${kind === "image" ? "图" : "视频"}）` }];
                if (status === "error") return [{ key: `${node.id}:${kind}`, node, kind, state: "error", error: kind === "image" ? meta.shotStatus?.imageError : meta.shotStatus?.videoError, label: `${label}（${kind === "image" ? "图" : "视频"}）` }];
                return [];
            });
        }
        const imageError = meta.images?.find((image) => image.status === "error")?.errorDetails;
        if (meta.status === "loading") return [{ key: node.id, node, state: meta.videoTaskId ? "queued" : "running", startedAt: running.get(node.id)?.startedAt, label }];
        if (meta.status === "error" || imageError) return [{ key: node.id, node, state: "error", error: meta.errorDetails || imageError, label }];
        return [];
    });
}

const STATE_TAG = { queued: { color: "gold", text: "排队/任务已提交" }, running: { color: "processing", text: "生成中" }, error: { color: "error", text: "失败" } } as const;
const RECORD_TAG = { running: { color: "processing", text: "进行中" }, success: { color: "success", text: "成功" }, error: { color: "error", text: "失败" }, canceled: { color: "default", text: "已取消" } } as const;
const MODE_TEXT = { image: "图片", video: "视频", text: "文本", audio: "音频" } as const;

export function CanvasGenerationQueue({
    open,
    projectId,
    nodes,
    onClose,
    onFocus,
    onEdit,
    onRetry,
    onStop,
    onRetryAll,
}: {
    open: boolean;
    projectId: string;
    nodes: CanvasNodeData[];
    onClose: () => void;
    onFocus: (nodeId: string) => void;
    onEdit: (nodeId: string) => void;
    onRetry: (item: QueueItem) => void;
    onStop: (nodeId: string) => void;
    onRetryAll: (items: QueueItem[]) => void;
}) {
    const [tab, setTab] = useState<"queue" | "records">("queue");
    const allRecords = useGenerationLogStore((state) => state.records);
    const records = useMemo(() => allRecords.filter((record) => record.projectId === projectId), [allRecords, projectId]);
    const items = useMemo(() => collectQueueItems(nodes, records), [nodes, records]);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!open || !items.some((item) => item.state !== "error")) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [items, open]);
    const failed = items.filter((item) => item.state === "error");
    const nodeExists = new Set(nodes.map((node) => node.id));

    return (
        <Drawer title="生成队列" open={open} onClose={onClose} mask={false} width={420} styles={{ body: { padding: 12 } }} extra={<Segmented size="small" value={tab} onChange={(value) => setTab(value as "queue" | "records")} options={[{ label: `队列 ${items.length}`, value: "queue" }, { label: `记录 ${records.length}`, value: "records" }]} />}>
            <div data-canvas-shortcuts-ignore className="space-y-2">
                {tab === "queue" ? (
                    <>
                        {failed.length > 1 ? (
                            <Button block size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetryAll(failed)}>
                                全部失败项重跑（{failed.length}）
                            </Button>
                        ) : null}
                        {items.length ? (
                            items.map((item) => (
                                <div key={item.key} className="rounded-lg border p-2.5 text-xs" style={{ borderColor: "rgba(127,127,127,.25)" }}>
                                    <div className="flex items-center gap-2">
                                        <Tag color={STATE_TAG[item.state].color} className="!m-0">{STATE_TAG[item.state].text}</Tag>
                                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                                        {item.state !== "error" ? <span className="shrink-0 opacity-60">{elapsed(item.startedAt)}</span> : null}
                                    </div>
                                    {item.error ? <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-red-500/10 p-1.5 font-mono text-[11px] text-red-400">{item.error}</pre> : null}
                                    <div className="mt-1.5 flex gap-1">
                                        <Button size="small" type="text" icon={<LocateFixed className="size-3.5" />} onClick={() => onFocus(item.node.id)}>定位</Button>
                                        {item.state === "error" ? (
                                            <>
                                                <Tooltip title="打开节点参数，改完点「重跑」，参数保留在节点上">
                                                    <Button size="small" type="text" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => onEdit(item.node.id)}>改参数</Button>
                                                </Tooltip>
                                                <Button size="small" type="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry(item)}>重跑</Button>
                                            </>
                                        ) : (
                                            <Button size="small" type="text" danger icon={<Square className="size-3" />} onClick={() => onStop(item.node.id)}>停止</Button>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有进行中或失败的生成" />
                        )}
                    </>
                ) : records.length ? (
                    records.map((record) => (
                        <button key={record.id} type="button" className="block w-full rounded-lg border p-2.5 text-left text-xs hover:bg-black/5 disabled:cursor-default dark:hover:bg-white/5" style={{ borderColor: "rgba(127,127,127,.25)" }} disabled={!nodeExists.has(record.resultNodeId || record.nodeId)} onClick={() => onFocus(nodeExists.has(record.resultNodeId || "") ? record.resultNodeId! : record.nodeId)}>
                            <div className="flex items-center gap-2">
                                <Tag color={RECORD_TAG[record.status].color} className="!m-0">{RECORD_TAG[record.status].text}</Tag>
                                <span className="min-w-0 flex-1 truncate font-medium">{record.nodeTitle}</span>
                                <span className="shrink-0 opacity-60">{dayjs(record.startedAt).format("MM-DD HH:mm:ss")}</span>
                            </div>
                            <div className="mt-1 opacity-70">
                                {MODE_TEXT[record.mode]} · {record.model} · {record.channel}
                                {record.count > 1 ? ` · ${record.count} 个` : ""}
                                {record.draft ? " · 草稿" : ""}
                                {record.seed ? ` · 种子 ${record.seed}` : ""}
                                {record.finishedAt ? ` · 用时 ${elapsed(record.startedAt, record.finishedAt)}` : ""}
                            </div>
                            <div className="mt-1 line-clamp-2 opacity-50" title={record.prompt}>{record.prompt}</div>
                            {record.error ? <div className="mt-1 break-all font-mono text-[11px] text-red-400">{record.error}</div> : null}
                        </button>
                    ))
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成记录" />
                )}
            </div>
        </Drawer>
    );
}
