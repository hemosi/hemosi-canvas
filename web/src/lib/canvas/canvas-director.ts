import { nanoid } from "nanoid";

import { CAMERA_ANGLES, CAMERA_BODIES, CAMERA_LENSES, CAMERA_MOVES, LIGHT_MOODS, SHOT_SIZES, hasCamera } from "@/lib/canvas/canvas-cinematography";
import { buildShotRow, nextShotNo } from "@/lib/canvas/canvas-shot-actions";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, HemosiNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { CameraSettings, LightingSettings } from "@/types/cinematography";

/**
 * The in-canvas director Agent: one instruction → a plan (script, shots, per-shot image/video tasks, edits, batch
 * changes) from the user's own LLM key, then canvas ops. Scope caps how far it goes; spending steps never run
 * without the generation confirm card.
 */

export const DIRECTOR_SCOPES = [
    { value: "analyze", label: "只分析" },
    { value: "script", label: "先写脚本" },
    { value: "shots", label: "先建分镜" },
    { value: "tasks", label: "建图片/视频任务" },
    { value: "run", label: "全流程并执行" },
] as const;
export type DirectorScope = (typeof DIRECTOR_SCOPES)[number]["value"];
const SCOPE_LEVEL: Record<DirectorScope, number> = { analyze: 0, script: 1, shots: 2, tasks: 3, run: 4 };
export const scopeAllows = (scope: DirectorScope, step: DirectorScope) => SCOPE_LEVEL[scope] >= SCOPE_LEVEL[step];

export type DirectorShot = { description: string; prompt?: string; camera?: CameraSettings; seconds?: number; characters?: string[] };
export type DirectorEdit = { nodeId: string; title?: string; prompt?: string; shotDescription?: string; content?: string; camera?: CameraSettings; lighting?: LightingSettings; size?: string; seconds?: string };
export type DirectorBatch = { match: { type?: string; ids?: string[]; size?: string; model?: string; titleIncludes?: string }; patch: Omit<DirectorEdit, "nodeId">; run?: "image" | "video" };
export type DirectorPlan = {
    analysis?: string;
    script?: string;
    sceneTitle?: string;
    characters?: Array<{ name: string; description: string }>;
    sceneLighting?: LightingSettings;
    shots?: DirectorShot[];
    edits?: DirectorEdit[];
    batch?: DirectorBatch[];
    /** Which generations to start when scope is "run". */
    run?: "none" | "images" | "videos" | "both";
};

export type DirectorExecution = {
    ops: CanvasAgentOp[];
    shotIds: string[];
    runImages: string[];
    runVideos: string[];
    /** Non-shot nodes a batch asked to regenerate (run through the normal per-node path). */
    runNodes: Array<{ nodeId: string; mode: "image" | "video" }>;
    steps: string[];
};

const vocab = (list: Array<{ value: string; label: string }>) => list.map((item) => `${item.value}(${item.label})`).join(", ");

export function directorSystemPrompt() {
    return `你是 AI 影视无限画布里的执行导演 Agent。用户给你一句话指令和当前画布（JSON）。你只输出一个 JSON 对象（不要 markdown 代码块、不要解释），字段：
{
  "analysis": "对画布/需求的简短分析与执行思路（中文，<=200字）",
  "script": "需要写脚本时给出完整分场脚本（中文），不需要则省略",
  "sceneTitle": "这一场/这一组分镜的名字",
  "characters": [{"name":"角色名","description":"外形、服装、年龄等固定设定，用于全片一致"}],
  "sceneLighting": {"mood": "${LIGHT_MOODS.map((item) => item.value).join("|")}", "brightness": -100~100, "colorTemp": 2000~10000, "key": {"enabled": true, "direction": "front|left|right|top|bottom|back|back-left|back-right", "intensity": 0~100, "quality": "soft|hard"}, "rim": {"enabled": true, "intensity": 0~100}},
  "shots": [{"description": "画面描述（中文，一句话说清谁在哪做什么）", "prompt": "给图像/视频模型的完整提示词（英文或中文，具体到主体、动作、环境、风格）", "seconds": 4~15, "characters": ["出现的角色名"], "camera": {"body": "...", "lens": "...", "focalLength": 毫米数, "aperture": f值, "shotSize": "...", "angle": "...", "movement": "...", "movementSpeed": "slow|medium|fast"}}],
  "edits": [{"nodeId": "画布里已有节点的 id", "title": "...", "prompt": "...", "shotDescription": "...", "content": "文本节点新内容", "camera": {...}, "size": "16:9", "seconds": "8"}],
  "batch": [{"match": {"type": "image|video|shot|text", "ids": ["可选"], "size": "可选，按现有比例筛选", "model": "可选", "titleIncludes": "可选"}, "patch": {同 edits 的可改字段}, "run": "image|video（可选，改完要重新生成时）"}],
  "run": "none|images|videos|both"
}
camera 取值只能用：body=${vocab(CAMERA_BODIES)}；lens=${vocab(CAMERA_LENSES)}；shotSize=${vocab(SHOT_SIZES)}；angle=${vocab(CAMERA_ANGLES)}；movement=${vocab(CAMERA_MOVES)}。
规则：分镜数量与剧本镜头一一对应；不需要的字段省略；改已有内容用 edits（nodeId 必须是画布里存在的）；对一批同规格素材统一改用 batch；不要编造画布里不存在的 id。`;
}

