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

/** One file from an imported folder or zip, path relative to the import root (forward slashes). */
export type SkillSourceFile = { path: string; read: () => Promise<string>; size: number };

const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|ps1|bat|rb|go|rs|java|kt|swift|c|h|cpp|sql|ini|cfg|conf|env\.example)$/i;
const MAX_FILE = 200 * 1024;
const MAX_TOTAL = 600 * 1024;

/**
 * Build skills from a folder or zip: every SKILL.md is one skill; the other text files in its folder (references, templates,
 * scripts) are attached under its body so the Agent can read them. Binary files are skipped; scripts are text only (not run).
 */
export async function parseSkillFolder(files: SkillSourceFile[]): Promise<{ skills: ParsedSkill[]; skipped: string[] }> {
    const norm = files.map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\/+/, "") })).filter((f) => !/(^|\/)(\.|__MACOSX\/)/.test(f.path));
    const skillFiles = norm.filter((f) => /(^|\/)SKILL\.md$/i.test(f.path));
    const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
    const skillDirs = skillFiles.map((f) => dirOf(f.path));
    const skipped: string[] = [];
    const skills: ParsedSkill[] = [];
    for (const skillFile of skillFiles) {
        const dir = dirOf(skillFile.path);
        const folderName = dir.replace(/\/$/, "").split("/").pop() || "";
        const parsed = parseSkillMarkdown(await skillFile.read(), folderName || skillFile.path);
        // Files of this skill: under its folder and not under a deeper skill folder.
        const own = norm.filter((f) => f !== skillFile && f.path.startsWith(dir) && !skillDirs.some((d) => d !== dir && d.startsWith(dir) && f.path.startsWith(d)));
        let total = 0;
        const attached: string[] = [];
        for (const f of own.sort((a, b) => a.path.localeCompare(b.path))) {
            const rel = f.path.slice(dir.length);
            if (!TEXT_EXT.test(rel) || f.size > MAX_FILE || total + f.size > MAX_TOTAL) {
                skipped.push(f.path);
                continue;
            }
            total += f.size;
            attached.push(`### 附带文件：${rel}\n\`\`\`\n${(await f.read()).replace(/\r\n/g, "\n").trim()}\n\`\`\``);
        }
        const body = attached.length ? `${parsed.body}\n\n## skill 附带文件（只读参考，脚本不会被执行）\n\n${attached.join("\n\n")}` : parsed.body;
        skills.push({ ...parsed, body });
    }
    return { skills, skipped };
}
