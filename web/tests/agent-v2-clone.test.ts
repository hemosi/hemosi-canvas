import { expect, test } from "bun:test";

import { buildAgentChange, parseAgentReply, runReadCall } from "../src/lib/canvas/agent/agent-tools";
import { attachTranscript, blueprintFromCuts, expandBlueprint, fillVariables, toSrt, variableNames } from "../src/lib/canvas/clone/blueprint";
import { isLocalBaseUrl } from "../src/stores/use-config-store";
import type { CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";

const empty: CanvasAgentSnapshot = { projectId: "p", title: "t", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

test("parses agent JSON, tolerates fences and plain text", () => {
    expect(parseAgentReply('```json\n{"say":"好","calls":[{"tool":"read_canvas"}]}\n```')).toEqual({ say: "好", calls: [{ tool: "read_canvas" }] });
    expect(parseAgentReply("就是一句话")).toEqual({ say: "就是一句话", calls: [] });
});

test("add_shots + anchor linking by key + generate builds one change", () => {
    const change = buildAgentChange(
        [
            { tool: "add_shots", args: { key: "s", title: "开场", shots: [{ image: "a", video: "va", seconds: 4 }, { image: "b" }] } },
            { tool: "add_anchor", args: { kind: "character", title: "小林", text: "白T丸子头", linkTo: ["s.1", "s.2"] } },
            { tool: "generate", args: { ids: ["s.1"], kind: "image" } },
            { tool: "nope" },
        ],
        empty,
    );
    expect(change.ops.filter((op) => op.type === "add_node").length).toBe(4);
    expect(change.ops.filter((op) => op.type === "connect_nodes").length).toBe(2);
    expect(change.shots).toEqual([{ ids: [change.keys["s.1"]], kind: "image" }]);
    expect(change.errors.length).toBe(1);
    expect(runReadCall({ tool: "read_node", args: { id: "x" } }, empty)).toContain("没有节点");
});

test("blueprint: transcript, variables, expand, srt", () => {
    let bp = blueprintFromCuts("v", "源", [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 6 }], 6);
    bp = { ...bp, beats: attachTranscript(bp.beats, [{ start: 0.1, end: 1.8, text: "你知道吗" }, { start: 2.2, end: 4.9, text: "{{主角}}每天都这样，真的。" }]) };
    expect(bp.beats.map((beat) => beat.role)).toEqual(["钩子", "铺垫", "行动号召"]);
    expect(variableNames(bp)).toEqual(["主角"]);
    expect(fillVariables(bp.beats[1].line, {})).toBe("主角每天都这样，真的。");
    const ops = expandBlueprint(bp, { 主角: "小林" }, empty, "变体 1");
    expect(JSON.stringify(ops)).not.toContain("{{");
    expect(JSON.stringify(ops)).toContain("小林每天都这样");
    expect(toSrt(bp, { 主角: "小林" })).toContain("00:00:02,000 --> ");
});

test("local base urls need no key", () => {
    expect(isLocalBaseUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalBaseUrl("localhost:8000/v1")).toBe(true);
    expect(isLocalBaseUrl("http://192.168.1.5:1234")).toBe(true);
    expect(isLocalBaseUrl("https://api.openai.com")).toBe(false);
});
