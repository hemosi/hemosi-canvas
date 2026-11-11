import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MutableRefObject, type ReactNode } from "react";
import { App, Select, Switch } from "antd";
import { Camera, Circle, Clapperboard, Image as ImageIcon, Loader2, Pause, Play, Plus, Sparkles, Trash2, Upload, Video, X } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, PerspectiveCamera, TransformControls } from "@react-three/drei";
import * as THREE from "three";

import { readDirectorScene, runDirectorAgent, useResolvedImage } from "@/components/canvas/nodes/director-node";
import {
    activeShot,
    aspectRatio,
    DIRECTOR_ASPECTS,
    DIRECTOR_EASINGS,
    DIRECTOR_EASING_LABEL,
    DIRECTOR_MOVE_PRESETS,
    DIRECTOR_SUBJECT_KINDS,
    DIRECTOR_SUBJECT_KIND_LABEL,
    directorId,
    directorShotPrompt,
    presetShot,
    sampleShot,
    sampleSubject,
    upsertCameraKeyframe,
    type DirectorMovePreset,
    type DirectorScene,
    type DirectorShot,
    type DirectorSubject,
    type Vec3,
} from "@/lib/canvas/director-scene";
import { drawToVideoOps } from "@/lib/canvas/canvas-draw-to-video";
import { CanvasNodeType } from "@/types/canvas";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

type Selection = { kind: "subject"; id: string } | { kind: "camera" | "target"; index: number } | null;
type Clock = { t: number };
type StageApi = { gl: THREE.WebGLRenderer; camera: THREE.Camera; target: () => Vec3 | null };

const toV = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);
const fromV = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 100) / 100;
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- 3D 内容

function Panorama({ url }: { url: string }) {
    const scene = useThree((state) => state.scene);
    useEffect(() => {
        let texture: THREE.Texture | null = null;
        new THREE.TextureLoader().load(url, (loaded) => {
            loaded.mapping = THREE.EquirectangularReflectionMapping;
            loaded.colorSpace = THREE.SRGBColorSpace;
            texture = loaded;
            scene.background = loaded;
        });
        return () => {
            if (scene.background === texture) scene.background = null;
            texture?.dispose();
        };
    }, [scene, url]);
    return null;
}

function SubjectMesh({ subject, clock, dragging, register, director, selected, onSelect }: { subject: DirectorSubject; clock: MutableRefObject<Clock>; dragging: MutableRefObject<boolean>; register: (key: string, object: THREE.Object3D | null) => void; director: boolean; selected: boolean; onSelect: () => void }) {
    const group = useRef<THREE.Group>(null);
    useFrame(() => {
        if (!group.current || (dragging.current && selected)) return;
        const pose = sampleSubject(subject, clock.current.t);
        group.current.position.set(...pose.position);
        group.current.rotation.y = deg(pose.rotationY);
    });
    const h = subject.height;
    const material = <meshStandardMaterial color={subject.color} emissive={selected && director ? subject.color : "#000"} emissiveIntensity={selected && director ? 0.35 : 0} />;
    return (
        <group
            ref={(object) => {
                group.current = object;
                register(`subject:${subject.id}`, object);
            }}
            onClick={(event) => {
                if (!director) return;
                event.stopPropagation();
                onSelect();
            }}
        >
            {subject.kind === "person" ? (
                <>
                    <mesh position={[0, h * 0.42, 0]} castShadow>
                        <capsuleGeometry args={[h * 0.14, h * 0.5, 6, 12]} />
                        {material}
                    </mesh>
                    <mesh position={[0, h * 0.88, 0]} castShadow>
                        <sphereGeometry args={[h * 0.1, 16, 16]} />
                        {material}
                    </mesh>
                    <mesh position={[0, h * 0.88, h * 0.09]}>
                        <boxGeometry args={[h * 0.08, h * 0.03, h * 0.04]} />
                        <meshStandardMaterial color="#111" />
                    </mesh>
                </>
            ) : subject.kind === "vehicle" ? (
                <mesh position={[0, h * 0.4, 0]} castShadow>
                    <boxGeometry args={[h * 1.2, h * 0.8, h * 2.8]} />
                    {material}
                </mesh>
            ) : (
                <mesh position={[0, h / 2, 0]} castShadow>
                    <boxGeometry args={subject.kind === "box" ? [h, h, h] : [h * 0.6, h, h * 0.6]} />
                    {material}
                </mesh>
            )}
            {director ? (
                <Html position={[0, h + 0.25, 0]} center zIndexRange={[10, 0]}>
                    <div className="pointer-events-none whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]" style={{ background: "rgba(10,12,14,.7)", color: "#fff" }}>
                        {subject.name}
                        {subject.action ? ` · ${subject.action}` : ""}
                    </div>
                </Html>
            ) : null}
        </group>
    );
}

