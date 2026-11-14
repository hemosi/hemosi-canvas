import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ParsedSkill } from "@/lib/agent-skills";
import { localForageStorage } from "@/lib/localforage-storage";

/** A SKILL.md the user imported; kept only in this app (IndexedDB). */
export type LocalSkill = ParsedSkill & {
    id: string;
    /** Disabled skills are neither offered to the Agent nor shown in the chip bar. */
    enabled: boolean;
    updatedAt: number;
};

type AgentSkillStore = {
    skills: LocalSkill[];
    /** Skills the user switched on by hand, per Agent chat scope (canvas / storyboard table). */
    activeByScope: Record<string, string[]>;
    addSkills: (items: ParsedSkill[]) => { added: number; replaced: number };
    updateSkill: (id: string, patch: Partial<Omit<LocalSkill, "id">>) => void;
    removeSkill: (id: string) => void;
    toggleActive: (scope: string, skillId: string) => void;
};

export const useAgentSkillStore = create<AgentSkillStore>()(
    persist(
        (set, get) => ({
            skills: [],
            activeByScope: {},
            addSkills: (items) => {
                let added = 0;
                let replaced = 0;
                const skills = [...get().skills];
                for (const item of items) {
                    // Same name = same skill: importing again replaces it.
                    const index = skills.findIndex((s) => s.name === item.name);
                    if (index >= 0) {
                        skills[index] = { ...skills[index], ...item, updatedAt: Date.now() };
                        replaced++;
                    } else {
                        skills.push({ ...item, id: nanoid(), enabled: true, updatedAt: Date.now() });
                        added++;
                    }
                }
                set({ skills });
                return { added, replaced };
            },
            updateSkill: (id, patch) => set({ skills: get().skills.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)) }),
            removeSkill: (id) =>
                set({
                    skills: get().skills.filter((s) => s.id !== id),
                    activeByScope: Object.fromEntries(Object.entries(get().activeByScope).map(([k, v]) => [k, v.filter((x) => x !== id)])),
                }),
            toggleActive: (scope, skillId) => {
                const cur = get().activeByScope[scope] || [];
                set({ activeByScope: { ...get().activeByScope, [scope]: cur.includes(skillId) ? cur.filter((x) => x !== skillId) : [...cur, skillId] } });
            },
        }),
        { name: "hemosi:agent-skills", storage: createJSONStorage(() => localForageStorage) },
    ),
);
