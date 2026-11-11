import { ChevronLeft, ChevronRight, Eye, EyeOff, FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { AUDIO_ROLES, AUDIO_ROLE_LABEL, IMAGE_ROLES, IMAGE_ROLE_LABEL, videoFrameSlots, type ReferenceSlot } from "@/lib/canvas/canvas-reference-roles";
import { HemosiNodeType, type CanvasNodeMetadata } from "@/types/canvas";
import { Popover } from "antd";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, onDisconnect, onStartSelection, onUpdateNode, video }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void; onUpdateNode?: (nodeId: string, patch: CanvasNodeMetadata) => void; video?: boolean }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const target = nodes.find((node) => node.id === nodeId);
    const order = target?.metadata?.refOrder || [];
    const disabled = new Set(target?.metadata?.refDisabled || []);
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const references = connectedNodes
        .flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })))
        .map((item, index) => ({ ...item, index }))
        .sort((a, b) => rank(a.node.id) - rank(b.node.id) || a.index - b.index);
    const ids = references.map((item) => item.node.id);
    const move = (id: string, delta: -1 | 1) => {
        const next = [...ids];
        const index = next.indexOf(id);
        const swap = index + delta;
        if (index < 0 || swap < 0 || swap >= next.length) return;
        [next[index], next[swap]] = [next[swap], next[index]];
        onUpdateNode?.(nodeId, { refOrder: next });
    };
    const toggle = (id: string) => onUpdateNode?.(nodeId, { refDisabled: disabled.has(id) ? [...disabled].filter((item) => item !== id) : [...disabled, id] });
    const slots: ReferenceSlot[] = references.map(({ node }) => ({ id: node.id, title: node.title, kind: node.type === CanvasNodeType.Image ? "image" : node.type === HemosiNodeType.Anchor ? "anchor" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "text", role: node.metadata?.imageRole, enabled: !disabled.has(node.id) }));
    const frames = video ? videoFrameSlots(slots) : null;
    const slotLabel = (id: string) => (frames?.first?.id === id ? "首帧" : frames?.last?.id === id ? "尾帧" : undefined);
    let imageIndex = 0;
    return (
        <div className="mb-2">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium" style={{ color: theme.node.muted }}>
                <span>{t("canvas.references.title")}</span>
                {video && frames ? <span>首帧：{frames.first?.title || "—"}　尾帧：{frames.last?.title || "—"}{frames.references.length ? `　参考图 ${frames.references.length} 张` : ""}</span> : null}
            </div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }, index) => {
                    const enabled = !disabled.has(node.id);
                    const isImage = node.type === CanvasNodeType.Image;
                    const number = isImage && enabled ? ++imageIndex : 0;
                    return (
                        <div key={`${sourceNodeId}:${node.id}`} className="flex shrink-0 flex-col items-center gap-0.5" style={{ opacity: enabled ? 1 : 0.4 }}>
                            <ReferenceItem node={node} badge={slotLabel(node.id) || (number ? `图${number}` : undefined)} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />
                            {onUpdateNode ? (
                                <div className="flex items-center gap-0.5">
                                    <button type="button" className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" disabled={index === 0} title="前移" onClick={() => move(node.id, -1)}><ChevronLeft className="size-3" /></button>
                                    <button type="button" className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" title={enabled ? "本次不用这张" : "启用"} onClick={() => toggle(node.id)}>{enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</button>
                                    <button type="button" className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" disabled={index === references.length - 1} title="后移" onClick={() => move(node.id, 1)}><ChevronRight className="size-3" /></button>
                                </div>
                            ) : null}
                            {onUpdateNode && isImage ? (
                                <select className="max-w-[64px] rounded bg-transparent text-[10px] outline-none" style={{ color: theme.node.text }} value={node.metadata?.imageRole || "reference"} title="身份标记" onChange={(event) => onUpdateNode(node.id, { imageRole: event.target.value as never })}>
                                    {IMAGE_ROLES.map((role) => <option key={role} value={role} style={{ background: theme.toolbar.panel }}>{IMAGE_ROLE_LABEL[role]}</option>)}
                                </select>
                            ) : null}
                            {onUpdateNode && node.type === CanvasNodeType.Audio ? (
                                <select className="max-w-[64px] rounded bg-transparent text-[10px] outline-none" style={{ color: theme.node.text }} value={node.metadata?.audioRole || ""} title="音频类型" onChange={(event) => onUpdateNode(node.id, { audioRole: (event.target.value || undefined) as never })}>
                                    <option value="" style={{ background: theme.toolbar.panel }}>未标记</option>
                                    {AUDIO_ROLES.map((role) => <option key={role} value={role} style={{ background: theme.toolbar.panel }}>{AUDIO_ROLE_LABEL[role]}</option>)}
                                </select>
                            ) : null}
                        </div>
                    );
                })}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title={t("canvas.references.select")} onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
        </div>
    );
}

function ReferenceItem({ node, badge, onRemove }: { node: CanvasNodeData; badge?: string; onRemove: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : node.type === HemosiNodeType.Anchor && node.metadata?.anchorImages?.[0]?.content ? <img src={node.metadata.anchorImages[0].content} alt="" className="size-full object-cover" /> : <Icon className="size-4 opacity-65" />}
                </span>
                {badge ? <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr-md rounded-bl-xl px-1 text-[9px] font-semibold" style={{ background: "rgba(10,12,14,.72)", color: "#fff" }}>{badge}</span> : null}
                <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
