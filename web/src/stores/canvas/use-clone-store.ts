import localforage from "localforage";
import { create } from "zustand";

import type { CloneBlueprint } from "@/lib/canvas/clone/blueprint";

/** 爆款复刻弹窗开关；蓝图按「画布 + 视频节点」存 localforage（键 clone:blueprint:<projectId>:<nodeId>）。 */
type Store = {
    target: { projectId: string; nodeId: string } | null;
    open: (projectId: string, nodeId: string) => void;
    close: () => void;
};

export const useCloneStore = create<Store>()((set) => ({
    target: null,
    open: (projectId, nodeId) => set({ target: { projectId, nodeId } }),
    close: () => set({ target: null }),
}));

const key = (projectId: string, nodeId: string) => `clone:blueprint:${projectId}:${nodeId}`;
export const loadBlueprint = (projectId: string, nodeId: string) => localforage.getItem<CloneBlueprint>(key(projectId, nodeId));
export const saveBlueprint = (projectId: string, blueprint: CloneBlueprint) => localforage.setItem(key(projectId, blueprint.sourceNodeId), blueprint);
