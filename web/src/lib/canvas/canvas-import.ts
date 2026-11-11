import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/canvas/use-workspace-store";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";

/** Import a canvas export or a 项目包: restores files first, then projects (re-linked to their imported canvases). */
export async function importCanvasPackage(file: File) {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("missing projects.json");
    const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
    const restore = (item: CanvasExportAsset) => {
        const blob = zip.get(item.path);
        if (!blob) return Promise.resolve();
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
        return item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob);
    };
    await Promise.all([...data.projects.flatMap((project) => project.files.map(restore)), ...(data.workspaces || []).flatMap((item) => item.files.map(restore))]);
    const workspaceIds = new Map<string, string>();
    (data.workspaces || []).forEach(({ workspace }) => workspaceIds.set(workspace.id, useWorkspaceStore.getState().importWorkspace(workspace)));
    const canvasIds = data.projects.map((item) => useCanvasStore.getState().importProject({ ...item.project, workspaceId: item.project.workspaceId ? workspaceIds.get(item.project.workspaceId) : undefined }));
    return { canvases: canvasIds.length, workspaces: workspaceIds.size, workspaceId: [...workspaceIds.values()][0], canvasIds };
}
