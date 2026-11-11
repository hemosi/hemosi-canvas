import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";

/** A file archived into a project: dropped into one of its canvases or uploaded on the project page. */
export type WorkspaceMaterial = {
    id: string;
    kind: "image" | "video" | "audio";
    name: string;
    storageKey: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
    durationMs?: number;
    addedAt: string;
    /** Canvas it was dropped into, when it came from a canvas. */
    canvasId?: string;
};

/** 项目 = several canvases (by workspaceId on each canvas) + the script + all materials, one container. */
export type Workspace = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    script: string;
    materials: WorkspaceMaterial[];
};

type WorkspaceStore = {
    hydrated: boolean;
    workspaces: Workspace[];
    createWorkspace: (title: string, patch?: Partial<Pick<Workspace, "script" | "materials">>) => string;
    updateWorkspace: (id: string, patch: Partial<Pick<Workspace, "title" | "script" | "materials">>) => void;
    addMaterials: (id: string, materials: Omit<WorkspaceMaterial, "id" | "addedAt">[]) => void;
    removeMaterial: (id: string, materialId: string) => void;
    deleteWorkspace: (id: string) => void;
    importWorkspace: (workspace: Workspace) => string;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
    persist(
        (set) => ({
            hydrated: false,
            workspaces: [],
            createWorkspace: (title, patch = {}) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ workspaces: [{ id, title, createdAt: now, updatedAt: now, script: patch.script || "", materials: patch.materials || [] }, ...state.workspaces] }));
                return id;
            },
            updateWorkspace: (id, patch) => set((state) => ({ workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)) })),
            addMaterials: (id, materials) =>
                set((state) => ({
                    workspaces: state.workspaces.map((item) => {
                        if (item.id !== id) return item;
                        const known = new Set(item.materials.map((material) => material.storageKey));
                        const added = materials.filter((material) => material.storageKey && !known.has(material.storageKey)).map((material) => ({ ...material, id: nanoid(), addedAt: new Date().toISOString() }));
                        return added.length ? { ...item, materials: [...item.materials, ...added], updatedAt: new Date().toISOString() } : item;
                    }),
                })),
            removeMaterial: (id, materialId) => set((state) => ({ workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, materials: item.materials.filter((material) => material.id !== materialId) } : item)) })),
            deleteWorkspace: (id) => set((state) => ({ workspaces: state.workspaces.filter((item) => item.id !== id) })),
            importWorkspace: (workspace) => {
                const id = nanoid();
                set((state) => ({ workspaces: [{ ...workspace, id, updatedAt: new Date().toISOString() }, ...state.workspaces] }));
                return id;
            },
        }),
        {
            name: "hemosi:workspaces",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ workspaces: state.workspaces }),
            onRehydrateStorage: () => () => useWorkspaceStore.setState({ hydrated: true }),
        },
    ),
);
