import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented } from "antd";
import dayjs from "dayjs";

import { snapshotResult } from "@/lib/canvas/canvas-node-versions";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, HemosiNodeType, type CanvasNodeData, type CanvasNodeVersion } from "@/types/canvas";

type Entry = { id: string; label: string; version: CanvasNodeVersion | { kind: "text"; content: string; createdAt: string; id: string }; current: boolean };

function Media({ entry }: { entry: Entry }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const version = entry.version;
    if (version.kind === "text") return <div className="thin-scrollbar h-72 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>{version.content || "（空）"}</div>;
    if (version.kind === "video") return <video src={version.content} controls className="h-72 w-full rounded-lg bg-black object-contain" />;
    if (version.kind === "audio") return <audio src={version.content} controls className="w-full" />;
    return <img src={version.content} alt="" className="h-72 w-full rounded-lg object-contain" style={{ background: theme.canvas.background }} />;
}

/** Earlier results of a node side by side with the current one; restore any of them (the replaced one is kept). */
export function CanvasNodeVersionsModal({ node, onClose, onRestore, onDelete, onRestoreText }: { node: CanvasNodeData | null; onClose: () => void; onRestore: (nodeId: string, versionId: string) => void; onDelete: (nodeId: string, versionId: string) => void; onRestoreText: (nodeId: string, versionId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isText = node?.type === CanvasNodeType.Text;
    const [shotKind, setShotKind] = useState<"image" | "video">("image");
    const entries = useMemo<Entry[]>(() => {
        if (!node) return [];
        if (isText) {
            const history = (node.metadata?.textVersions || []).map((version, index) => ({ id: version.id, label: `第 ${index + 1} 版 · ${dayjs(version.createdAt).format("MM-DD HH:mm")}`, version: { ...version, kind: "text" as const }, current: false }));
            return [{ id: "current", label: "当前", version: { id: "current", kind: "text" as const, content: node.metadata?.content || "", createdAt: "" }, current: true }, ...history.reverse()];
        }
        const isShot = node.type === HemosiNodeType.Shot;
        const kind = isShot ? shotKind : undefined;
        const current = snapshotResult(node, kind);
        const versions = (node.metadata?.versions || []).filter((version) => !isShot || version.kind === shotKind);
        return [
            ...(current ? [{ id: "current", label: "当前", version: current, current: true }] : []),
            ...versions.map((version, index) => ({ id: version.id, label: `第 ${index + 1} 版 · ${dayjs(version.createdAt).format("MM-DD HH:mm")}${version.draft ? " · 草稿" : ""}`, version, current: false })).reverse(),
        ];
    }, [isText, node, shotKind]);
    const [leftId, setLeftId] = useState("current");
    const [rightId, setRightId] = useState("");
    useEffect(() => {
        setLeftId(entries[0]?.id || "");
        setRightId(entries[1]?.id || "");
    }, [node?.id, entries.length, shotKind]); // eslint-disable-line react-hooks/exhaustive-deps
    const left = entries.find((entry) => entry.id === leftId);
    const right = entries.find((entry) => entry.id === rightId);

    const side = (entry: Entry | undefined, setId: (id: string) => void, value: string) => (
        <div className="min-w-0 flex-1 space-y-2">
            <select className="w-full rounded-md border bg-transparent px-2 py-1 text-xs outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={value} onChange={(event) => setId(event.target.value)}>
                {entries.map((item) => (
                    <option key={item.id} value={item.id} style={{ background: theme.toolbar.panel }}>
                        {item.label}
                    </option>
                ))}
            </select>
            {entry ? <Media entry={entry} /> : <div className="grid h-72 place-items-center text-xs opacity-50">无</div>}
            {entry && !entry.current ? (
                <div className="flex gap-2">
                    <Button size="small" type="primary" onClick={() => (isText ? onRestoreText(node!.id, entry.id) : onRestore(node!.id, entry.id))}>
                        {isText ? "回退到这一版" : "还原为当前"}
                    </Button>
                    {!isText ? (
                        <Button size="small" danger onClick={() => onDelete(node!.id, entry.id)}>
                            删除此版
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {entry && "prompt" in entry.version && entry.version.prompt ? <div className="line-clamp-3 text-[11px] opacity-60" title={entry.version.prompt}>{entry.version.model ? `${entry.version.model} · ` : ""}{entry.version.prompt}</div> : null}
        </div>
    );

    return (
        <Modal title={`版本对比 · ${node?.title || ""}`} open={Boolean(node)} centered width={900} footer={null} onCancel={onClose} destroyOnHidden>
            {node?.type === HemosiNodeType.Shot ? <Segmented className="mb-3" size="small" value={shotKind} onChange={(value) => setShotKind(value as "image" | "video")} options={[{ label: "图片结果", value: "image" }, { label: "视频结果", value: "video" }]} /> : null}
            {entries.length < 2 ? <div className="py-10 text-center text-sm opacity-60">还没有可对比的历史版本（每次重新生成，旧结果都会留在这里）</div> : <div className="flex gap-4">{side(left, setLeftId, leftId)}{side(right, setRightId, rightId)}</div>}
        </Modal>
    );
}
