/**
 * 3D 导演台的场景数据：主体、机位运镜关键帧、时长、全景底图。
 * 纯数据与数学（解析 / 归一化 / 插值 / 运镜预设 / 提示词），不依赖 three.js，便于单测。
 * 坐标系：Y 轴朝上，单位米，地面 y=0；角度用度。
 */

export type Vec3 = [number, number, number];

export type DirectorMedia = { content: string; storageKey?: string; naturalWidth?: number; naturalHeight?: number; mimeType?: string };

export type DirectorSubjectKind = "person" | "female" | "prop" | "vehicle" | "box";

export type DirectorSubjectKeyframe = { t: number; position: Vec3; rotationY: number; pose?: string };

export type DirectorSubject = {
    id: string;
    name: string;
    kind: DirectorSubjectKind;
    color: string;
    /** 高度（米），person 默认 1.75，female 默认 1.65。 */
    height: number;
    /** 动作描述（走、跑、转身、坐下、招手…），写进预演提示词。 */
    action: string;
    /** 姿态预设（站立、坐姿、招手、奔跑、戒备等）。 */
    pose?: string;
    /** 起始位姿；有 keyframes 时按关键帧插值。 */
    position: Vec3;
    rotationY: number;
    keyframes: DirectorSubjectKeyframe[];
};

export type DirectorEasing = "linear" | "easeInOut" | "easeIn" | "easeOut";

export type DirectorCameraKeyframe = { t: number; position: Vec3; target: Vec3; fov: number };

export type DirectorShot = {
    id: string;
    name: string;
    /** 运镜描述：推、拉、摇、移、环绕、升降… */
    move: string;
    duration: number;
    easing: DirectorEasing;
    keyframes: DirectorCameraKeyframe[];
};

export type DirectorAspect = "16:9" | "9:16" | "1:1" | "4:3" | "2.39:1";

export type DirectorScene = {
    version: 1;
    title: string;
    description: string;
    aspect: DirectorAspect;
    panorama?: DirectorMedia;
    /** 最近一次截图，节点卡片上的预览。 */
    preview?: DirectorMedia;
    groundColor: string;
    showGround: boolean;
    subjects: DirectorSubject[];
    shots: DirectorShot[];
    activeShotId: string;
};

export type DirectorCameraPose = { position: Vec3; target: Vec3; fov: number };

export const DIRECTOR_ASPECTS: DirectorAspect[] = ["16:9", "9:16", "1:1", "4:3", "2.39:1"];
export const DIRECTOR_SUBJECT_KINDS: DirectorSubjectKind[] = ["person", "female", "prop", "vehicle", "box"];
export const DIRECTOR_SUBJECT_KIND_LABEL: Record<DirectorSubjectKind, string> = { person: "男木偶", female: "女木偶", prop: "道具", vehicle: "载具", box: "方块" };
export const DIRECTOR_EASINGS: DirectorEasing[] = ["linear", "easeInOut", "easeIn", "easeOut"];
export const DIRECTOR_EASING_LABEL: Record<DirectorEasing, string> = { linear: "匀速", easeInOut: "缓入缓出", easeIn: "缓入", easeOut: "缓出" };

const MAX_DURATION = 60;
const MAX_COORD = 200;
const COLORS = ["#f59e0b", "#22d3ee", "#a855f7", "#10b981", "#ef4444", "#3b82f6", "#f472b6"];

