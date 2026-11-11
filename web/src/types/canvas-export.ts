import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Workspace } from "@/stores/canvas/use-workspace-store";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3 | 4;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
    /** 项目包: the project container (script + materials) the canvases belong to. */
    workspaces?: { workspace: Workspace; files: CanvasExportAsset[] }[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
