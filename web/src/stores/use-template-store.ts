import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { getBuiltinTemplates, type CanvasTemplate } from "@/lib/canvas/canvas-templates";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type TemplateStore = {
    templates: CanvasTemplate[];
    addTemplate: (name: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) => CanvasTemplate;
    deleteTemplate: (id: string) => void;
};

export const TEMPLATE_STORE_KEY = "hemosi:canvas_templates";

/** User templates, kept in localStorage. Built-in templates are not stored; see getBuiltinTemplates. */
export const useTemplateStore = create<TemplateStore>()(
    persist(
        (set) => ({
            templates: [],
            addTemplate: (name, nodes, connections) => {
                const template: CanvasTemplate = { id: nanoid(), name, nodes, connections, createdAt: new Date().toISOString() };
                set((state) => ({ templates: [template, ...state.templates] }));
                return template;
            },
            deleteTemplate: (id) => set((state) => ({ templates: state.templates.filter((template) => template.id !== id) })),
        }),
        { name: TEMPLATE_STORE_KEY, partialize: (state) => ({ templates: state.templates }) },
    ),
);

export function findTemplate(id: string) {
    return getBuiltinTemplates().find((template) => template.id === id) || useTemplateStore.getState().templates.find((template) => template.id === id) || null;
}
