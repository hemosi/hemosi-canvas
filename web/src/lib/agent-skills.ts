import { unzip } from "fflate";

export type ParsedSkill = {
    name: string;
    description: string;
    /** Main SKILL.md markdown body (L2 instructions). */
    body: string;
    /** L3 reference/template/script files inside the skill folder, keyed by relative path (e.g. "references/script-engine.md"). */
    files?: Record<string, string>;
};

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

/** Back to SKILL.md text. */
export function toSkillMarkdown(skill: ParsedSkill): string {
    const q = (v: string) => JSON.stringify(v.replace(/\s+/g, " ").trim());
    return `---\nname: ${q(skill.name)}\ndescription: ${q(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}

/** One file from an imported folder or zip, path relative to the import root (forward slashes). */
export type SkillSourceFile = { path: string; read: () => Promise<string>; readBytes?: () => Promise<Uint8Array>; size: number };

const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|ps1|bat|rb|go|rs|java|kt|swift|c|h|cpp|sql|ini|cfg|conf|env\.example|prompt)$/i;
const MAX_SINGLE_FILE = 1024 * 1024; // 1MB per text file

export function unzipBytesToSkillFiles(bytes: Uint8Array, prefix = ""): Promise<SkillSourceFile[]> {
    return new Promise<SkillSourceFile[]>((resolve, reject) =>
        unzip(bytes, (err, out) => {
            if (err) return reject(err);
            const decoder = new TextDecoder();
            resolve(
                Object.entries(out)
                    .filter(([path]) => !path.endsWith("/"))
                    .map(([path, data]) => ({
                        path: prefix ? `${prefix.replace(/\/+$/, "")}/${path}` : path,
                        size: data.byteLength,
                        read: async () => decoder.decode(data),
                        readBytes: async () => data,
                    })),
            );
        }),
    );
}

/**
 * Build skills from a folder or zip: every SKILL.md is one skill package.
 * Its sibling/child files (references/*, templates/*, scripts/*) are stored separately in `skill.files[relPath]`
 * for L3 on-demand reading — never flattened into SKILL.md body.
 */
export async function parseSkillFolder(rawFiles: SkillSourceFile[]): Promise<{ skills: ParsedSkill[]; skipped: string[] }> {
    // Expand any nested .zip files first
    const expanded: SkillSourceFile[] = [];
    for (const f of rawFiles) {
        if (/\.zip$/i.test(f.path) && f.readBytes) {
            try {
                const subPrefix = f.path.replace(/\.zip$/i, "");
                const inner = await unzipBytesToSkillFiles(await f.readBytes(), subPrefix);
                expanded.push(...inner);
                continue;
            } catch {
                // ignore broken nested zip
            }
        }
        expanded.push(f);
    }

    const norm = expanded
        .map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\/+/, "") }))
        .filter((f) => !/(^|\/)(\.|__MACOSX\/)/.test(f.path));

    const skillFiles = norm.filter((f) => /(^|\/)SKILL\.md$/i.test(f.path));
    const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
    const skillDirs = skillFiles.map((f) => dirOf(f.path));
    const skipped: string[] = [];
    const skills: ParsedSkill[] = [];

    for (const skillFile of skillFiles) {
        const dir = dirOf(skillFile.path);
        const folderName = dir.replace(/\/$/, "").split("/").pop() || "";
        const parsed = parseSkillMarkdown(await skillFile.read(), folderName || skillFile.path);
        const own = norm.filter(
            (f) => f !== skillFile && f.path.startsWith(dir) && !skillDirs.some((d) => d !== dir && d.startsWith(dir) && f.path.startsWith(d)),
        );
        const fileMap: Record<string, string> = {};
        for (const f of own.sort((a, b) => a.path.localeCompare(b.path))) {
            const rel = f.path.slice(dir.length);
            if (!TEXT_EXT.test(rel) || f.size > MAX_SINGLE_FILE) {
                skipped.push(f.path);
                continue;
            }
            fileMap[rel] = (await f.read()).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
        }
        skills.push({
            ...parsed,
            files: Object.keys(fileMap).length ? fileMap : undefined,
        });
    }
    return { skills, skipped };
}