/** 机位关键帧：机身 + 视线 + 目标点；导演视角下可点选拖动。 */
function CameraRig({ shot, register, selection, onSelect }: { shot: DirectorShot; register: (key: string, object: THREE.Object3D | null) => void; selection: Selection; onSelect: (selection: Selection) => void }) {
    const path = useMemo(() => {
        const steps = Math.max(2, Math.ceil(shot.duration * 12));
        return Array.from({ length: steps + 1 }, (_, i) => toV(sampleShot(shot, (i / steps) * shot.duration).position));
    }, [shot]);
    return (
        <>
            {shot.keyframes.length > 1 ? <Line points={path} color="#facc15" lineWidth={2} dashed dashSize={0.2} gapSize={0.1} /> : null}
            {shot.keyframes.map((frame, index) => {
                const active = (selection?.kind === "camera" || selection?.kind === "target") && selection.index === index;
                return (
                    <group key={index}>
                        <group
                            position={frame.position}
                            ref={(object) => {
                                object?.lookAt(toV(frame.target));
                                register(`camera:${index}`, object);
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                onSelect({ kind: "camera", index });
                            }}
                        >
                            <mesh>
                                <boxGeometry args={[0.35, 0.25, 0.4]} />
                                <meshStandardMaterial color={active ? "#facc15" : "#e5e7eb"} />
                            </mesh>
                            <mesh position={[0, 0, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
                                <coneGeometry args={[0.16, 0.25, 4]} />
                                <meshStandardMaterial color="#9ca3af" />
                            </mesh>
                            <Html position={[0, 0.3, 0]} center zIndexRange={[10, 0]}>
                                <div className="pointer-events-none whitespace-nowrap text-[10px]" style={{ color: "#facc15" }}>{frame.t}s</div>
                            </Html>
                        </group>
                        <mesh
                            position={frame.target}
                            ref={(object) => register(`target:${index}`, object)}
                            onClick={(event) => {
                                event.stopPropagation();
                                onSelect({ kind: "target", index });
                            }}
                        >
                            <sphereGeometry args={[0.08, 12, 12]} />
                            <meshBasicMaterial color={selection?.kind === "target" && selection.index === index ? "#facc15" : "#f97316"} />
                        </mesh>
                        <Line points={[toV(frame.position), toV(frame.target)]} color="#f97316" lineWidth={1} transparent opacity={0.5} />
                    </group>
                );
            })}
        </>
    );
}

/** 当前时刻机位的位置标记（导演视角下随播放移动）。 */
function LiveCameraMarker({ shot, clock }: { shot: DirectorShot; clock: MutableRefObject<Clock> }) {
    const ref = useRef<THREE.Mesh>(null);
    useFrame(() => {
        if (!ref.current) return;
        const pose = sampleShot(shot, clock.current.t);
        ref.current.position.set(...pose.position);
        ref.current.lookAt(toV(pose.target));
    });
    return (
        <mesh ref={ref}>
            <coneGeometry args={[0.22, 0.45, 4]} />
            <meshBasicMaterial color="#facc15" wireframe />
        </mesh>
    );
}

/** 镜头视角：用机位插值驱动默认相机。 */
function ShotCamera({ shot, clock }: { shot: DirectorShot; clock: MutableRefObject<Clock> }) {
    const ref = useRef<THREE.PerspectiveCamera>(null);
    useFrame(() => {
        const camera = ref.current;
        if (!camera) return;
        const pose = sampleShot(shot, clock.current.t);
        camera.position.set(...pose.position);
        camera.lookAt(toV(pose.target));
        if (Math.abs(camera.fov - pose.fov) > 0.01) {
            camera.fov = pose.fov;
            camera.updateProjectionMatrix();
        }
    });
    return <PerspectiveCamera ref={ref} makeDefault near={0.05} far={2000} />;
}

function Gizmo({ objects, selection, onStart, onEnd }: { objects: MutableRefObject<Map<string, THREE.Object3D>>; selection: Selection; onStart: () => void; onEnd: (object: THREE.Object3D) => void }) {
    const key = selection ? (selection.kind === "subject" ? `subject:${selection.id}` : `${selection.kind}:${selection.index}`) : "";
    const [object, setObject] = useState<THREE.Object3D | null>(null);
    // 物体由 ref 回调登记，提交后才可取；每次渲染后对一下当前选中的物体。
    useEffect(() => {
        const next = key ? objects.current.get(key) || null : null;
        if (next !== object) setObject(next);
    });
    if (!object) return null;
    return <TransformControls object={object} mode="translate" size={0.8} onMouseDown={onStart} onMouseUp={() => onEnd(object)} />;
}

function ApiBridge({ apiRef }: { apiRef: MutableRefObject<StageApi | null> }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const controls = useThree((state) => state.controls) as unknown as { target?: THREE.Vector3 } | null;
    useEffect(() => {
        apiRef.current = { gl, camera, target: () => (controls?.target ? fromV(controls.target) : null) };
    }, [apiRef, camera, controls, gl]);
    return null;
}

// ---------------------------------------------------------------- 小部件

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium opacity-60">
                <span>{title}</span>
                {extra}
            </div>
            {children}
        </div>
    );
}

