import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasGenerationMode } from "@/types/canvas";

export type GenerationRecordStatus = "running" | "success" | "error" | "canceled";

/** One generation request: when, which model/channel, from which node, and how it ended (error text kept verbatim). */
export type GenerationRecord = {
    id: string;
    projectId: string;
    nodeId: string;
    nodeTitle: string;
    /** Node that holds the result when it differs from the node that started the run. */
    resultNodeId?: string;
    mode: CanvasGenerationMode;
    model: string;
    channel: string;
    prompt: string;
    draft?: boolean;
    seed?: string;
    count: number;
    startedAt: string;
    finishedAt?: string;
    status: GenerationRecordStatus;
    error?: string;
};

type GenerationLogStore = {
    records: GenerationRecord[];
    start: (record: Omit<GenerationRecord, "id" | "startedAt" | "status">) => string;
    update: (id: string, patch: Partial<GenerationRecord>) => void;
    finish: (id: string, status: GenerationRecordStatus, error?: string) => void;
    clearProject: (projectId: string) => void;
};

export const useGenerationLogStore = create<GenerationLogStore>()(
    persist(
        (set) => ({
            records: [],
            start: (record) => {
                const id = nanoid();
                set((state) => ({ records: [{ ...record, id, startedAt: new Date().toISOString(), status: "running" }, ...state.records] }));
                return id;
            },
            update: (id, patch) => set((state) => ({ records: state.records.map((record) => (record.id === id ? { ...record, ...patch } : record)) })),
            finish: (id, status, error) => set((state) => ({ records: state.records.map((record) => (record.id === id && record.status === "running" ? { ...record, status, error, finishedAt: new Date().toISOString() } : record)) })),
            clearProject: (projectId) => set((state) => ({ records: state.records.filter((record) => record.projectId !== projectId) })),
        }),
        {
            name: "hemosi:generation_records",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ records: state.records }),
            // A run that was still going when the app closed did not finish.
            onRehydrateStorage: () => (state) => {
                state?.records.forEach((record) => record.status === "running" && Object.assign(record, { status: "error", error: "应用关闭时仍在进行，已中断" }));
            },
        },
    ),
);
