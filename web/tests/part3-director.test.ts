import { expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) },
    navigator: { userAgent: "bun" },
});

const { parseDirectorPlan, planToExecution, directorUserPrompt, sanitizeCamera } = await import("../src/lib/canvas/canvas-director");
const { applyCanvasAgentOps } = await import("../src/lib/canvas/canvas-agent-ops");
(await import("../src/lib/canvas/node-registry")).registerNodeDefinitions(["text", "group", "shot", "anchor", "image"].map((type) => ({ type, title: type, defaultSize: { width: 300, height: 200 }, defaultMetadata: {} }) as never));
const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
type Node = import("../src/types/canvas").CanvasNodeData;
type Snapshot = import("../src/lib/canvas/canvas-agent-ops").CanvasAgentSnapshot;

const node = (id: string, type: string, metadata: Node["metadata"] = {}, x = 0): Node => ({ id, type, title: id, position: { x, y: 0 }, width: 300, height: 200, metadata });
const snapshot = (nodes: Node[], selected: string[] = []): Snapshot => ({ projectId: "p", title: "测试", nodes, connections: [], selectedNodeIds: selected, viewport: { x: 0, y: 0, scale: 1 } });

const reply = `好的，方案如下：
\`\`\`json
{
  "analysis": "三场戏，雨夜追逐",
  "script": "第一场：雨夜小巷，她回头。\\n第二场：他追进巷子。\\n第三场：两人在霓虹下对峙。",
  "sceneTitle": "雨夜追逐",
  "characters": [{"name": "林", "description": "黑色风衣、短发"}, {"name": "陈", "description": "灰色连帽衫"}],
  "sceneLighting": {"mood": "neon", "colorTemp": 7000, "rim": {"enabled": true, "intensity": 60}},
  "shots": [
    {"description": "她在雨夜小巷回头", "prompt": "a woman turns back in a rainy alley", "characters": ["林"], "camera": {"focalLength": 35, "movement": "push-in", "angle": "low", "body": "made-up-camera"}},
    {"description": "他追进巷子", "prompt": "a man runs into the alley", "characters": ["陈"], "camera": {"movement": "tracking"}},
    {"description": "两人对峙", "prompt": "two people face off under neon", "camera": {"shotSize": "wide"}}
  ],
  "edits": [{"nodeId": "old-text", "content": "改过的备注"}, {"nodeId": "ghost", "prompt": "x"}],
  "batch": [{"match": {"type": "image", "size": "9:16"}, "patch": {"size": "16:9"}, "run": "image"}],
  "run": "both"
}
\`\`\``;

const existing = [node("old-text", "text", { content: "旧备注" }), node("img-a", "image", { size: "9:16", content: "blob:a" }, 400), node("img-b", "image", { size: "1:1", content: "blob:b" }, 800)];

test("the plan is parsed from a fenced reply and camera values are kept only when the canvas knows them", () => {
    const plan = parseDirectorPlan(reply);
    expect(plan.shots).toHaveLength(3);
    expect(sanitizeCamera(plan.shots![0].camera)).toEqual({ focalLength: 35, movement: "push-in", angle: "low" });
    expect(() => parseDirectorPlan("没有 JSON")).toThrow();
});

test("scope caps what the Agent does: analyze / script / shots / tasks / run", () => {
    const plan = parseDirectorPlan(reply);
    const snap = snapshot(existing);
    expect(planToExecution(plan, snap, "analyze").ops).toHaveLength(0);
    const script = planToExecution(plan, snap, "script");
    expect(script.ops.filter((op) => op.type === "add_node").map((op) => (op as { nodeType?: string }).nodeType)).toEqual(["text"]);
    expect(script.runImages).toHaveLength(0);
    const shots = planToExecution(plan, snap, "shots", { image: "c::flux-2-max", video: "c::kling-4.0" });
    expect(shots.shotIds).toHaveLength(3);
    const firstShot = shots.ops.find((op) => op.type === "add_node" && (op as { nodeType?: string }).nodeType === "shot") as { metadata: Node["metadata"] };
    expect(firstShot.metadata?.model).toBeUndefined();
    expect(shots.runImages).toHaveLength(0);
    const tasks = planToExecution(plan, snap, "tasks", { image: "c::flux-2-max", video: "c::kling-4.0" });
    const taskShot = tasks.ops.find((op) => op.type === "add_node" && (op as { nodeType?: string }).nodeType === "shot") as { metadata: Node["metadata"] };
    expect(taskShot.metadata).toMatchObject({ model: "c::flux-2-max", videoModel: "c::kling-4.0", prompt: "a woman turns back in a rainy alley" });
    expect(tasks.runImages).toHaveLength(0);
    const run = planToExecution(plan, snap, "run", { image: "c::flux-2-max", video: "c::kling-4.0" });
    expect(run.runImages).toEqual(run.shotIds);
    expect(run.runVideos).toEqual(run.shotIds);
    expect(run.runNodes).toEqual([{ nodeId: "img-a", mode: "image" }]);
});

test("applying the plan builds script, a grouped shot row numbered in order, character anchors, edits and batch changes", () => {
    const plan = parseDirectorPlan(reply);
    const snap = snapshot(existing);
    const execution = planToExecution(plan, snap, "tasks", { image: "c::flux-2-max", video: "c::kling-4.0" });
    const next = applyCanvasAgentOps(snap, execution.ops);
    const shots = next.nodes.filter((item) => item.type === "shot").sort((a, b) => a.position.x - b.position.x);
    expect(shots.map((item) => item.metadata?.shotNo)).toEqual([1, 2, 3]);
    expect(shots.map((item) => item.metadata?.shotDescription)).toEqual(["她在雨夜小巷回头", "他追进巷子", "两人对峙"]);
    const group = next.nodes.find((item) => item.type === "group")!;
    expect(shots.every((item) => item.metadata?.groupId === group.id)).toBe(true);
    expect(group.metadata?.lighting?.mood).toBe("neon");
    const anchors = next.nodes.filter((item) => item.type === "anchor");
    expect(anchors.map((item) => item.title)).toEqual(["林", "陈"]);
    const linIn = next.connections.filter((item) => item.fromNodeId === anchors[0].id).map((item) => item.toNodeId);
    expect(linIn).toEqual([shots[0].id, shots[2].id]); // shot 3 lists no characters → every character anchor feeds it
    expect(next.nodes.find((item) => item.id === "old-text")?.metadata?.content).toBe("改过的备注");
    expect(next.nodes.find((item) => item.id === "img-a")?.metadata?.size).toBe("16:9");
    expect(next.nodes.find((item) => item.id === "img-b")?.metadata?.size).toBe("1:1");
    expect(execution.steps.some((step) => step.includes("忽略 1 条"))).toBe(true);

    // The agent-made shot generates with its camera, the shared scene lighting and the character anchor in the prompt.
    const context = buildNodeGenerationContext(shots[0].id, next.nodes, next.connections, shots[0].metadata!.prompt!, { mode: "image" });
    expect(context.prompt).toContain("35mm");
    expect(context.prompt).toContain("dollies in");
    expect(context.prompt).toContain("7000K");
    expect(context.prompt).toContain("黑色风衣");
});

test("the canvas digest sent to the LLM can be limited to the selection", () => {
    const prompt = directorUserPrompt("只改选中的", "shots", snapshot(existing, ["img-b"]), true);
    expect(prompt).toContain("img-b");
    expect(prompt).not.toContain("img-a");
});
