import { CanvasNodeType, HemosiNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { CameraSettings, LightingSettings, LightSource } from "@/types/cinematography";

type Option = { value: string; label: string; prompt: string };

export const CAMERA_BODIES: Option[] = [
    { value: "arri-alexa-35", label: "ARRI Alexa 35（电影感）", prompt: "shot on ARRI Alexa 35 digital cinema camera, natural film-like color science" },
    { value: "red-v-raptor", label: "RED V-Raptor（锐利高动态）", prompt: "shot on RED V-Raptor 8K, crisp detail, high dynamic range" },
    { value: "sony-venice-2", label: "Sony Venice 2（干净肤色）", prompt: "shot on Sony Venice 2, clean skin tones, full-frame look" },
    { value: "imax-70mm", label: "IMAX 70mm 胶片", prompt: "shot on IMAX 70mm film, epic large-format image, fine grain" },
    { value: "35mm-film", label: "35mm 胶片（Kodak Vision3）", prompt: "shot on 35mm Kodak Vision3 film stock, organic grain, filmic halation" },
    { value: "16mm-film", label: "16mm 胶片（复古纪录）", prompt: "shot on 16mm film, visible grain, vintage documentary feel" },
    { value: "vhs", label: "VHS 家用录像", prompt: "VHS camcorder footage, low resolution, tape artifacts, timestamp-free" },
    { value: "iphone", label: "手机拍摄", prompt: "shot on a smartphone camera, vertical-video realism, slight digital sharpening" },
];

export const CAMERA_LENSES: Option[] = [
    { value: "spherical-prime", label: "球面定焦", prompt: "spherical prime lens" },
    { value: "anamorphic", label: "变形宽银幕", prompt: "anamorphic lens, oval bokeh, horizontal lens flares, 2.39:1 cinematic feel" },
    { value: "vintage", label: "老镜头（柔和）", prompt: "vintage lens, soft contrast, gentle glow" },
    { value: "macro", label: "微距", prompt: "macro lens, extreme close focus detail" },
    { value: "tilt-shift", label: "移轴", prompt: "tilt-shift lens, miniature effect, selective focus plane" },
    { value: "fisheye", label: "鱼眼", prompt: "fisheye lens, strong barrel distortion" },
];

export const CAMERA_ANGLES: Option[] = [
    { value: "eye-level", label: "平视", prompt: "eye-level camera angle" },
    { value: "low", label: "仰拍", prompt: "low-angle shot looking up at the subject" },
    { value: "high", label: "俯拍", prompt: "high-angle shot looking down at the subject" },
    { value: "overhead", label: "顶拍（上帝视角）", prompt: "top-down overhead bird's-eye view" },
    { value: "dutch", label: "斜角（荷兰角）", prompt: "dutch angle, tilted horizon" },
    { value: "ots", label: "过肩", prompt: "over-the-shoulder shot" },
    { value: "pov", label: "主观视角", prompt: "first-person POV shot" },
    { value: "side", label: "侧面 90°", prompt: "side profile view, camera at 90 degrees to the subject" },
    { value: "three-quarter", label: "侧前 45°", prompt: "three-quarter view, camera 45 degrees off the subject's front" },
    { value: "back", label: "背面", prompt: "shot from behind the subject" },
];

export const SHOT_SIZES: Option[] = [
    { value: "extreme-wide", label: "大远景", prompt: "extreme wide shot" },
    { value: "wide", label: "远景/全景", prompt: "wide shot, full body in frame" },
    { value: "medium", label: "中景", prompt: "medium shot, waist up" },
    { value: "medium-close", label: "中近景", prompt: "medium close-up, chest up" },
    { value: "close-up", label: "特写", prompt: "close-up on the face" },
    { value: "extreme-close-up", label: "大特写", prompt: "extreme close-up on a detail" },
];

export const CAMERA_MOVES: Option[] = [
    { value: "static", label: "固定机位", prompt: "static locked-off camera, no camera movement" },
    { value: "push-in", label: "推（向前推近）", prompt: "camera dollies in toward the subject (push-in)" },
    { value: "pull-out", label: "拉（向后拉远）", prompt: "camera dollies back away from the subject (pull-out)" },
    { value: "pan-left", label: "左摇", prompt: "camera pans left" },
    { value: "pan-right", label: "右摇", prompt: "camera pans right" },
    { value: "tilt-up", label: "上摇", prompt: "camera tilts up" },
    { value: "tilt-down", label: "下摇", prompt: "camera tilts down" },
    { value: "truck-left", label: "左移", prompt: "camera trucks left, moving sideways parallel to the subject" },
    { value: "truck-right", label: "右移", prompt: "camera trucks right, moving sideways parallel to the subject" },
    { value: "crane-up", label: "升（摇臂上升）", prompt: "crane shot rising upward" },
    { value: "crane-down", label: "降（摇臂下降）", prompt: "crane shot descending" },
    { value: "orbit", label: "环绕", prompt: "camera orbits around the subject" },
    { value: "tracking", label: "跟拍", prompt: "tracking shot following the subject" },
    { value: "handheld", label: "手持晃动", prompt: "handheld camera, subtle natural shake" },
    { value: "dolly-zoom", label: "希区柯克变焦", prompt: "dolly zoom (vertigo effect)" },
];

export const LIGHT_DIRECTIONS: Option[] = [
    { value: "front", label: "正面", prompt: "from the front" },
    { value: "left", label: "左侧", prompt: "from camera left" },
    { value: "right", label: "右侧", prompt: "from camera right" },
    { value: "top", label: "顶光", prompt: "from directly above" },
    { value: "bottom", label: "底光", prompt: "from below" },
    { value: "back", label: "背后", prompt: "from behind the subject" },
    { value: "back-left", label: "左后", prompt: "from behind-left" },
    { value: "back-right", label: "右后", prompt: "from behind-right" },
];

export const LIGHT_MOODS: Option[] = [
    { value: "natural", label: "自然光", prompt: "natural motivated lighting" },
    { value: "high-key", label: "高调（明亮少阴影）", prompt: "high-key lighting, bright, minimal shadows" },
    { value: "low-key", label: "低调（暗部多、反差大）", prompt: "low-key lighting, deep shadows, high contrast chiaroscuro" },
    { value: "golden-hour", label: "黄金时刻", prompt: "golden hour sunlight" },
    { value: "blue-hour", label: "蓝调时刻", prompt: "blue hour ambient light" },
    { value: "neon", label: "霓虹", prompt: "neon practical lights, colored spill" },
    { value: "moonlight", label: "月光", prompt: "cool moonlight" },
];

const find = (list: Option[], value?: string) => list.find((item) => item.value === value);
const isSet = (value: unknown) => value !== undefined && value !== null && value !== "";

export function hasCamera(camera?: CameraSettings | null): camera is CameraSettings {
    return Boolean(camera && Object.values(camera).some(isSet));
}

export function hasLighting(lighting?: LightingSettings | null): lighting is LightingSettings {
    return Boolean(lighting && (isSet(lighting.brightness) || isSet(lighting.colorTemp) || isSet(lighting.mood) || isSet(lighting.note) || lighting.key?.enabled || lighting.rim?.enabled));
}

function colorTempWords(kelvin: number) {
    if (kelvin <= 2700) return "very warm candle/tungsten";
    if (kelvin <= 3600) return "warm tungsten";
    if (kelvin <= 4800) return "neutral warm";
    if (kelvin <= 6000) return "neutral daylight";
    if (kelvin <= 7500) return "cool overcast";
    return "cold blue";
}

function brightnessWords(value: number) {
    if (value <= -60) return "very dark, underexposed night-level exposure";
    if (value <= -20) return "dim, moody exposure";
    if (value < 20) return "balanced exposure";
    if (value < 60) return "bright exposure";
    return "very bright, airy exposure";
}

const speedWord = (speed?: CameraSettings["movementSpeed"]) => (speed === "fast" ? "fast" : speed === "medium" ? "steady" : speed === "slow" ? "slow" : "");

/** English camera description (video/image models follow English camera language best). "" when nothing is set. */
export function cameraPromptText(camera?: CameraSettings | null) {
    if (!hasCamera(camera)) return "";
    const lens = [camera.focalLength ? `${camera.focalLength}mm` : "", find(CAMERA_LENSES, camera.lens)?.prompt || (camera.focalLength ? "lens" : "")].filter(Boolean).join(" ");
    const aperture = camera.aperture ? `f/${camera.aperture} ${camera.aperture <= 2.8 ? "shallow depth of field, creamy bokeh" : camera.aperture >= 8 ? "deep focus, everything sharp" : "moderate depth of field"}` : "";
    const move = find(CAMERA_MOVES, camera.movement)?.prompt;
    const parts = [find(CAMERA_BODIES, camera.body)?.prompt, lens, aperture, find(SHOT_SIZES, camera.shotSize)?.prompt, find(CAMERA_ANGLES, camera.angle)?.prompt, move ? [speedWord(camera.movementSpeed), move].filter(Boolean).join(" ") : ""].filter(Boolean);
    return parts.join(", ");
}

function lightSourceText(name: string, light?: LightSource) {
    if (!light?.enabled) return "";
    return [`${light.quality === "hard" ? "hard" : "soft"} ${name}`, find(LIGHT_DIRECTIONS, light.direction)?.prompt, isSet(light.intensity) ? `at ${light.intensity}% intensity` : "", light.color ? `${light.color} tint` : ""].filter(Boolean).join(" ");
}

/** English lighting description, identical for every shot that shares the same setup. "" when nothing is set. */
export function lightingPromptText(lighting?: LightingSettings | null) {
    if (!hasLighting(lighting)) return "";
    const parts = [
        find(LIGHT_MOODS, lighting.mood)?.prompt,
        isSet(lighting.brightness) ? brightnessWords(Number(lighting.brightness)) : "",
        lighting.colorTemp ? `color temperature ${lighting.colorTemp}K (${colorTempWords(lighting.colorTemp)})` : "",
        lightSourceText("key light", lighting.key),
        lightSourceText("rim light separating the subject from the background", lighting.rim),
        lighting.note?.trim(),
    ].filter(Boolean);
    return parts.join(", ");
}

/** Short Chinese summary for the confirm card and node chips. */
export function cameraSummary(camera?: CameraSettings | null) {
    if (!hasCamera(camera)) return "";
    return [find(CAMERA_BODIES, camera.body)?.label.replace(/（.*）/, ""), camera.focalLength ? `${camera.focalLength}mm` : "", find(CAMERA_LENSES, camera.lens)?.label, camera.aperture ? `f/${camera.aperture}` : "", find(SHOT_SIZES, camera.shotSize)?.label, find(CAMERA_ANGLES, camera.angle)?.label, find(CAMERA_MOVES, camera.movement)?.label.replace(/（.*）/, "")].filter(Boolean).join(" · ");
}

export function lightingSummary(lighting?: LightingSettings | null) {
    if (!hasLighting(lighting)) return "";
    return [find(LIGHT_MOODS, lighting.mood)?.label.replace(/（.*）/, ""), isSet(lighting.brightness) ? `亮度 ${lighting.brightness}` : "", lighting.colorTemp ? `${lighting.colorTemp}K` : "", lighting.key?.enabled ? `主光${find(LIGHT_DIRECTIONS, lighting.key.direction)?.label || ""}${isSet(lighting.key.intensity) ? ` ${lighting.key.intensity}%` : ""}` : "", lighting.rim?.enabled ? `轮廓光${isSet(lighting.rim.intensity) ? ` ${lighting.rim.intensity}%` : ""}` : ""].filter(Boolean).join(" · ");
}

export type ResolvedLighting = { lighting?: LightingSettings; source?: { nodeId: string; title: string; kind: "node" | "group" | "anchor" } };

/**
 * Lighting a node generates with: its own setup when it has one, else its group's (one scene = one setup),
 * else a linked scene anchor's. Every shot in the same group/anchor therefore gets the identical block.
 */
export function resolveNodeLighting(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): ResolvedLighting {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return {};
    if (hasLighting(node.metadata?.lighting)) return { lighting: node.metadata!.lighting, source: { nodeId: node.id, title: node.title, kind: "node" } };
    const group = node.metadata?.groupId ? nodes.find((item) => item.id === node.metadata!.groupId && item.type === CanvasNodeType.Group) : undefined;
    if (group && hasLighting(group.metadata?.lighting)) return { lighting: group.metadata!.lighting, source: { nodeId: group.id, title: group.title, kind: "group" } };
    const upstream = connections.filter((connection) => connection.toNodeId === nodeId || (group && connection.toNodeId === group.id)).map((connection) => nodes.find((item) => item.id === connection.fromNodeId));
    const anchor = upstream.find((item) => item?.type === HemosiNodeType.Anchor && item.metadata?.anchorKind === "scene" && hasLighting(item.metadata?.lighting));
    if (anchor) return { lighting: anchor.metadata!.lighting, source: { nodeId: anchor.id, title: anchor.title, kind: "anchor" } };
    return {};
}

/** The block appended to a generation prompt for camera + lighting; "" when neither is set. */
export function cinematographyPromptBlock(camera?: CameraSettings | null, lighting?: LightingSettings | null) {
    const cameraText = cameraPromptText(camera);
    const lightingText = lightingPromptText(lighting);
    return [cameraText ? `【摄像机 Camera】\n${cameraText}.` : "", lightingText ? `【灯光 Lighting】\n${lightingText}.` : ""].filter(Boolean).join("\n\n");
}

/** Split one shot into one shot per angle (多角度): same content, each with its own camera angle. */
export function multiAngleCameras(base: CameraSettings | undefined, angles: string[]) {
    return angles.map((angle) => ({ ...(base || {}), angle }));
}