/** Compact canvas for the LLM: enough to edit existing content without sending images. */
export function canvasDigest(snapshot: CanvasAgentSnapshot, onlySelected: boolean) {
    const selected = new Set(snapshot.selectedNodeIds);
    const nodes = snapshot.nodes.filter((node) => !onlySelected || selected.has(node.id) || (node.metadata?.groupId && selected.has(node.metadata.groupId)));
    const ids = new Set(nodes.map((node) => node.id));
    return {
        title: snapshot.title,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: nodes.map((node) => {
            const meta = node.metadata || {};
            return compact({
                id: node.id,
                type: node.type,
                title: node.title,
                groupId: meta.groupId,
                shotNo: meta.shotNo,
                description: meta.shotDescription,
                prompt: clip(meta.prompt, 400),
                content: clip(meta.content, 1200),
                anchorKind: meta.anchorKind,
                anchorText: clip(meta.anchorText, 300),
                model: meta.model,
                videoModel: meta.videoModel,
                size: meta.size,
                seconds: meta.seconds,
                camera: meta.camera,
                lighting: meta.lighting,
                hasImage: Boolean(meta.content && node.type === CanvasNodeType.Image) || Boolean(meta.shotImage?.content) || undefined,
                hasVideo: Boolean(meta.content && node.type === CanvasNodeType.Video) || Boolean(meta.shotVideo?.content) || undefined,
                status: meta.status,
                shotStatus: meta.shotStatus,
            });
        }),
        connections: snapshot.connections.filter((item) => ids.has(item.fromNodeId) && ids.has(item.toNodeId)).map((item) => ({ from: item.fromNodeId, to: item.toNodeId, kind: item.kind })),
    };
}

export function directorUserPrompt(instruction: string, scope: DirectorScope, snapshot: CanvasAgentSnapshot, onlySelected: boolean) {
    const scopeNote: Record<DirectorScope, string> = {
        analyze: "本次只分析：只填 analysis，不要 script/shots/edits/batch。",
        script: "本次只写脚本：填 analysis 和 script（必要时 characters），不要拆分镜。",
        shots: "本次写脚本并拆分镜：填 script、shots（含 camera），可以有 edits/batch；run=none。",
        tasks: "本次写脚本、拆分镜，并为每个分镜写好可直接生成的图片/视频提示词与摄像机参数；run=none。",
        run: "本次全流程：脚本、分镜、提示词、摄像机参数都要给，并在 run 里说明要生成 images/videos/both。",
    };
    return `指令：${instruction}\n\n${scopeNote[scope]}\n\n当前画布${onlySelected ? "（只含用户选中的节点）" : ""}：\n${JSON.stringify(canvasDigest(snapshot, onlySelected))}`;
}

