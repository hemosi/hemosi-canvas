// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

import { applyVideoSendPlan, planVideoImageSend } from "../video-send-plan";

describe("planVideoImageSend", () => {
    test("unmarked images all go as references, even one or two", () => {
        expect(planVideoImageSend([undefined])).toEqual({ mode: "reference", references: [0], dropped: [] });
        expect(planVideoImageSend(["character", "scene"]).mode).toBe("reference");
    });

    test("a marked first frame is really sent as first frame, whatever the image count", () => {
        const plan = planVideoImageSend(["character", "firstFrame", "scene", "style"]);
        expect(plan.mode).toBe("frames");
        expect(plan.first).toBe(1);
        expect(applyVideoSendPlan(["a", "b", "c", "d"], plan)).toEqual(["b"]);
    });

    test("first frame + references on a model that cannot mix: warns and lists what is left out", () => {
        const plan = planVideoImageSend(["firstFrame", "character", "scene"]);
        expect(plan.dropped).toEqual([1, 2]);
        expect(plan.warning).toContain("不会发送");
    });

    test("mix supported keeps references after the frames", () => {
        const plan = planVideoImageSend(["character", "lastFrame", "firstFrame"], true);
        expect(applyVideoSendPlan(["a", "b", "c"], plan)).toEqual(["c", "b", "a"]);
        expect(plan.dropped).toEqual([]);
    });

    test("only a last frame falls back to references with a warning (never silently)", () => {
        const plan = planVideoImageSend(["lastFrame", undefined]);
        expect(plan.mode).toBe("reference");
        expect(plan.warning).toBeTruthy();
    });
});
