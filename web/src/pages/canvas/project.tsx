import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bookmark, Box, Clapperboard, Columns2, Copy, Film, Flame, Download, Group, History, Image as ImageIcon, Keyboard, LayoutGrid, Link2, ListChecks, Play, Ratio, RotateCcw, Rows3, Search, Table2, Trash2, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { defaultConfig, modelNotReadyReason, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { ensureImagePreview, uploadImage } from "@/services/image-storage";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { formatBytes, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, resizeByShortEdgeDataUrl, resolveShortEdgeSize, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { captureVideoFrameSafe, VideoFrameTaintedError, type VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { App, Button, Input, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { withCinematography, buildNodeGenerationContext, buildNodeGenerationInputs, buildUpstreamTextBlock, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { flushCanvasSave, useCanvasSaveStatus, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useWorkspaceStore } from "@/stores/canvas/use-workspace-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { buildNodeMentionReferences, getGroupResourceNodes, isCanvasReferenceNode, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { StoryboardConfirmModal, type StoryboardConfirmState } from "@/components/canvas/storyboard-confirm-modal";
import { StoryboardGhostLayer } from "@/components/canvas/storyboard-ghost-layer";
import { applyCanvasPlan, applyPlan, type GhostPreviewNode } from "@/lib/canvas/storyboard-plan";
import { runWithConcurrency, summarizeStoryboardRun } from "@/lib/canvas/storyboard-queue";
import { emitCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { allocateRefId, ensureNodeRefIds } from "@/lib/canvas/node-ref-id";
import { createEmptyStoryboardData, reconcileStoryboardGraph } from "@/lib/canvas/storyboard-utils";
import { applyGroupSelection, applyUngroupSelection, canGroupSelectedNodes, canUngroupSelectedNodes, collectGroupMemberNodes, findContainingGroupId, findGroupDropTarget, focusViewportForNode, getConnectionTargetAnchor, getGroupWrapRect, normalizeConnection, snapNodesIntoGroup } from "@/lib/canvas/canvas-node-geometry";
import {
    audioExtension,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    generationReferenceUrls,
    getGenerationCount,
    getInputSummary,
    hasResumableVideoTask,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    resetInterruptedGeneration,
    resolveGenerationSource,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { registerHemosiNodes } from "@/components/canvas/nodes/hemosi-nodes";
import { DIRECTOR_NODE_TYPE, registerDirectorNodes } from "@/components/canvas/nodes/director-node";
import { canDrawToVideo, drawToVideoOps } from "@/lib/canvas/canvas-draw-to-video";
import { downstreamNodeCount, nextShotNo, renumberShotRows, setShotHost, shotRowMembers, splitScript } from "@/lib/canvas/canvas-shot-actions";
import { useShotGeneration } from "@/pages/canvas/hooks/use-shot-generation";
import { useGenerationTracker } from "@/pages/canvas/hooks/use-generation-tracker";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import { CanvasQuickGrowMenu } from "@/components/canvas/canvas-quick-grow-menu";
import { CanvasGenerationConfirmModal, buildGenerationConfirmSummary, type GenerationConfirmSummary } from "@/components/canvas/canvas-generation-confirm-modal";
import { applyDraftConfig, draftParamsFor, isDraftMode } from "@/lib/canvas/canvas-draft";
import { stripGeneratedResult } from "@/lib/canvas/canvas-node-clone";
import { CONNECTION_KINDS, CONNECTION_KIND_LABEL, connectionKindOf, connectionKindProblem, inferConnectionKind } from "@/lib/canvas/canvas-connection-kind";
import { MenuButton } from "@/components/canvas/canvas-context-menu";
import { deleteVersion, restoreVersion, withPreviousVersion } from "@/lib/canvas/canvas-node-versions";
import { CanvasNodeVersionsModal } from "@/components/canvas/canvas-node-versions-modal";
import { CanvasGenerationQueue, collectQueueItems, type QueueItem } from "@/components/canvas/canvas-generation-queue";
import { CanvasNodeSearch, flashNode } from "@/components/canvas/canvas-node-search";
import { CanvasShortcutsList } from "@/components/canvas/canvas-shortcuts-list";
import { autoLayoutNodes } from "@/lib/canvas/canvas-layout";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { useGenerationLogStore } from "@/stores/canvas/use-generation-log-store";
import { ModelPicker } from "@/components/model-picker";
import { isGenerationTarget } from "@/lib/canvas/canvas-connection-kind";
import { connectionsTouching, downloadNodeContent, duplicateNodeWithLinks, restoreTextVersion, takeTextSelection, toggleNodeCollapsed, withTextVersion } from "@/lib/canvas/canvas-node-ops";
import { buildTemplateFromSelection, instantiateTemplate, templateName, type CanvasTemplate } from "@/lib/canvas/canvas-templates";
import { findTemplate, useTemplateStore } from "@/stores/use-template-store";
import { CanvasSaveTemplateModal, CanvasTemplateModal } from "@/components/canvas/canvas-templates";
import { findFreeRightPosition, quickGrowKinds, quickGrowNodeType, type QuickGrowKind } from "@/lib/canvas/canvas-quick-grow";
import {
    CanvasNodeType,
    HemosiNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeText,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();
registerHemosiNodes();
registerDirectorNodes();

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 56;
const CONNECTION_NODE_HIT_PADDING = 44;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

function applyGeneratedVideo(item: CanvasNodeData, video: UploadedFile, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const videoSize = fitNodeSize(video.width || item.width, video.height || item.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    return {
        ...item,
        width: videoSize.width,
        height: videoSize.height,
        position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
        metadata: withPreviousVersion(item, { ...item.metadata, ...videoMetadata(video), ...extra }),
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function measureFocusFrame(container: HTMLDivElement | null, nodeId: string) {
    if (!container) return {};
    const nodeRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
    const panelRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-node-panel]`)?.getBoundingClientRect();
    const toolbarRect = document.querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)?.getBoundingClientRect();
    const dockRect = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
    const below = nodeRect && panelRect ? panelRect.bottom - nodeRect.bottom : 0;
    const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
    return { above, below, bottomInset: dockRect && below > 0 ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top) : 0 };
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        altDuplicatePending?: boolean;
        startX: number;
        startY: number;
        // Keyed by node id so drag frames look positions up in O(1) instead of scanning the array per node.
        initialSelectedNodes: Map<string, { x: number; y: number }>;
        movedIds: Set<string>;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: new Map(),
        movedIds: new Set(),
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("pan");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [storyboardHoverIds, setStoryboardHoverIds] = useState<string[]>([]);
    const [storyboardGhostNodes, setStoryboardGhostNodes] = useState<GhostPreviewNode[]>([]);
    const [storyboardConfirm, setStoryboardConfirm] = useState<StoryboardConfirmState | null>(null);
    const handleRetryNodeRef = useRef<((node: CanvasNodeData, imageId?: string, retryOptions?: { skipConfirm?: boolean }) => Promise<unknown>) | null>(null);
    const refCountersRef = useRef<Record<string, number>>({});
    // Every node gets a short @图n-style id, including pictures dragged, pasted or dropped in from the asset library, so the Agent can bind them.
    useEffect(() => {
        if (!nodes.some((node) => !node.metadata?.refId)) return;
        const result = ensureNodeRefIds(nodes, refCountersRef.current);
        if (!result.changed) return;
        refCountersRef.current = result.counters;
        setNodes(result.nodes);
    }, [nodes]);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [shortResizeNodeId, setShortResizeNodeId] = useState<string | null>(null);
    const [shortResizeEdge, setShortResizeEdge] = useState<string>("768");
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [hoverPreviewNodeId, setHoverPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedBatchNodeIds, setExpandedBatchNodeIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [referencePickerNodeId, setReferencePickerNodeId] = useState<string | null>(null);
    const [quickGrowMenu, setQuickGrowMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
    const [generationConfirmSummary, setGenerationConfirmSummary] = useState<GenerationConfirmSummary | null>(null);
    const generationConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
    const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
    const [saveTemplateNodeIds, setSaveTemplateNodeIds] = useState<Set<string> | null>(null);
    const [labelEdit, setLabelEdit] = useState<{ connectionId: string; value: string } | null>(null);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const focusAnimRef = useRef<number | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { origin?: "agent" }) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const videoPollIdsRef = useRef(new Set<string>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    // Pre-generation confirm card. Resolves true right away when the user turned confirmation off in settings.
    // Agent-started runs use the same card; "Agent 发起的生成也确认" (on by default) can opt them out.
    const trackGeneration = useGenerationTracker(projectId, nodes);
    // With a nodeId the accepted request is also written to the generation records (shots log themselves).
    const requestGenerationConfirm = useCallback((summary: GenerationConfirmSummary, origin: "user" | "agent" = "user", nodeId?: string, skipConfirm = false) => {
        const record = (confirmed: boolean) => {
            if (confirmed && nodeId) trackGeneration(summary, nodeId, nodesRef.current.find((node) => node.id === nodeId)?.title || nodeId);
            return confirmed;
        };
        const { confirmBeforeGenerate, confirmAgentGenerations } = useConfigStore.getState().config;
        // skipConfirm: a batch already showed one card for all of its items.
        if (skipConfirm || !confirmBeforeGenerate || (origin === "agent" && !confirmAgentGenerations)) return Promise.resolve(record(true));
        generationConfirmResolveRef.current?.(false);
        return new Promise<boolean>((resolve) => {
            generationConfirmResolveRef.current = (confirmed) => resolve(record(confirmed));
            setGenerationConfirmSummary(summary);
        });
    }, [trackGeneration]);

    const settleGenerationConfirm = useCallback((confirmed: boolean, dontAskAgain = false) => {
        if (confirmed && dontAskAgain) useConfigStore.getState().updateConfig("confirmBeforeGenerate", false);
        const resolve = generationConfirmResolveRef.current;
        generationConfirmResolveRef.current = null;
        setGenerationConfirmSummary(null);
        resolve?.(confirmed);
    }, []);

    useEffect(() => () => generationConfirmResolveRef.current?.(false), []);

    const { runShot, runShots } = useShotGeneration({ projectId, nodesRef, connectionsRef, setNodes, effectiveConfig, isAiConfigReady, openConfigDialog, requestGenerationConfirm, startGenerationRequest, finishGenerationRequest });
    const [versionsNodeId, setVersionsNodeId] = useState<string | null>(null);
    const jumpToBookmark = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            // Reset zoom to 100% (k = 1) and place the bookmark at the top-left corner of the visible canvas area
            const k = 1;
            const sidePanel = useCanvasSidePanelStore.getState();
            const leftInset = sidePanel.panelOpen ? sidePanel.width + 24 : 24;
            const topInset = 64;
            const target = {
                x: leftInset - node.position.x * k,
                y: topInset - node.position.y * k,
                k,
            };
            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            const start = { ...viewportRef.current };
            const duration = 280;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const ease = easeOutCubic(progress);
                setViewport({
                    x: start.x + (target.x - start.x) * ease,
                    y: start.y + (target.y - start.y) * ease,
                    k: start.k + (target.k - start.k) * ease,
                });
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [],
    );

    useEffect(
        () =>
            setShotHost({
                generate: (nodeId, kind) => runShot(nodeId, kind),
                selectRow: (nodeId) => {
                    const row = shotRowMembers(nodeId, nodesRef.current);
                    setSelectedNodeIds(new Set(row.map((node) => node.id)));
                    setDialogNodeId(null);
                },
                openVersions: setVersionsNodeId,
                downstreamCount: (nodeId) => downstreamNodeCount(nodeId, nodesRef.current, connectionsRef.current),
                updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
                jumpToBookmark,
                getCurrentZoom: () => viewportRef.current.k,
                commitStoryboard: (storyboardNodeId, nextData, autoLayout = false) => {
                    const result = reconcileStoryboardGraph({
                        storyboardNodeId,
                        data: nextData,
                        nodes: nodesRef.current,
                        connections: connectionsRef.current,
                        refCounters: refCountersRef.current,
                        autoLayout,
                    });
                    refCountersRef.current = result.refCounters;
                    nodesRef.current = result.nodes;
                    connectionsRef.current = result.connections;
                    setNodes(result.nodes);
                    setConnections(result.connections);
                },
                applyStoryboardPlan: (storyboardNodeId, plan, enabledIds, removeOrphanDownstream = true, modelPresets) => {
                    const sbNode = nodesRef.current.find((n) => n.id === storyboardNodeId);
                    const data = sbNode?.metadata?.storyboard;
                    if (!sbNode || !data) return;
                    const result = applyPlan({
                        storyboardNodeId,
                        data,
                        plan,
                        enabledIds,
                        nodes: nodesRef.current,
                        connections: connectionsRef.current,
                        refCounters: refCountersRef.current,
                        removeOrphanDownstream,
                        modelPresets,
                    });
                    refCountersRef.current = result.refCounters;
                    nodesRef.current = result.nodes;
                    connectionsRef.current = result.connections;
                    setNodes(result.nodes);
                    setConnections(result.connections);
                    const repromptedSettingIds = plan.changes.flatMap((c) => (enabledIds.has(c.id) && c.kind === "setting.update" && c.patch.imgPrompt ? [c.settingId] : []));
                    return { warnings: result.warnings, createdTasks: result.createdTasks, applied: result.applied, settingIds: [...result.diff.addedSettingIds, ...repromptedSettingIds] };
                },
                applyCanvasAgentPlan: (plan, enabledIds, modelPresets) => {
                    const vp = viewportRef.current;
                    const result = applyCanvasPlan({
                        plan,
                        enabledIds,
                        nodes: nodesRef.current,
                        connections: connectionsRef.current,
                        refCounters: refCountersRef.current,
                        modelPresets,
                        anchorPosition: {
                            x: Math.round((size.width / 2 - vp.x) / (vp.k || 1)),
                            y: Math.round((size.height / 2 - vp.y) / (vp.k || 1)),
                        },
                    });
                    refCountersRef.current = result.refCounters;
                    nodesRef.current = result.nodes;
                    connectionsRef.current = result.connections;
                    setNodes(result.nodes);
                    setConnections(result.connections);
                    return { createdTasks: result.createdTasks };
                },
                createStoryboardNode: () => {
                    const vp = viewportRef.current;
                    const allocated = allocateRefId(HemosiNodeType.Storyboard, nodesRef.current, refCountersRef.current);
                    refCountersRef.current = allocated.nextCounters;
                    const created = createCanvasNode(
                        HemosiNodeType.Storyboard,
                        { x: Math.round((size.width / 2 - vp.x) / (vp.k || 1)), y: Math.round((size.height / 2 - vp.y) / (vp.k || 1)) },
                        { status: "idle", storyboard: createEmptyStoryboardData(), refId: allocated.refId },
                    );
                    nodesRef.current = [...nodesRef.current, created];
                    setNodes(nodesRef.current);
                    return created.id;
                },
                setStoryboardGhostNodes: (ghosts) => setStoryboardGhostNodes(ghosts),
                runStoryboardBatch: async (tasks, options) => {
                    if (!tasks.length) return { ok: 0, failed: 0, canceled: false };
                    const nodeModel = (id: string) => nodesRef.current.find((n) => n.id === id)?.metadata?.model;
                    const groups = summarizeStoryboardRun(effectiveConfig, tasks, nodeModel);
                    // Images run first and finish before any video starts, so videos pick up the new frames as references.
                    const stages = (["image", "video"] as const)
                        .map((kind) => ({ kind, tasks: tasks.filter((t) => t.kind === kind) }))
                        .filter((stage) => stage.tasks.length > 0);

                    const execute = async () => {
                        let ok = 0;
                        let failed = 0;
                        let canceled = false;
                        for (const stage of stages) {
                            const concurrency = Math.min(...groups.filter((g) => g.kind === stage.kind).map((g) => g.concurrency));
                            const stageRes = await runWithConcurrency(stage.tasks, concurrency, async (task) => {
                                const targetNode = nodesRef.current.find((n) => n.id === task.nodeId);
                                if (!targetNode) {
                                    failed++;
                                    return;
                                }
                                const res = await handleRetryNodeRef.current?.(targetNode, undefined, { skipConfirm: true });
                                if (res === false) {
                                    failed++;
                                } else {
                                    ok++;
                                    const latest = nodesRef.current.find((n) => n.id === task.nodeId);
                                    if (latest?.metadata?.inputsHash) {
                                        setNodes((prev) =>
                                            prev.map((n) =>
                                                n.id === task.nodeId
                                                    ? { ...n, metadata: { ...n.metadata, generatedInputsHash: latest.metadata?.inputsHash } }
                                                    : n,
                                            ),
                                        );
                                    }
                                }
                            });
                            if (stageRes.canceled) {
                                canceled = true;
                                break;
                            }
                        }
                        return { ok, failed, canceled };
                    };

                    if (options?.skipConfirm) return execute();

                    const notReady = groups.find((g) => !g.ready);
                    return new Promise((resolve) => {
                        setStoryboardConfirm({
                            title: options?.title || "分镜生成确认",
                            tasks,
                            groups,
                            ready: !notReady,
                            reason: notReady?.reason,
                            onCancel: () => {
                                setStoryboardConfirm(null);
                                resolve({ ok: 0, failed: 0, canceled: true });
                            },
                            onConfirm: () => {
                                setStoryboardConfirm(null);
                                void execute().then(resolve);
                            },
                        });
                    });
                },
                getAllNodes: () => nodesRef.current,
                getSelectedNodeIds: () => Array.from(selectedNodeIdsRef.current),
                getProjectId: () => projectId || "default",
                setStoryboardHover: (nodeIds) => setStoryboardHoverIds(nodeIds),
            }),
        [effectiveConfig, jumpToBookmark, message, projectId, runShot, size.height, size.width],
    );

    useEffect(() => {
        const onBookmarkKey = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable || target.closest("[data-canvas-shortcuts-ignore]"))) return;
            const bookmarks = nodesRef.current.filter((n) => n.type === HemosiNodeType.Bookmark);
            if (!bookmarks.length) return;
            const pressed = event.key.toLowerCase();
            const matched = bookmarks.find((b, idx) => (b.metadata?.bookmarkKey || String((idx % 9) + 1)).toLowerCase() === pressed);
            if (matched) {
                event.preventDefault();
                jumpToBookmark(matched.id);
            }
        };
        window.addEventListener("keydown", onBookmarkKey);
        return () => window.removeEventListener("keydown", onBookmarkKey);
    }, [jumpToBookmark]);

    // Single tap on Shift toggles between Pan (hand) and Select (pointer) mode
    useEffect(() => {
        let shiftAlone = false;
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable || target.closest("[data-canvas-shortcuts-ignore]"))) {
                shiftAlone = false;
                return;
            }
            if (event.key === "Shift" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat) {
                shiftAlone = true;
            } else if (event.key !== "Shift") {
                shiftAlone = false;
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Shift" && shiftAlone) {
                shiftAlone = false;
                setCanvasTool((prev) => (prev === "pan" ? "select" : "pan"));
            }
        };
        const onPointerDown = () => {
            shiftAlone = false;
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("pointerdown", onPointerDown, true);
        };
    }, []);

    const completeVideoNodeTask = useCallback(
        async (nodeId: string, config: Parameters<typeof buildGenerationConfig>[0], prompt: string, images: Parameters<typeof createVideoGenerationTask>[2], signal: AbortSignal, extra: CanvasNodeData["metadata"] = {}, videos: ReferenceVideo[] = [], audios: ReferenceAudio[] = []) => {
            const task = await createVideoGenerationTask(config, prompt, images, { signal, videos, audios });
            if (task.provider !== "plugin") {
                setNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoTaskProvider: task.provider === "plugin" ? "openai" : task.provider, model: config.model } } : item)));
            }
            const video = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task, { signal }));
            setNodes((prev) => prev.map((item) => (item.id === nodeId ? applyGeneratedVideo(item, video, { prompt, model: config.model, ...extra }) : item)));
        },
        [],
    );

    const pollVideoNodeTask = useCallback(
        async (node: CanvasNodeData, silent = false) => {
            const taskId = node.metadata?.videoTaskId;
            if (!taskId || node.metadata?.content || generationRequestsRef.current.has(node.id) || videoPollIdsRef.current.has(node.id)) return;
            videoPollIdsRef.current.add(node.id);
            let controller: AbortController | undefined;
            try {
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                    if (silent) {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: t("workbench.configFirst") } } : item)));
                        return;
                    }
                    openConfigDialog(true);
                    return;
                }
                setRunningNodeId(node.id);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
                controller = startGenerationRequest(node.id, node.id, node.id);
                const video = await storeGeneratedVideo(await waitForVideoGenerationTask(generationConfig, { id: taskId, provider: node.metadata?.videoTaskProvider || "openai", model: generationConfig.model }, { signal: controller.signal }));
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? applyGeneratedVideo(item, video, {
                                  prompt: item.metadata?.prompt,
                                  model: generationConfig.model,
                                  size: generationConfig.size,
                                  seconds: generationConfig.videoSeconds,
                                  vquality: generationConfig.vquality,
                                  generateAudio: generationConfig.videoGenerateAudio,
                                  watermark: generationConfig.videoWatermark,
                                  videoMode: generationConfig.videoMode,
                              })
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      ...(isVideoTaskFailed(error) ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                videoPollIdsRef.current.delete(node.id);
                if (controller) {
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                }
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? {
                          ...node,
                          metadata: {
                              ...node.metadata,
                              status: NODE_STATUS_IDLE,
                              errorDetails: undefined,
                              images: node.metadata.images?.map((image) => (image.status === NODE_STATUS_LOADING ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : image)),
                              texts: node.metadata.texts?.map((text) => (text.status === NODE_STATUS_LOADING ? { ...text, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : text)),
                          },
                      }
                    : node,
            ),
        );
    }, [t]);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: t("canvas.projectPage.stopTitle"),
                content: t("canvas.projectPage.stopDescription"),
                okText: t("canvas.projectPage.stop"),
                cancelText: t("canvas.projectPage.continue"),
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, t],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, navigate, openProject, projectId]);

    // Every canvas lives in a 项目; an older or stand-alone canvas gets its own project the first time it opens.
    const workspacesHydrated = useWorkspaceStore((state) => state.hydrated);
    useEffect(() => {
        if (!projectLoaded || !workspacesHydrated) return;
        const canvas = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!canvas || (canvas.workspaceId && useWorkspaceStore.getState().workspaces.some((item) => item.id === canvas.workspaceId))) return;
        updateProject(projectId, { workspaceId: useWorkspaceStore.getState().createWorkspace(canvas.title) });
    }, [projectId, projectLoaded, updateProject, workspacesHydrated]);
    const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === currentProject?.workspaceId));

    // 未保存提示: warn before leaving while a save is queued, and write it immediately when the page is hidden.
    const savePending = useCanvasSaveStatus((state) => state.pending);
    const saveSavedAt = useCanvasSaveStatus((state) => state.savedAt);
    const saveError = useCanvasSaveStatus((state) => state.error);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!useCanvasSaveStatus.getState().pending) return;
            void flushCanvasSave();
            event.preventDefault();
        };
        const hide = () => void flushCanvasSave();
        window.addEventListener("beforeunload", beforeUnload);
        window.addEventListener("pagehide", hide);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            window.removeEventListener("pagehide", hide);
        };
    }, []);

    useEffect(() => {
        if (!projectLoaded) return;
        nodesRef.current.filter(hasResumableVideoTask).forEach((node) => void pollVideoNodeTask(node, true));
        // Resume once after the current canvas is restored, not on later config identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectLoaded]);

    // /templates "插入到新画布" lands here with ?template=<id>; insert once the canvas has loaded, then drop the param.
    const pendingTemplateId = searchParams.get("template");
    useEffect(() => {
        if (!projectLoaded || !pendingTemplateId) return;
        const template = findTemplate(pendingTemplateId);
        if (template) insertTemplate(template);
        else message.error(t("hemosi.templates.notFound"));
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete("template");
                return next;
            },
            { replace: true },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectLoaded, pendingTemplateId]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl") && !localAgentEnabled && !fragmentBootstrap) openAgentPanel();
    }, [fragmentBootstrap, localAgentEnabled, openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    // Tell listeners outside the canvas tree (the agent panel) that nodes or the selection changed.
    useEffect(() => {
        emitCanvasEvent("canvas:changed");
    }, [nodes, selectedNodeIds]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const isMultiSource = current.handleType === "source" && selectedNodeIdsRef.current.size > 1 && selectedNodeIdsRef.current.has(current.nodeId);
            const sourceIds = isMultiSource ? [...selectedNodeIdsRef.current].filter((id) => id !== targetNodeId) : [current.nodeId];

            const newConns: CanvasConnection[] = [];
            for (const srcId of sourceIds) {
                const connection = normalizeConnection(srcId, targetNodeId, nodesRef.current, current.handleType);
                if (!connection) continue;
                const { fromNodeId, toNodeId } = connection;
                const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId) || newConns.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
                if (!exists) {
                    const from = nodesRef.current.find((node) => node.id === fromNodeId);
                    const to = nodesRef.current.find((node) => node.id === toNodeId);
                    const kind = from && to ? inferConnectionKind(from, to) : undefined;
                    newConns.push({ id: `conn-${Date.now()}-${nanoid(4)}`, fromNodeId, toNodeId, kind });
                }
            }

            if (!newConns.length && !isMultiSource) {
                const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
                if (!connection) {
                    message.warning(t("canvas.projectPage.configConnection"));
                    return;
                }
            }
            if (newConns.length) {
                setConnections((prev) => [...prev, ...newConns]);
            }
            setContextMenu(null);
        },
        [message, t],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const isMultiSource = pending.connection.handleType === "source" && selectedNodeIdsRef.current.size > 1 && selectedNodeIdsRef.current.has(pending.connection.nodeId);
            const sourceIds = isMultiSource ? [...selectedNodeIdsRef.current] : [pending.connection.nodeId];
            const nextNodesList = [...nodesRef.current, newNode];
            const newConns: CanvasConnection[] = [];
            for (const srcId of sourceIds) {
                const connection = normalizeConnection(srcId, newNode.id, nextNodesList, pending.connection.handleType);
                if (connection) {
                    newConns.push({ id: nanoid(), ...connection });
                }
            }
            if (!newConns.length) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, ...newConns]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting, t],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const viewBounds = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        return { left, top, right: left + width / viewport.k + padding * 2, bottom: top + height / viewport.k + padding * 2 };
        // `nodes` keeps the container rect re-read on node changes, matching the previous behaviour when the container resizes without a size update.
    }, [nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const visibleNodes = useMemo(
        () => nodes.filter((node) => node.position.x + node.width > viewBounds.left && node.position.x < viewBounds.right && node.position.y + node.height > viewBounds.top && node.position.y < viewBounds.bottom),
        [nodes, viewBounds],
    );

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

    // Connections are culled like nodes; a cubic curve stays inside its control-point hull, so endpoint bounds widened by the curvature is a safe test.
    const visibleConnections = useMemo(
        () =>
            connections.flatMap((connection) => {
                const from = nodeById.get(connection.fromNodeId);
                const to = nodeById.get(connection.toNodeId);
                if (!from || !to) return [];
                const startX = from.position.x + from.width;
                const startY = from.position.y + from.height / 2;
                const endX = to.position.x;
                const endY = to.position.y + to.height / 2;
                const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
                const inView =
                    Math.max(startX + curvature, endX) > viewBounds.left && Math.min(startX, endX - curvature) < viewBounds.right && Math.max(startY, endY) > viewBounds.top && Math.min(startY, endY) < viewBounds.bottom;
                return inView ? [{ connection, from, to }] : [];
            }),
        [connections, nodeById, viewBounds],
    );
    // The toolbar follows a single selected node selected by click, creation, marquee, or keyboard.
    // It stays hidden for multi-selection and while isNodeDragging is true.
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const shortResizeNode = shortResizeNodeId ? nodeById.get(shortResizeNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewContent = previewImageId ? previewNode?.metadata?.images?.find((image) => image.id === previewImageId)?.content : previewNode?.metadata?.content;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id)), [nodes, selectedNodeIds]);
    const canGroupSelection = canGroupSelectedNodes(selectedNodeIds, nodes);
    const canUngroupSelection = canUngroupSelectedNodes(selectedNodeIds, nodes);
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (storyboardHoverIds.length > 0) {
            const set = new Set(storyboardHoverIds);
            storyboardHoverIds.forEach((id) => nodeIds.add(id));
            connections.forEach((connection) => {
                if (set.has(connection.fromNodeId) && set.has(connection.toNodeId)) {
                    connectionIds.add(connection.id);
                }
            });
            return { nodeIds, connectionIds };
        }

        if (!activeNodeId) return { nodeIds, connectionIds };

        const addNode = (nodeId: string) => {
            nodeIds.add(nodeId);
            if (nodeById.get(nodeId)?.type === CanvasNodeType.Group) nodes.forEach((node) => node.metadata?.groupId === nodeId && nodeIds.add(node.id));
        };
        addNode(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            addNode(connection.fromNodeId);
            addNode(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections, nodeById, nodes, storyboardHoverIds]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const connectedNodesByNodeId = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        connections.forEach((connection) => {
            const source = nodeById.get(connection.fromNodeId);
            if (!source) return;
            const connected = map.get(connection.toNodeId);
            if (connected) connected.push(source);
            else map.set(connection.toNodeId, [source]);
        });
        return map;
    }, [connections, nodeById]);
    const referenceConnectedNodeIds = useMemo(() => new Set([referencePickerNodeId, ...(referencePickerNodeId ? connectedNodesByNodeId.get(referencePickerNodeId)?.flatMap((node) => node.type === CanvasNodeType.Group ? [node.id, ...getGroupResourceNodes(node.id, nodes).map((child) => child.id)] : [node.id]) || [] : [])].filter((id): id is string => Boolean(id))), [connectedNodesByNodeId, nodes, referencePickerNodeId]);
    const { applyAgentOps } = useAgentBridge({
        runShots,
        projectId,
        title: currentProject?.title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const allocated = allocateRefId(type, nodesRef.current, refCountersRef.current);
            refCountersRef.current = allocated.nextCounters;
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const baseMetadata = type === HemosiNodeType.Shot ? { shotNo: nextShotNo(nodesRef.current) } : configMetadata;
            const newNode = createCanvasNode(type, targetPosition, { ...baseMetadata, refId: allocated.refId });

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image, video, and config nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            const lockedIds = [...ids].filter((id) => nodesRef.current.find((node) => node.id === id)?.metadata?.locked);
            if (lockedIds.length) message.warning(t("p1.node.lockedSkip", { count: lockedIds.length }));
            const allIds = new Set([...ids].filter((id) => !lockedIds.includes(id)));
            if (!allIds.size) return;
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setReferencePickerNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedBatchNodeIds((current) => new Set([...current].filter((nodeId) => !allIds.has(nodeId))));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, message, projectId, t],
    );

    // Deleting nodes that still have links asks first and names the links that will be cut.
    const requestDeleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const cut = connectionsTouching(ids, connectionsRef.current);
            if (!cut.length) return deleteNodes(ids);
            const titleOf = (id: string) => nodesRef.current.find((node) => node.id === id)?.title || id;
            modal.confirm({
                title: t("p1.node.deleteLinkedTitle", { count: ids.size }),
                content: (
                    <div className="text-xs">
                        <p className="mb-2">{t("p1.node.deleteLinkedBody", { count: cut.length })}</p>
                        <ul className="max-h-48 list-disc overflow-auto pl-5 opacity-80">
                            {cut.slice(0, 20).map((connection) => (
                                <li key={connection.id}>{titleOf(connection.fromNodeId)} → {titleOf(connection.toNodeId)}</li>
                            ))}
                        </ul>
                    </div>
                ),
                okText: t("p1.node.deleteLinkedOk"),
                okButtonProps: { danger: true },
                cancelText: t("common.cancel"),
                onOk: () => deleteNodes(ids),
            });
        },
        [deleteNodes, modal, t],
    );

    const layoutNodes = useCallback(() => {
        const ids = selectedNodeIdsRef.current.size > 1 ? new Set(selectedNodeIdsRef.current) : new Set(nodesRef.current.map((node) => node.id));
        setNodes((prev) => autoLayoutNodes(prev, connectionsRef.current, ids));
        message.success(t("p1.batch.laidOut", { count: ids.size }));
    }, [message, t]);

    const updateNodeById = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? update(node) : node)));
    }, []);
    const toggleNodeLock = useCallback((nodeId: string) => updateNodeById(nodeId, (node) => ({ ...node, metadata: { ...node.metadata, locked: !node.metadata?.locked } })), [updateNodeById]);
    const toggleNodeCollapse = useCallback((nodeId: string) => updateNodeById(nodeId, toggleNodeCollapsed), [updateNodeById]);
    const downloadAnyNode = useCallback(
        async (node: CanvasNodeData) => {
            const count = await downloadNodeContent(node).catch(() => 0);
            if (!count) message.warning(t("p1.node.nothingToDownload"));
        },
        [message, t],
    );

    const groupSelection = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
        if (members.length < 2) return;
        const rect = getGroupWrapRect(members);
        const created = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const result = applyGroupSelection(selectedIds, nodesRef.current, connectionsRef.current, { ...created, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds[0] || null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const ungroupSelection = useCallback((ids?: Set<string>) => {
        const result = applyUngroupSelection(ids || selectedNodeIdsRef.current, nodesRef.current, connectionsRef.current);
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds.length === 1 ? result.selectedIds[0] : null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const setConnectionKind = useCallback(
        (connectionId: string, kind: CanvasConnection["kind"]) => {
            const connection = connectionsRef.current.find((item) => item.id === connectionId);
            const from = nodesRef.current.find((node) => node.id === connection?.fromNodeId);
            const to = nodesRef.current.find((node) => node.id === connection?.toNodeId);
            const problem = from && to && kind ? connectionKindProblem(kind, from, to) : null;
            if (problem) message.warning(t("p1.link.problem", { problem }));
            setConnections((prev) => prev.map((item) => (item.id === connectionId ? { ...item, kind } : item)));
            setContextMenu(null);
        },
        [message, t],
    );

    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {
        setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== fromNodeId || connection.toNodeId !== toNodeId));
    }, []);

    const startNodeReferenceSelection = useCallback((nodeId: string) => {
        setReferencePickerNodeId(nodeId);
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, []);

    const exitNodeReferenceSelection = useCallback(() => {
        if (!referencePickerNodeId) return;
        setSelectedNodeIds(new Set([referencePickerNodeId]));
        setDialogNodeId(referencePickerNodeId);
        setReferencePickerNodeId(null);
    }, [referencePickerNodeId]);

    const selectNodeReference = useCallback((fromNodeId: string) => {
        if (!referencePickerNodeId || referenceConnectedNodeIds.has(fromNodeId)) return;
        const source = nodesRef.current.find((node) => node.id === fromNodeId);
        if (!source || !isCanvasReferenceNode(source, nodesRef.current)) return;
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId, toNodeId: referencePickerNodeId }]);
    }, [referenceConnectedNodeIds, referencePickerNodeId]);

    useEffect(() => {
        if (!referencePickerNodeId) return;
        const exit = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            exitNodeReferenceSelection();
        };
        window.addEventListener("keydown", exit, true);
        return () => window.removeEventListener("keydown", exit, true);
    }, [exitNodeReferenceSelection, referencePickerNodeId]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string, withConnections = false) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const { node: next, connections: referenceConnections } = duplicateNodeWithLinks(source, connectionsRef.current, withConnections);
        const id = next.id;

        setNodes((prev) => [...prev, next]);
        setConnections((prev) => [...prev, ...referenceConnections]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const focusNodePrompt = useCallback((nodeId: string) => {
        let attempts = 0;
        const tryFocus = () => {
            const editor = document.querySelector<HTMLElement>(`[data-node-panel="${nodeId}"] [contenteditable="true"], [data-node-panel="${nodeId}"] textarea`);
            if (editor) {
                editor.focus();
                return;
            }
            if (attempts++ < 10) window.setTimeout(tryFocus, 40);
        };
        window.setTimeout(tryFocus, 40);
    }, []);

    const closeQuickGrowMenu = useCallback(() => setQuickGrowMenu(null), []);

    const openQuickGrowMenu = useCallback((nodeId: string, x: number, y: number) => {
        setContextMenu(null);
        setQuickGrowMenu({ nodeId, x, y });
    }, []);

    const quickGrowNode = useCallback(
        (nodeId: string, kind: QuickGrowKind) => {
            setQuickGrowMenu(null);
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source) return;
            const isMultiSource = selectedNodeIdsRef.current.size > 1 && selectedNodeIdsRef.current.has(nodeId);
            const sourceIds = isMultiSource ? [...selectedNodeIdsRef.current] : [source.id];
            const type = quickGrowNodeType(kind);
            const spec = getNodeSpec(type);
            const position = findFreeRightPosition(source, spec, nodesRef.current);
            const created = createCanvasNode(type, { x: position.x + spec.width / 2, y: position.y + spec.height / 2 });
            const newNode: CanvasNodeData = kind === "edit" ? { ...created, title: t("hemosi.quickGrow.editTitle") } : created;
            const nextNodesList = [...nodesRef.current, newNode];
            const newConns: CanvasConnection[] = [];
            for (const srcId of sourceIds) {
                const connection = normalizeConnection(srcId, newNode.id, nextNodesList, "source");
                if (connection) newConns.push({ id: nanoid(), ...connection });
            }
            if (!newConns.length) {
                message.warning(t("hemosi.quickGrow.connectFailed"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, ...newConns]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setToolbarNodeId(null);
            setDialogNodeId(newNode.id);
            focusNodePrompt(newNode.id);
        },
        [focusNodePrompt, message, t],
    );

    // 文本拆分镜: the selected part of a script (or all of it) becomes a row of empty shots, one per paragraph/line, grouped as one scene.
    const splitTextToShots = useCallback(
        (nodeId: string, by: "paragraph" | "line") => {
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source) return;
            const selected = takeTextSelection(nodeId);
            const parts = splitScript(selected || source.metadata?.content || source.metadata?.prompt || "", by);
            if (!parts.length) return void message.warning(t("p1.shot.nothingToSplit"));
            const spec = getNodeSpec(HemosiNodeType.Shot);
            const startNo = nextShotNo(nodesRef.current);
            const gap = 40;
            const x0 = source.position.x + source.width + 160;
            const y0 = source.position.y;
            const shots = parts.map((text, index) => {
                const created = createCanvasNode(HemosiNodeType.Shot, { x: x0 + index * (spec.width + gap) + spec.width / 2, y: y0 + spec.height / 2 }, { shotNo: startNo + index, shotDescription: text, shotRefs: [] });
                return { ...created, title: `镜头 ${startNo + index}` };
            });
            const withShots = [...nodesRef.current, ...shots];
            const rect = getGroupWrapRect(shots);
            const groupNode = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
            const grouped = applyGroupSelection(new Set(shots.map((shot) => shot.id)), withShots, connectionsRef.current, { ...groupNode, title: `${source.title || t("p1.shot.scene")} · ${t("p1.shot.scene")}`, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
            setNodes(grouped ? grouped.nodes : withShots);
            if (grouped) setConnections(grouped.connections);
            setSelectedNodeIds(new Set(shots.map((shot) => shot.id)));
            setDialogNodeId(null);
            message.success(t("p1.shot.split", { count: shots.length, from: startNo, to: startNo + shots.length - 1 }));
        },
        [message, t],
    );

    // 视频拆分镜: scene-change detection -> one shot per cut, mid-shot keyframe as its reference, time range in the description.
    const splitVideoToShots = useCallback(
        async (nodeId: string) => {
            setContextMenu(null);
            const source = nodesRef.current.find((node) => node.id === nodeId);
            const url = source?.metadata?.content;
            if (source?.type !== CanvasNodeType.Video || !url) return void message.error("这个视频节点还没有视频");
            const key = `split-video-${nodeId}`;
            message.loading({ key, content: "正在分析镜头切换…", duration: 0 });
            try {
                const { splitVideoIntoShots } = await import("@/lib/canvas/canvas-video-shots");
                const segments = await splitVideoIntoShots(url, (ratio) => message.loading({ key, content: `正在分析镜头切换… ${Math.round(ratio * 100)}%`, duration: 0 }));
                const spec = getNodeSpec(HemosiNodeType.Shot);
                const startNo = nextShotNo(nodesRef.current);
                const gap = 40;
                const x0 = source.position.x + source.width + 160;
                const y0 = source.position.y;
                const shots: CanvasNodeData[] = [];
                for (const [index, segment] of segments.entries()) {
                    const image = await uploadImage(segment.keyframe);
                    const ref = { id: nanoid(), status: "success" as const, content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/png", enabled: true, role: "reference" as const };
                    const description = `原片 ${segment.start.toFixed(1)}s–${segment.end.toFixed(1)}s（${(segment.end - segment.start).toFixed(1)} 秒）`;
                    const created = createCanvasNode(HemosiNodeType.Shot, { x: x0 + index * (spec.width + gap) + spec.width / 2, y: y0 + spec.height / 2 }, { shotNo: startNo + index, shotDescription: description, shotRefs: [ref], shotImage: { ...ref } });
                    shots.push({ ...created, title: `镜头 ${startNo + index}` });
                }
                const withShots = [...nodesRef.current, ...shots];
                const links = shots.map((shot) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: shot.id }));
                const rect = getGroupWrapRect(shots);
                const groupNode = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
                const grouped = applyGroupSelection(new Set(shots.map((shot) => shot.id)), withShots, [...connectionsRef.current, ...links], { ...groupNode, title: `${source.title || "视频"} · 拆分镜`, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
                const nextNodes = grouped ? grouped.nodes : withShots;
                const nextConnections = grouped ? grouped.connections : [...connectionsRef.current, ...links];
                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                setSelectedNodeIds(new Set(shots.map((shot) => shot.id)));
                message.success({ key, content: `拆出 ${shots.length} 个镜头（镜头 ${startNo}–${startNo + shots.length - 1}）` });
            } catch (error) {
                message.error({ key, content: error instanceof DOMException && error.name === "SecurityError" ? "视频跨域读不到，打开设置里的本地代理后重试" : `拆分镜失败：${error instanceof Error ? error.message : String(error)}` });
            }
        },
        [message],
    );

    const [refTargetSourceId, setRefTargetSourceId] = useState<string | null>(null);
    // Toolbar items are built before these callbacks exist in the file; refs keep them current.
    const batchExecuteRef = useRef<((ids: string[]) => void) | null>(null);
    const copySelectedNodesRef = useRef<(() => void) | null>(null);
    const pasteCopiedNodesRef = useRef<(() => boolean) | null>(null);

    const openSaveTemplate = useCallback(() => {
        setContextMenu(null);
        const ids = new Set(selectedNodeIdsRef.current);
        if (!ids.size) {
            message.warning(t("hemosi.templates.nothingSelected"));
            return;
        }
        setSaveTemplateNodeIds(ids);
    }, [message, t]);

    const saveSelectionAsTemplate = useCallback(
        (name: string) => {
            if (!saveTemplateNodeIds) return;
            const { nodes: templateNodes, connections: templateConnections } = buildTemplateFromSelection(saveTemplateNodeIds, nodesRef.current, connectionsRef.current);
            setSaveTemplateNodeIds(null);
            if (!templateNodes.length) {
                message.warning(t("hemosi.templates.nothingSelected"));
                return;
            }
            useTemplateStore.getState().addTemplate(name, templateNodes, templateConnections);
            message.success(t("hemosi.templates.saved", { name }));
        },
        [message, saveTemplateNodeIds, t],
    );

    const insertTemplate = useCallback(
        (template: CanvasTemplate) => {
            const { nodes: inserted, connections: insertedConnections } = instantiateTemplate(template, getCanvasCenter());
            if (!inserted.length) return;
            setNodes((prev) => [...prev, ...inserted]);
            setConnections((prev) => [...prev, ...insertedConnections]);
            setSelectedNodeIds(new Set(inserted.map((node) => node.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            setTemplatePanelOpen(false);
            message.success(t("hemosi.templates.inserted", { name: templateName(template) }));
        },
        [getCanvasCenter, message, t],
    );

    const copySelectedNodes = useCallback(() => {
        // A copied group takes its members along (整组复制).
        const groupIds = new Set(nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
        const selectedIds = new Set([...selectedNodeIdsRef.current, ...nodesRef.current.filter((node) => node.metadata?.groupId && groupIds.has(node.metadata.groupId)).map((node) => node.id)]);
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const toNodeId = idMap.get(connection.toNodeId);
            if (!toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId: idMap.get(connection.fromNodeId) ?? connection.fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            setHoverPreviewNodeId(null);
            const target = focusViewportForNode(node, size, measureFocusFrame(containerRef.current, nodeId));
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            const start = { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                setViewport({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t });
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [size.height, size.width],
    );

    const focusNodeRef = useRef(focusNode);
    useEffect(() => {
        focusNodeRef.current = focusNode;
    }, [focusNode]);

    const focusSelectedNode = useCallback(() => {
        const nodeId = selectedNodeIdsRef.current.values().next().value;
        if (nodeId) focusNode(nodeId);
    }, [focusNode]);

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }), currentProject?.workspaceId);
        navigate(`/canvas/${id}`);
    }, [createProject, currentProject?.workspaceId, navigate, t]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            await exportCanvasProjects([project], project.title || t("canvas.title"));
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const forkCurrentCanvas = useCallback(() => {
        void flushCanvasSave();
        const id = useCanvasStore.getState().forkProject(projectId);
        if (!id) return;
        message.success(t("p1.project.forked"));
        navigate(`/canvas/${id}`);
    }, [message, navigate, projectId, t]);

    const saveCanvasAsTemplate = useCallback(() => {
        if (!nodesRef.current.length) return void message.info("画布是空的，没有可存的节点");
        setSaveTemplateNodeIds(new Set(nodesRef.current.map((node) => node.id)));
    }, [message]);

    // Full copy of this canvas (prompts, per-node models, links) in a brand-new project container; the source stays untouched.
    const cloneCanvasToNewProject = useCallback(() => {
        void flushCanvasSave();
        const store = useCanvasStore.getState();
        const source = store.projects.find((item) => item.id === projectId);
        if (!source) return;
        const sourceWs = useWorkspaceStore.getState().workspaces.find((item) => item.id === source.workspaceId);
        const wsId = useWorkspaceStore.getState().createWorkspace(`${sourceWs?.title || source.title} · 克隆`, { script: sourceWs?.script || "" });
        const id = store.forkProject(projectId, source.title);
        if (!id) return;
        store.updateProject(id, { workspaceId: wsId });
        message.success("已克隆为新项目，原项目不变");
        navigate(`/canvas/${id}`);
    }, [message, navigate, projectId]);

    const exportProjectPackage = useCallback(async () => {
        const canvas = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        const ws = useWorkspaceStore.getState().workspaces.find((item) => item.id === canvas?.workspaceId);
        if (!canvas) return;
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            const canvases = ws ? useCanvasStore.getState().projects.filter((item) => item.workspaceId === ws.id) : [canvas];
            await exportCanvasProjects(canvases, `${ws?.title || canvas.title}-项目包`, ws ? [ws] : []);
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
        },
        [selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        // Capture already selected the node; this only starts dragging, with a fallback selection if capture did not run.
        const currentNodes = nodesRef.current;
        const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        const initialSelectedNodes = new Map(currentNodes.filter((node) => dragIds.has(node.id) && !node.metadata?.locked).map((node): [string, { x: number; y: number }] => [node.id, { x: node.position.x, y: node.position.y }]));
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            altDuplicatePending: Boolean(event.altKey),
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes,
            movedIds: new Set(initialSelectedNodes.keys()),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.size === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes.keys().next().value;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;
        const movedIds = dragRef.current.movedIds;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy }, metadata: { ...node.metadata, manualPos: true } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return renumberShotRows(movedIds, snapNodesIntoGroup(movedIds, moved, targetGroup));
                // Dragging a shot within its row renumbers the row left to right.
                return renumberShotRows(
                    movedIds,
                    moved.map((node) => {
                        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                        const groupId = findContainingGroupId(node, moved);
                        if (node.metadata?.groupId === groupId) return node;
                        return { ...node, metadata: { ...node.metadata, groupId } };
                    }),
                );
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = new Map();
        dragRef.current.movedIds = new Set();
        if (wasClick && clickedNodeId) {
            if (document.querySelector("[data-director-agent-drop='active']")) {
                window.dispatchEvent(
                    new CustomEvent("director-agent-drop-nodes", {
                        detail: { nodeIds: [clickedNodeId] },
                    }),
                );
            }
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
                if (useConfigStore.getState().config.autoFocusOnSelect) {
                    // Wait for the generation panel to render so centering accounts for it.
                    requestAnimationFrame(() => focusNodeRef.current(clickedNodeId));
                }
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                    if (dragRef.current.altDuplicatePending) {
                        dragRef.current.altDuplicatePending = false;
                        const origIds = dragRef.current.movedIds;
                        const idMap = new Map<string, string>();
                        const newInitial = new Map<string, { x: number; y: number }>();
                        const clones: CanvasNodeData[] = [];
                        nodesRef.current.forEach((n, idx) => {
                            if (!origIds.has(n.id)) return;
                            const newId = `${n.type}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
                            idMap.set(n.id, newId);
                            const initPos = dragRef.current.initialSelectedNodes.get(n.id) || n.position;
                            newInitial.set(newId, { x: initPos.x, y: initPos.y });
                            clones.push({
                                ...n,
                                id: newId,
                                position: { x: initPos.x + dx, y: initPos.y + dy },
                                metadata: n.metadata ? structuredClone(n.metadata) : undefined,
                            });
                        });
                        const remappedClones = clones.map((c) => {
                            const gid = c.metadata?.groupId;
                            if (gid && idMap.has(gid)) {
                                return { ...c, metadata: { ...c.metadata, groupId: idMap.get(gid) } };
                            }
                            return c;
                        });
                        const newMovedSet = new Set(newInitial.keys());
                        dragRef.current.initialSelectedNodes = newInitial;
                        dragRef.current.movedIds = newMovedSet;
                        const nextNodes = [...nodesRef.current, ...remappedClones];
                        nodesRef.current = nextNodes;
                        setNodes(nextNodes);
                        setSelectedNodeIds(newMovedSet);
                        setToolbarNodeId(newMovedSet.size === 1 ? [...newMovedSet][0] : null);
                        return;
                    }
                }
                const initialPositions = dragRef.current.initialSelectedNodes;
                const movedIds = dragRef.current.movedIds;

                // Drop-target detection and node updates both run once per frame; mousemove can fire far more often than the display refreshes.
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    const previewNodes = nodesRef.current.map((node) => {
                        const initial = initialPositions.get(node.id);
                        return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                    });
                    setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.get(node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    // 素材节点: a file brought in from outside becomes a node and is archived into this canvas's project.
    const archiveMaterial = useCallback(
        (kind: "image" | "video" | "audio", name: string, file: { storageKey?: string; mimeType: string; bytes: number; width?: number; height?: number; durationMs?: number }) => {
            const workspaceId = useCanvasStore.getState().projects.find((item) => item.id === projectId)?.workspaceId;
            if (workspaceId && file.storageKey) useWorkspaceStore.getState().addMaterials(workspaceId, [{ kind, name, storageKey: file.storageKey, mimeType: file.mimeType, bytes: file.bytes, width: file.width, height: file.height, durationMs: file.durationMs, canvasId: projectId }]);
        },
        [projectId],
    );

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        archiveMaterial("image", file.name, image);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: { ...imageMetadata(image), material: true, sourceFileName: file.name },
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, [archiveMaterial]);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        archiveMaterial("video", file.name, video);
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: { ...videoMetadata(video), material: true, sourceFileName: file.name },
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, [archiveMaterial]);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        archiveMaterial("audio", file.name, audio);
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: { ...audioMetadata(audio), material: true, sourceFileName: file.name },
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, [archiveMaterial]);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter, t],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success(t("canvas.projectPage.clipboardImageAdded"));
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success(t("canvas.projectPage.clipboardTextAdded"));
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message, t]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore],.ant-modal-wrap")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "f") {
                event.preventDefault();
                setSearchOpen(true);
                return;
            }
            if (isModifierShortcut && event.shiftKey && !event.altKey && key === "l") {
                event.preventDefault();
                layoutNodes();
                return;
            }
            if (isModifierShortcut && !event.shiftKey && !event.altKey && key === "l") {
                event.preventDefault();
                selectedNodeIdsRef.current.forEach((id) => toggleNodeLock(id));
                return;
            }
            if (isModifierShortcut && event.shiftKey && !event.altKey && key === "c") {
                event.preventDefault();
                selectedNodeIdsRef.current.forEach((id) => toggleNodeCollapse(id));
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "d") {
                event.preventDefault();
                const id = selectedNodeIdsRef.current.values().next().value;
                if (id) duplicateNode(id, event.shiftKey);
                return;
            }
            if (!isModifierShortcut && event.key === "?") {
                event.preventDefault();
                setShortcutsOpen(true);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "g") {
                if (event.shiftKey) {
                    if (canUngroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                        event.preventDefault();
                        ungroupSelection();
                    }
                    return;
                }
                if (canGroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                    event.preventDefault();
                    groupSelection();
                }
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    requestDeleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, duplicateNode, layoutNodes, requestDeleteNodes, toggleNodeCollapse, toggleNodeLock, groupSelection, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas, ungroupSelection]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const hemosiToolbarItems = useCallback(
        (node: CanvasNodeData) => {
            const items: { id: string; title: string; label: string; icon: ReactNode; onClick: () => void }[] = [];
            const versions = node.metadata?.versions?.length || 0;
            if (node.type === CanvasNodeType.Text) {
                items.push({ id: "p1-split-paragraph", title: t("p1.shot.splitParagraphTitle"), label: t("p1.shot.splitParagraph"), icon: <Clapperboard className="size-4" />, onClick: () => splitTextToShots(node.id, "paragraph") });
                items.push({ id: "p1-split-line", title: t("p1.shot.splitLineTitle"), label: t("p1.shot.splitLine"), icon: <Rows3 className="size-4" />, onClick: () => splitTextToShots(node.id, "line") });
            }
            if (node.type === CanvasNodeType.Group) {
                const members = nodesRef.current.filter((item) => item.metadata?.groupId === node.id).map((item) => item.id);
                items.push({ id: "p1-group-run", title: t("p1.group.runTitle"), label: t("p1.group.run"), icon: <Play className="size-4" />, onClick: () => batchExecuteRef.current?.(members) });
                items.push({ id: "p1-group-copy", title: t("p1.group.copyTitle"), label: t("p1.group.copy"), icon: <Copy className="size-4" />, onClick: () => { copySelectedNodesRef.current?.(); pasteCopiedNodesRef.current?.(); } });
            }
            if (canDrawToVideo(node)) {
                const toVideo = (role: "firstFrame" | "reference") => {
                    const { ops, videoId } = drawToVideoOps(node, nodesRef.current, role);
                    applyAgentOps(ops);
                    setDialogNodeId(videoId);
                };
                items.push({ id: "p6-draw-to-video", title: "作为首帧图，新建视频节点并连线", label: "首帧转视频", icon: <Video className="size-4" />, onClick: () => toVideo("firstFrame") });
                items.push({ id: "p6-draw-to-video-ref", title: "作为参考图，新建视频节点并连线", label: "参考转视频", icon: <Film className="size-4" />, onClick: () => toVideo("reference") });
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.content) items.push({ id: "p1-set-ref", title: t("p1.toolbar.setRefTitle"), label: t("p1.toolbar.setRef"), icon: <Link2 className="size-4" />, onClick: () => setRefTargetSourceId(node.id) });
            if (node.type === CanvasNodeType.Video && node.metadata?.content) items.push({ id: "p1-ratio-lock", title: t("p1.toolbar.ratioLockTitle"), label: node.metadata?.freeResize ? t("p1.toolbar.freeResize") : t("p1.toolbar.ratioLocked"), icon: <Ratio className="size-4" />, onClick: () => toggleNodeFreeResize(node.id) });
            if (versions || (node.type === CanvasNodeType.Text && node.metadata?.textVersions?.length)) items.push({ id: "p1-versions", title: t("p1.versions.title"), label: t("p1.versions.button", { count: versions || node.metadata?.textVersions?.length || 0 }), icon: <History className="size-4" />, onClick: () => setVersionsNodeId(node.id) });
            return items;
        },
        [applyAgentOps, splitTextToShots, t, toggleNodeFreeResize],
    );

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? { ...node, metadata: { ...withTextVersion(node, content), texts: node.metadata?.texts?.map((text) => (text.id === node.metadata?.primaryTextId ? { ...text, content } : text)) } }
                    : node,
            ),
        );
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedBatchNodeIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, itemId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                if (node.type === CanvasNodeType.Text) {
                    const text = node.metadata?.texts?.find((item) => item.id === itemId);
                    return text?.content ? { ...node, metadata: { ...node.metadata, content: text.content, primaryTextId: text.id } } : node;
                }
                const image = node.metadata?.images?.find((item) => item.id === itemId);
                if (!image?.content) return node;
                const edge = Math.max(node.width, node.height);
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const edge = Math.max(node.width, node.height);
        const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const downloadBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
    }, []);

    const captureVideoNodeFrame = useCallback(
        async (nodeId: string, position: VideoFramePosition, options: { openPanel?: boolean } = {}): Promise<CanvasNodeData | null> => {
            setContextMenu(null);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const video = Array.from(containerRef.current?.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]") || []).find((item) => item.dataset.canvasVideo === nodeId) || null;
            if (node?.type !== CanvasNodeType.Video || !node.metadata?.content) {
                message.error(t("canvas.videoFrames.failed"));
                return null;
            }
            try {
                const image = await uploadImage(await captureVideoFrameSafe(node.metadata.content, position, video));
                const size = fitNodeSize(image.width, image.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const current = nodesRef.current.find((item) => item.id === nodeId) || node;
                const child: CanvasNodeData = {
                    id: nanoid(),
                    type: CanvasNodeType.Image,
                    title: t(`canvas.videoFrames.${position}Title`, { name: current.title || t("assets.kinds.video") }),
                    position: findFreeRightPosition(current, size, nodesRef.current),
                    ...size,
                    metadata: imageMetadata(image),
                };
                const nextNodes = [...nodesRef.current, child];
                const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: current.id, toNodeId: child.id }];
                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                setSelectedNodeIds(new Set([child.id]));
                setSelectedConnectionId(null);
                if (options.openPanel !== false) setDialogNodeId(child.id);
                message.success(t("canvas.videoFrames.captured"));
                return child;
            } catch (error) {
                message.error(error instanceof VideoFrameTaintedError ? t("hemosi.videoTools.tainted") : t("canvas.videoFrames.failed"));
                return null;
            }
        },
        [message, t],
    );

    // 用末帧续拍: last frame -> image node -> new video generation node prefilled with the original prompt and params.
    const continueVideoFromLastFrame = useCallback(
        async (node: CanvasNodeData) => {
            const frame = await captureVideoNodeFrame(node.id, "last", { openPanel: false });
            if (!frame) return;
            const spec = getNodeSpec(CanvasNodeType.Video);
            const position = findFreeRightPosition(frame, spec, nodesRef.current);
            const meta = node.metadata || {};
            // Carry the raw prompt and re-link the original upstream text nodes instead of copying the composed prompt,
            // so the new run composes the same text once. Config/composer sources keep the composed prompt as-is.
            const { source, rawPrompt } = resolveGenerationSource(node, nodesRef.current, connectionsRef.current, (id) => buildUpstreamTextBlock(id, nodesRef.current, connectionsRef.current));
            const useRaw = source.type !== CanvasNodeType.Config;
            const textInputIds = useRaw ? buildNodeGenerationInputs(source.id, nodesRef.current, connectionsRef.current).flatMap((input) => (input.type === "text" ? [input.nodeId] : [])) : [];
            const created = createCanvasNode(
                CanvasNodeType.Video,
                { x: position.x + spec.width / 2, y: position.y + spec.height / 2 },
                {
                    prompt: (useRaw ? rawPrompt : meta.prompt) || "",
                    ...(meta.model ? { model: meta.model } : {}),
                    ...(meta.size ? { size: meta.size } : {}),
                    ...(meta.seconds ? { seconds: meta.seconds } : {}),
                    ...(meta.vquality ? { vquality: meta.vquality } : {}),
                    ...(meta.generateAudio ? { generateAudio: meta.generateAudio } : {}),
                    ...(meta.watermark ? { watermark: meta.watermark } : {}),
                    ...(meta.videoMode ? { videoMode: meta.videoMode } : {}),
                },
            );
            const next: CanvasNodeData = { ...created, title: t("hemosi.videoTools.continueTitleNode", { name: node.title || t("assets.kinds.video") }) };
            setNodes((prev) => [...prev, next]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: frame.id, toNodeId: next.id }, ...textInputIds.map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: next.id }))]);
            setSelectedNodeIds(new Set([next.id]));
            setSelectedConnectionId(null);
            setToolbarNodeId(null);
            setDialogNodeId(next.id);
            focusNodePrompt(next.id);
        },
        [captureVideoNodeFrame, focusNodePrompt, t],
    );

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                addAsset({ kind: "text", title: node.title?.trim() || node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"), coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                addAsset({
                    kind: "video",
                    title: node.title?.trim() || node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.title?.trim() || node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success(t("common.addedToAssets"));
        },
        [addAsset, message, t],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: t("canvas.projectPage.reversePreset"), prompt: t("canvas.projectPage.reversePreset"), status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: t("canvas.projectPage.reverseTitle"),
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: t("canvas.reverseComposer", { imageId: node.id, textId: textNode.id }),
                    },
                ),
                title: t("canvas.projectPage.reverseConfigTitle"),
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, t],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.splitTitle", { name: node.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }),
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(t("canvas.projectPage.splitSuccess", { count: childNodes.length }));
        },
        [message, t],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (payload.generate && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: userPrompt });
            setMaskEditNodeId(null);
            const maskImage = await uploadImage(payload.maskDataUrl);
            const maskNodeId = nanoid();
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const maskSource = { id: maskNodeId, name: "mask.png", type: maskImage.mimeType || "image/png", dataUrl: maskImage.url, storageKey: maskImage.storageKey };
            const references = [source, maskSource];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, references);
            const childMetadata = payload.generate ? { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } : { prompt };
            setNodes((prev) => [
                ...prev,
                {
                    id: maskNodeId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.maskNodeTitle"),
                    position: { x: node.position.x, y: node.position.y + node.height + 96 },
                    width: node.width,
                    height: node.height,
                    metadata: imageMetadata(maskImage),
                },
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || t("canvas.projectPage.maskResult"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: childMetadata,
                },
            ]);
            setConnections((prev) => [
                ...prev,
                { id: nanoid(), fromNodeId: node.id, toNodeId: childId },
                { id: nanoid(), fromNodeId: maskNodeId, toNodeId: childId },
            ]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            if (!payload.generate) return;
            if (!(await requestGenerationConfirm(buildGenerationConfirmSummary(generationConfig, "image", { prompt, images: references, count: 1 }), "user", childId))) return;
            setRunningNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, references, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.maskFailed");
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, requestGenerationConfirm, startGenerationRequest, t],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const shortResizeImageNode = useCallback(async (node: CanvasNodeData, rawEdge: string) => {
        if (!node.metadata?.content) return;
        const targetShortEdge = Math.max(16, Math.min(4096, Math.round(Number(rawEdge) || 768)));
        setShortResizeNodeId(null);
        const resized = await resizeByShortEdgeDataUrl(node.metadata.content, targetShortEdge);
        const image = await uploadImage(resized);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: `${node.title || "图片"} (${image.width}×${image.height})`,
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    // Image-to-image result as a new connected node (改角度 / 超分): confirm card, record, loading state, error text kept.
    const runImageEditChild = useCallback(
        async (node: CanvasNodeData, prompt: string, title: string) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.error(modelNotReadyReason(generationConfig, generationConfig.model) || t("canvas.projectPage.generationFailed"));
                openConfigDialog(true);
                return;
            }
            if (!(await requestGenerationConfirm(buildGenerationConfirmSummary(generationConfig, "image", { prompt, images: sourceNodeReferenceImages(node), count: 1 }), "user", node.id))) return;
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setSuperResolveNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, generationSourceId: node.id, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    { signal: controller.signal },
                ).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, requestGenerationConfirm, startGenerationRequest, t],
    );
    const generateAngleNode = useCallback((node: CanvasNodeData, params: CanvasImageAngleParams) => runImageEditChild(node, buildAnglePrompt(params), buildAngleLabel(params)), [runImageEditChild]);
    const superResolveImageNode = useCallback((node: CanvasNodeData) => runImageEditChild(node, t("p1.toolbar.superResolvePrompt"), `${node.title || ""} · 超分`), [runImageEditChild, t]);

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter(
                (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || isAudioFile(f),
            );
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition =
                target?.position ||
                screenToCanvas(
                    (containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2,
                    (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2,
                );
            const STAGGER = 40; // Offset between multiple imported files.

            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;

                // Replace the target node with the first file.
                if (isAudioFile(first)) {
                    const audio = await uploadMediaFile(first, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else if (first.type.startsWith("video/")) {
                    const video = await uploadMediaFile(first, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else {
                    const image = await uploadImage(first);
                    const s = fitNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Image,
                                      title: first.name,
                                      width: s.width,
                                      height: s.height,
                                      metadata: {
                                          ...node.metadata,
                                          ...imageMetadata(image),
                                          errorDetails: undefined,
                                          freeResize: false,
                                          images: undefined,
                                          generationType: undefined,
                                          model: undefined,
                                          size: undefined,
                                          quality: undefined,
                                          count: undefined,
                                          references: undefined,
                                          primaryImageId: undefined,
                                      },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                }

                // Create the remaining files near the target node.
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files).filter(
                (item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item),
            );
            if (!files.length) return;

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            for (let i = 0; i < files.length; i++) {
                const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                const f = files[i];
                if (isAudioFile(f)) {
                    void createAudioFileNode(f, pos);
                } else if (f.type.startsWith("video/")) {
                    void createVideoFileNode(f, pos);
                } else {
                    void createImageFileNode(f, pos);
                }
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || t("canvas.projectPage.untitledCanvas"));
        setTitleEditing(true);
    }, [currentProject?.title, t]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options: { origin?: "agent"; skipConfirm?: boolean } = {}) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.error(modelNotReadyReason(generationConfig, generationConfig.model) || t("canvas.projectPage.generationFailed"));
                openConfigDialog(true);
                return;
            }

            const draftParams = draftParamsFor(sourceNode, mode);
            const isDraft = Boolean(draftParams) && Boolean(sourceNode?.metadata?.draft);
            const requestConfig = withCinematography(isDraft && draftParams ? applyDraftConfig(generationConfig, mode, draftParams) : generationConfig, buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, prompt, { mode }));

            {
                const preview = buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, prompt, { mode });
                const sourceImages = mode === "image" && effectiveConfig.nodeRegenerateBehavior !== "overwrite" ? sourceNodeReferenceImages(sourceNode || null) : [];
                const previewImages = [...new Map([...sourceImages, ...preview.referenceImages].map((image) => [image.id, image])).values()];
                const previewCount = mode === "image" ? getGenerationCount(requestConfig.count) : mode === "text" ? getGenerationCount(String(sourceNode?.metadata?.textCount || 1)) : 1;
                const confirmed = await requestGenerationConfirm(
                    buildGenerationConfirmSummary(requestConfig, mode, { prompt: preview.prompt, images: previewImages, videos: preview.referenceVideos, audioCount: preview.referenceAudios.length, count: previewCount, draft: isDraft }),
                    options.origin === "agent" ? "agent" : "user",
                    nodeId,
                    options.skipConfirm,
                );
                if (!confirmed) return;
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, fullPrompt));
                    const refs = context.referenceImages;
                    // Plugin nodes honour 草稿 for the size/quality params they expose (see draftParamsFor).
                    const image = refs.length
                        ? await requestEdit({ ...requestConfig, count: "1" }, context.prompt, refs, { signal: controller.signal }).then((items) => items[0])
                        : await requestGeneration({ ...requestConfig, count: "1" }, context.prompt, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                    setNodes((prev) =>
                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, rawPrompt: scene, generationSourceId: nodeId, model: generationConfig.model, draftResult: isDraft, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const overwriteExisting = effectiveConfig.nodeRegenerateBehavior === "overwrite";
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt, { mode }),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    // Draft runs request the cheapest variant; the node keeps its normal params in metadata for 高清重生成.
                    const count = getGenerationCount(requestConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const reuseImageNode = isImageNode && (overwriteExisting || isEmptyImageNode);
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content && !overwriteExisting
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = [...new Map([...sourceReference, ...generationContext.referenceImages].map((image) => [image.id, image])).values()];
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = { ...buildImageGenerationMetadata(generationType, generationConfig, getGenerationCount(generationConfig.count), referenceImages), draftResult: isDraft };
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const rootId = reuseImageNode ? nodeId : nanoid();
                    const imageIds = Array.from({ length: count }, () => nanoid());
                    pendingChildIds = [rootId];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: reuseImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: reuseImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: reuseImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            rawPrompt: prompt,
                            generationSourceId: nodeId,
                            status: NODE_STATUS_LOADING,
                            images: imageIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" })),
                            primaryImageId: undefined,
                            ...generationMetadata,
                        },
                    };

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : reuseImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: withPreviousVersion(node, { ...node.metadata, ...rootNode.metadata, content: undefined, storageKey: undefined, naturalWidth: undefined, naturalHeight: undefined, bytes: undefined, mimeType: undefined, errorDetails: undefined }),
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(reuseImageNode ? [] : [rootNode]),
                    ]);
                    if (!reuseImageNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    await Promise.all(
                        imageIds.map(async (imageId) => {
                            try {
                                const image = referenceImages.length
                                    ? await requestEdit({ ...requestConfig, count: "1" }, effectivePrompt, referenceImages, { signal: controller.signal }).then((items) => items[0])
                                    : await requestGeneration({ ...requestConfig, count: "1" }, effectivePrompt, { signal: controller.signal }).then((items) => items[0]);
                                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                const item: CanvasNodeImage = { id: imageId, status: NODE_STATUS_SUCCESS, content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
                                setNodes((prev) =>
                                    prev.map((node) => {
                                        if (node.id !== rootId) return node;
                                        const images = node.metadata?.images?.map((image) => (image.id === imageId ? item : image)) || [];
                                        if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images } };
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        return {
                                            ...node,
                                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                            ...imageSize,
                                            metadata: {
                                                ...node.metadata,
                                                content: item.content,
                                                storageKey: item.storageKey,
                                                naturalWidth: item.naturalWidth,
                                                naturalHeight: item.naturalHeight,
                                                bytes: item.bytes,
                                                mimeType: item.mimeType,
                                                images,
                                                primaryImageId: imageId,
                                            },
                                        };
                                    }),
                                );
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                if (!firstError) firstError = errorDetails;
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, images: node.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : node)));
                            }
                            return false;
                        }),
                    );
                    if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) {
                        message.error(hasSuccess ? t("canvas.projectPage.partialFailed") : firstError || t("canvas.projectPage.generationFailed"));
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : t("canvas.projectPage.generationFailed") } }
                                : node.id === rootId
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : t("canvas.projectPage.allFailed") } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const reuseVideoNode = sourceNode?.type === CanvasNodeType.Video && (overwriteExisting || isEmptyVideoNode);
                    const videoId = reuseVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: reuseVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: reuseVideoNode ? sourceNode.width : spec.width,
                        height: reuseVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            rawPrompt: prompt,
                            generationSourceId: nodeId,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                            draftResult: isDraft,
                            ...(reuseVideoNode ? { draft: sourceNode.metadata?.draft } : {}),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        reuseVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!reuseVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        await completeVideoNodeTask(videoId, { ...requestConfig, videoImageRoles: generationContext.imageRoles || generationContext.referenceImages.map(() => undefined) }, effectivePrompt, generationContext.referenceImages, controller.signal, {
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                            draftResult: isDraft,
                            rawPrompt: prompt,
                            generationSourceId: nodeId,
                        }, generationContext.referenceVideos, generationContext.referenceAudios);
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const reuseAudioNode = sourceNode?.type === CanvasNodeType.Audio && (overwriteExisting || isEmptyAudioNode);
                    const audioId = reuseAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: reuseAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: reuseAudioNode ? sourceNode.width : spec.width,
                        height: reuseAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, rawPrompt: prompt, generationSourceId: nodeId, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        reuseAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!reuseAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = getGenerationCount(String(sourceNode?.metadata?.textCount || 1));
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const isEmptyTextNode = sourceNode?.type === CanvasNodeType.Text && !sourceTextContent;
                const reuseTextNode = sourceNode?.type === CanvasNodeType.Text && (overwriteExisting || isEmptyTextNode);
                const rootId = reuseTextNode ? nodeId : nanoid();
                const textIds = Array.from({ length: textCount }, () => nanoid());
                const rootNode: CanvasNodeData = {
                    id: rootId,
                    type: CanvasNodeType.Text,
                    title: effectivePrompt.slice(0, 32) || "Generated Text",
                    position: reuseTextNode ? sourceNode.position : { x: parentPosition.x + parentConfig.width + 96, y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 },
                    width: reuseTextNode ? sourceNode.width : textConfig.width,
                    height: reuseTextNode ? sourceNode.height : textConfig.height,
                    metadata: {
                        prompt: effectivePrompt,
                        ...(editingTextNode ? {} : { rawPrompt: prompt, generationSourceId: nodeId }),
                        status: NODE_STATUS_LOADING,
                        fontSize: 14,
                        model: generationConfig.model,
                        reasoningEffort: generationConfig.reasoningEffort,
                        textCount,
                        texts: textIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "" })),
                        primaryTextId: textIds[0],
                    },
                };
                pendingChildIds = [rootId];
                setNodes((prev) =>
                    reuseTextNode
                        ? prev.map((node) => (node.id === nodeId ? { ...node, ...rootNode } : node))
                        : [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), rootNode],
                );
                if (!reuseTextNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                setSelectedNodeIds(new Set([nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(nodeId);

                const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                const results = await Promise.all(
                    textIds.map(async (textId): Promise<CanvasNodeText | null> => {
                        let streamed = "";
                        try {
                            const answer = await requestImageQuestion(
                                generationConfig,
                                buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                                (text) => {
                                    streamed = text;
                                    setNodes((prev) =>
                                        prev.map((node) =>
                                            node.id === rootId
                                                ? {
                                                      ...node,
                                                      metadata: {
                                                          ...node.metadata,
                                                          ...(node.metadata?.primaryTextId === textId ? { content: text } : {}),
                                                          texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content: text } : item)),
                                                      },
                                                  }
                                                : node,
                                        ),
                                    );
                                },
                                { signal: controller.signal },
                            );
                            const content = answer || streamed;
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === rootId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  ...(node.metadata?.primaryTextId === textId ? { content } : {}),
                                                  texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content, status: NODE_STATUS_SUCCESS } : item)),
                                              },
                                          }
                                        : node,
                                ),
                            );
                            return { id: textId, status: NODE_STATUS_SUCCESS, content } satisfies CanvasNodeText;
                        } catch (error) {
                            if (isGenerationCanceled(error)) return null;
                            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                            setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, status: NODE_STATUS_ERROR, errorDetails } : item)) } } : node)));
                            return { id: textId, status: NODE_STATUS_ERROR, content: "", errorDetails } satisfies CanvasNodeText;
                        }
                    }),
                );
                if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                if (controller.signal.aborted) return;
                const completedTexts = results.flatMap((item) => (item?.status === NODE_STATUS_SUCCESS ? [item] : []));
                const failedTexts = results.filter((item) => item?.status === NODE_STATUS_ERROR);
                const firstText = completedTexts[0];
                if (completedTexts.length <= 1) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== rootId)));
                if (failedTexts.length) message.error(firstText ? t("canvas.projectPage.partialTextFailed") : failedTexts[0]?.errorDetails || t("canvas.projectPage.generationFailed"));
                setNodes((prev) =>
                    prev.map((node) => {
                        if (node.id === rootId) {
                            const primaryText = completedTexts.find((text) => text.id === node.metadata?.primaryTextId) || firstText;
                            return {
                                ...node,
                                metadata: {
                                    ...node.metadata,
                                    content: primaryText?.content || "",
                                    texts: completedTexts,
                                    primaryTextId: primaryText?.id,
                                    status: primaryText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                    errorDetails: primaryText ? undefined : t("canvas.projectPage.generationFailed"),
                                },
                            };
                        }
                        return node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: firstText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: firstText ? undefined : t("canvas.projectPage.generationFailed") } } : node;
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : {
                                      ...node,
                                      metadata: {
                                          ...node.metadata,
                                          status: NODE_STATUS_ERROR,
                                          errorDetails,
                                          ...(isVideoTaskFailed(error) && node.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                      },
                                  }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, requestGenerationConfirm, startGenerationRequest, t],
    );
    useEffect(() => {
        // Shots run their own image/video generation (same confirm card, Agent-started ones included).
        generateNodeRef.current = async (nodeId, mode, prompt, options) => {
            if (nodesRef.current.find((node) => node.id === nodeId)?.type === HemosiNodeType.Shot) return void (await runShot(nodeId, mode === "video" ? "video" : "image", { origin: options?.origin }));
            return handleGenerateNode(nodeId, mode, prompt, options);
        };
    }, [handleGenerateNode, runShot]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string, retryOptions: { skipConfirm?: boolean } = {}) => {
            if (hasResumableVideoTask(node)) {
                await pollVideoNodeTask(node);
                return;
            }
            // Recompose from the generation source's current upstream (same traversal as a normal run) with the node's raw prompt,
            // so upstream text is not appended twice and references behind prompt/text nodes are collected again.
            const { source: sourceNode, rawPrompt } = resolveGenerationSource(node, nodesRef.current, connectionsRef.current, (id) => buildUpstreamTextBlock(id, nodesRef.current, connectionsRef.current));
            const paramsNode = sourceNode.type === CanvasNodeType.Config ? sourceNode : node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, paramsNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.error(modelNotReadyReason(generationConfig, generationConfig.model) || t("canvas.projectPage.generationFailed"));
                openConfigDialog(true);
                return false;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, rawPrompt, { mode: node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Image ? "image" : undefined }));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return false;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"), images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image)) } } : item)));
                return false;
            }
            const retryImages = retryReferenceImages || [];
            const retryMode = node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image";
            // Retrying a draft result stays a draft; the stored metadata keeps the normal params.
            const retryDraft = isDraftMode(retryMode) && Boolean(node.metadata?.draftResult);
            const requestConfig = retryDraft ? { ...applyDraftConfig(generationConfig, retryMode, draftParamsFor(paramsNode, retryMode) || undefined), count: "1" } : generationConfig;
            const retryConfirmed = await requestGenerationConfirm(
                buildGenerationConfirmSummary(requestConfig, retryMode, { prompt, images: useReferenceImages ? retryImages : [], videos: context?.referenceVideos, audioCount: context?.referenceAudios.length, count: 1, draft: retryDraft }),
                "user",
                node.id,
                retryOptions.skipConfirm,
            );
            if (!retryConfirmed) return false;

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, errorDetails: undefined } : image)) } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    await completeVideoNodeTask(node.id, context ? { ...requestConfig, videoImageRoles: context.imageRoles || context.referenceImages.map(() => undefined) } : requestConfig, prompt, retryImages, controller.signal, {
                        rawPrompt,
                        generationSourceId: sourceNode.id,
                        references: context ? generationReferenceUrls(context) : node.metadata?.references,
                        size: generationConfig.size,
                        seconds: generationConfig.videoSeconds,
                        vquality: generationConfig.vquality,
                        generateAudio: generationConfig.videoGenerateAudio,
                        watermark: generationConfig.videoWatermark,
                        videoMode: generationConfig.videoMode,
                    }, context?.referenceVideos || [], context?.referenceAudios || []);
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(requestConfig, prompt, retryImages, { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(requestConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl, { signal: controller.signal });
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const edge = imageId ? Math.max(item.width, item.height) : 0;
                        const imageSize = imageId && item.metadata?.freeResize ? { width: item.width, height: item.height } : imageId ? fitNodeSize(uploadedImage.width, uploadedImage.height, edge, edge) : fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary ? { width: imageSize.width, height: imageSize.height, ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}) } : {}),
                            metadata: withPreviousVersion(makePrimary ? item : undefined, {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            }),
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),
                                      ...(isVideoTaskFailed(error) && item.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, requestGenerationConfirm, startGenerationRequest, t],
    );
    handleRetryNodeRef.current = handleRetryNode;

    // Copy a generated image/video node to the right (same upstream connections, media stripped) and rerun it there.
    // hd: drop the draft flag so the copy uses the node's normal params; reshoot: keep everything as it was.
    const rerunIntoNewNode = useCallback(
        async (node: CanvasNodeData, kind: "hd" | "reshoot") => {
            const pluginPanel = getNodeDefinition(node.type)?.useBuiltinPanel;
            const isPluginWriteBack = !isBuiltinType(node.type) && Boolean(pluginPanel?.writeBackToSelf);
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && !isPluginWriteBack) return;
            if (!node.metadata?.prompt?.trim()) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const position = findFreeRightPosition(node, { width: node.width, height: node.height }, nodesRef.current);
            const metadata = stripGeneratedResult(node.metadata);
            const copyId = nanoid();
            const copy: CanvasNodeData = {
                ...node,
                id: copyId,
                position,
                metadata: {
                    ...metadata,
                    draft: false,
                    draftResult: kind === "hd" ? false : node.metadata?.draftResult,
                    groupId: undefined,
                    // A node that generated from its own inputs keeps doing so as the copy (which gets the same incoming edges).
                    ...(node.metadata?.generationSourceId === node.id ? { generationSourceId: copyId } : {}),
                },
            };
            const incoming = connectionsRef.current.filter((connection) => connection.toNodeId === node.id).map((connection) => ({ ...connection, id: nanoid(), toNodeId: copy.id }));
            const nextNodes = [...nodesRef.current, copy];
            const nextConnections = [...connectionsRef.current, ...incoming];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([copy.id]));
            setSelectedConnectionId(null);
            if (isPluginWriteBack && pluginPanel) {
                // Plugin nodes that write results to themselves rerun through the normal generate path on the copy.
                await handleGenerateNode(copy.id, pluginPanel.mode, node.metadata?.rawPrompt || node.metadata?.prompt || "");
                return;
            }
            const started = await handleRetryNode(copy);
            if (started === false) {
                setNodes((prev) => prev.filter((item) => item.id !== copy.id));
                setConnections((prev) => prev.filter((connection) => connection.toNodeId !== copy.id));
                setSelectedNodeIds(new Set([node.id]));
            }
        },
        [handleGenerateNode, handleRetryNode, message, t],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== nodeId)));
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                return { ...item, metadata: { ...item.metadata, images, count: images.length, primaryImageId: item.metadata?.primaryImageId === imageId ? images[0]?.id : item.metadata?.primaryImageId } };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, t],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            await ensureImagePreview(storedImage.storageKey);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, imageId?: string) => {
        setPreviewNodeId(node.id);
        setPreviewImageId(imageId || null);
    }, []);
    const handleNodeRetry = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text && (node.metadata?.textCount || 1) > 1) {
                void generateNodeRef.current?.(node.id, "text", node.metadata?.prompt || "");
                return;
            }
            void handleRetryNode(node);
        },
        [handleRetryNode],
    );
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNodeIds((current) => (current.has(nodeId) ? current : new Set([nodeId])));
        setSelectedConnectionId(null);
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);

    const [queueOpen, setQueueOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [rowModelIds, setRowModelIds] = useState<string[] | null>(null);
    const projectRecords = useGenerationLogStore((state) => state.records);
    const queueCount = useMemo(() => collectQueueItems(nodes, projectRecords.filter((record) => record.projectId === projectId)).length, [nodes, projectId, projectRecords]);

    const locateNode = useCallback(
        (nodeId: string) => {
            focusNode(nodeId);
            flashNode(nodeId);
        },
        [focusNode],
    );


    const confirmBatch = useCallback(
        (title: string, run: () => void) => {
            if (!useConfigStore.getState().config.confirmBeforeGenerate) return run();
            modal.confirm({ title, content: t("p1.batch.costHint"), okText: t("p1.batch.run"), cancelText: t("common.cancel"), onOk: run });
        },
        [modal, t],
    );

    /** 批量执行: shots get one confirm for the whole row; other generation nodes run with their own prompt/model/params. */
    const batchExecute = useCallback(
        (ids: string[], shotKind: "image" | "video" = "image") => {
            const targets = nodesRef.current.filter((node) => ids.includes(node.id));
            const shots = targets.filter((node) => node.type === HemosiNodeType.Shot);
            const runnable = targets.flatMap((node) => {
                const meta = node.metadata || {};
                if (node.type === CanvasNodeType.Config) return (meta.composerContent ?? meta.prompt)?.trim() ? [{ node, mode: meta.generationMode || "image", prompt: meta.composerContent ?? meta.prompt ?? "" }] : [];
                const mode = node.type === CanvasNodeType.Image ? "image" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : node.type === CanvasNodeType.Text ? "text" : null;
                return mode && meta.prompt?.trim() && !(node.type === CanvasNodeType.Text && meta.content?.trim()) ? [{ node, mode: mode as CanvasNodeGenerationMode, prompt: meta.prompt }] : [];
            });
            if (!shots.length && !runnable.length) return void message.warning(t("p1.batch.nothingToRun"));
            if (shots.length) void runShots(shots.map((shot) => shot.id), shotKind);
            if (runnable.length) confirmBatch(t("p1.batch.runTitle", { count: runnable.length }), () => runnable.forEach((item) => void handleGenerateNode(item.node.id, item.mode as CanvasNodeGenerationMode, item.prompt, { skipConfirm: true })));
        },
        [confirmBatch, handleGenerateNode, message, runShots, t],
    );

    useEffect(() => {
        batchExecuteRef.current = batchExecute;
        copySelectedNodesRef.current = copySelectedNodes;
        pasteCopiedNodesRef.current = pasteCopiedNodes;
    }, [batchExecute, copySelectedNodes, pasteCopiedNodes]);

    const retryQueueItems = useCallback(
        (items: QueueItem[], skipConfirm: boolean) => {
            items.forEach((item) => {
                const node = nodesRef.current.find((current) => current.id === item.node.id);
                if (!node) return;
                if (item.kind) void runShot(node.id, item.kind, { skipConfirm });
                else void handleRetryNode(node, undefined, { skipConfirm });
            });
        },
        [handleRetryNode, runShot],
    );

    const retryFailedIn = useCallback(
        (ids: string[]) => {
            const items = collectQueueItems(nodesRef.current.filter((node) => ids.includes(node.id)), []).filter((item) => item.state === "error");
            if (!items.length) return void message.info(t("p1.batch.noFailed"));
            confirmBatch(t("p1.batch.retryTitle", { count: items.length }), () => retryQueueItems(items, true));
        },
        [confirmBatch, message, retryQueueItems, t],
    );

    const exportNodes = useCallback(
        async (ids: string[]) => {
            const targets = nodesRef.current.filter((node) => ids.includes(node.id));
            const hide = message.loading(t("canvas.projectPage.exporting"), 0);
            try {
                await exportCanvasNodes(targets, `${currentProject?.title || t("canvas.title")}-${targets.length}`, { nodes: nodesRef.current, connections: connectionsRef.current });
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.sidePanel.exportFailed"));
            } finally {
                hide();
            }
        },
        [currentProject?.title, message, t],
    );

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    nodeId={panelNode.id}
                    nodes={nodes}
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                    onDisconnectReference={disconnectNodeReference}
                    onStartReferenceSelection={startNodeReferenceSelection}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    nodes={nodes}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    onDisconnectReference={disconnectNodeReference}
                    onStartReferenceSelection={startNodeReferenceSelection}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [configInputsById, confirmStopGeneration, connectedNodesByNodeId, disconnectNodeReference, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, nodes, renderPluginPanel, runningNodeId, startNodeReferenceSelection],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
            />
        ),
        [configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, runningNodeId],
    );

    const hoverPreviewNode = hoverPreviewNodeId ? nodeById.get(hoverPreviewNodeId) || null : null;
    const hoverPreviewMedia =
        hoverPreviewNode && (hoverPreviewNode.type === CanvasNodeType.Image || hoverPreviewNode.type === CanvasNodeType.Video) && hoverPreviewNode.metadata?.content
            ? {
                  video: hoverPreviewNode.type === CanvasNodeType.Video,
                  src: hoverPreviewNode.metadata.content,
                  width: hoverPreviewNode.metadata.naturalWidth || hoverPreviewNode.width,
                  height: hoverPreviewNode.metadata.naturalHeight || hoverPreviewNode.height,
              }
            : null;
    const showHoverPreview = Boolean(hoverPreviewMedia);
    const retainedPreviewRef = useRef<{ video: boolean; src: string; title: string; width: number; height: number } | null>(null);
    // Written during render on purpose: the overlay stays mounted while it fades out, so the last preview has to be
    // retained after the hovered node clears. Sizing reuses the measured container size instead of reading layout here.
    if (hoverPreviewMedia) {
        const previewSize = fitNodeSize(hoverPreviewMedia.width, hoverPreviewMedia.height, size.width * 0.9, size.height * 0.9);
        retainedPreviewRef.current = { video: hoverPreviewMedia.video, src: hoverPreviewMedia.src, title: hoverPreviewNode?.title || "", width: previewSize.width, height: previewSize.height };
    }
    const retainedPreview = retainedPreviewRef.current;

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onHoverNode={setHoverPreviewNodeId} onInsertAsset={handleAssetInsert} projectId={projectId} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || t("canvas.projectPage.untitledCanvas")}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onOpenPlugins={() => setPluginManagerOpen(true)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                    projectName={workspace?.title}
                    onOpenProject={workspace ? () => navigate(`/projects/${workspace.id}`) : undefined}
                    onFork={forkCurrentCanvas}
                    onSaveCanvasTemplate={saveCanvasAsTemplate}
                    onCloneToNewProject={cloneCanvasToNewProject}
                    onExportPackage={exportProjectPackage}
                    saveState={{ pending: savePending, savedAt: saveSavedAt, error: saveError }}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={(event) => {
                        if (!referencePickerNodeId) handleCanvasMouseDown(event);
                    }}
                    onCanvasDeselect={referencePickerNodeId ? undefined : deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        if (referencePickerNodeId) return;
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {visibleConnections.map(({ connection, from, to }) => {
                            const kind = connectionKindOf(connection, from, to);
                            return (
                            <ConnectionPath
                                key={connection.id}
                                connection={connection}
                                from={from}
                                to={to}
                                label={connection.label ? `${CONNECTION_KIND_LABEL[kind]} · ${connection.label}` : CONNECTION_KIND_LABEL[kind]}
                                problem={connectionKindProblem(kind, from, to)}
                                active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                onSelect={() => {
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu(null);
                                }}
                                onContextMenu={(event) => {
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                }}
                            />
                            );
                        })}
                        {connectingParams ? (
                            connectingParams.handleType === "source" && selectedNodeIds.size > 1 && selectedNodeIds.has(connectingParams.nodeId) ? (
                                selectedNodes.map((selNode) => (
                                    <ActiveConnectionPath
                                        key={`active-${selNode.id}`}
                                        node={selNode}
                                        handle={{ nodeId: selNode.id, handleType: "source" }}
                                        mouseWorld={mouseWorld}
                                        target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
                                    />
                                ))
                            ) : (
                                <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} />
                            )
                        ) : null}
                    </svg>

                    <StoryboardGhostLayer ghosts={storyboardGhostNodes} />

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            referenceSelectionState={!referencePickerNodeId ? undefined : node.id === referencePickerNodeId ? "target" : referenceConnectedNodeIds.has(node.id) || !isCanvasReferenceNode(node, nodes) ? "disabled" : "available"}
                            showPanel={!isNodeResizing && dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={expandedBatchNodeIds.has(node.id)}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            renderNodeContent={renderNodeContentPanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleNodeHoverStart}
                            onHoverEnd={handleNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onResizeStart={handleNodeResizeStart}
                            onResize={handleNodeResize}
                            onResizeEnd={handleNodeResizeEnd}
                            onContentChange={handleNodeContentChange}
                            onTitleChange={handleNodeTitleChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onDuplicateBatchImage={duplicateBatchImage}
                            onDownloadBatchImage={downloadBatchImage}
                            onRetryBatchImage={retryBatchImage}
                            onDeleteBatchImage={deleteBatchImage}
                            onRetry={handleNodeRetry}
                            onViewImage={handleNodeViewImage}
                            onSelectReference={selectNodeReference}
                            onContextMenu={handleNodeContextMenu}
                            onQuickGrow={referencePickerNodeId || hasMultipleSelectedNodes ? undefined : openQuickGrowMenu}
                        />
                    ))}

                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                            }}
                        >
                            <rect width="100%" height="100%" fill={theme.canvas.selectionFill} stroke={theme.canvas.selectionStroke} strokeOpacity={0.55} strokeWidth={1 / viewport.k} strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`} />
                        </svg>
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} scale={viewport.k} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            scale={viewport.k}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                {referencePickerNodeId ? <button type="button" className="absolute left-1/2 top-4 z-[90] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} onClick={exitNodeReferenceSelection}>{t("canvas.references.selectingHint")}</button> : null}

                <div
                    className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ease-out"
                    style={{ background: `color-mix(in srgb, ${theme.canvas.background} 76%, transparent)`, opacity: showHoverPreview ? 1 : 0 }}
                >
                    <div
                        className="flex flex-col overflow-hidden rounded-2xl border transition-transform duration-200 ease-out"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 24px 60px rgba(0,0,0,.32)", transform: showHoverPreview ? "scale(1)" : "scale(0.95)" }}
                    >
                        {retainedPreview ? (
                            <>
                                <div className="max-w-full truncate px-3.5 py-2 text-sm font-medium" style={{ color: theme.node.text }}>
                                    {retainedPreview.title || t(retainedPreview.video ? "assets.kinds.video" : "assets.kinds.image")}
                                </div>
                                <div className="overflow-hidden" style={{ width: retainedPreview.width, height: retainedPreview.height }}>
                                    {retainedPreview.video ? <video src={retainedPreview.src} muted playsInline preload="metadata" className="size-full object-contain" /> : <img src={retainedPreview.src} alt={retainedPreview.title} className="size-full object-contain" />}
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || isNodeResizing || nodeImageSettingsOpen || Boolean(referencePickerNodeId) || expandedBatchNodeIds.has(toolbarNode?.id || "") ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    pinnedExtraTools={toolbarNode ? hemosiToolbarItems(toolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onShortResize={(node) => setShortResizeNodeId(node.id)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={handleNodeViewImage}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onHdRegenerate={(node) => void rerunIntoNewNode(node, "hd")}
                    onCaptureFrame={(node) => void captureVideoNodeFrame(node.id, "current")}
                    onSplitVideoShots={(node) => void splitVideoToShots(node.id)}
                    onContinueFromLastFrame={(node) => void continueVideoFromLastFrame(node)}
                    onReshoot={(node) => void rerunIntoNewNode(node, "reshoot")}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => requestDeleteNodes(new Set([node.id]))}
                    onUngroup={(node) => ungroupSelection(new Set([node.id]))}
                />

                {hasMultipleSelectedNodes && !selectionBox ? (
                    <CanvasSelectionToolbar
                        nodes={selectedNodes}
                        viewport={viewport}
                        showToolbar={!isNodeDragging && !isNodeResizing}
                        canGroup={canGroupSelection}
                        canUngroup={canUngroupSelection}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onSaveTemplate={openSaveTemplate}
                        onConnectStart={(event, nodeId) => handleConnectStart(event, nodeId, "source")}
                        onQuickGrow={openQuickGrowMenu}
                        actions={[
                            ...(selectedNodes.some((node) => node.type === HemosiNodeType.Shot)
                                ? [
                                      { id: "shots-image", label: t("p1.batch.shotImages"), title: t("p1.batch.shotImagesTitle"), icon: <ImageIcon className="size-4" />, onClick: () => batchExecute([...selectedNodeIds], "image") },
                                      { id: "shots-video", label: t("p1.batch.shotVideos"), icon: <Video className="size-4" />, onClick: () => batchExecute([...selectedNodeIds], "video") },
                                      { id: "shots-model", label: t("p1.batch.shotModel"), title: t("p1.batch.shotModelTitle"), icon: <ListChecks className="size-4" />, onClick: () => setRowModelIds(selectedNodes.filter((node) => node.type === HemosiNodeType.Shot).map((node) => node.id)) },
                                  ]
                                : [{ id: "run", label: t("p1.batch.run"), title: t("p1.batch.runHint"), icon: <Play className="size-4" />, onClick: () => batchExecute([...selectedNodeIds]) }]),
                            { id: "retry", label: t("p1.batch.retryFailed"), icon: <RotateCcw className="size-4" />, onClick: () => retryFailedIn([...selectedNodeIds]) },
                            { id: "layout", label: t("p1.batch.layout"), icon: <LayoutGrid className="size-4" />, onClick: layoutNodes },
                            { id: "download", label: t("p1.batch.download"), title: t("p1.batch.downloadTitle"), icon: <Download className="size-4" />, onClick: () => void exportNodes([...selectedNodeIds]) },
                            { id: "delete", label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => requestDeleteNodes(new Set(selectedNodeIds)) },
                        ]}
                    />
                ) : null}

                <CanvasToolbar
                    onOpenTemplates={() => setTemplatePanelOpen(true)}
                    selectedCount={selectedNodeIds.size}
                    canvasTool={canvasTool}
                    onFocusSelected={focusSelectedNode}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    extraButtons={[
                        { id: "tool-storyboard", label: "分镜表", icon: <Clapperboard className="size-4.5" />, onClick: () => createNode(HemosiNodeType.Storyboard) },
                        { id: "tool-compare", label: "双图拉帘对比", icon: <Columns2 className="size-4.5" />, onClick: () => createNode(HemosiNodeType.ImageCompare) },
                        { id: "tool-bookmark", label: "书签快速导航 (按 1~9 闪现)", icon: <Bookmark className="size-4.5" />, onClick: () => createNode(HemosiNodeType.Bookmark) },
                        { id: "tool-scene3d", label: "3D 导演工作台", icon: <Box className="size-4.5" />, onClick: () => createNode(DIRECTOR_NODE_TYPE) },
                        { id: "tool-search", label: "搜索节点 (Ctrl+F)", icon: <Search className="size-4.5" />, active: searchOpen, onClick: () => setSearchOpen((value) => !value) },
                        { id: "tool-layout", label: "一键整理布局 (Ctrl+Shift+L)", icon: <LayoutGrid className="size-4.5" />, onClick: layoutNodes },
                        { id: "tool-queue", label: queueCount ? `生成队列 · ${queueCount} 项` : "生成队列 / 记录", icon: <span className="relative"><ListChecks className="size-4.5" />{queueCount ? <span className="absolute -right-1.5 -top-1.5 grid min-w-3.5 place-items-center rounded-full px-0.5 text-[9px] font-bold" style={{ background: "var(--hemosi-accent)", color: "#0a0c0e" }}>{queueCount}</span> : null}</span>, active: queueOpen, onClick: () => setQueueOpen((value) => !value) },
                    ]}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => requestDeleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onCanvasToolChange={setCanvasTool}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {quickGrowMenu && nodeById.get(quickGrowMenu.nodeId) ? (
                    <CanvasQuickGrowMenu x={quickGrowMenu.x} y={quickGrowMenu.y} kinds={quickGrowKinds(nodeById.get(quickGrowMenu.nodeId)!)} onSelect={(kind) => quickGrowNode(quickGrowMenu.nodeId, kind)} onClose={closeQuickGrowMenu} />
                ) : null}

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canCaptureVideoFrame={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content)}
                        canGroup={contextMenu.type === "node" && canGroupSelection}
                        canUngroup={contextMenu.type === "node" && canUngroupSelection}
                        onClose={() => setContextMenu(null)}
                        onCaptureVideoFrame={(position) => {
                            if (contextMenu.type !== "node") return;
                            void captureVideoNodeFrame(contextMenu.nodeId, position);
                        }}
                        onDuplicate={(withConnections) => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId, withConnections);
                            setContextMenu(null);
                        }}
                        node={contextMenuNode}
                        onToggleLock={() => {
                            if (contextMenu.type === "node") toggleNodeLock(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onToggleCollapse={() => {
                            if (contextMenu.type === "node") toggleNodeCollapse(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDownload={() => {
                            if (contextMenuNode) void downloadAnyNode(contextMenuNode);
                            setContextMenu(null);
                        }}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onSaveTemplate={openSaveTemplate}
                        connectionItems={
                            contextMenu.type === "connection" ? (
                                <>
                                    {CONNECTION_KINDS.map((kind) => (
                                        <MenuButton key={kind} icon={<span className="inline-block size-4 text-center">{connectionsRef.current.find((item) => item.id === contextMenu.connectionId)?.kind === kind ? "●" : "○"}</span>} label={t("p1.link.setKind", { kind: CONNECTION_KIND_LABEL[kind] })} onClick={() => setConnectionKind(contextMenu.connectionId, kind)} />
                                    ))}
                                    <MenuButton icon={<span className="inline-block size-4 text-center">✎</span>} label={t("p1.link.editLabel")} onClick={() => {
                                        const current = connectionsRef.current.find((item) => item.id === contextMenu.connectionId);
                                        setLabelEdit({ connectionId: contextMenu.connectionId, value: current?.label || "" });
                                        setContextMenu(null);
                                    }} />
                                </>
                            ) : null
                        }
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                requestDeleteNodes(selectedNodeIdsRef.current.has(contextMenu.nodeId) ? new Set(selectedNodeIdsRef.current) : new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <StoryboardConfirmModal state={storyboardConfirm} />
                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                <Modal
                    title="短边缩放"
                    open={Boolean(shortResizeNode?.metadata?.content)}
                    centered
                    width={420}
                    okText="生成缩放图"
                    cancelText="取消"
                    onOk={() => shortResizeNode && void shortResizeImageNode(shortResizeNode, shortResizeEdge)}
                    onCancel={() => setShortResizeNodeId(null)}
                >
                    {shortResizeNode ? (() => {
                        const srcW = shortResizeNode.metadata?.naturalWidth || shortResizeNode.width || 0;
                        const srcH = shortResizeNode.metadata?.naturalHeight || shortResizeNode.height || 0;
                        const out = srcW && srcH ? resolveShortEdgeSize(srcW, srcH, Math.max(16, Math.min(4096, Math.round(Number(shortResizeEdge) || 768)))) : null;
                        return (
                            <div className="space-y-3 py-1">
                                <div className="flex items-center justify-between text-xs opacity-70">
                                    <span>原图真实像素：{srcW && srcH ? `${srcW} × ${srcH} px（短边 ${Math.min(srcW, srcH)} px）` : "读取中"}</span>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="text-xs font-medium opacity-80">目标最短边像素（回车直接生成）</div>
                                    <Input
                                        type="number"
                                        min={16}
                                        max={4096}
                                        value={shortResizeEdge}
                                        autoFocus
                                        suffix="px"
                                        onChange={(e) => setShortResizeEdge(e.target.value)}
                                        onPressEnter={() => void shortResizeImageNode(shortResizeNode, shortResizeEdge)}
                                    />
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {[512, 768, 1024, 1280].map((preset) => (
                                            <Button key={preset} size="small" type={Number(shortResizeEdge) === preset ? "primary" : "default"} onClick={() => setShortResizeEdge(String(preset))}>
                                                {preset}px
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                                {out ? (
                                    <div className="rounded-lg border border-white/10 bg-black/5 px-3 py-2 text-xs dark:bg-white/5">
                                        输出尺寸：<span className="font-semibold">{out.width} × {out.height} px</span>（保持原图比例）
                                    </div>
                                ) : null}
                            </div>
                        );
                    })() : null}
                </Modal>

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title={t("canvas.projectPage.superResolve")} open={Boolean(superResolveNode?.metadata?.content)} centered okText={t("p1.toolbar.superResolveOk")} cancelText={t("common.cancel")} onOk={() => superResolveNode && void superResolveImageNode(superResolveNode)} onCancel={() => setSuperResolveNodeId(null)}>
                    <p className="text-sm opacity-70">{t("p1.toolbar.superResolveBody")}</p>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <CanvasMediaPreviewModal
                    node={previewNode}
                    content={previewContent}
                    open={Boolean(previewContent)}
                    onClose={() => {
                        setPreviewNodeId(null);
                        setPreviewImageId(null);
                    }}
                />

                <Modal
                    title={t("canvas.projectPage.clearTitle")}
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>{t("common.cancel")}</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                {t("canvas.projectPage.clear")}
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">{t("canvas.projectPage.clearDescription")}</p>
                </Modal>

                <CanvasTemplateModal open={templatePanelOpen} onClose={() => setTemplatePanelOpen(false)} onInsert={insertTemplate} />
                <CanvasSaveTemplateModal open={Boolean(saveTemplateNodeIds)} defaultName={t("hemosi.templates.defaultName", { count: useTemplateStore.getState().templates.length + 1 })} onCancel={() => setSaveTemplateNodeIds(null)} onSave={saveSelectionAsTemplate} />

                <Modal title={t("p1.link.editLabel")} open={Boolean(labelEdit)} centered destroyOnHidden onCancel={() => setLabelEdit(null)} onOk={() => {
                    if (labelEdit) setConnections((prev) => prev.map((item) => (item.id === labelEdit.connectionId ? { ...item, label: labelEdit.value.trim() || undefined } : item)));
                    setLabelEdit(null);
                }}>
                    <Input autoFocus maxLength={24} value={labelEdit?.value || ""} placeholder={t("p1.link.labelPlaceholder")} onChange={(event) => setLabelEdit((current) => (current ? { ...current, value: event.target.value } : current))} />
                </Modal>

                {searchOpen ? <CanvasNodeSearch nodes={nodes} onLocate={locateNode} onClose={() => setSearchOpen(false)} /> : null}

                <CanvasGenerationQueue
                    open={queueOpen}
                    projectId={projectId}
                    nodes={nodes}
                    onClose={() => setQueueOpen(false)}
                    onFocus={locateNode}
                    onEdit={(nodeId) => {
                        locateNode(nodeId);
                        setDialogNodeId(nodeId);
                    }}
                    onRetry={(item) => retryQueueItems([item], false)}
                    onRetryAll={(items) => confirmBatch(t("p1.batch.retryTitle", { count: items.length }), () => retryQueueItems(items, true))}
                    onStop={confirmStopGeneration}
                />

                <Modal title="快捷键清单" open={shortcutsOpen} centered width={760} footer={null} onCancel={() => setShortcutsOpen(false)}>
                    <CanvasShortcutsList />
                </Modal>

                <Modal title={t("p1.batch.shotModelTitle")} open={Boolean(rowModelIds)} centered footer={null} onCancel={() => setRowModelIds(null)} destroyOnHidden>
                    <div className="space-y-3 pt-2">
                        <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-sm opacity-70">图片模型</span>
                            <ModelPicker config={effectiveConfig} value={nodeById.get(rowModelIds?.[0] || "")?.metadata?.model || effectiveConfig.imageModel} capability="image" fullWidth onChange={(model) => setNodes((prev) => prev.map((node) => (rowModelIds?.includes(node.id) ? { ...node, metadata: { ...node.metadata, model } } : node)))} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-sm opacity-70">视频模型</span>
                            <ModelPicker config={effectiveConfig} value={nodeById.get(rowModelIds?.[0] || "")?.metadata?.videoModel || effectiveConfig.videoModel} capability="video" fullWidth onChange={(videoModel) => setNodes((prev) => prev.map((node) => (rowModelIds?.includes(node.id) ? { ...node, metadata: { ...node.metadata, videoModel } } : node)))} />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button onClick={() => { if (rowModelIds) batchExecute(rowModelIds, "image"); setRowModelIds(null); }}>{t("p1.batch.rerunImages")}</Button>
                            <Button type="primary" onClick={() => { if (rowModelIds) batchExecute(rowModelIds, "video"); setRowModelIds(null); }}>{t("p1.batch.rerunVideos")}</Button>
                        </div>
                    </div>
                </Modal>

                <CanvasNodeVersionsModal
                    node={versionsNodeId ? nodeById.get(versionsNodeId) || null : null}
                    onClose={() => setVersionsNodeId(null)}
                    onRestore={(nodeId, versionId) => updateNodeById(nodeId, (node) => restoreVersion(node, versionId))}
                    onDelete={(nodeId, versionId) => updateNodeById(nodeId, (node) => deleteVersion(node, versionId))}
                    onRestoreText={(nodeId, versionId) => updateNodeById(nodeId, (node) => restoreTextVersion(node, versionId))}
                />

                <Modal title={t("p1.toolbar.setRefTitle")} open={Boolean(refTargetSourceId)} centered footer={null} onCancel={() => setRefTargetSourceId(null)} destroyOnHidden>
                    <div className="thin-scrollbar max-h-[50vh] space-y-1 overflow-auto">
                        {nodes.filter((node) => node.id !== refTargetSourceId && isGenerationTarget(node) && node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Audio).map((node) => (
                            <button key={node.id} type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => {
                                if (refTargetSourceId && !connectionsRef.current.some((item) => item.fromNodeId === refTargetSourceId && item.toNodeId === node.id)) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: refTargetSourceId, toNodeId: node.id, kind: "reference" }]);
                                setRefTargetSourceId(null);
                                focusNode(node.id);
                            }}>
                                <span className="truncate">{node.type === HemosiNodeType.Shot ? `镜头 ${node.metadata?.shotNo ?? ""} · ` : ""}{node.title}</span>
                                <span className="shrink-0 text-xs opacity-50">{getNodeSpec(node.type).title}</span>
                            </button>
                        ))}
                    </div>
                </Modal>

                <CanvasGenerationConfirmModal summary={generationConfirmSummary} onConfirm={(dontAskAgain) => settleGenerationConfirm(true, dontAskAgain)} onCancel={() => settleGenerationConfirm(false)} />

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}

function CanvasMediaPreviewModal({
    node,
    content,
    open,
    onClose,
}: {
    node: CanvasNodeData | null;
    content: string | undefined;
    open: boolean;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const isVideo = node?.type === CanvasNodeType.Video;
    const [videoMeta, setVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
    const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
    const [infoOpen, setInfoOpen] = useState(false);

    useEffect(() => {
        if (!open) {
            setVideoMeta(null);
            setImageMeta(null);
            setInfoOpen(false);
            return;
        }
        // Exit any native browser fullscreen and pause any playing videos on the canvas when opening fullscreen preview
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
        }
        document.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]").forEach((v) => {
            if (!v.paused) v.pause();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
            if (event.key === "i" || event.key === "I") setInfoOpen((prev) => !prev);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open || !content) return null;

    const bytes = node?.metadata?.bytes || (content ? getDataUrlByteSize(content) : 0);
    const videoDuration = videoMeta?.duration || (node?.metadata?.durationMs ? node.metadata.durationMs / 1000 : node?.metadata?.seconds || 0);
    const videoWidth = videoMeta?.width || node?.metadata?.naturalWidth;
    const videoHeight = videoMeta?.height || node?.metadata?.naturalHeight;
    const imgWidth = imageMeta?.width || node?.metadata?.naturalWidth;
    const imgHeight = imageMeta?.height || node?.metadata?.naturalHeight;

    const handleCopyPreviewImage = async () => {
        try {
            const { copyImageSourceToClipboard } = await import("@/components/canvas/canvas-image-toolbar-tools");
            await copyImageSourceToClipboard(content);
            message.success("已复制到粘贴板");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "复制图片失败");
        }
    };

    return (
        <div
            className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/92 backdrop-blur-md select-none"
            onClick={onClose}
        >
            {/* 纯无边框媒体画面主体 */}
            {isVideo ? (
                <video
                    src={content}
                    controls
                    controlsList="nofullscreen nodownload noremoteplayback"
                    disablePictureInPicture
                    autoPlay
                    className="max-h-[95vh] max-w-[96vw] object-contain outline-none"
                    onClick={(event) => event.stopPropagation()}
                    onLoadedMetadata={(event) =>
                        setVideoMeta({
                            duration: event.currentTarget.duration || 0,
                            width: event.currentTarget.videoWidth,
                            height: event.currentTarget.videoHeight,
                        })
                    }
                />
            ) : (
                <img
                    src={content}
                    alt={node?.title || "Image"}
                    className="max-h-[95vh] max-w-[96vw] object-contain"
                    onClick={(event) => event.stopPropagation()}
                    onLoad={(event) =>
                        setImageMeta({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                        })
                    }
                />
            )}

            {/* 右上角极简悬浮控制组：复制图片 + i 信息按钮 + 关闭 */}
            <div
                className="fixed right-5 top-5 z-[1310] flex items-center gap-2.5"
                onClick={(event) => event.stopPropagation()}
            >
                {!isVideo ? (
                    <button
                        type="button"
                        title="复制到粘贴板"
                        className="flex h-10 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3.5 text-xs font-medium text-white/90 backdrop-blur-md transition hover:border-[#00d0c4] hover:text-[#00d0c4]"
                        onClick={() => void handleCopyPreviewImage()}
                    >
                        <Copy className="size-3.5" />
                        <span>复制图片</span>
                    </button>
                ) : null}
                <div className="relative">
                    <button
                        type="button"
                        title="媒体信息 (快捷键 I)"
                        className={`grid size-10 place-items-center rounded-full border text-sm font-semibold italic backdrop-blur-md transition ${
                            infoOpen
                                ? "border-[#00d0c4] bg-[#00d0c4]/20 text-[#00d0c4]"
                                : "border-white/15 bg-black/60 text-white/90 hover:border-white/40 hover:text-white"
                        }`}
                        onClick={() => setInfoOpen((prev) => !prev)}
                    >
                        i
                    </button>
                    {infoOpen ? (
                        <div className="absolute right-0 top-12 w-80 rounded-2xl border border-white/15 bg-[#0d1114]/95 p-4 text-xs text-gray-200 shadow-2xl backdrop-blur-xl select-text">
                            <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
                                <span className="font-semibold text-white truncate max-w-[210px]" title={node?.title}>
                                    {node?.title || (isVideo ? "视频节点" : "图片节点")}
                                </span>
                                <span className="rounded bg-[#00d0c4]/15 px-1.5 py-0.5 text-[10px] text-[#00d0c4]">
                                    {isVideo ? "VIDEO" : "IMAGE"}
                                </span>
                            </div>
                            <div className="space-y-1.5 leading-relaxed">
                                {isVideo ? (
                                    <>
                                        {videoWidth && videoHeight ? (
                                            <div className="flex justify-between"><span className="opacity-55">分辨率</span><span>{videoWidth} × {videoHeight} px</span></div>
                                        ) : null}
                                        {videoDuration ? (
                                            <div className="flex justify-between"><span className="opacity-55">时长</span><span>{Number(videoDuration).toFixed(1)} 秒</span></div>
                                        ) : null}
                                    </>
                                ) : (
                                    <>
                                        {imgWidth && imgHeight ? (
                                            <div className="flex justify-between"><span className="opacity-55">真实像素</span><span>{imgWidth} × {imgHeight} px</span></div>
                                        ) : null}
                                    </>
                                )}
                                {bytes ? (
                                    <div className="flex justify-between"><span className="opacity-55">文件大小</span><span>{formatBytes(bytes)}</span></div>
                                ) : null}
                                {node?.metadata?.model ? (
                                    <div className="flex justify-between gap-2"><span className="shrink-0 opacity-55">生成模型</span><span className="truncate">{node.metadata.model}</span></div>
                                ) : null}
                                {node?.metadata?.prompt ? (
                                    <div className="pt-1.5 border-t border-white/10">
                                        <div className="mb-1 opacity-55">提示词</div>
                                        <div className="max-h-32 overflow-y-auto rounded-lg bg-black/40 p-2 text-[11px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                                            {node.metadata.prompt}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </div>
                <button
                    type="button"
                    title="关闭全屏 (Esc)"
                    className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/60 text-lg leading-none text-white/90 backdrop-blur-md transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                    onClick={onClose}
                >
                    ×
                </button>
            </div>
        </div>
    );
}
