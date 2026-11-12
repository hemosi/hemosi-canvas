import "./storyai-desk/styles/index.css";
import { useEffect, useState } from "react";
import { App } from "antd";
import { Camera, Send, X } from "lucide-react";
import { nanoid } from "nanoid";

import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadImage } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { DirectorDeskShell } from "./storyai-desk/app/layout/DirectorDeskShell";
import { DirectorCanvas } from "./storyai-desk/editor/canvas/DirectorCanvas";
import { requestViewportCapture } from "./storyai-desk/editor/io/captureBridge";
import { setHostCapturesCallback } from "./storyai-desk/editor/io/hostBridge";
import { useDirectorStore } from "./storyai-desk/editor/store/directorStore";

function isEditableShortcutTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], fileName, { type: blob.type || "image/png" });
}

export default function DirectorStage({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { message } = App.useApp();
    const themeMode = useThemeStore((state) => state.theme);
    const viewMode = useDirectorStore((state) => state.viewMode);
    const setViewMode = useDirectorStore((state) => state.setViewMode);
    const [sending, setSending] = useState(false);

    // Load scoped 3D scene for this canvas node & sync upstream panorama if connected
    useEffect(() => {
        useDirectorStore.getState().openScopedScene(ctx.node.id);
        const upstreamImg = ctx
            .getUpstream()
            .map((n) => n.metadata?.images?.[0]?.content || n.metadata?.shotImage?.content || n.metadata?.content)
            .find((url) => url && !url.startsWith("blob:video"));
        if (upstreamImg && !useDirectorStore.getState().project.panoramaAssetId) {
            useDirectorStore.getState().addImportedAsset({
                kind: "panorama",
                name: "上游参考背景图",
                fileName: "panorama.png",
                url: upstreamImg,
                projectionMode: "backdrop",
            });
        }
    }, [ctx]);

    // Handle sending one or more captures back to HemosiTV canvas as downstream Image nodes
    useEffect(() => {
        const sendCapturesToCanvas = async (captures: Array<{ dataUrl: string; fileName: string }>) => {
            if (!captures.length) return;
            setSending(true);
            try {
                const uploadedList = await Promise.all(
                    captures.map(async (item, idx) => {
                        const file = await dataUrlToFile(item.dataUrl, item.fileName || `机位截图-${idx + 1}.png`);
                        const up = await uploadImage(file);
                        return { ...up, title: (item.fileName || `机位截图 ${idx + 1}`).replace(/\.[^.]+$/, "") };
                    }),
                );
                const first = uploadedList[0];
                if (first) {
                    const prevScene = ctx.node.metadata?.directorScene;
                    ctx.updateMetadata({
                        directorScene: {
                            ...(prevScene || { version: 1, title: ctx.node.title || "3D 导演台", description: "", aspect: "16:9", groundColor: "#14181d", showGround: true, subjects: [], shots: [], activeShotId: "" }),
                            preview: { content: first.url, storageKey: first.storageKey, width: first.width, height: first.height },
                        },
                    });
                }

                const ops = uploadedList.map((img, index) => {
                    const size = fitNodeSize(img.width, img.height);
                    return {
                        type: "add_node" as const,
                        nodeType: CanvasNodeType.Image,
                        title: img.title,
                        position: {
                            x: ctx.node.position.x + ctx.node.width + 64,
                            y: ctx.node.position.y + index * (size.height + 28),
                        },
                        width: size.width,
                        height: size.height,
                        connectFrom: ctx.node.id,
                        metadata: {
                            status: "success" as const,
                            content: img.url,
                            storageKey: img.storageKey,
                            naturalWidth: img.width,
                            naturalHeight: img.height,
                            bytes: img.bytes,
                            mimeType: img.mimeType,
                            images: [
                                {
                                    id: nanoid(),
                                    status: "success" as const,
                                    content: img.url,
                                    storageKey: img.storageKey,
                                    naturalWidth: img.width,
                                    naturalHeight: img.height,
                                    bytes: img.bytes,
                                    mimeType: img.mimeType,
                                },
                            ],
                        },
                    };
                });
                ctx.applyOps(ops);
                message.success(`已将 ${uploadedList.length} 张机位画面发送到画布`);
            } catch (err) {
                message.error(err instanceof Error ? err.message : "发送机位截图失败");
            } finally {
                setSending(false);
            }
        };

        setHostCapturesCallback((captures) => {
            void sendCapturesToCanvas(captures);
        });
        return () => setHostCapturesCallback(null);
    }, [ctx, message]);

    // Keyboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z, Esc) inside 3D Director Desk
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape" && !isEditableShortcutTarget(event.target)) {
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
            if (!event.metaKey && !event.ctrlKey) return;

            const key = event.key.toLowerCase();
            if (key === "c") {
                event.preventDefault();
                event.stopPropagation();
                useDirectorStore.getState().copySelectedObjects();
                return;
            }
            if (key === "v") {
                event.preventDefault();
                event.stopPropagation();
                useDirectorStore.getState().pasteClipboardObjects();
                return;
            }
            if (key === "z" && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                useDirectorStore.getState().undo();
            }
        }
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [onClose]);

    const handleQuickCaptureToCanvas = async () => {
        if (sending) return;
        try {
            const shot = await requestViewportCapture();
            const state = useDirectorStore.getState();
            const activeCam = state.project.cameras.find((c) => c.id === state.project.activeCameraId);
            if (activeCam) {
                state.addCameraCaptures(activeCam.id, [
                    {
                        id: nanoid(),
                        name: `${activeCam.name}-机位图`,
                        createdAt: new Date().toISOString(),
                        dataUrl: shot.dataUrl,
                        width: shot.meta.width,
                        height: shot.meta.height,
                    },
                ]);
            }
            const file = await dataUrlToFile(shot.dataUrl, `${activeCam?.name || "3D机位"}.png`);
            const up = await uploadImage(file);
            const prevScene = ctx.node.metadata?.directorScene;
            ctx.updateMetadata({
                directorScene: {
                    ...(prevScene || { version: 1, title: ctx.node.title || "3D 导演台", description: "", aspect: "16:9", groundColor: "#14181d", showGround: true, subjects: [], shots: [], activeShotId: "" }),
                    preview: { content: up.url, storageKey: up.storageKey, width: up.width, height: up.height },
                },
            });
            const size = fitNodeSize(up.width, up.height);
            ctx.applyOps([
                {
                    type: "add_node",
                    nodeType: CanvasNodeType.Image,
                    title: `${activeCam?.name || "3D 机位"} 构图参考`,
                    position: { x: ctx.node.position.x + ctx.node.width + 64, y: ctx.node.position.y },
                    width: size.width,
                    height: size.height,
                    connectFrom: ctx.node.id,
                    metadata: {
                        status: "success",
                        content: up.url,
                        storageKey: up.storageKey,
                        naturalWidth: up.width,
                        naturalHeight: up.height,
                        bytes: up.bytes,
                        mimeType: up.mimeType,
                        images: [
                            {
                                id: nanoid(),
                                status: "success",
                                content: up.url,
                                storageKey: up.storageKey,
                                naturalWidth: up.width,
                                naturalHeight: up.height,
                                bytes: up.bytes,
                                mimeType: up.mimeType,
                            },
                        ],
                    },
                },
            ]);
            message.success("已截取当前 3D 机位画面并发送到画布！");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "截图失败");
        }
    };

    const handleCloseWithPreview = async () => {
        try {
            const shot = await requestViewportCapture();
            const file = await dataUrlToFile(shot.dataUrl, "director-preview.png");
            const up = await uploadImage(file);
            const prevScene = ctx.node.metadata?.directorScene;
            ctx.updateMetadata({
                directorScene: {
                    ...(prevScene || { version: 1, title: ctx.node.title || "3D 导演台", description: "", aspect: "16:9", groundColor: "#14181d", showGround: true, subjects: [], shots: [], activeShotId: "" }),
                    preview: { content: up.url, storageKey: up.storageKey, width: up.width, height: up.height },
                },
            });
        } catch {
            // ignore preview capture failure on close
        }
        onClose();
    };

    return (
        <div
            className="storyai-director-desk-root fixed inset-0 z-[1100]"
            data-theme={themeMode === "light" ? "light" : "dark"}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            <div className="app-shell">
                <header className="top-bar">
                    <div className="top-bar-left" style={{ gap: 10 }}>
                        <h1 className="top-bar-title">3D 导演工作台 · {ctx.node.title || "场记调度"}</h1>
                    </div>
                    <div className="top-bar-center">
                        <div className="mode-toggle ui-segmented" role="group" aria-label="视角切换">
                            <button
                                className={`mode-toggle-button ui-segmented-item ${viewMode === "director" ? "ui-segmented-item-active" : ""}`}
                                aria-pressed={viewMode === "director"}
                                type="button"
                                onClick={() => setViewMode("director")}
                            >
                                导演视角 (自由布景)
                            </button>
                            <button
                                className={`mode-toggle-button ui-segmented-item ${viewMode === "camera" ? "ui-segmented-item-active" : ""}`}
                                aria-pressed={viewMode === "camera"}
                                type="button"
                                onClick={() => setViewMode("camera")}
                            >
                                机位视角 (镜头取景)
                            </button>
                        </div>
                    </div>
                    <div className="top-bar-actions" style={{ gap: 10 }}>
                        <button
                            type="button"
                            disabled={sending}
                            onClick={() => void handleQuickCaptureToCanvas()}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                height: 34,
                                padding: "0 14px",
                                borderRadius: 10,
                                border: "none",
                                background: "linear-gradient(90deg, #00c8c2, #00dbd0)",
                                color: "#051918",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                            title="截取当前 3D 视口画面并在画布右侧生成参考图节点"
                        >
                            <Camera size={15} />
                            <span>出图到画布</span>
                            <Send size={13} />
                        </button>
                        <button
                            className="top-bar-action-button"
                            type="button"
                            aria-label="关闭"
                            title="保存预览并返回画布 (Esc)"
                            onClick={() => void handleCloseWithPreview()}
                        >
                            <X aria-hidden="true" size={16} strokeWidth={1.8} />
                        </button>
                    </div>
                </header>
                <DirectorDeskShell>
                    <DirectorCanvas />
                </DirectorDeskShell>
            </div>
        </div>
    );
}