let idSeq = 0;
export function directorId(prefix: string) {
    idSeq += 1;
    return `${prefix}-${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const num = (value: unknown, fallback: number, min = -MAX_COORD, max = MAX_COORD) => {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : fallback);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** 接受 [x,y,z]、{x,y,z} 或缺省。 */
export function toVec3(value: unknown, fallback: Vec3): Vec3 {
    if (Array.isArray(value)) return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])];
    const o = obj(value);
    if ("x" in o || "y" in o || "z" in o) return [num(o.x, fallback[0]), num(o.y, fallback[1]), num(o.z, fallback[2])];
    return [...fallback];
}

function color(value: unknown, index: number) {
    const text = str(value);
    return /^#[0-9a-f]{3,8}$/i.test(text) ? text : COLORS[index % COLORS.length];
}

function kindOf(value: unknown): DirectorSubjectKind {
    const text = str(value).toLowerCase();
    if (DIRECTOR_SUBJECT_KINDS.includes(text as DirectorSubjectKind)) return text as DirectorSubjectKind;
    if (/女|woman|girl|female/.test(text)) return "female";
    if (/男|人|character|human|actor|man|boy/.test(text)) return "person";
    if (/车|car|vehicle|bike|马/.test(text)) return "vehicle";
    return text ? "prop" : "person";
}

function easingOf(value: unknown): DirectorEasing {
    const text = str(value);
    if (DIRECTOR_EASINGS.includes(text as DirectorEasing)) return text as DirectorEasing;
    if (/ease-?in-?out|smooth|缓入缓出/i.test(text)) return "easeInOut";
    if (/ease-?in|缓入/i.test(text)) return "easeIn";
    if (/ease-?out|缓出/i.test(text)) return "easeOut";
    return text === "linear" || /匀速/.test(text) ? "linear" : "easeInOut";
}

const byTime = <T extends { t: number }>(items: T[]) => [...items].sort((a, b) => a.t - b.t);

function normalizeSubject(raw: unknown, index: number, duration: number): DirectorSubject {
    const o = obj(raw);
    const kind = kindOf(o.kind ?? o.type);
    const position = toVec3(o.position, [index * 1.5 - 1, 0, 0]);
    const rotationY = num(o.rotationY ?? o.rotation ?? o.yaw, 0, -3600, 3600);
    const keyframes = byTime(
        (Array.isArray(o.keyframes) ? o.keyframes : []).map((item) => {
            const k = obj(item);
            return { t: num(k.t ?? k.time, 0, 0, duration), position: toVec3(k.position, position), rotationY: num(k.rotationY ?? k.rotation ?? k.yaw, rotationY, -3600, 3600) };
        }),
    );
    return {
        id: str(o.id) || directorId("subject"),
        name: str(o.name) || `主体${index + 1}`,
        kind,
        color: color(o.color, index),
        height: num(o.height, kind === "person" ? 1.75 : kind === "vehicle" ? 1.5 : 1, 0.1, 50),
        action: str(o.action),
        position,
        rotationY,
        keyframes,
    };
}

function normalizeShot(raw: unknown, index: number, fallbackDuration: number): DirectorShot {
    const o = obj(raw);
    const duration = num(o.duration ?? o.seconds, fallbackDuration, 0.5, MAX_DURATION);
    const keyframes = byTime(
        (Array.isArray(o.keyframes) ? o.keyframes : []).map((item) => {
            const k = obj(item);
            return { t: num(k.t ?? k.time, 0, 0, duration), position: toVec3(k.position, [0, 1.6, 6]), target: toVec3(k.target ?? k.lookAt, [0, 1.2, 0]), fov: num(k.fov, 45, 10, 120) };
        }),
    );
    return {
        id: str(o.id) || directorId("shot"),
        name: str(o.name) || `机位${index + 1}`,
        move: str(o.move ?? o.movement),
        duration,
        easing: easingOf(o.easing),
        keyframes: keyframes.length ? keyframes : [{ t: 0, position: [0, 1.6, 6], target: [0, 1.2, 0], fov: 45 }],
    };
}

function aspectOf(value: unknown): DirectorAspect {
    const text = str(value);
    return DIRECTOR_ASPECTS.includes(text as DirectorAspect) ? (text as DirectorAspect) : "16:9";
}

/** 把任意对象归一化成合法场景：缺字段补默认，数值夹到合理范围，关键帧按时间排序。 */
export function normalizeDirectorScene(raw: unknown, base?: Partial<DirectorScene>): DirectorScene {
    const o = obj(raw);
    const duration = num(o.duration, 5, 0.5, MAX_DURATION);
    const rawShots = Array.isArray(o.shots) ? o.shots : Array.isArray(o.cameras) ? o.cameras : o.camera ? [o.camera] : [];
    const shots = rawShots.map((shot, index) => normalizeShot(shot, index, duration));
    if (!shots.length) shots.push(normalizeShot({}, 0, duration));
    const subjects = (Array.isArray(o.subjects) ? o.subjects : Array.isArray(o.characters) ? o.characters : []).map((item, index) => normalizeSubject(item, index, MAX_DURATION));
    const activeShotId = shots.some((shot) => shot.id === str(o.activeShotId)) ? str(o.activeShotId) : shots[0].id;
    return {
        version: 1,
        title: str(o.title) || base?.title || "3D 场景",
        description: str(o.description) || base?.description || "",
        aspect: aspectOf(o.aspect ?? base?.aspect),
        panorama: base?.panorama,
        preview: base?.preview,
        groundColor: /^#[0-9a-f]{3,8}$/i.test(str(o.groundColor)) ? str(o.groundColor) : base?.groundColor || "#3f3f46",
        showGround: typeof o.showGround === "boolean" ? o.showGround : (base?.showGround ?? true),
        subjects,
        shots,
        activeShotId,
    };
}

/** 从 LLM 回复里取出 JSON（```json 代码块、或第一个 { 到最后一个 }），解析并归一化。失败抛出中文错误。 */
export function parseDirectorScene(text: string, base?: Partial<DirectorScene>): DirectorScene {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidates = [fenced, text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter((item): item is string => Boolean(item && item.trim()));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate.trim());
            if (parsed && typeof parsed === "object") return normalizeDirectorScene(obj(parsed).scene ?? parsed, base);
        } catch {
            // try the next candidate
        }
    }
    throw new Error("模型回复里没有可解析的场景 JSON");
}

