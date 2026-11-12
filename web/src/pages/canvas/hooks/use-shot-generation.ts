import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext, withCinematography, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { buildGenerationConfirmSummary, type GenerationConfirmSummary } from "@/components/canvas/canvas-generation-confirm-modal";
import { shotGenerationConfig } from "@/components/canvas/nodes/hemosi-nodes";
import { applyDraftConfig } from "@/lib/canvas/canvas-draft";
import { generationReferenceUrls, isGenerationCanceled } from "@/lib/canvas/canvas-generation-helpers";
import { withPreviousVersion } from "@/lib/canvas/canvas-node-versions";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { createVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { uploadImage } from "@/services/image-storage";
import { useGenerationLogStore } from "@/stores/canvas/use-generation-log-store";
import { modelNotReadyReason, type AiConfig } from "@/stores/use-config-store";
import { HemosiNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type Deps = {
    projectId: string;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    requestGenerationConfirm: (summary: GenerationConfirmSummary, origin?: "user" | "agent") => Promise<boolean>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
};

type ShotKind = "image" | "video";

/** What one shot generation sends: prompt (description fallback), own reference slots, its image as first frame for video, plus upstream links (anchors, images…). */
function prepareShotRun(node: CanvasNodeData, kind: ShotKind, nodes: CanvasNodeData[], connections: CanvasConnection[], config: AiConfig) {
    const meta = node.metadata || {};
    const prompt = (
        kind === "image"
            ? meta.shotDescription?.trim() || meta.prompt?.trim() || ""
            : meta.prompt?.trim() || meta.shotDescription?.trim() || ""
    ).trim();
    const localRefs = (meta.shotRefs || []).filter((ref) => ref.enabled && ref.content);
    const extraInputs: NodeGenerationInput[] = [];
    if (kind === "video" && meta.shotImage?.content && !localRefs.some((ref) => ref.role === "firstFrame")) {
        extraInputs.push({ nodeId: `${node.id}~result`, type: "image", title: `镜头${meta.shotNo ?? ""}图片结果`, role: "firstFrame", image: { id: `${node.id}~result`, name: "first-frame.png", type: meta.shotImage.mimeType || "image/png", dataUrl: meta.shotImage.content, storageKey: meta.shotImage.storageKey } });
    }
    localRefs.forEach((ref, index) => extraInputs.push({ nodeId: `${node.id}~${ref.id}`, type: "image", title: `参考${index + 1}`, role: ref.role, image: { id: `${node.id}~${ref.id}`, name: `ref-${index + 1}.png`, type: ref.mimeType || "image/png", dataUrl: ref.content, storageKey: ref.storageKey } }));
    const context = buildNodeGenerationContext(node.id, nodes, connections, prompt, { mode: kind, extraInputs });
    const base = shotGenerationConfig(config, node, kind);
    const draft = Boolean(meta.draft);
    const requestConfig = withCinematography({ ...(draft ? applyDraftConfig(base, kind) : base), count: "1", ...(kind === "video" && context.forceFrames ? { videoMode: "frames" } : {}) }, context);
    return { prompt, context, base, requestConfig, draft };
}

export function useShotGeneration({ projectId, nodesRef, connectionsRef, setNodes, effectiveConfig, isAiConfigReady, openConfigDialog, requestGenerationConfirm, startGenerationRequest, finishGenerationRequest }: Deps) {
    const { message } = App.useApp();

    const patchShot = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData["metadata"]) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: update(node) } : node))), [setNodes]);

    const runShot = useCallback(
        async (nodeId: string, kind: ShotKind, options: { skipConfirm?: boolean; origin?: "user" | "agent" } = {}) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node || node.type !== HemosiNodeType.Shot) return false;
            const { prompt, context, base, requestConfig, draft } = prepareShotRun(node, kind, nodesRef.current, connectionsRef.current, effectiveConfig);
            if (!context.prompt.trim() && !context.referenceImages.length) {
                message.warning(`镜头 ${node.metadata?.shotNo ?? ""} 还没有画面描述或提示词`);
                return false;
            }
            if (!isAiConfigReady(base, base.model)) {
                message.error(`镜头 ${node.metadata?.shotNo ?? ""}：${modelNotReadyReason(base, base.model)}`);
                openConfigDialog(true);
                return false;
            }
            const summary = buildGenerationConfirmSummary(requestConfig, kind, { prompt: context.prompt, images: context.referenceImages, videos: context.referenceVideos, audioCount: context.referenceAudios.length, count: 1, draft });
            if (!options.skipConfirm && !(await requestGenerationConfirm(summary, options.origin))) return false;

            const log = useGenerationLogStore.getState();
            const recordId = log.start({ projectId, nodeId, nodeTitle: `镜头 ${node.metadata?.shotNo ?? ""} ${node.title}`.trim(), mode: kind, model: summary.model, channel: summary.channel, prompt: context.prompt, draft, seed: summary.seed, count: 1 });
            const statusKey = kind === "image" ? "imageError" : "videoError";
            patchShot(nodeId, (item) => ({ ...item.metadata, shotStatus: { ...item.metadata?.shotStatus, [kind]: "loading", [statusKey]: undefined } }));
            const controller = startGenerationRequest(`${nodeId}:${kind}`, nodeId, nodeId);
            try {
                const hydrated = await hydrateNodeGenerationContext(context);
                if (kind === "image") {
                    const image = hydrated.referenceImages.length
                        ? (await requestEdit(requestConfig, hydrated.prompt, hydrated.referenceImages, { signal: controller.signal }))[0]
                        : (await requestGeneration(requestConfig, hydrated.prompt, { signal: controller.signal }))[0];
                    const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === nodeId
                                ? {
                                      ...item,
                                      metadata: withPreviousVersion(item, {
                                          ...item.metadata,
                                          shotImage: { id: recordId, status: "success", content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
                                          shotStatus: { ...item.metadata?.shotStatus, image: "success", imageError: undefined },
                                          draftResult: draft,
                                          generationSourceId: nodeId,
                                          references: generationReferenceUrls(hydrated),
                                      }, "image"),
                                  }
                                : item,
                        ),
                    );
                } else {
                    const task = await createVideoGenerationTask(requestConfig, hydrated.prompt, hydrated.referenceImages, { signal: controller.signal, videos: hydrated.referenceVideos, audios: hydrated.referenceAudios });
                    const video = await storeGeneratedVideo(await waitForVideoGenerationTask(requestConfig, task, { signal: controller.signal }));
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === nodeId
                                ? {
                                      ...item,
                                      metadata: withPreviousVersion(item, {
                                          ...item.metadata,
                                          shotVideo: { content: video.url, storageKey: video.storageKey, mimeType: video.mimeType, naturalWidth: video.width, naturalHeight: video.height, durationMs: video.durationMs, bytes: video.bytes },
                                          shotStatus: { ...item.metadata?.shotStatus, video: "success", videoError: undefined },
                                          draftResult: draft,
                                          generationSourceId: nodeId,
                                      }, "video"),
                                  }
                                : item,
                        ),
                    );
                }
                useGenerationLogStore.getState().finish(recordId, "success");
                return true;
            } catch (error) {
                const canceled = isGenerationCanceled(error);
                const errorText = error instanceof Error ? error.message : String(error);
                useGenerationLogStore.getState().finish(recordId, canceled ? "canceled" : "error", canceled ? undefined : errorText);
                patchShot(nodeId, (item) => ({ ...item.metadata, shotStatus: { ...item.metadata?.shotStatus, [kind]: canceled ? "idle" : "error", [statusKey]: canceled ? undefined : errorText } }));
                if (!canceled) message.error(`镜头 ${node.metadata?.shotNo ?? ""}：${errorText}`);
                return false;
            } finally {
                finishGenerationRequest(`${nodeId}:${kind}`, controller);
            }
        },
        [connectionsRef, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, nodesRef, openConfigDialog, patchShot, projectId, requestGenerationConfirm, setNodes, startGenerationRequest],
    );

    /** A whole row in one go: one confirm card for all of them, then every shot runs; a failure does not stop the rest. */
    const runShots = useCallback(
        async (nodeIds: string[], kind: ShotKind, origin?: "user" | "agent") => {
            const shots = nodeIds.map((id) => nodesRef.current.find((node) => node.id === id)).filter((node): node is CanvasNodeData => node?.type === HemosiNodeType.Shot);
            if (!shots.length) return { ok: 0, failed: 0 };
            const first = shots[0];
            const { context, requestConfig, draft, prompt } = prepareShotRun(first, kind, nodesRef.current, connectionsRef.current, effectiveConfig);
            if (!isAiConfigReady(requestConfig, requestConfig.model)) {
                message.error(modelNotReadyReason(requestConfig, requestConfig.model));
                openConfigDialog(true);
                return { ok: 0, failed: shots.length, canceled: true };
            }
            const others = shots.length > 1 ? `\n\n…另有 ${shots.length - 1} 个镜头，各自使用自己的提示词、参考图与参数（镜头 ${shots.map((shot) => shot.metadata?.shotNo ?? "?").join("、")}）` : "";
            const summary = buildGenerationConfirmSummary(requestConfig, kind, { prompt: `${prompt ? context.prompt : "（首个镜头无提示词）"}${others}`, images: context.referenceImages, videos: context.referenceVideos, audioCount: context.referenceAudios.length, count: shots.length, draft });
            if (!(await requestGenerationConfirm(summary, origin))) return { ok: 0, failed: 0, canceled: true };
            const results = await Promise.all(shots.map((shot) => runShot(shot.id, kind, { skipConfirm: true })));
            const failed = results.filter((ok) => !ok).length;
            if (failed) message.warning(`${shots.length - failed} 个成功，${failed} 个失败；失败原因见生成队列，改参后可一键重跑`);
            else message.success(`${shots.length} 个镜头已生成`);
            return { ok: shots.length - failed, failed };
        },
        [connectionsRef, effectiveConfig, isAiConfigReady, message, nodesRef, openConfigDialog, requestGenerationConfirm, runShot],
    );

    return { runShot, runShots };
}
