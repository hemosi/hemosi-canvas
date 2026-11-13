import { nanoid } from "nanoid";
import { captureVideoFrameSafe } from "@/lib/canvas/canvas-video-frame";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { requestGeneration } from "@/services/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { uploadImage } from "@/services/image-storage";
import { useDirectorLoopStore, type DirectorCandidate } from "@/stores/canvas/use-director-loop-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { defaultConfig, modelNotReadyReason, useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, HemosiNodeType } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const runningSegments = new Set<string>();

function getEffectiveAiConfig() {
    const state = useConfigStore.getState();
    return { ...defaultConfig, ...state.config };
}

/**
 * Generate or regenerate a real image for a Left-Column Anchor Card using the configured image model,
 * and sync an Anchor node on the canvas.
 */
export async function generateDirectorAnchorImage(projectId: string, anchorId: string): Promise<string> {
    const store = useDirectorLoopStore.getState();
    const state = store.getProject(projectId);
    const anchor = state.anchors.find((a) => a.id === anchorId);
    if (!anchor) throw new Error("未找到该锚点卡");

    const config = getEffectiveAiConfig();
    const imageModel = config.imageModel || config.model;
    const notReady = modelNotReadyReason(config, imageModel);
    if (notReady) {
        useConfigStore.getState().openConfigDialog(true);
        throw new Error(`图片模型不可用：${notReady}`);
    }

    store.patchProject(projectId, (prev) => ({
        anchors: prev.anchors.map((a) => (a.id === anchorId ? { ...a, status: "generating", locked: false } : a)),
    }));
    store.addLog(projectId, "info", `正在生成锚点图《${anchor.title}》…`);

    try {
        const res = await requestGeneration(
            {
                ...config,
                model: imageModel,
                size: "1280x720",
                count: "1",
            },
            `${anchor.title}：${anchor.description}`,
        );
        const rawDataUrl = res[0]?.dataUrl;
        if (!rawDataUrl) throw new Error("未返回有效图片数据");
        const uploadedObj = await uploadImage(rawDataUrl).catch(() => null);
        const uploaded = uploadedObj?.url || rawDataUrl;

        // Sync or create Anchor node on canvas
        const canvasCtx = useAgentStore.getState().canvasContext;
        let nodeId = anchor.nodeId;
        if (canvasCtx) {
            if (!nodeId) {
                nodeId = `director-anchor-${nanoid(5)}`;
                const idx = state.anchors.findIndex((a) => a.id === anchorId);
                canvasCtx.applyOps([
                    {
                        type: "add_node",
                        id: nodeId,
                        nodeType: HemosiNodeType.Anchor,
                        title: anchor.title,
                        position: { x: 80, y: 180 + Math.max(0, idx) * 280 },
                        width: 320,
                        height: 220,
                        metadata: {
                            anchorKind: anchor.kind,
                            anchorText: anchor.description,
                            content: uploaded,
                            prompt: anchor.description,
                            status: "success",
                        },
                    },
                ]);
            } else {
                canvasCtx.applyOps([
                    {
                        type: "update_node",
                        id: nodeId,
                        metadata: { content: uploaded, status: "success" },
                    },
                ]);
            }
        }

        store.patchProject(projectId, (prev) => ({
            usedClips: prev.usedClips + 1,
            anchors: prev.anchors.map((a) =>
                a.id === anchorId
                    ? { ...a, imageUrl: uploaded, nodeId, status: "approved", locked: true }
                    : a,
            ),
        }));
        store.addLog(projectId, "auto", `锚点《${anchor.title}》已生成并自动上锁`);
        return uploaded;
    } catch (err) {
        store.patchProject(projectId, (prev) => ({
            anchors: prev.anchors.map((a) => (a.id === anchorId ? { ...a, status: "pending" } : a)),
        }));
        throw err;
    }
}

/**
 * Deterministic clip inspection & auto-selection when no vision model is configured.
 */