export function emptyDirectorScene(): DirectorScene {
    return normalizeDirectorScene({ title: "3D 场景", duration: 5, subjects: [{ name: "角色A", kind: "person", position: [0, 0, 0] }], shots: [presetShot("push-in", [0, 0, 0], 5)] });
}

// ---------------------------------------------------------------- 插值

export function applyEasing(easing: DirectorEasing, u: number) {
    const x = clamp(u, 0, 1);
    if (easing === "linear") return x;
    if (easing === "easeIn") return x * x * x;
    if (easing === "easeOut") return 1 - (1 - x) ** 3;
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const lerpVec3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** 找 t 所在的相邻关键帧及其局部进度 u（0..1）。 */
function segment<T extends { t: number }>(frames: T[], t: number): [T, T, number] {
    if (frames.length === 1 || t <= frames[0].t) return [frames[0], frames[0], 0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return [last, last, 0];
    const index = frames.findIndex((frame) => frame.t > t);
    const a = frames[index - 1];
    const b = frames[index];
    return [a, b, b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)];
}

/** 机位在 t 秒的位姿：关键帧间按 easing 插值位置/目标/视场角；t 超出范围取首尾帧。 */
export function sampleShot(shot: DirectorShot, t: number): DirectorCameraPose {
    const frames = byTime(shot.keyframes);
    if (!frames.length) return { position: [0, 1.6, 6], target: [0, 1.2, 0], fov: 45 };
    const [a, b, u] = segment(frames, t);
    const e = applyEasing(shot.easing, u);
    return { position: lerpVec3(a.position, b.position, e), target: lerpVec3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
}

/** 主体在 t 秒的位置与朝向；没有关键帧就停在起始位姿。主体关键帧匀速插值。 */
export function sampleSubject(subject: DirectorSubject, t: number): { position: Vec3; rotationY: number } {
    const frames = byTime(subject.keyframes);
    if (!frames.length) return { position: subject.position, rotationY: subject.rotationY };
    const [a, b, u] = segment(frames, t);
    return { position: lerpVec3(a.position, b.position, u), rotationY: lerp(a.rotationY, b.rotationY, u) };
}

export function activeShot(scene: DirectorScene) {
    return scene.shots.find((shot) => shot.id === scene.activeShotId) || scene.shots[0];
}

/** 关键帧插入或替换（同一时刻 ±0.05s 视为同一帧）。 */
export function upsertCameraKeyframe(shot: DirectorShot, frame: DirectorCameraKeyframe): DirectorShot {
    const t = clamp(frame.t, 0, shot.duration);
    const rest = shot.keyframes.filter((item) => Math.abs(item.t - t) > 0.05);
    return { ...shot, keyframes: byTime([...rest, { ...frame, t }]) };
}

// ---------------------------------------------------------------- 运镜预设

export const DIRECTOR_MOVE_PRESETS = [
    { id: "static", label: "固定" },
    { id: "push-in", label: "推" },
    { id: "pull-out", label: "拉" },
    { id: "pan-left", label: "左摇" },
    { id: "pan-right", label: "右摇" },
    { id: "truck-right", label: "右移" },
    { id: "orbit", label: "环绕" },
    { id: "crane-up", label: "升" },
    { id: "crane-down", label: "降" },
] as const;
export type DirectorMovePreset = (typeof DIRECTOR_MOVE_PRESETS)[number]["id"];

/** 以 focus 为对象生成一组运镜关键帧。 */
export function presetShot(preset: DirectorMovePreset, focus: Vec3, duration: number, base?: Partial<DirectorShot>): DirectorShot {
    const [fx, , fz] = focus;
    const eye = 1.6;
    const target: Vec3 = [fx, 1.2, fz];
    const at = (t: number, position: Vec3, look: Vec3 = target, fov = 45): DirectorCameraKeyframe => ({ t, position, target: look, fov });
    const d = duration;
    const label = DIRECTOR_MOVE_PRESETS.find((item) => item.id === preset)?.label || preset;
    const frames: Record<DirectorMovePreset, DirectorCameraKeyframe[]> = {
        static: [at(0, [fx, eye, fz + 6])],
        "push-in": [at(0, [fx, eye, fz + 7]), at(d, [fx, eye, fz + 2.5])],
        "pull-out": [at(0, [fx, eye, fz + 2.5]), at(d, [fx, eye + 0.5, fz + 8])],
        "pan-left": [at(0, [fx, eye, fz + 6], [fx + 3, 1.2, fz]), at(d, [fx, eye, fz + 6], [fx - 3, 1.2, fz])],
        "pan-right": [at(0, [fx, eye, fz + 6], [fx - 3, 1.2, fz]), at(d, [fx, eye, fz + 6], [fx + 3, 1.2, fz])],
        "truck-right": [at(0, [fx - 3, eye, fz + 5], [fx - 3, 1.2, fz]), at(d, [fx + 3, eye, fz + 5], [fx + 3, 1.2, fz])],
        orbit: [0, 0.25, 0.5, 0.75, 1].map((p) => at(p * d, [fx + Math.sin(p * Math.PI) * 6, eye, fz + Math.cos(p * Math.PI) * 6])),
        "crane-up": [at(0, [fx, 0.6, fz + 6]), at(d, [fx, 5, fz + 6])],
        "crane-down": [at(0, [fx, 5, fz + 6]), at(d, [fx, 0.8, fz + 6])],
    };
    return { id: base?.id || directorId("shot"), name: base?.name || `${label}镜头`, move: label, duration: d, easing: preset === "static" ? "linear" : base?.easing || "easeInOut", keyframes: frames[preset] };
}

// ---------------------------------------------------------------- 提示词

const fmt = (v: Vec3) => v.map((n) => Math.round(n * 10) / 10).join(", ");

/** 选定机位的预演描述，作为截图 / 录制节点的提示词，喂给视频生成。 */
export function directorShotPrompt(scene: DirectorScene, shot: DirectorShot = activeShot(scene)) {
    const start = sampleShot(shot, 0);
    const end = sampleShot(shot, shot.duration);
    const subjects = scene.subjects.map((subject) => `${subject.name}（${DIRECTOR_SUBJECT_KIND_LABEL[subject.kind]}${subject.action ? `，${subject.action}` : ""}）`).join("；");
    const focal = (fov: number) => Math.round(18 / Math.tan(((fov / 2) * Math.PI) / 180));
    return [
        scene.description || scene.title,
        subjects ? `主体：${subjects}` : "",
        `镜头：${shot.name}${shot.move ? `，运镜：${shot.move}` : ""}，时长 ${shot.duration} 秒，画幅 ${scene.aspect}`,
        `机位从 (${fmt(start.position)}) 看向 (${fmt(start.target)})，约 ${focal(start.fov)}mm${shot.keyframes.length > 1 ? `，结束于 (${fmt(end.position)}) 看向 (${fmt(end.target)})，约 ${focal(end.fov)}mm` : ""}`,
        "构图与运镜严格按预演画面。",
    ]
        .filter(Boolean)
        .join("\n");
}

export const DIRECTOR_SYSTEM_PROMPT = `你是影视预演（previz）的 3D 场景搭建助手。根据用户的自然语言描述，输出一个 JSON 场景，只输出 JSON，不要解释。
坐标系：Y 轴朝上，单位米，地面 y=0，主体放在原点附近（±10 米内）；镜头朝 -Z 方向看时 +X 在右。角度单位为度。
JSON 结构：
{
  "title": "场景名",
  "description": "一句话画面描述（中文）",
  "duration": 总时长秒数(0.5-60),
  "aspect": "16:9" | "9:16" | "1:1" | "4:3" | "2.39:1",
  "subjects": [
    { "name": "名字", "kind": "person"|"prop"|"vehicle"|"box", "color": "#rrggbb", "height": 米,
      "action": "动作描述", "position": [x, 0, z], "rotationY": 朝向角度,
      "keyframes": [ { "t": 秒, "position": [x, 0, z], "rotationY": 角度 } ] }
  ],
  "shots": [
    { "name": "机位名", "move": "运镜描述（推/拉/摇/移/环绕/升降/跟拍…）", "duration": 秒,
      "easing": "linear"|"easeInOut"|"easeIn"|"easeOut",
      "keyframes": [ { "t": 秒, "position": [x, y, z], "target": [x, y, z], "fov": 视场角度(10-120，50mm 约 40) } ] }
  ]
}
要求：每个机位至少 1 个关键帧，运镜至少 2 个；关键帧 t 从 0 到该机位 duration；主体有位移时给出关键帧；机位高度一般 0.5-3 米，人物视线高约 1.6 米。`;

/** 发给 LLM 的用户消息；已有场景时附上当前 JSON，让模型在其上修改。 */
export function buildDirectorUserPrompt(instruction: string, current?: DirectorScene) {
    if (!current) return instruction.trim();
    const { panorama: _panorama, preview: _preview, ...rest } = current;
    return `当前场景 JSON：\n${JSON.stringify(rest)}\n\n在此基础上按要求修改（保留未提到的部分与 id），输出完整 JSON：\n${instruction.trim()}`;
}

export function aspectRatio(aspect: DirectorAspect) {
    const [w, h] = aspect.split(":").map(Number);
    return w / h;
}