/** Pull the JSON object out of an LLM reply (tolerates code fences and text around it). */
export function parseDirectorPlan(text: string): DirectorPlan {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced || text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Agent 没有返回可解析的方案（缺少 JSON），请重试或换一个文本模型");
    try {
        return JSON.parse(source.slice(start, end + 1)) as DirectorPlan;
    } catch (error) {
        throw new Error(`Agent 返回的方案 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

const pick = <T extends string>(list: Array<{ value: string }>, value: unknown) => (typeof value === "string" && list.some((item) => item.value === value) ? (value as T) : undefined);

/** Keep only camera values the canvas knows, so the request really carries what the card shows. */
export function sanitizeCamera(camera?: CameraSettings | null): CameraSettings | undefined {
    if (!camera) return undefined;
    const next: CameraSettings = compact({
        body: pick(CAMERA_BODIES, camera.body),
        lens: pick(CAMERA_LENSES, camera.lens),
        focalLength: Number(camera.focalLength) > 0 ? Math.round(Number(camera.focalLength)) : undefined,
        aperture: Number(camera.aperture) > 0 ? Number(camera.aperture) : undefined,
        shotSize: pick(SHOT_SIZES, camera.shotSize),
        angle: pick(CAMERA_ANGLES, camera.angle),
        movement: pick(CAMERA_MOVES, camera.movement),
        movementSpeed: camera.movementSpeed === "slow" || camera.movementSpeed === "medium" || camera.movementSpeed === "fast" ? camera.movementSpeed : undefined,
    });
    return hasCamera(next) ? next : undefined;
}

function editPatch(edit: Omit<DirectorEdit, "nodeId">, node: CanvasNodeData): CanvasNodeMetadata {
    return compact({
        prompt: edit.prompt,
        shotDescription: node.type === HemosiNodeType.Shot ? edit.shotDescription : undefined,
        content: node.type === CanvasNodeType.Text ? edit.content : undefined,
        camera: edit.camera ? sanitizeCamera(edit.camera) : undefined,
        lighting: edit.lighting,
        size: edit.size,
        seconds: edit.seconds,
    });
}

export function matchBatch(nodes: CanvasNodeData[], match: DirectorBatch["match"]) {
    return nodes.filter(
        (node) =>
            node.type !== CanvasNodeType.Group &&
            (!match.ids?.length || match.ids.includes(node.id)) &&
            (!match.type || node.type === match.type) &&
            (!match.size || node.metadata?.size === match.size || node.metadata?.videoSize === match.size) &&
            (!match.model || (node.metadata?.model || "").includes(match.model) || (node.metadata?.videoModel || "").includes(match.model)) &&
            (!match.titleIncludes || node.title.includes(match.titleIncludes)),
    );
}

/**
 * Turn a plan into canvas ops, capped by scope. New content lands to the right of what is already there.
 * `models` are the image/video models the user picked in the panel for new shot tasks.
 */
export function planToExecution(plan: DirectorPlan, snapshot: CanvasAgentSnapshot, scope: DirectorScope, models: { image?: string; video?: string; seconds?: string; size?: string } = {}): DirectorExecution {
    const ops: CanvasAgentOp[] = [];
    const steps: string[] = [];
    const runImages: string[] = [];
    const runVideos: string[] = [];
    const runNodes: DirectorExecution["runNodes"] = [];
    let shotIds: string[] = [];
    if (scope === "analyze") return { ops, shotIds, runImages, runVideos, runNodes, steps: ["只分析，不改画布"] };

    const right = snapshot.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 0);
    const top = snapshot.nodes.length ? Math.min(...snapshot.nodes.map((node) => node.position.y)) : 0;
    const origin = { x: snapshot.nodes.length ? right + 160 : 0, y: top };

    if (plan.script?.trim()) {
        ops.push({ type: "add_node", id: `director-script-${nanoid(6)}`, nodeType: CanvasNodeType.Text, title: `${plan.sceneTitle || "剧本"}`, position: origin, width: 420, height: 520, metadata: { content: plan.script.trim(), prompt: plan.script.trim(), fontSize: 14, status: "success" } });
        steps.push(`写脚本（${plan.script.trim().length} 字）`);
    }

    const shots = (plan.shots || []).filter((shot) => shot?.description?.trim());
    if (scopeAllows(scope, "shots") && shots.length) {
        const rowOrigin = { x: origin.x + (plan.script?.trim() ? 520 : 0), y: origin.y };
        const row = buildShotRow(shots.map((shot) => shot.description.trim()), rowOrigin, nextShotNo(snapshot.nodes), plan.sceneTitle || "Agent 分镜");
        const [group, ...shotNodes] = row;
        const withTasks = scopeAllows(scope, "tasks");
        ops.push({ type: "add_node", id: group.id, nodeType: group.type, title: group.title, position: group.position, width: group.width, height: group.height, metadata: { ...group.metadata, ...(plan.sceneLighting ? { lighting: plan.sceneLighting } : {}) } });
        shotNodes.forEach((node, index) => {
            const shot = shots[index];
            const camera = sanitizeCamera(shot.camera);
            const metadata: CanvasNodeMetadata = { ...node.metadata, ...(camera ? { camera } : {}), ...(shot.prompt?.trim() ? { prompt: shot.prompt.trim() } : {}) };
            if (withTasks) Object.assign(metadata, compact({ model: models.image, videoModel: models.video, seconds: shot.seconds ? String(shot.seconds) : models.seconds, size: models.size, videoSize: models.size }));
            ops.push({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata });
        });
        shotIds = shotNodes.map((node) => node.id);
        steps.push(`拆 ${shotNodes.length} 个分镜（镜头 ${shotNodes[0].metadata?.shotNo}–${shotNodes[shotNodes.length - 1].metadata?.shotNo}）${plan.sceneLighting ? "，整组共用一套灯光" : ""}`);
        if (withTasks) steps.push(`为每个分镜建图片任务${models.image ? `（${models.image.split("::").pop()}）` : ""}和视频任务${models.video ? `（${models.video.split("::").pop()}）` : ""}`);

        // Character anchors: one per character, linked to the shots they appear in, so looks stay consistent.
        (plan.characters || []).filter((item) => item?.name && item.description).forEach((character, index) => {
            const anchorId = `director-anchor-${nanoid(6)}`;
            ops.push({ type: "add_node", id: anchorId, nodeType: HemosiNodeType.Anchor, title: character.name, position: { x: rowOrigin.x + index * 340, y: group.position.y + group.height + 80 }, metadata: { anchorKind: "character", anchorText: `${character.name}：${character.description}`, anchorImages: [], status: "idle" } });
            shotNodes.forEach((node, shotIndex) => {
                const appears = shots[shotIndex].characters;
                if (!appears?.length || appears.includes(character.name)) ops.push({ type: "connect_nodes", fromNodeId: anchorId, toNodeId: node.id });
            });
        });
        if (plan.characters?.length) steps.push(`建 ${plan.characters.length} 个角色锚点并连到出场分镜`);

        if (scope === "run") {
            if (plan.run === "images" || plan.run === "both" || !plan.run) runImages.push(...shotIds);
            if (plan.run === "videos" || plan.run === "both") runVideos.push(...shotIds);
        }
    }

    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const edits = (plan.edits || []).filter((edit) => edit?.nodeId && byId.has(edit.nodeId));
    edits.forEach((edit) => {
        const node = byId.get(edit.nodeId)!;
        ops.push({ type: "update_node", id: node.id, ...(edit.title ? { patch: { title: edit.title } } : {}), metadata: editPatch(edit, node) });
    });
    if (edits.length) steps.push(`修改已有节点 ${edits.length} 个`);
    const dropped = (plan.edits || []).length - edits.length;
    if (dropped > 0) steps.push(`忽略 ${dropped} 条指向不存在节点的修改`);

    (plan.batch || []).forEach((batch) => {
        if (!batch?.match || !batch.patch) return;
        const matched = matchBatch(snapshot.nodes, batch.match);
        matched.forEach((node) => ops.push({ type: "update_node", id: node.id, ...(batch.patch.title ? { patch: { title: batch.patch.title } } : {}), metadata: editPatch(batch.patch, node) }));
        steps.push(`批量处理同规格素材 ${matched.length} 个${batch.run && scope === "run" ? `，并重新生成${batch.run === "image" ? "图片" : "视频"}` : ""}`);
        if (batch.run && scope === "run")
            matched.forEach((node) => {
                if (node.type === HemosiNodeType.Shot) (batch.run === "image" ? runImages : runVideos).push(node.id);
                else runNodes.push({ nodeId: node.id, mode: batch.run! });
            });
    });

    if (runImages.length) steps.push(`批量生成 ${runImages.length} 张分镜图（先弹确认卡）`);
    if (runVideos.length) steps.push(`批量生成 ${runVideos.length} 段分镜视频（先弹确认卡；有图片结果的分镜用它做首帧）`);
    if (runNodes.length) steps.push(`重新生成 ${runNodes.length} 个节点（每个都弹确认卡）`);
    return { ops, shotIds, runImages: [...new Set(runImages)], runVideos: [...new Set(runVideos)], runNodes, steps };
}

function clip(value: string | undefined, max: number) {
    if (!value) return undefined;
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "" && item !== null)) as T;
}