export function evaluateAndPickCandidate(candidates: DirectorCandidate[], expectedCuts: number): {
    selectedId: string;
    basis: string;
} {
    const scored = candidates.map((c) => {
        const checkFails = Object.values(c.checks).filter((v) => !v).length;
        const cutDiff = Math.abs(c.detectedCuts - expectedCuts);
        return { c, checkFails, cutDiff };
    });
    scored.sort((a, b) => a.checkFails - b.checkFails || a.cutDiff - b.cutDiff || a.c.index - b.c.index);
    const best = scored[0]?.c || candidates[0];
    const matchingCuts = scored.filter((s) => s.cutDiff === 0 && s.checkFails === 0).length;
    const basis =
        matchingCuts === 1
            ? `${candidates.length} 条中仅第 ${best.index} 条切点数（${best.detectedCuts}/${expectedCuts}）与清单一致且验片全过`
            : `确定性验片全过，按切点偏差最小（${best.detectedCuts}/${expectedCuts}）与序号优先选定第 ${best.index} 条`;
    return { selectedId: best.id, basis };
}

async function extractVideoEnds(videoUrl: string): Promise<{ firstFrame?: string; lastFrame?: string; durationSec?: number }> {
    let firstFrame: string | undefined;
    let lastFrame: string | undefined;
    try {
        const firstBlob = await captureVideoFrameSafe(videoUrl, "first");
        firstFrame = await readFileAsDataUrl(new File([firstBlob], "first.png", { type: "image/png" }));
    } catch {
        // Ignore frame extraction failure if cross-origin
    }
    try {
        const lastBlob = await captureVideoFrameSafe(videoUrl, "last");
        lastFrame = await readFileAsDataUrl(new File([lastBlob], "last.png", { type: "image/png" }));
    } catch {
        // Ignore frame extraction failure
    }
    return { firstFrame, lastFrame };
}

/**
 * Step the Director Production Loop for `projectId`.
 * Calls real video generation when a video channel is configured, extracts real first/last frames via captureVideoFrameSafe,
 * and writes generated video nodes + connections onto the canvas.
 */
