import { describe, expect, test } from "bun:test";

import { applyEasing, buildDirectorUserPrompt, directorShotPrompt, emptyDirectorScene, normalizeDirectorScene, parseDirectorScene, presetShot, sampleShot, sampleSubject, toVec3, upsertCameraKeyframe, type DirectorShot } from "../src/lib/canvas/director-scene";

const llmReply = `好的，场景如下：
\`\`\`json
{
  "title": "雨夜对峙",
  "description": "两人在巷口对峙",
  "duration": 6,
  "aspect": "2.39:1",
  "subjects": [
    { "name": "阿杰", "kind": "person", "position": [-1, 0, 0], "rotationY": 90, "action": "向前走两步",
      "keyframes": [ { "t": 0, "position": [-1, 0, 0] }, { "t": 2, "position": [0, 0, 0] } ] },
    { "name": "黑车", "kind": "car", "position": { "x": 3, "y": 0, "z": -2 } }
  ],
  "shots": [
    { "name": "推近", "move": "推", "duration": 4, "easing": "linear",
      "keyframes": [ { "t": 4, "position": [0, 1.6, 2], "target": [0, 1.2, 0], "fov": 30 }, { "t": 0, "position": [0, 1.6, 10], "target": [0, 1.2, 0], "fov": 50 } ] }
  ]
}
\`\`\`
有需要再改。`;

describe("场景 JSON 解析", () => {
    test("从带代码块的 LLM 回复中取出 JSON 并归一化", () => {
        const scene = parseDirectorScene(llmReply);
        expect(scene.title).toBe("雨夜对峙");
        expect(scene.aspect).toBe("2.39:1");
        expect(scene.subjects).toHaveLength(2);
        expect(scene.subjects[0].action).toBe("向前走两步");
        expect(scene.subjects[1].kind).toBe("vehicle");
        expect(scene.subjects[1].position).toEqual([3, 0, -2]);
        expect(scene.shots[0].keyframes.map((k) => k.t)).toEqual([0, 4]); // 按时间排序
        expect(scene.activeShotId).toBe(scene.shots[0].id);
    });

    test("没有代码块时取第一个 { 到最后一个 }", () => {
        const scene = parseDirectorScene('场景：{"title":"空镜","shots":[{"duration":3}]} 完');
        expect(scene.title).toBe("空镜");
        expect(scene.shots[0].duration).toBe(3);
        expect(scene.shots[0].keyframes).toHaveLength(1); // 缺关键帧补默认机位
    });

    test("无 JSON 时抛中文错误", () => {
        expect(() => parseDirectorScene("抱歉我不能")).toThrow("场景 JSON");
    });

    test("非法数值被夹到范围内、缺省补默认", () => {
        const scene = normalizeDirectorScene({ duration: 999, shots: [{ duration: -3, easing: "smooth", keyframes: [{ t: 50, fov: 500, position: ["a", 1, 2] }] }], subjects: [{}] });
        expect(scene.shots[0].duration).toBe(0.5);
        expect(scene.shots[0].easing).toBe("easeInOut");
        expect(scene.shots[0].keyframes[0].t).toBe(0.5);
        expect(scene.shots[0].keyframes[0].fov).toBe(120);
        expect(scene.shots[0].keyframes[0].position).toEqual([0, 1, 2]);
        expect(scene.subjects[0].kind).toBe("person");
        expect(scene.subjects[0].height).toBe(1.75);
        expect(scene.aspect).toBe("16:9");
    });

    test("归一化保留全景底图与预览（来自 base）", () => {
        const panorama = { content: "blob:x", storageKey: "image:abc" };
        const scene = parseDirectorScene('{"title":"t"}', { panorama, preview: panorama });
        expect(scene.panorama).toEqual(panorama);
        expect(scene.preview).toEqual(panorama);
    });

    test("toVec3 接受数组、对象与缺省", () => {
        expect(toVec3([1, 2, 3], [0, 0, 0])).toEqual([1, 2, 3]);
        expect(toVec3({ x: 1, z: 5 }, [9, 9, 9])).toEqual([1, 9, 5]);
        expect(toVec3(undefined, [4, 5, 6])).toEqual([4, 5, 6]);
    });

    test("修改指令带上当前场景且不含媒体", () => {
        const scene = { ...emptyDirectorScene(), panorama: { content: "blob:big", storageKey: "image:p" } };
        const prompt = buildDirectorUserPrompt("把镜头改成环绕", scene);
        expect(prompt).toContain("把镜头改成环绕");
        expect(prompt).toContain(scene.shots[0].id);
        expect(prompt).not.toContain("blob:big");
    });
});

