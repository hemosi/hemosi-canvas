import { useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Popconfirm, Switch } from "antd";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";

import { parseSkillMarkdown, type ParsedSkill } from "@/lib/agent-skills";
import { useAgentSkillStore, type LocalSkill } from "@/stores/use-agent-skill-store";

/** Manage imported SKILL.md files: import, edit, delete, enable. */
export function AgentSkillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const skills = useAgentSkillStore((s) => s.skills);
    const addSkills = useAgentSkillStore((s) => s.addSkills);
    const updateSkill = useAgentSkillStore((s) => s.updateSkill);
    const removeSkill = useAgentSkillStore((s) => s.removeSkill);
    const [editing, setEditing] = useState<(ParsedSkill & { id?: string }) | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const importFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const parsed = await Promise.all([...files].map(async (file) => parseSkillMarkdown(await file.text(), file.name)));
        const usable = parsed.filter((s) => s.body);
        const res = addSkills(usable);
        message.success(`已导入 ${res.added} 个 skill${res.replaced ? `，覆盖同名 ${res.replaced} 个` : ""}`);
        if (usable.some((s) => !s.description)) message.warning("有 skill 没写 description，Agent 无法按描述自动加载它，只能手动开启");
    };

    const save = () => {
        if (!editing) return;
        const item = { name: editing.name.trim(), description: editing.description.trim(), body: editing.body.trim() };
        if (!item.name || !item.body) return message.warning("名称和内容不能为空");
        if (skills.some((s) => s.name === item.name && s.id !== editing.id)) return message.warning("已有同名 skill");
        if (editing.id) updateSkill(editing.id, item);
        else addSkills([item]);
        setEditing(null);
    };

    return (
        <>
            <Modal open={open} title="Agent skill" footer={null} width={620} onCancel={onClose} centered>
                <div className="space-y-3 text-xs">
                    <div className="opacity-70">
                        导入 SKILL.md（开头 frontmatter 写 name 和 description，下面是正文），只存在本机。用法：在 Agent 面板点亮 skill 手动加载；或者 Agent 看 description 觉得这次用得上时自己加载。skill 只算风格/写法参考，排在内置硬规则后面，冲突时以硬规则为准。
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                            导入 SKILL.md
                        </Button>
                        <Button icon={<Plus className="size-3.5" />} onClick={() => setEditing({ name: "", description: "", body: "" })}>
                            新建
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".md,.markdown,text/markdown,text/plain"
                            multiple
                            hidden
                            onChange={(e) => {
                                void importFiles(e.target.files);
                                e.target.value = "";
                            }}
                        />
                    </div>
                    {skills.length ? (
                        <div className="thin-scrollbar max-h-[50vh] space-y-1.5 overflow-y-auto">
                            {skills.map((s: LocalSkill) => (
                                <div key={s.id} className="flex items-start gap-2 rounded-lg border border-black/10 p-2 dark:border-white/10">
                                    <Switch size="small" className="mt-0.5" checked={s.enabled} title={s.enabled ? "已启用" : "已停用"} onChange={(enabled) => updateSkill(s.id, { enabled })} />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium">{s.name}</div>
                                        <div className="line-clamp-2 opacity-65">{s.description || "（没有 description，只能手动开启）"}</div>
                                    </div>
                                    <Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => setEditing({ id: s.id, name: s.name, description: s.description, body: s.body })} />
                                    <Popconfirm title={`删除 skill「${s.name}」？`} okText="删除" cancelText="取消" onConfirm={() => removeSkill(s.id)}>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                    </Popconfirm>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 skill" />
                    )}
                </div>
            </Modal>
            <Modal open={Boolean(editing)} title={editing?.id ? "编辑 skill" : "新建 skill"} okText="保存" cancelText="取消" width={640} onOk={save} onCancel={() => setEditing(null)} centered>
                {editing ? (
                    <div className="space-y-2 text-xs">
                        <Input placeholder="名称（name）" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                        <Input placeholder="描述（description）：什么时候该用它，Agent 靠这句判断是否自动加载" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                        <Input.TextArea rows={14} placeholder="正文（markdown）" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    </div>
                ) : null}
            </Modal>
        </>
    );
}