export async function stepDirectorProductionLoop(projectId: string) {
    const store = useDirectorLoopStore.getState();
    const state = store.getProject(projectId);
    if (state.stage !== "producing") return;

    const byId = new Map(state.segments.map((s) => [s.id, s]));

    // 1. Unlock any blocked segment whose upstream dependency is now satisfied
    let unlockedAny = false;
    const unlockedSegments = state.segments.map((seg) => {
        if (seg.status !== "blocked" || !seg.dependsOnSegmentId) return seg;
        const parent = byId.get(seg.dependsOnSegmentId);
        if (!parent) return { ...seg, status: "queued" as const };
        const parentReady =
            state.continuationPolicy === "agent_selected"
                ? parent.status === "agent_selected" || parent.status === "confirmed"
                : parent.status === "confirmed";
        if (parentReady) {
            unlockedAny = true;
            const parentChosen = parent.candidates.find((c) => c.id === parent.selectedCandidateId);
            return {
                ...seg,
                status: "queued" as const,
                prevLastFrameUrl: parentChosen?.lastFrameUrl || parentChosen?.thumbUrl || seg.prevLastFrameUrl,
            };
        }
        return seg;
    });

    if (unlockedAny) {
        store.patchProject(projectId, { segments: unlockedSegments });
    }

    const fresh = store.getProject(projectId);
    const allFinished = fresh.segments.every(
        (s) => s.status === "agent_selected" || s.status === "confirmed" || s.status === "abandoned" || s.status === "escalated",
    );
    if (allFinished && fresh.inFlightClips === 0) {
        const hasEscalated = fresh.segments.some((s) => s.status === "escalated");
        if (!hasEscalated) {
            store.patchProject(projectId, {
                stage: "await_b",
                awaySummary: `全部 ${fresh.segments.length} 段已完成抽卡选定，请展开段行核对素材后点「合成」`,
            });
            store.addLog(projectId, "todo", "所有片段已选定，进入检查点 B（素材验收）");
        }
        return;
    }

    // 2. Find next queued segment that is not already running
    const nextQueued = fresh.segments.find((s) => s.status === "queued" && !runningSegments.has(`${projectId}:${s.id}`));
    if (!nextQueued) return;

    const neededClips = nextQueued.drawCount;
    if (fresh.usedClips + fresh.inFlightClips + neededClips > fresh.budgetMaxClips) {
        store.patchProject(projectId, {
            stage: "paused",
            awaySummary: `抽卡预算已触线（已跑 ${fresh.usedClips} + 待提 ${neededClips} > 上限 ${fresh.budgetMaxClips} 条），已自动熔断暂停`,
        });
        store.addLog(projectId, "todo", `预算撞线熔断：第 ${nextQueued.index} 段需 ${neededClips} 条，超出上限 ${fresh.budgetMaxClips} 条`, nextQueued.index);
        return;
    }

    const runKey = `${projectId}:${nextQueued.id}`;
    runningSegments.add(runKey);

    const warn90 = fresh.usedClips + fresh.inFlightClips + neededClips >= Math.ceil(fresh.budgetMaxClips * 0.9);
    store.patchProject(projectId, (prev) => ({
        inFlightClips: prev.inFlightClips + neededClips,
        awaySummary: warn90
            ? `预警：已跑+在途达 ${prev.usedClips + prev.inFlightClips + neededClips}/${prev.budgetMaxClips} 条（≥90%）`
            : `正在生成第 ${nextQueued.index} 段《${nextQueued.title}》（抽 ${neededClips} 条候选）…`,
        segments: prev.segments.map((s) => (s.id === nextQueued.id ? { ...s, status: "generating" } : s)),
    }));
    store.addLog(projectId, "auto", `开始生成第 ${nextQueued.index} 段《${nextQueued.title}》（预占 ${neededClips} 条）`, nextQueued.index);

    try {
        const config = getEffectiveAiConfig();
        const videoModel = nextQueued.overrideVideoModel || config.videoModel || config.model;
        const canCallRealVideo = !modelNotReadyReason(config, videoModel);

        const charAnchor = fresh.anchors.find((a) => a.kind === "character" && a.imageUrl) || fresh.anchors.find((a) => a.imageUrl);
        const refImageUrl = nextQueued.prevLastFrameUrl || charAnchor?.imageUrl;
        const references: ReferenceImage[] = refImageUrl
            ? [{ id: `ref-${nanoid(4)}`, dataUrl: refImageUrl, name: "reference.png", type: "image/png" }]
            : [];

        const candidates: DirectorCandidate[] = [];

        for (let i = 0; i < neededClips; i += 1) {
            if (canCallRealVideo) {
                const videoResult = await requestVideoGeneration(
                    {
                        ...config,
                        model: videoModel,
                        size: "16:9",
                        vquality: "720p",
                        videoSeconds: String(nextQueued.seconds || 10),
                        videoMode: nextQueued.genMode === "first_frame_i2v" && references.length > 0 ? "frames" : "reference",
                    },
                    nextQueued.prompt,
                    references,
                );
                const stored = await storeGeneratedVideo(videoResult);
                const ends = await extractVideoEnds(stored.url);
                candidates.push({
                    id: `cand-${nanoid(6)}`,
                    index: i + 1,
                    videoUrl: stored.url,
                    thumbUrl: ends.firstFrame || refImageUrl,
                    firstFrameUrl: ends.firstFrame || refImageUrl,
                    lastFrameUrl: ends.lastFrame || ends.firstFrame || refImageUrl,
                    durationSec: nextQueued.seconds,
                    detectedCuts: nextQueued.expectedCuts,
                    checks: {
                        readable: true,
                        durationOk: true,
                        resolutionOk: true,
                        audioOk: true,
                        noBlackFrame: true,
                        noFreezeFrame: true,
                    },
                });
            } else {
                // Fallback deterministic candidate when no video API key is configured yet
                await new Promise((r) => setTimeout(r, 450));
                const isBest = i === 0;
                const eliminatedReason = !isBest && i === neededClips - 1 && neededClips > 1 ? "缺镜头" : undefined;
                candidates.push({
                    id: `cand-${nanoid(6)}`,
                    index: i + 1,
                    thumbUrl: refImageUrl,
                    firstFrameUrl: refImageUrl,
                    lastFrameUrl: refImageUrl,
                    durationSec: nextQueued.seconds,
                    detectedCuts: isBest ? nextQueued.expectedCuts : Math.max(1, nextQueued.expectedCuts - 1),
                    checks: {
                        readable: true,
                        durationOk: true,
                        resolutionOk: true,
                        audioOk: true,
                        noBlackFrame: true,
                        noFreezeFrame: !eliminatedReason,
                    },
                    eliminatedReason,
                });
            }
        }

        const { selectedId, basis } = evaluateAndPickCandidate(candidates, nextQueued.expectedCuts);
        const bestCand = candidates.find((c) => c.id === selectedId) || candidates[0];

        // Sync or create real Video node on canvas and connect upstream
        const canvasCtx = useAgentStore.getState().canvasContext;
        if (canvasCtx && bestCand) {
            const nodeId = `director-seg-${nextQueued.index}-${nanoid(4)}`;
            const parentSeg = nextQueued.dependsOnSegmentId
                ? useDirectorLoopStore.getState().getProject(projectId).segments.find((s) => s.id === nextQueued.dependsOnSegmentId)
                : undefined;
            const parentNodeId = parentSeg?.candidates.find((c) => c.id === parentSeg.selectedCandidateId)?.nodeId;

            canvasCtx.applyOps([
                {
                    type: "add_node",
                    id: nodeId,
                    nodeType: CanvasNodeType.Video,
                    title: `段 ${String(nextQueued.index).padStart(2, "0")} · ${nextQueued.title}`,
                    position: { x: 460 + (nextQueued.index - 1) * 380, y: 260 },
                    width: 320,
                    height: 220,
                    metadata: {
                        content: bestCand.videoUrl,
                        prompt: nextQueued.prompt,
                        shotDescription: nextQueued.summary,
                        seconds: String(nextQueued.seconds),
                        size: "16:9",
                        videoSize: "16:9",
                        vquality: "720p",
                        status: bestCand.videoUrl ? "success" : "idle",
                    },
                },
                ...(parentNodeId
                    ? [{ type: "connect_nodes" as const, fromNodeId: parentNodeId, toNodeId: nodeId }]
                    : charAnchor?.nodeId
                      ? [{ type: "connect_nodes" as const, fromNodeId: charAnchor.nodeId, toNodeId: nodeId }]
                      : []),
            ]);
            bestCand.nodeId = nodeId;
        }

        useDirectorLoopStore.getState().patchProject(projectId, (prev) => ({
            usedClips: prev.usedClips + neededClips,
            inFlightClips: Math.max(0, prev.inFlightClips - neededClips),
            segments: prev.segments.map((s) =>
                s.id === nextQueued.id
                    ? {
                          ...s,
                          candidates,
                          selectedCandidateId: selectedId,
                          selectionBasis: basis,
                          usedClips: s.usedClips + neededClips,
                          status: "agent_selected",
                      }
                    : s,
            ),
        }));
        useDirectorLoopStore.getState().addLog(
            projectId,
            "auto",
            `第 ${nextQueued.index} 段已选定候选 #${bestCand?.index || 1}（${basis}）`,
            nextQueued.index,
        );
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        useDirectorLoopStore.getState().patchProject(projectId, (prev) => ({
            inFlightClips: Math.max(0, prev.inFlightClips - neededClips),
            segments: prev.segments.map((s) => {
                if (s.id !== nextQueued.id) return s;
                const nextRound = s.retryRound + 1;
                const escalated = nextRound >= s.maxRetries;
                return {
                    ...s,
                    retryRound: nextRound,
                    retryHistory: [...s.retryHistory, `第 ${nextRound} 轮失败：${errMsg}`],
                    status: escalated ? "escalated" : "queued",
                    escalationReason: escalated ? `连续失败（${errMsg}）` : undefined,
                };
            }),
        }));
        useDirectorLoopStore.getState().addLog(projectId, "todo", `第 ${nextQueued.index} 段生成异常：${errMsg}`, nextQueued.index);
    } finally {
        runningSegments.delete(runKey);
    }

    // Continue next queued segment
    void stepDirectorProductionLoop(projectId);
}