function FlatButton({ children, onClick, disabled, title, accent }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; accent?: boolean }) {
    return (
        <button type="button" title={title} disabled={disabled} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-40 ${accent ? "font-medium" : "hover:bg-black/5 dark:hover:bg-white/10"}`} style={accent ? { background: "var(--hemosi-accent)", color: "#0a0c0e" } : undefined} onClick={onClick}>
            {children}
        </button>
    );
}

function useFitBox(ratio: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => {
            const { width, height } = element.getBoundingClientRect();
            const w = Math.min(width, height * ratio);
            setSize({ width: Math.floor(w), height: Math.floor(w / ratio) });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ratio]);
    return { ref, size };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function pickRecorderMime() {
    return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
}

// ---------------------------------------------------------------- 导演台

export default function DirectorStage({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { message } = App.useApp();
    const theme = ctx.theme;
    const [scene, setScene] = useState<DirectorScene>(() => readDirectorScene(ctx.node));
    const shot = activeShot(scene);
    const [mode, setMode] = useState<"director" | "shot">("director");
    const [selection, setSelection] = useState<Selection>(null);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [recording, setRecording] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [instruction, setInstruction] = useState("");
    const [stream, setStream] = useState("");
    const clock = useRef<Clock>({ t: 0 });
    const dragging = useRef(false);
    const objects = useRef(new Map<string, THREE.Object3D>());
    const apiRef = useRef<StageApi | null>(null);
    const panoramaInput = useRef<HTMLInputElement>(null);
    const panoramaUrl = useResolvedImage(scene.panorama);
    const ratio = aspectRatio(scene.aspect);
    const { ref: boxRef, size } = useFitBox(ratio);
    const director = mode === "director" && !recording;

    const commit = useCallback(
        (next: DirectorScene) => {
            setScene(next);
            ctx.updateMetadata({ directorScene: next, prompt: next.description });
        },
        [ctx],
    );
    const patchShot = (patch: Partial<DirectorShot>) => commit({ ...scene, shots: scene.shots.map((item) => (item.id === shot.id ? { ...item, ...patch } : item)) });
    const patchSubject = (id: string, patch: Partial<DirectorSubject>) => commit({ ...scene, subjects: scene.subjects.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
    const register = useCallback((key: string, object: THREE.Object3D | null) => {
        if (object) objects.current.set(key, object);
        else objects.current.delete(key);
    }, []);

    const seek = useCallback((t: number) => {
        clock.current.t = t;
        setTime(t);
    }, []);

    // 播放：按真实时间推进，到时长结尾停住。
    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        const start = performance.now() - clock.current.t * 1000;
        const tick = () => {
            const t = (performance.now() - start) / 1000;
            if (t >= shot.duration) {
                seek(shot.duration);
                setPlaying(false);
                return;
            }
            seek(t);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, seek, shot.duration]);

    // 导演台打开时：Esc 关闭；焦点不在导演台内的按键不再传给画布快捷键（避免误删节点）。
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !recording) return onClose();
            if (!rootRef.current?.contains(event.target as Node)) event.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose, recording]);

    const endDrag = (object: THREE.Object3D) => {
        dragging.current = false;
        if (!selection) return;
        const position = fromV(object.position);
        if (selection.kind === "subject") {
            const subject = scene.subjects.find((item) => item.id === selection.id);
            if (!subject) return;
            if (!subject.keyframes.length) return patchSubject(subject.id, { position: [position[0], 0, position[2]] });
            const at = clock.current.t;
            const rest = subject.keyframes.filter((frame) => Math.abs(frame.t - at) > 0.05);
            const rotationY = sampleSubject(subject, at).rotationY;
            return patchSubject(subject.id, { keyframes: [...rest, { t: round(at), position: [position[0], 0, position[2]] as Vec3, rotationY }].sort((a, b) => a.t - b.t) });
        }
        const keyframes = shot.keyframes.map((frame, index) => (index === selection.index ? { ...frame, [selection.kind === "camera" ? "position" : "target"]: position } : frame));
        patchShot({ keyframes });
    };

    const focusOf = (): Vec3 => {
        const subject = selection?.kind === "subject" ? scene.subjects.find((item) => item.id === selection.id) : scene.subjects[0];
        return subject ? sampleSubject(subject, 0).position : [0, 0, 0];
    };

    const recordKeyframe = () => {
        const api = apiRef.current;
        if (!api || mode !== "director") return;
        const camera = api.camera as THREE.PerspectiveCamera;
        const target = api.target() || [0, 1.2, 0];
        patchShot(upsertCameraKeyframe(shot, { t: round(clock.current.t), position: fromV(camera.position), target, fov: round(camera.fov || 45) }));
        message.success(`已在 ${round(clock.current.t)}s 记录关键帧`);
    };

    const runAi = async () => {
        if (!instruction.trim() || busy) return;
        setBusy("ai");
        setStream("");
        try {
            const edit = Boolean(ctx.node.metadata?.directorScene);
            const next = await runDirectorAgent(ctx, scene, instruction, edit, (delta) => setStream((value) => (value + delta).slice(-400)));
            commit(next);
            ctx.updateNode({ title: next.title });
            setSelection(null);
            seek(0);
            setInstruction("");
            message.success(`场景已${edit ? "修改" : "搭好"}：${next.subjects.length} 个主体、${next.shots.length} 个机位`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "场景生成失败");
        } finally {
            setBusy(null);
            setStream("");
        }
    };

    const uploadPanorama = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const image = await uploadImage(file);
            if (Math.abs(image.width / image.height - 2) > 0.15) message.warning("全景图一般是 2:1 的等距柱状投影图，这张比例不是 2:1，显示可能变形");
            commit({ ...scene, panorama: { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, mimeType: image.mimeType } });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "全景图读取失败");
        }
    };

    /** 镜头视角下渲染一帧，导出 PNG。 */
    const captureShot = async () => {
        const previous = mode;
        setSelection(null);
        setMode("shot");
        await nextFrame();
        await nextFrame();
        const canvas = apiRef.current?.gl.domElement;
        const blob = canvas ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")) : null;
        setMode(previous);
        if (!blob) throw new Error("截图失败");
        return blob;
    };

    const placeRight = (offsetY: number, width: number, height: number) => ({ x: ctx.node.position.x + ctx.node.width + 120, y: ctx.node.position.y + offsetY, width, height });

    const screenshot = async (toVideo: boolean) => {
        if (busy) return;
        setBusy(toVideo ? "toVideo" : "shot");
        try {
            const image = await uploadImage(await captureShot());
            const media = { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, mimeType: image.mimeType };
            commit({ ...scene, preview: media });
            const id = `${CanvasNodeType.Image}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const rect = placeRight(ctx.getDownstream().length * 60, 340, Math.round((340 * image.height) / image.width));
            const node = {
                id,
                type: CanvasNodeType.Image,
                title: `${scene.title}·${shot.name}·${round(clock.current.t)}s`,
                position: { x: rect.x, y: rect.y },
                width: rect.width,
                height: rect.height,
                metadata: { content: image.url, storageKey: image.storageKey, status: "success" as const, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, prompt: directorShotPrompt(scene, shot), seconds: String(Math.round(shot.duration)) },
            };
            const ops = [
                { type: "add_node" as const, id, nodeType: CanvasNodeType.Image, title: node.title, position: node.position, width: node.width, height: node.height, metadata: node.metadata },
                { type: "connect_nodes" as const, fromNodeId: ctx.node.id, toNodeId: id },
            ];
            ctx.applyOps(toVideo ? [...ops, ...drawToVideoOps(node, ctx.getNodes(), "firstFrame").ops] : ops);
            message.success(toVideo ? "截图已回画布，并新建了以它为首帧的视频节点：点开视频节点确认提示词后生成" : "截图已回画布并连线");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "截图失败");
        } finally {
            setBusy(null);
        }
    };

    /** 按选定机位时长实时渲染，canvas.captureStream + MediaRecorder 录成视频节点。 */
    const record = async () => {
        if (busy) return;
        const canvas = apiRef.current?.gl.domElement;
        const mimeType = pickRecorderMime();
        if (!canvas || !mimeType || !canvas.captureStream) return void message.error("当前浏览器不支持画面录制（MediaRecorder）");
        setBusy("record");
        setPlaying(false);
        setSelection(null);
        setRecording(true);
        seek(0);
        try {
            await nextFrame();
            const capture = canvas.captureStream(30);
            const recorder = new MediaRecorder(capture, { mimeType, videoBitsPerSecond: 12_000_000 });
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
            const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
            recorder.start(250);
            await new Promise<void>((resolve) => {
                const start = performance.now();
                const tick = () => {
                    const t = (performance.now() - start) / 1000;
                    seek(Math.min(t, shot.duration));
                    if (t >= shot.duration) return resolve();
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
            await nextFrame();
            recorder.stop();
            await stopped;
            capture.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
            const file = await uploadMediaFile(blob, "video");
            const width = canvas.width;
            const height = canvas.height;
            const id = `${CanvasNodeType.Video}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const rect = placeRight(ctx.getDownstream().length * 60, 420, Math.round((420 * height) / width));
            ctx.applyOps([
                {
                    type: "add_node",
                    id,
                    nodeType: CanvasNodeType.Video,
                    title: `${scene.title}·${shot.name}·预演`,
                    position: { x: rect.x, y: rect.y },
                    width: rect.width,
                    height: rect.height,
                    metadata: { content: file.url, storageKey: file.storageKey, status: "success", naturalWidth: width, naturalHeight: height, bytes: file.bytes, mimeType: file.mimeType, durationMs: Math.round(shot.duration * 1000), prompt: directorShotPrompt(scene, shot) },
                },
                { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
            ]);
            message.success(`已录制 ${shot.duration}s 预演，回到画布成新视频节点`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "录制失败");
        } finally {
            setRecording(false);
            setBusy(null);
        }
    };

    const addSubject = () => {
        const subject: DirectorSubject = { id: directorId("subject"), name: `主体${scene.subjects.length + 1}`, kind: "person", color: ["#f59e0b", "#22d3ee", "#a855f7", "#10b981"][scene.subjects.length % 4], height: 1.75, action: "", position: [scene.subjects.length * 1.2, 0, 0], rotationY: 0, keyframes: [] };
        commit({ ...scene, subjects: [...scene.subjects, subject] });
        setSelection({ kind: "subject", id: subject.id });
    };
    const addShot = (preset: DirectorMovePreset) => {
        const next = presetShot(preset, focusOf(), shot.duration);
        commit({ ...scene, shots: [...scene.shots, next], activeShotId: next.id });
        seek(0);
    };
    const applyPreset = (preset: DirectorMovePreset) => {
        commit({ ...scene, shots: scene.shots.map((item) => (item.id === shot.id ? presetShot(preset, focusOf(), shot.duration, { id: item.id, name: item.name, easing: item.easing }) : item)) });
        setSelection(null);
        seek(0);
    };
    const selectedSubject = selection?.kind === "subject" ? scene.subjects.find((item) => item.id === selection.id) : undefined;
    const panel = { background: theme.toolbar.panel, borderColor: theme.toolbar.border };
    const inputStyle = { borderColor: theme.node.stroke, color: theme.node.text };
    const inputClass = "w-full rounded-md border bg-transparent px-2 py-1 text-xs outline-none";
    const initialCamera = useMemo(() => {
        const pose = sampleShot(shot, 0);
        return { position: [pose.position[0] + 6, pose.position[1] + 5, pose.position[2] + 6] as Vec3 };
        // 只在打开时取一次初始导演视角
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div ref={rootRef} className="fixed inset-0 z-[1000] flex flex-col" style={{ background: theme.canvas.background, color: theme.node.text }} onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-sm" style={{ borderColor: theme.toolbar.border }}>
                <Clapperboard className="size-4" style={{ color: "var(--hemosi-accent)" }} />
                <input className="w-56 bg-transparent font-medium outline-none" value={scene.title} onChange={(event) => setScene({ ...scene, title: event.target.value })} onBlur={() => { commit(scene); ctx.updateNode({ title: scene.title }); }} />
                <div className="ml-4 flex items-center gap-1 text-xs">
                    <FlatButton onClick={() => setMode("director")} title="自由视角：拖动主体与机位"><span style={mode === "director" ? { color: "var(--hemosi-accent)", fontWeight: 600 } : undefined}>导演视角</span></FlatButton>
                    <FlatButton onClick={() => { setSelection(null); setMode("shot"); }} title="透过选定机位看画面"><span style={mode === "shot" ? { color: "var(--hemosi-accent)", fontWeight: 600 } : undefined}>镜头视角</span></FlatButton>
                    <Select size="small" className="w-24" value={scene.aspect} options={DIRECTOR_ASPECTS.map((value) => ({ value, label: value }))} onChange={(aspect) => commit({ ...scene, aspect })} />
                </div>
                <div className="ml-auto flex items-center gap-1">
                    <FlatButton disabled={Boolean(busy)} onClick={() => void screenshot(false)} title="以选定机位当前时刻截图，回画布成图片节点并连线">
                        {busy === "shot" ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />} 截图回画布
                    </FlatButton>
                    <FlatButton disabled={Boolean(busy)} onClick={() => void screenshot(true)} title="截图并以它为首帧新建视频节点（draw-to-video）">
                        {busy === "toVideo" ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />} 截图转视频
                    </FlatButton>
                    <FlatButton accent disabled={Boolean(busy)} onClick={() => void record()} title="按选定机位的时长实时渲染并录制，导出为画布上的新视频节点">
                        {busy === "record" ? <Circle className="size-3.5 animate-pulse fill-red-600 text-red-600" /> : <Video className="size-3.5" />} {busy === "record" ? `录制中 ${time.toFixed(1)}s` : "录制运镜→视频节点"}
                    </FlatButton>
                    <FlatButton disabled={recording} onClick={onClose} title="关闭（Esc）"><X className="size-4" /></FlatButton>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                <div className="thin-scrollbar w-72 shrink-0 space-y-4 overflow-y-auto border-r p-3 text-xs" style={{ borderColor: theme.toolbar.border }}>
                    <Section title="AI 搭场景（用设置里的文本模型）">
                        <textarea className={`${inputClass} resize-none leading-5`} style={inputStyle} rows={4} value={instruction} placeholder={ctx.node.metadata?.directorScene ? "在当前场景上修改：加一个路人从左走到右，镜头改成跟拍…" : "描述场景：雨夜巷口，阿杰与黑衣人对峙，镜头从远处缓慢推近，5 秒"} onChange={(event) => setInstruction(event.target.value)} />
                        <FlatButton accent disabled={Boolean(busy) || !instruction.trim()} onClick={() => void runAi()}>
                            {busy === "ai" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {ctx.node.metadata?.directorScene ? "AI 修改场景" : "AI 搭建场景"}
                        </FlatButton>
                        {stream ? <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-all text-[10px] opacity-50">{stream}</pre> : null}
                    </Section>

                    <Section title="画面描述">
                        <textarea className={`${inputClass} resize-none`} style={inputStyle} rows={2} value={scene.description} onChange={(event) => setScene({ ...scene, description: event.target.value })} onBlur={() => commit(scene)} />
                    </Section>

                    <Section title="全景底图（2:1 等距柱状投影）" extra={scene.panorama ? <FlatButton onClick={() => commit({ ...scene, panorama: undefined })}><Trash2 className="size-3" /></FlatButton> : null}>
                        {panoramaUrl ? <img src={panoramaUrl} alt="" className="aspect-[2/1] w-full rounded-md object-cover" /> : null}
                        <FlatButton onClick={() => panoramaInput.current?.click()}><Upload className="size-3.5" /> {scene.panorama ? "更换全景图" : "上传全景图"}</FlatButton>
                        <label className="flex items-center gap-2"><Switch size="small" checked={scene.showGround} onChange={(showGround) => commit({ ...scene, showGround })} /> 显示地面</label>
                        <input ref={panoramaInput} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadPanorama(event)} />
                    </Section>

                    <Section title={`主体 ${scene.subjects.length}`} extra={<FlatButton onClick={addSubject}><Plus className="size-3" />添加</FlatButton>}>
                        {scene.subjects.map((subject) => {
                            const active = selection?.kind === "subject" && selection.id === subject.id;
                            return (
                                <div key={subject.id} className="space-y-1 rounded-md border p-1.5" style={{ borderColor: active ? "var(--hemosi-accent)" : theme.node.stroke }} onClick={() => setSelection({ kind: "subject", id: subject.id })}>
                                    <div className="flex items-center gap-1">
                                        <input type="color" className="size-5 shrink-0 cursor-pointer bg-transparent" value={subject.color} onChange={(event) => patchSubject(subject.id, { color: event.target.value })} />
                                        <input className="min-w-0 flex-1 bg-transparent font-medium outline-none" value={subject.name} onChange={(event) => patchSubject(subject.id, { name: event.target.value })} />
                                        <select className="bg-transparent outline-none" value={subject.kind} onChange={(event) => patchSubject(subject.id, { kind: event.target.value as DirectorSubject["kind"] })}>
                                            {DIRECTOR_SUBJECT_KINDS.map((kind) => <option key={kind} value={kind} style={{ background: theme.toolbar.panel }}>{DIRECTOR_SUBJECT_KIND_LABEL[kind]}</option>)}
                                        </select>
                                        <button type="button" className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" title="删除" onClick={(event) => { event.stopPropagation(); setSelection(null); commit({ ...scene, subjects: scene.subjects.filter((item) => item.id !== subject.id) }); }}><Trash2 className="size-3" /></button>
                                    </div>
                                    {active ? (
                                        <>
                                            <input className={inputClass} style={inputStyle} placeholder="动作：缓步向前、转身…" value={subject.action} onChange={(event) => patchSubject(subject.id, { action: event.target.value })} />
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-60">朝向</span>
                                                <input type="range" min={-180} max={180} value={subject.rotationY} className="flex-1" onChange={(event) => patchSubject(subject.id, { rotationY: Number(event.target.value), keyframes: subject.keyframes.map((frame) => ({ ...frame, rotationY: Number(event.target.value) })) })} />
                                                <span className="w-8 text-right">{subject.rotationY}°</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-60">高度</span>
                                                <input type="number" step={0.05} min={0.1} className={`${inputClass} w-16`} style={inputStyle} value={subject.height} onChange={(event) => patchSubject(subject.id, { height: Math.max(0.1, Number(event.target.value) || 1) })} />
                                                <span className="ml-auto opacity-60">走位关键帧 {subject.keyframes.length}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                <FlatButton title="把当前位置记为此刻的走位关键帧（之后拖动会改此刻的位置）" onClick={() => { const pose = sampleSubject(subject, clock.current.t); patchSubject(subject.id, { keyframes: [...subject.keyframes.filter((frame) => Math.abs(frame.t - clock.current.t) > 0.05), { t: round(clock.current.t), position: pose.position, rotationY: pose.rotationY }].sort((a, b) => a.t - b.t) }); }}>
                                                    <Plus className="size-3" />此刻走位
                                                </FlatButton>
                                                {subject.keyframes.length ? <FlatButton onClick={() => patchSubject(subject.id, { keyframes: [] })}>清空走位</FlatButton> : null}
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            );
                        })}
                    </Section>
                    <div className="text-[11px] leading-5 opacity-50">导演视角下点选主体 / 机位 / 橙色目标点，拖动坐标轴移动；滚轮缩放、右键平移。</div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                    <div ref={boxRef} className="relative grid min-h-0 flex-1 place-items-center p-3">
                        <div className="overflow-hidden rounded-md" style={{ width: size.width, height: size.height, outline: mode === "shot" || recording ? "1px solid var(--hemosi-accent)" : undefined }}>
                            {size.width > 0 ? (
                                <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: initialCamera.position, fov: 50, near: 0.05, far: 2000 }} onPointerMissed={() => director && setSelection(null)}>
                                    <ApiBridge apiRef={apiRef} />
                                    {panoramaUrl ? <Panorama url={panoramaUrl} /> : <color attach="background" args={[theme.canvas.background === "#181715" ? "#1c1b19" : "#d9d6cf"]} />}
                                    <hemisphereLight args={["#ffffff", "#444444", 0.9]} />
                                    <directionalLight position={[5, 10, 6]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
                                    {scene.showGround ? (
                                        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                                            <planeGeometry args={[200, 200]} />
                                            <meshStandardMaterial color={scene.groundColor} transparent={Boolean(panoramaUrl)} opacity={panoramaUrl ? 0.35 : 1} />
                                        </mesh>
                                    ) : null}
                                    {director ? <Grid position={[0, 0.002, 0]} args={[40, 40]} cellColor="#6b7280" sectionColor="#9ca3af" fadeDistance={40} infiniteGrid /> : null}
                                    {scene.subjects.map((subject) => (
                                        <SubjectMesh key={subject.id} subject={subject} clock={clock} dragging={dragging} register={register} director={director} selected={selection?.kind === "subject" && selection.id === subject.id} onSelect={() => setSelection({ kind: "subject", id: subject.id })} />
                                    ))}
                                    {director ? (
                                        <>
                                            <CameraRig shot={shot} register={register} selection={selection} onSelect={setSelection} />
                                            <LiveCameraMarker shot={shot} clock={clock} />
                                            <OrbitControls makeDefault target={[0, 1, 0]} />
                                            <Gizmo objects={objects} selection={selection} onStart={() => (dragging.current = true)} onEnd={endDrag} />
                                        </>
                                    ) : (
                                        <ShotCamera shot={shot} clock={clock} />
                                    )}
                                </Canvas>
                            ) : null}
                        </div>
                        {recording ? <div className="absolute left-5 top-5 rounded px-2 py-0.5 text-xs" style={{ background: "rgba(127,29,29,.85)", color: "#fff" }}>● REC {time.toFixed(1)} / {shot.duration}s</div> : null}
                    </div>

                    <div className="shrink-0 space-y-2 border-t px-3 py-2 text-xs" style={{ ...panel, borderTopColor: theme.toolbar.border }}>
                        <div className="flex items-center gap-2">
                            <FlatButton disabled={recording} onClick={() => { if (!playing && clock.current.t >= shot.duration) seek(0); setPlaying(!playing); }}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</FlatButton>
                            <input type="range" min={0} max={shot.duration} step={0.01} value={time} disabled={recording} className="flex-1" onChange={(event) => { setPlaying(false); seek(Number(event.target.value)); }} />
                            <span className="w-24 text-right tabular-nums">{time.toFixed(2)} / {shot.duration}s</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                            <span className="opacity-60">机位</span>
                            {scene.shots.map((item) => (
                                <button key={item.id} type="button" className="rounded-md px-2 py-0.5" style={item.id === shot.id ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined} onClick={() => { commit({ ...scene, activeShotId: item.id }); setSelection(null); seek(0); }}>
                                    {item.name}
                                </button>
                            ))}
                            <Select<string | null> size="small" className="w-28" placeholder="+ 新机位" value={null} options={DIRECTOR_MOVE_PRESETS.map((item) => ({ value: item.id, label: `+ ${item.label}` }))} onChange={(value) => value && addShot(value as DirectorMovePreset)} />
                            {scene.shots.length > 1 ? <FlatButton title="删除当前机位" onClick={() => { const shots = scene.shots.filter((item) => item.id !== shot.id); commit({ ...scene, shots, activeShotId: shots[0].id }); setSelection(null); }}><Trash2 className="size-3" /></FlatButton> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <input className="w-28 rounded-md border bg-transparent px-2 py-0.5 outline-none" style={inputStyle} value={shot.name} onChange={(event) => patchShot({ name: event.target.value })} title="机位名" />
                            <input className="w-36 rounded-md border bg-transparent px-2 py-0.5 outline-none" style={inputStyle} value={shot.move} placeholder="运镜描述" onChange={(event) => patchShot({ move: event.target.value })} />
                            <label className="flex items-center gap-1">
                                时长
                                <input type="number" min={0.5} max={60} step={0.5} className="w-14 rounded-md border bg-transparent px-1 py-0.5 outline-none" style={inputStyle} value={shot.duration} onChange={(event) => { const duration = Math.min(60, Math.max(0.5, Number(event.target.value) || 1)); const scale = duration / shot.duration; patchShot({ duration, keyframes: shot.keyframes.map((frame) => ({ ...frame, t: round(frame.t * scale) })) }); seek(Math.min(clock.current.t, duration)); }} />s
                            </label>
                            <Select size="small" className="w-24" value={shot.easing} options={DIRECTOR_EASINGS.map((value) => ({ value, label: DIRECTOR_EASING_LABEL[value] }))} onChange={(easing) => patchShot({ easing })} />
                            <span className="opacity-60">运镜预设</span>
                            {DIRECTOR_MOVE_PRESETS.map((item) => <FlatButton key={item.id} title={`以${selectedSubject?.name || scene.subjects[0]?.name || "原点"}为对象套用「${item.label}」`} onClick={() => applyPreset(item.id)}>{item.label}</FlatButton>)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                            <span className="opacity-60">关键帧</span>
                            {shot.keyframes.map((frame, index) => {
                                const active = (selection?.kind === "camera" || selection?.kind === "target") && selection.index === index;
                                return (
                                    <span key={index} className="flex items-center rounded-md border" style={{ borderColor: active ? "var(--hemosi-accent)" : theme.node.stroke }}>
                                        <button type="button" className="px-1.5 py-0.5" onClick={() => { setMode("director"); setSelection({ kind: "camera", index }); seek(frame.t); }}>
                                            {frame.t}s · {Math.round(frame.fov)}°
                                        </button>
                                        {active ? (
                                            <>
                                                <input type="number" className="w-12 bg-transparent px-1 outline-none" title="时刻（秒）" step={0.1} min={0} max={shot.duration} value={frame.t} onChange={(event) => patchShot({ keyframes: shot.keyframes.map((item, i) => (i === index ? { ...item, t: Math.min(shot.duration, Math.max(0, Number(event.target.value) || 0)) } : item)).sort((a, b) => a.t - b.t) })} />
                                                <input type="range" title="视场角（越小越长焦）" min={10} max={100} value={frame.fov} className="w-20" onChange={(event) => patchShot({ keyframes: shot.keyframes.map((item, i) => (i === index ? { ...item, fov: Number(event.target.value) } : item)) })} />
                                            </>
                                        ) : null}
                                        {shot.keyframes.length > 1 ? <button type="button" className="px-1 opacity-60 hover:opacity-100" title="删除关键帧" onClick={() => { setSelection(null); patchShot({ keyframes: shot.keyframes.filter((_, i) => i !== index) }); }}><X className="size-3" /></button> : null}
                                    </span>
                                );
                            })}
                            <FlatButton disabled={mode !== "director"} title="把导演视角当前的相机位置与视线记为此刻的关键帧" onClick={recordKeyframe}><Plus className="size-3" />当前视角记为 {time.toFixed(1)}s 关键帧</FlatButton>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
