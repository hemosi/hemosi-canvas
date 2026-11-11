import { useCallback, useEffect, useRef } from "react";

import type { GenerationConfirmSummary } from "@/components/canvas/canvas-generation-confirm-modal";
import { useGenerationLogStore } from "@/stores/canvas/use-generation-log-store";
import type { CanvasNodeData } from "@/types/canvas";

type Pending = { recordId: string; nodeId?: string; at: number; bound: boolean };

function nodeError(node: CanvasNodeData) {
    return node.metadata?.errorDetails || node.metadata?.images?.find((image) => image.errorDetails)?.errorDetails || node.metadata?.texts?.find((text) => text.errorDetails)?.errorDetails;
}

/**
 * Generation records for the regular (non-shot) generation paths: a record starts when the confirm card is accepted,
 * attaches to the node(s) that go into 生成中 right after, and closes with their final status and verbatim error text.
 */
export function useGenerationTracker(projectId: string, nodes: CanvasNodeData[]) {
    const pending = useRef<Pending[]>([]);
    const bound = useRef(new Map<string, string>());
    const previous = useRef(new Map<string, string | undefined>());

    const track = useCallback(
        (summary: GenerationConfirmSummary, nodeId: string, title: string) => {
            const recordId = useGenerationLogStore.getState().start({ projectId, nodeId, nodeTitle: title, mode: summary.mode, model: summary.model, channel: summary.channel, prompt: summary.prompt, draft: summary.draft, seed: summary.seed, count: summary.count });
            pending.current.push({ recordId, nodeId, at: Date.now(), bound: false });
        },
        [projectId],
    );

    useEffect(() => {
        const now = Date.now();
        const log = useGenerationLogStore.getState();
        const byId = new Map(nodes.map((node) => [node.id, node]));
        nodes.forEach((node) => {
            const status = node.metadata?.status;
            if (status === "loading" && previous.current.get(node.id) !== "loading" && !bound.current.has(node.id)) {
                const recent = pending.current.filter((item) => now - item.at < 5000);
                const match = recent.find((item) => item.nodeId === node.id || item.nodeId === node.metadata?.generationSourceId) || recent[recent.length - 1];
                if (match) {
                    bound.current.set(node.id, match.recordId);
                    match.bound = true;
                    if (match.nodeId !== node.id) log.update(match.recordId, { resultNodeId: node.id });
                }
            }
            previous.current.set(node.id, status);
        });
        const byRecord = new Map<string, string[]>();
        bound.current.forEach((recordId, nodeId) => byRecord.set(recordId, [...(byRecord.get(recordId) || []), nodeId]));
        byRecord.forEach((nodeIds, recordId) => {
            const tracked = nodeIds.map((id) => byId.get(id));
            if (tracked.some((node) => node?.metadata?.status === "loading")) return;
            const present = tracked.filter((node): node is CanvasNodeData => Boolean(node));
            const success = present.some((node) => node.metadata?.status === "success");
            const failed = present.find((node) => node.metadata?.status === "error");
            log.finish(recordId, success ? "success" : failed ? "error" : "canceled", success ? undefined : failed ? nodeError(failed) : undefined);
            nodeIds.forEach((id) => bound.current.delete(id));
        });
        pending.current = pending.current.filter((item) => {
            if (now - item.at < 5000) return true;
            if (!item.bound) log.finish(item.recordId, "canceled", "请求未发出");
            return false;
        });
    }, [nodes]);

    return track;
}
