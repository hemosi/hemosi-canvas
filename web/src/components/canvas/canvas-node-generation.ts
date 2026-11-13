import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, HemosiNodeType, type CanvasAudioRole, type CanvasConnection, type CanvasImageRole, type CanvasNodeData } from "@/types/canvas";
import { connectionKindOf } from "@/lib/canvas/canvas-connection-kind";
import { IMAGE_ROLE_LABEL, AUDIO_ROLE_LABEL, orderReferenceInputs } from "@/lib/canvas/canvas-reference-roles";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cinematographyPromptBlock, hasCamera, resolveNodeLighting, type ResolvedLighting } from "@/lib/canvas/canvas-cinematography";
import type { CameraSettings, LightingSettings } from "@/types/cinematography";
import type { AiConfig } from "@/stores/use-config-store";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
    /** Roles of referenceImages, same order. */
    imageRoles?: (CanvasImageRole | undefined)[];
    /** A first/last frame was marked, so video generation must use first/last-frame mode. */
    forceFrames?: boolean;
    /** Videos linked as 续作: their last frame becomes the first frame (resolved in hydrateNodeGenerationContext). */
    continueVideos?: ReferenceVideo[];
    /** Camera of the generating node and the lighting it resolved to (already written into prompt). */
    camera?: CameraSettings;
    lighting?: LightingSettings;
    lightingSource?: ResolvedLighting["source"];
};

/** Carry the context's camera/lighting onto the request config so the confirm card shows them and vendor adapters can send native params. */
export function withCinematography<T extends AiConfig>(config: T, context: Pick<NodeGenerationContext, "camera" | "lighting">): T {
    return { ...config, camera: context.camera, lighting: context.lighting };
}

export type NodeGenerationResourceInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    /** Text block label override (anchors). */
    label?: string;
    role?: CanvasImageRole;
    audioRole?: CanvasAudioRole;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

type NodeGenerationGroupInput = {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput = NodeGenerationResourceInput | NodeGenerationGroupInput;

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, options: { mode?: string; extraInputs?: NodeGenerationInput[] } = {}): NodeGenerationContext {
    const context = buildBaseGenerationContext(nodeId, nodes, connections, prompt, options);
    if (options.mode !== "image" && options.mode !== "video") return context;
    const source = nodes.find((node) => node.id === nodeId);
    const camera = hasCamera(source?.metadata?.camera) ? source!.metadata!.camera : undefined;
    const resolved = resolveNodeLighting(nodeId, nodes, connections);
    const block = cinematographyPromptBlock(camera, resolved.lighting);
    return { ...context, prompt: block ? `${context.prompt}\n\n${block}` : context.prompt, camera, lighting: resolved.lighting, lightingSource: resolved.source };
}

function buildBaseGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, options: { mode?: string; extraInputs?: NodeGenerationInput[] }): NodeGenerationContext {
    const inputs = [...(options.extraInputs || []), ...buildNodeGenerationInputs(nodeId, nodes, connections)];
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    // The node a run reads its settings from (a config node it feeds, or itself) decides order and on/off of references.
    const settingsNode = nodes.find((node) => node.id === connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((item) => item.id === connection.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId) || sourceNode;
    const targetIds = new Set([nodeId, settingsNode?.id].filter(Boolean) as string[]);
    const linkKind = (fromId: string) => {
        const connection = connections.find((item) => item.fromNodeId === fromId && targetIds.has(item.toNodeId));
        return connection ? connectionKindOf(connection, nodes.find((node) => node.id === fromId), nodes.find((node) => node.id === connection.toNodeId)) : undefined;
    };
    const resourceInputs = orderReferenceInputs(flattenGenerationInputs(inputs), settingsNode?.metadata, options.mode === "video");
    const continueVideos = options.mode === "video" ? resourceInputs.filter((input) => input.video && linkKind(input.nodeId) === "continue").map((input) => input.video!) : [];
    let textIndex = 0;
    const upstreamText = resourceInputs.flatMap((input) => (input.text ? [textBlock(input.label || generationLabel("text", textIndex++), input.text)] : [])).join("\n\n");
    const imageInputs = resourceInputs.filter((input) => input.image);
    const referenceImages = imageInputs.map((input) => input.image!);
    const imageRoles = imageInputs.map((input) => input.role);
    const referenceVideos = resourceInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video) && !continueVideos.includes(video!));
    const audioInputs = resourceInputs.filter((input) => input.audio);
    const referenceAudios = audioInputs.map((input) => input.audio!);
    const roleNotes = [
        ...imageInputs.flatMap((input, index) => (input.role && input.role !== "reference" ? [`${imageReferenceLabel(index + continueVideos.length)}：${IMAGE_ROLE_LABEL[input.role]}${input.title ? `（${input.title}）` : ""}`] : [])),
        ...audioInputs.flatMap((input, index) => (input.audioRole ? [`${generationLabel("audio", index)}：${AUDIO_ROLE_LABEL[input.audioRole]}`] : [])),
    ];
    const blocks = [upstreamText, roleNotes.length ? textBlock("参考素材说明", roleNotes.join("\n")) : ""].filter(Boolean).join("\n\n");

    return {
        prompt: blocks ? `${prompt}\n\n${blocks}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: resourceInputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
        imageRoles,
        forceFrames: continueVideos.length > 0 || imageRoles.some((role) => role === "firstFrame" || role === "lastFrame"),
        continueVideos,
    };
}

/** The upstream text block plain (non-composer) generation appends after the node's own prompt; "" when there is none. */
export function buildUpstreamTextBlock(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const resourceInputs = flattenGenerationInputs(buildNodeGenerationInputs(nodeId, nodes, connections));
    let textIndex = 0;
    return resourceInputs.flatMap((input) => (input.text ? [textBlock(generationLabel("text", textIndex++), input.text)] : [])).join("\n\n");
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            const labels = flattenGenerationInputs([input]).map((resource) => {
                let label = labelByNodeId.get(resource.nodeId);
                if (!label) {
                    label = generationLabel(resource.type, counts[resource.type]++);
                    labelByNodeId.set(resource.nodeId, label);
                    if (resource.type === "text") textBlocks.push(textBlock(label, resource.text || ""));
                    else selectedInputs.push(resource);
                }
                return resource.type === "text" ? `【${label}】` : label;
            });
            nextPrompt += labels.join("、");
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        if (node.type === CanvasNodeType.Group) {
            const children = getGroupResourceNodes(node.id, nodes).flatMap((child) => readNodeGenerationResource(child, nodes, connections));
            return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
        }
        return readNodeGenerationResource(node, nodes, connections);
    });
}

function flattenGenerationInputs(inputs: NodeGenerationInput[]) {
    const resources = inputs.flatMap((input) => (input.type === "group" ? input.children : [input]));
    return [...new Map(resources.map((input) => [input.nodeId, input])).values()];
}

function readNodeGenerationResource(node: CanvasNodeData, _nodes?: CanvasNodeData[], _connections?: CanvasConnection[]): NodeGenerationResourceInput[] {
    if (node.type === HemosiNodeType.Shot) return readShotResources(node);
    const image = readReferenceImage(node);
    if (image) return [{ nodeId: node.id, type: "image", title: node.title, image, role: node.metadata?.imageRole }];
    const video = readReferenceVideo(node);
    if (video) return [{ nodeId: node.id, type: "video", title: node.title, video }];
    const audio = readReferenceAudio(node);
    if (audio) return [{ nodeId: node.id, type: "audio", title: node.title, audio, audioRole: node.metadata?.audioRole }];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if (resource?.kind === "image" && resource.url) return [{ nodeId: node.id, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "video" && resource.url) return [{ nodeId: node.id, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: node.metadata?.mimeType || "video/mp4", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "audio" && resource.url) return [{ nodeId: node.id, type: "audio", title: node.title, audio: { id: node.id, name: `${node.title || node.id}.mp3`, type: node.metadata?.mimeType || "audio/mpeg", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "text" && resource.text) return [{ nodeId: node.id, type: "text", title: node.title, text: resource.text }];
    const text = readNodeTextInput(node);
    return text ? [{ nodeId: node.id, type: "text", title: node.title, text }] : [];
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    const referenceImages = await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) })));
    if (!context.continueVideos?.length) return { ...context, referenceImages };
    // 续作: the linked video's last frame is the first frame of this generation.
    const { captureVideoFrameSafe } = await import("@/lib/canvas/canvas-video-frame");
    const frames = await Promise.all(
        context.continueVideos.map(async (video) => {
            const blob = await captureVideoFrameSafe(video.url, "last");
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            return { id: `${video.id}:last`, name: `${video.name}-last.png`, type: "image/png", dataUrl } satisfies ReferenceImage;
        }),
    );
    return { ...context, referenceImages: [...frames, ...referenceImages], imageRoles: [...frames.map(() => "firstFrame" as const), ...(context.imageRoles || [])], imageCount: frames.length + referenceImages.length };
}

function readShotResources(node: CanvasNodeData): NodeGenerationResourceInput[] {
    const meta = node.metadata || {};
    if (meta.shotVideo?.content) return [{ nodeId: node.id, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: meta.shotVideo.mimeType || "video/mp4", url: meta.shotVideo.content, storageKey: meta.shotVideo.storageKey, durationMs: meta.shotVideo.durationMs } }];
    if (meta.shotImage?.content) return [{ nodeId: node.id, type: "image", title: node.title, role: "reference", image: { id: node.id, name: `${node.title || node.id}.png`, type: meta.shotImage.mimeType || "image/png", dataUrl: meta.shotImage.content, storageKey: meta.shotImage.storageKey } }];
    return [];
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function textBlock(label: string, text: string) {
    return `【${label}】\n${text}`;
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (type === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
