// @ts-ignore bun:test runtime module
import { describe, expect, test } from "bun:test";

import { parseSkillMarkdown, toSkillMarkdown } from "../agent-skills";

describe("parseSkillMarkdown", () => {
    test("reads name + description frontmatter and the markdown body", () => {
        const s = parseSkillMarkdown('---\nname: 废土动作片\ndescription: "写废土/机甲动作短片时用"\nlicense: MIT\n---\n\n# 规则\n\n- 镜头短促\n');
        expect(s).toEqual({ name: "废土动作片", description: "写废土/机甲动作短片时用", body: "# 规则\n\n- 镜头短促" });
    });

    test("folded description and CRLF", () => {
        const s = parseSkillMarkdown("---\r\nname: a\r\ndescription: >\r\n  第一行\r\n  第二行\r\n---\r\nbody");
        expect(s.description).toBe("第一行 第二行");
        expect(s.body).toBe("body");
    });

    test("no frontmatter: heading / file name and first paragraph", () => {
        expect(parseSkillMarkdown("# 导演\n\n节奏要快。\n\n更多", "x.md")).toMatchObject({ name: "导演", description: "节奏要快。" });
        expect(parseSkillMarkdown("只有正文", "my-skill.md").name).toBe("my-skill");
    });

    test("round trip", () => {
        const s = { name: 'A "q"', description: "d", body: "b" };
        expect(parseSkillMarkdown(toSkillMarkdown(s))).toEqual(s);
    });
});
