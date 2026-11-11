export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

/** Hemosi node types registered through the node registry (rendered by their own Content component). */
export const HemosiNodeType = { Shot: "shot", Anchor: "anchor" } as const;

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini";
    groupId?: string;
    /** Draft switch on an image/video generation node: generate with the cheapest parameters. */
    draft?: boolean;
    /** Result produced in draft mode; shows the 草稿 badge and offers 高清重生成. */
    draftResult?: boolean;
    /** The user's own prompt for the generation that produced this node, before upstream text was appended. */
    rawPrompt?: string;
    /** Node whose upstream inputs fed the generation that produced this node (config/text source, or the node itself). */
    generationSourceId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    /** Folded to a title bar; expandedHeight restores the size. */
    collapsed?: boolean;
    expandedHeight?: number;
    /** Locked nodes cannot be dragged, resized or deleted until unlocked. */
    locked?: boolean;
    /** Identity of an image when it feeds a generation. */
    imageRole?: CanvasImageRole;
    /** Kind of an audio node. */
    audioRole?: CanvasAudioRole;
    /** Order of upstream reference node ids on this generation node (ids not listed keep connection order after these). */
    refOrder?: string[];
    /** Upstream reference node ids switched off for this node's generation. */
    refDisabled?: string[];
    /** Generation seed; empty = random. */
    seed?: string;
    /** Earlier results of this node, newest last. */
    versions?: CanvasNodeVersion[];
    /** Text node history, newest last. */
    textVersions?: CanvasTextVersion[];
    /** Anchor node. */
    anchorKind?: CanvasAnchorKind;
    anchorText?: string;
    anchorImages?: CanvasNodeImage[];
    anchorVoice?: { content: string; storageKey?: string; mimeType?: string; name?: string };
    /** Storyboard shot node. */
    shotNo?: number;
    shotDescription?: string;
    shotRefs?: CanvasShotRef[];
    shotImage?: CanvasNodeImage;
    shotVideo?: { content: string; storageKey?: string; mimeType?: string; naturalWidth?: number; naturalHeight?: number; durationMs?: number; bytes?: number };
    shotStatus?: { image?: CanvasNodeStatus; video?: CanvasNodeStatus; imageError?: string; videoError?: string };
    videoModel?: string;
    /** Material node: an external file archived into the project. */
    material?: boolean;
    sourceFileName?: string;
};

export type CanvasImageRole = "reference" | "firstFrame" | "lastFrame" | "character" | "scene" | "style";
export type CanvasAudioRole = "voice" | "bgm" | "sfx";
export type CanvasAnchorKind = "character" | "scene" | "style";

export type CanvasShotRef = CanvasNodeImage & { enabled: boolean; role?: CanvasImageRole };

export type CanvasNodeVersion = {
    id: string;
    createdAt: string;
    kind: "image" | "video" | "audio" | "text";
    content: string;
    storageKey?: string;
    mimeType?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    bytes?: number;
    durationMs?: number;
    prompt?: string;
    model?: string;
    draft?: boolean;
};

export type CanvasTextVersion = { id: string; createdAt: string; content: string };

export type CanvasConnectionKind = "reference" | "input" | "continue";

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    /** Semantic of the link; inferred from the node types when missing. */
    kind?: CanvasConnectionKind;
    label?: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