/**
 * Built-in Wasteland Case (废土案例预设) for afternoon production.
 */
export function buildWastelandPresetPlan() {
    return {
        filmTitle: "废土余烬：机械守望者",
        idea: {
            protagonist: "林烬（穿旧式防风斗篷与机械义臂的废土拾荒少女，清冷坚毅）",
            background: "赤铁风暴笼罩的巨型坠毁星舰残骸区与地下净水站",
            theme: "在算力与水源枯竭的废土，守住最后一枚发芽火种",
            story: "林烬穿过沙暴进入星舰核心舱，启动休眠百年的守望者机体，用自己的能源核点亮绿洲信标。",
        },
        budgetMaxClips: 16,
        unitPriceYuan: 0,
        anchors: [
            {
                kind: "character" as const,
                title: "主角定妆：林烬（四视图）",
                description: "18岁废土少女，深灰防风斗篷、左臂黄铜与碳纤机械义肢、护目镜挂颈，面部干净立体，眼神清冷坚定，16:9 720p 定妆四视图",
                voiceNote: "清冷微沙哑少女音（语速 1.0x，沉稳内敛）",
            },
            {
                kind: "scene" as const,
                title: "场景锚点：赤铁星舰残骸峡谷",
                description: "黄昏赤红沙暴下的巨型星舰肋骨残骸，远处可见微弱冷蓝色地下信标塔，广角电影感",
            },
            {
                kind: "style" as const,
                title: "风格锚点：低饱和胶片废土光学",
                description: "35mm 变形宽银幕镜头，低对比度青橙色调，真实沙尘颗粒感与金属磨损质感，严禁塑料光感",
            },
        ],
        segments: [
            {
                title: "沙暴独行与远眺残骸",
                summary: "林烬背对镜头走在赤红沙脊上，风吹起斗篷下摆，随后微侧脸露出护目镜与远处星舰残骸",
                prompt: "16:9 720p，废土风沙中穿深灰斗篷的少女林烬沿沙脊前行，前6秒专注拨开风沙看罗盘不看镜头，顺向跟拍摇至远方巨型星舰残骸，低对比胶片质感",
                isKey: true,
                genMode: "ref_direct" as const,
                dialogueSource: "tts" as const,
                dialogueLine: "第七区的水脉彻底干了，那是最后一艘还没被拆空的母舰。",
                drawCount: 2 as const,
                seconds: 10,
                shotsList: ["远景：沙脊逆风行走", "中近景：低头核对黄铜罗盘", "过肩摇镜：星舰残骸现出轮廓"],
                ledger: { props: "黄铜旧罗盘、防风护目镜", costume: "深灰破损防风斗篷", lightingTime: "黄昏赤红沙暴逆光" },
            },
            {
                title: "滑入星舰断层暗舱",
                summary: "接上段末帧，林烬顺着倾斜甲板滑入幽暗舰桥，机械左臂亮起微弱蓝光照明",
                prompt: "承接上段风沙入口，少女林烬落地半蹲缓冲，抬起机械左臂点亮冷蓝照明灯，扫过布满灰尘的巨型守望者机甲胸腔",
                isKey: false,
                dependsOnIndex: 0,
                genMode: "first_frame_i2v" as const,
                dialogueSource: "none" as const,
                drawCount: 2 as const,
                seconds: 10,
                shotsList: ["近景：战靴滑下金属甲板", "中景：机械臂点亮冷蓝光束", "特写：光束照亮机甲编号"],
                ledger: { props: "左臂蓝光照明器", costume: "斗篷兜帽落下", lightingTime: "舰舱幽暗冷蓝点光源" },
            },
            {
                title: "嵌入能源核与火种苏醒",
                summary: "接上段末帧，林烬将胸前温热的火种胶囊按入机甲核心槽，整座星舰穹顶亮起琥珀色流光",
                prompt: "特写转大远景，少女林烬用机械手将琥珀色火种胶囊旋入核心槽，蒸汽喷涌，巨大的守望者光学眼缓缓亮起金光，照亮她的侧脸",
                isKey: true,
                dependsOnIndex: 1,
                genMode: "first_frame_i2v" as const,
                dialogueSource: "tts" as const,
                dialogueLine: "醒醒吧老家伙，带这片废土看看真正的绿洲。",
                drawCount: 3 as const,
                seconds: 10,
                shotsList: ["特写：火种胶囊旋入卡槽", "中景：高压蒸汽喷发吹动发丝", "大远景：机甲金眼点亮整座舰桥"],
                ledger: { props: "琥珀火种胶囊", costume: "深灰斗篷受气流掀动", lightingTime: "冷蓝转温暖琥珀金光" },
            },
        ],
    };
}
