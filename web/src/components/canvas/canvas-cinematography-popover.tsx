import { useState, type ReactNode } from "react";
import { Button, Checkbox, InputNumber, Popover, Select, Slider, Switch, Tooltip } from "antd";
import { Clapperboard, Lightbulb } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CAMERA_ANGLES, CAMERA_BODIES, CAMERA_LENSES, CAMERA_MOVES, LIGHT_DIRECTIONS, LIGHT_MOODS, SHOT_SIZES, cameraSummary, hasCamera, hasLighting, lightingSummary } from "@/lib/canvas/canvas-cinematography";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CameraSettings, LightingSettings, LightSource } from "@/types/cinematography";

const FOCALS = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135, 200];
const APERTURES = [1.2, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const stop = { onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onWheel: (event: { stopPropagation: () => void }) => event.stopPropagation() };
const opts = (list: Array<{ value: string; label: string }>) => list.map(({ value, label }) => ({ value, label }));

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="opacity-60">{label}</span>
            {children}
        </label>
    );
}

export function CameraEditor({ value, onChange, onSplitAngles }: { value?: CameraSettings; onChange: (camera: CameraSettings | undefined) => void; onSplitAngles?: (angles: string[]) => void }) {
    const camera = value || {};
    const [angles, setAngles] = useState<string[]>([]);
    const set = (patch: Partial<CameraSettings>) => {
        const next = { ...camera, ...patch };
        onChange(hasCamera(next) ? next : undefined);
    };
    return (
        <div className="space-y-2">
            <Row label="机型">
                <Select size="small" allowClear value={camera.body} options={opts(CAMERA_BODIES)} placeholder="不指定" onChange={(body) => set({ body })} />
            </Row>
            <Row label="镜头">
                <Select size="small" allowClear value={camera.lens} options={opts(CAMERA_LENSES)} placeholder="不指定" onChange={(lens) => set({ lens })} />
            </Row>
            <Row label="焦距">
                <Select size="small" allowClear value={camera.focalLength} options={FOCALS.map((value) => ({ value, label: `${value}mm${value <= 24 ? " 广角" : value >= 85 ? " 长焦" : ""}` }))} placeholder="不指定" onChange={(focalLength) => set({ focalLength })} />
            </Row>
            <Row label="光圈">
                <Select size="small" allowClear value={camera.aperture} options={APERTURES.map((value) => ({ value, label: `f/${value}${value <= 2.8 ? " 浅景深" : value >= 8 ? " 全清晰" : ""}` }))} placeholder="不指定" onChange={(aperture) => set({ aperture })} />
            </Row>
            <Row label="景别">
                <Select size="small" allowClear value={camera.shotSize} options={opts(SHOT_SIZES)} placeholder="不指定" onChange={(shotSize) => set({ shotSize })} />
            </Row>
            <Row label="角度">
                <Select size="small" allowClear value={camera.angle} options={opts(CAMERA_ANGLES)} placeholder="不指定" onChange={(angle) => set({ angle })} />
            </Row>
            <Row label="运镜">
                <Select size="small" allowClear value={camera.movement} options={opts(CAMERA_MOVES)} placeholder="不指定" onChange={(movement) => set({ movement })} />
            </Row>
            <Row label="速度">
                <Select size="small" allowClear value={camera.movementSpeed} options={[{ value: "slow", label: "慢" }, { value: "medium", label: "中" }, { value: "fast", label: "快" }]} placeholder="默认" onChange={(movementSpeed) => set({ movementSpeed })} />
            </Row>
            {onSplitAngles ? (
                <div className="space-y-1 border-t pt-2" style={{ borderColor: "rgba(127,127,127,.25)" }}>
                    <div className="text-xs opacity-60">多角度：勾选几个角度，按角度拆成同内容的多个分镜（每个分镜各用一个角度）</div>
                    <Checkbox.Group className="!grid grid-cols-3 gap-1 text-xs" value={angles} options={opts(CAMERA_ANGLES)} onChange={(values) => setAngles(values as string[])} />
                    <Button size="small" block disabled={angles.length < 2} onClick={() => onSplitAngles(angles)}>
                        拆成 {angles.length || ""} 个角度分镜
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function LightRow({ label, light, onChange }: { label: string; light?: LightSource; onChange: (light: LightSource) => void }) {
    const current = light || {};
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="opacity-60">{label}</span>
                <Switch size="small" checked={Boolean(current.enabled)} onChange={(enabled) => onChange({ intensity: 60, quality: "soft", direction: label === "轮廓光" ? "back" : "left", ...current, enabled })} />
            </div>
            {current.enabled ? (
                <div className="grid grid-cols-[1fr_1fr_64px] gap-1">
                    <Select size="small" value={current.direction} options={opts(LIGHT_DIRECTIONS)} onChange={(direction) => onChange({ ...current, direction })} />
                    <Select size="small" value={current.quality || "soft"} options={[{ value: "soft", label: "柔光" }, { value: "hard", label: "硬光" }]} onChange={(quality) => onChange({ ...current, quality })} />
                    <InputNumber size="small" min={0} max={100} value={current.intensity} suffix="%" onChange={(intensity) => onChange({ ...current, intensity: intensity ?? undefined })} />
                </div>
            ) : null}
        </div>
    );
}

export function LightingEditor({ value, onChange }: { value?: LightingSettings; onChange: (lighting: LightingSettings | undefined) => void }) {
    const lighting = value || {};
    const set = (patch: Partial<LightingSettings>) => {
        const next = { ...lighting, ...patch };
        onChange(hasLighting(next) ? next : undefined);
    };
    return (
        <div className="space-y-2">
            <Row label="氛围">
                <Select size="small" allowClear value={lighting.mood} options={opts(LIGHT_MOODS)} placeholder="不指定" onChange={(mood) => set({ mood })} />
            </Row>
            <Row label={`亮度 ${lighting.brightness ?? "—"}`}>
                <Slider min={-100} max={100} step={10} value={lighting.brightness ?? 0} onChange={(brightness) => set({ brightness })} />
            </Row>
            <Row label={`色温 ${lighting.colorTemp ? `${lighting.colorTemp}K` : "—"}`}>
                <Slider min={2000} max={10000} step={100} value={lighting.colorTemp ?? 5600} onChange={(colorTemp) => set({ colorTemp })} />
            </Row>
            <LightRow label="主光" light={lighting.key} onChange={(key) => set({ key })} />
            <LightRow label="轮廓光" light={lighting.rim} onChange={(rim) => set({ rim })} />
            <Button size="small" type="text" className="!px-1 !text-xs" onClick={() => onChange(undefined)}>
                清空灯光
            </Button>
        </div>
    );
}

/**
 * Camera + lighting button on a generation node. Camera is this node's own; lighting can be set here (overrides)
 * or on the group / scene anchor so a whole scene shares one setup.
 */
export function CanvasCinematographyButton({ camera, lighting, inheritedLighting, sections = "both", onCameraChange, onLightingChange, onSplitAngles }: { camera?: CameraSettings; lighting?: LightingSettings; inheritedLighting?: string; sections?: "both" | "lighting"; onCameraChange?: (camera: CameraSettings | undefined) => void; onLightingChange: (lighting: LightingSettings | undefined) => void; onSplitAngles?: (angles: string[]) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<"camera" | "lighting">(sections === "lighting" ? "lighting" : "camera");
    const active = hasCamera(camera) || hasLighting(lighting);
    const summary = [cameraSummary(camera), lightingSummary(lighting) || (inheritedLighting ? `灯光继承：${inheritedLighting}` : "")].filter(Boolean).join("\n");
    const content = (
        <div className="w-72 space-y-2" data-canvas-no-zoom {...stop}>
            {sections === "both" ? (
                <div className="flex gap-1 text-xs">
                    {(["camera", "lighting"] as const).map((key) => (
                        <button key={key} type="button" className="rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" style={tab === key ? { background: theme.toolbar.activeBg } : undefined} onClick={() => setTab(key)}>
                            {key === "camera" ? "摄像机" : "灯光"}
                        </button>
                    ))}
                </div>
            ) : null}
            {tab === "camera" && onCameraChange ? <CameraEditor value={camera} onChange={onCameraChange} onSplitAngles={onSplitAngles} /> : <LightingEditor value={lighting} onChange={onLightingChange} />}
            {tab === "lighting" && !hasLighting(lighting) && inheritedLighting ? <div className="text-xs opacity-60">本节点没单独设灯光，生成时用：{inheritedLighting}</div> : null}
            <div className="text-[11px] opacity-50">设置会写进本节点生成请求（提示词里的【摄像机】【灯光】段，支持的模型还会带原生参数），确认卡里可核对。</div>
        </div>
    );
    return (
        <Popover trigger="click" placement="topLeft" content={content}>
            <Tooltip title={summary || (sections === "lighting" ? "整组灯光" : "摄像机与灯光")}>
                <Button type="text" className="!h-10 !w-10 !min-w-10 !rounded-full !p-0" style={{ color: active ? "var(--hemosi-accent)" : theme.node.text }} icon={sections === "lighting" ? <Lightbulb className="size-3.5" /> : <Clapperboard className="size-3.5" />} />
            </Tooltip>
        </Popover>
    );
}