describe("运镜插值", () => {
    const shot: DirectorShot = {
        id: "s",
        name: "推",
        move: "推",
        duration: 4,
        easing: "linear",
        keyframes: [
            { t: 0, position: [0, 1.6, 10], target: [0, 1, 0], fov: 50 },
            { t: 4, position: [0, 1.6, 2], target: [0, 1, 0], fov: 30 },
        ],
    };

    test("匀速插值中点", () => {
        const pose = sampleShot(shot, 2);
        expect(pose.position[2]).toBeCloseTo(6, 6);
        expect(pose.fov).toBeCloseTo(40, 6);
    });

    test("超出范围取首尾帧", () => {
        expect(sampleShot(shot, -1).position).toEqual([0, 1.6, 10]);
        expect(sampleShot(shot, 99).position).toEqual([0, 1.6, 2]);
    });

    test("缓入缓出在端点与中点对称", () => {
        expect(applyEasing("easeInOut", 0)).toBe(0);
        expect(applyEasing("easeInOut", 1)).toBe(1);
        expect(applyEasing("easeInOut", 0.5)).toBeCloseTo(0.5, 6);
        expect(applyEasing("easeInOut", 0.25)).toBeLessThan(0.25);
        const eased = sampleShot({ ...shot, easing: "easeInOut" }, 1);
        expect(eased.position[2]).toBeGreaterThan(8); // 开头慢
    });

    test("多段关键帧按所在段插值", () => {
        const multi = { ...shot, keyframes: [...shot.keyframes, { t: 2, position: [4, 1.6, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 40 }] };
        expect(sampleShot(multi, 1).position[0]).toBeCloseTo(2, 6);
        expect(sampleShot(multi, 3).position[0]).toBeCloseTo(2, 6);
        expect(sampleShot(multi, 3).position[2]).toBeCloseTo(4, 6);
    });

    test("主体关键帧插值，无关键帧停在原位", () => {
        const scene = parseDirectorScene(llmReply);
        expect(sampleSubject(scene.subjects[0], 1).position[0]).toBeCloseTo(-0.5, 6);
        expect(sampleSubject(scene.subjects[0], 5).position[0]).toBeCloseTo(0, 6);
        expect(sampleSubject(scene.subjects[1], 3).position).toEqual([3, 0, -2]);
    });

    test("预设运镜：推镜头由远及近、首尾时间等于时长", () => {
        const push = presetShot("push-in", [0, 0, 0], 5);
        expect(push.keyframes[0].t).toBe(0);
        expect(push.keyframes[push.keyframes.length - 1].t).toBe(5);
        expect(sampleShot(push, 5).position[2]).toBeLessThan(sampleShot(push, 0).position[2]);
        const orbit = presetShot("orbit", [0, 0, 0], 4);
        expect(sampleShot(orbit, 4).position[2]).toBeCloseTo(-6, 6); // 绕到对面
    });

    test("插入关键帧：同一时刻替换、其余按时间排序并夹到时长内", () => {
        const next = upsertCameraKeyframe(shot, { t: 4.02, position: [1, 1, 1], target: [0, 0, 0], fov: 60 });
        expect(next.keyframes).toHaveLength(2);
        expect(next.keyframes[1].fov).toBe(60);
        const added = upsertCameraKeyframe(shot, { t: 9, position: [1, 1, 1], target: [0, 0, 0], fov: 60 });
        expect(added.keyframes.map((k) => k.t)).toEqual([0, 4]);
        const middle = upsertCameraKeyframe(shot, { t: 1, position: [1, 1, 1], target: [0, 0, 0], fov: 60 });
        expect(middle.keyframes.map((k) => k.t)).toEqual([0, 1, 4]);
    });

    test("预演提示词包含主体动作、运镜与时长", () => {
        const scene = parseDirectorScene(llmReply);
        const prompt = directorShotPrompt(scene);
        expect(prompt).toContain("阿杰");
        expect(prompt).toContain("向前走两步");
        expect(prompt).toContain("运镜：推");
        expect(prompt).toContain("4 秒");
    });
});
