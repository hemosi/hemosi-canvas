export type ParsedSkill = { name: string; description: string; body: string };

const unquote = (value: string) => {
    const v = value.trim();
    if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
        try {
            return JSON.parse(v) as string;
        } catch {
            return v.slice(1, -1);
        }
    }
    return v.length > 1 && v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
};

/**
 * Parse a SKILL.md: YAML-style frontmatter with `name` and `description`, then the markdown body.
 * Only the two keys are read (single-line values, quoted or not, or a `|` / `>` block); other keys are ignored.
 * Without frontmatter the first `# heading` (or the file name) is the name and the first paragraph the description.
 */
export function parseSkillMarkdown(text: string, fallbackName = ""): ParsedSkill {
    const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
    const meta: Record<string, string> = {};
    let body = src;
    if (fm) {
        body = fm[2];
        const lines = fm[1].split("\n");
        for (let i = 0; i < lines.length; i++) {
            const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
            if (!m) continue;
            const key = m[1].toLowerCase();
            let value = m[2];
            if (/^[|>][+-]?$/.test(value.trim())) {
                const folded = value.trim().startsWith(">");
                const block: string[] = [];
                while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
                value = block.join(folded ? " " : "\n").trim();
            }
            meta[key] = unquote(value);
        }
    }
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const firstParagraph = body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .find((p) => p && !p.startsWith("#"));
    const name = (meta.name || heading || fallbackName.replace(/\.md$/i, "").replace(/^SKILL$/i, "") || "未命名 skill").trim();
    return { name, description: (meta.description || firstParagraph || "").replace(/\s+/g, " ").trim(), body: body.trim() };
}

/** Back to SKILL.md text (for export / editing as one file). */
export function toSkillMarkdown(skill: ParsedSkill): string {
    const q = (v: string) => JSON.stringify(v.replace(/\s+/g, " ").trim());
    return `---\nname: ${q(skill.name)}\ndescription: ${q(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}
