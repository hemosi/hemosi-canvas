// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

import { buildArkRequest, buildKlingRequest } from "../official-providers";

const cfg = { baseUrl: "https://x", model: "m", size: "9:16", videoSeconds: "5", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false" } as never;

describe("first frame + reference images", () => {
    test("Seedance gets first_frame plus reference_image roles", () => {
        const { body } = buildArkRequest(cfg, "p", { images: ["data:image/png;base64,A", "data:image/png;base64,B", "data:image/png;base64,C"], mode: "frames", frameCount: 1 });
        const roles = (body.content as Array<{ role?: string }>).slice(1).map((c) => c.role);
        expect(roles).toEqual(["first_frame", "reference_image", "reference_image"]);
    });

    test("Seedance first+last+reference", () => {
        const { body } = buildArkRequest(cfg, "p", { images: ["data:image/png;base64,A", "data:image/png;base64,B", "data:image/png;base64,C"], mode: "frames", frameCount: 2 });
        const roles = (body.content as Array<{ role?: string }>).slice(1).map((c) => c.role);
        expect(roles).toEqual(["first_frame", "last_frame", "reference_image"]);
    });

    test("Kling refuses the mix with a clear message instead of misusing the refs as frames", () => {
        expect(() => buildKlingRequest(cfg, "p", { images: ["data:image/png;base64,A", "data:image/png;base64,B"], mode: "frames", frameCount: 1 })).toThrow("不能同时用首帧和参考图");
    });
});
