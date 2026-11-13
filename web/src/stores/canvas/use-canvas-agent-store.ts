import localforage from "localforage";
import { nanoid } from "nanoid";
import { create } from "zustand";

import type { AgentChange } from "@/lib/canvas/agent/agent-tools";

/**
 * 画布 Agent 的对话，按画布分开存（localforage，键 agent:thread:<projectId>）。
 * forModel 是这条消息喂给模型时的样子；没有 forModel 的消息只给人看。
 */
export type CanvasAgentMessage = {
    id: string;
    kind: "user" | "agent" | "tool" | "change" | "error";
    text: string;
    forModel?: { role: "user" | "assistant"; content: string };
    change?: AgentChange;
    changeStatus?: "pending" | "applied" | "rejected" | "undone";
};

type Store = {
    threads: Record<string, CanvasAgentMessage[]>;
    loaded: Record<string, boolean>;
    load: (projectId: string) => Promise<void>;
    push: (projectId: string, message: Omit<CanvasAgentMessage, "id">) => string;
    patch: (projectId: string, id: string, patch: Partial<CanvasAgentMessage>) => void;
    clear: (projectId: string) => void;
};

const key = (projectId: string) => `agent:thread:${projectId}`;

export const useCanvasAgentStore = create<Store>()((set, get) => {
    const save = (projectId: string) => void localforage.setItem(key(projectId), get().threads[projectId] || []);
    const update = (projectId: string, fn: (list: CanvasAgentMessage[]) => CanvasAgentMessage[]) => {
        set((state) => ({ threads: { ...state.threads, [projectId]: fn(state.threads[projectId] || []) } }));
        save(projectId);
    };
    return {
        threads: {},
        loaded: {},
        load: async (projectId) => {
            if (get().loaded[projectId]) return;
            const list = (await localforage.getItem<CanvasAgentMessage[]>(key(projectId))) || [];
            set((state) => ({ threads: { ...state.threads, [projectId]: list }, loaded: { ...state.loaded, [projectId]: true } }));
        },
        push: (projectId, message) => {
            const id = nanoid(8);
            update(projectId, (list) => [...list, { ...message, id }]);
            return id;
        },
        patch: (projectId, id, patch) => update(projectId, (list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item))),
        clear: (projectId) => update(projectId, () => []),
    };
});
