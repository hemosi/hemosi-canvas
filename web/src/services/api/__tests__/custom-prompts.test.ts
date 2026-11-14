// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
}

const { CUSTOM_PROMPT_CATEGORY, upsertCustomPrompt } = await import("@/services/api/prompts");

describe("custom prompts", () => {
    test("new prompts go on top, as 我的提示词 / custom, tags cleaned", () => {
        let list = upsertCustomPrompt([], { title: "A", prompt: "a", tags: [" x ", "x", ""] }, "t1", () => "id1");
        list = upsertCustomPrompt(list, { title: "", prompt: "b", tags: [] }, "t2", () => "id2");
        expect(list.map((p) => p.id)).toEqual(["id2", "id1"]);
        expect(list[1]).toMatchObject({ sourceId: "custom", category: CUSTOM_PROMPT_CATEGORY, tags: ["x"] });
        expect(list[0].title).toBe("未命名提示词");
    });

    test("editing keeps id and createdAt, updates the rest", () => {
        const list = upsertCustomPrompt([], { title: "A", prompt: "a", tags: [] }, "t1", () => "id1");
        const edited = upsertCustomPrompt(list, { id: "id1", title: "B", prompt: "b", tags: ["y"], coverUrl: "data:x" }, "t2");
        expect(edited).toHaveLength(1);
        expect(edited[0]).toMatchObject({ id: "id1", title: "B", prompt: "b", createdAt: "t1", updatedAt: "t2", coverUrl: "data:x" });
    });
});
