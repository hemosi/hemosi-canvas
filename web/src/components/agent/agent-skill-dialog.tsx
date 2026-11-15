import { useRef } from "react";
import { App, Button, Empty, Modal, Popconfirm, Switch } from "antd";
import { FolderUp, Trash2, Upload, Wrench } from "lucide-react";

import { parseSkillFolder, unzipBytesToSkillFiles, type ParsedSkill, type SkillSourceFile } from "@/lib/agent-skills";
import { useAgentSkillStore, type LocalSkill } from "@/stores/use-agent-skill-store";

/** Manage imported Agent Skills (folder / zip / SKILL.md): enable, disable, delete. */
export function AgentSkillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const skills = useAgentSkillStore((s) => s.skills);
    const addSkills = useAgentSkillStore((s) => s.addSkills);
    const updateSkill = useAgentSkillStore((s) => s.updateSkill);
    const removeSkill = useAgentSkillStore((s) => s.removeSkill);
    const fileRef = useRef<HTMLInputElement>(null);
    const folderRef = useRef<HTMLInputElement>(null);

    const finishImport = (parsed: ParsedSkill[]) => {
        const usable = parsed.filter((s) => s.body);
        if (!usable.length) return message.warning("未找到有效的 SKILL.md");
        const res = addSkills(usable);
        message.success(`已导入 ${res.added} 个 Skill${res.replaced ? `，更新同名 ${res.replaced} 个` : ""}`);
    };

    const importZip = async (files: FileList | null) => {
        if (!files?.length) return;
        try {
            const parsed: ParsedSkill[] = [];
            for (const file of [...files]) {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const res = await parseSkillFolder(await unzipBytesToSkillFiles(bytes));
                parsed.push(...res.skills);
            }
            finishImport(parsed);
        } catch (err) {
            message.error(`导入失败：${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const importFolder = async (files: FileList | null) => {
        if (!files?.length) return;
        try {
            const list: SkillSourceFile[] = [...files].map((file) => ({
                path: file.webkitRelativePath || file.name,
                size: file.size,
                read: () => file.text(),
                readBytes: async () => new Uint8Array(await file.arrayBuffer()),
            }));
            const res = await parseSkillFolder(list);
            finishImport(res.skills);
        } catch (err) {
            message.error(`导入失败：${err instanceof Error ? err.message : String(err)}`);
        }
    };

    return (
        <Modal open={open} title={`技能 (${skills.length})`} footer={null} width={560} onCancel={onClose} centered>
            <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                    <span className="opacity-65">开关打开即放入面板顶栏（模型可按需自动调用，也可在顶栏点蓝强制启动）</span>
                    <div className="flex shrink-0 gap-1.5">
                        <Button size="small" type="primary" icon={<FolderUp className="size-3.5" />} onClick={() => folderRef.current?.click()}>
                            导入 Skill 文件夹
                        </Button>
                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                            导入 .zip
                        </Button>
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".zip,application/zip"
                        multiple
                        hidden
                        onChange={(e) => {
                            void importZip(e.target.files);
                            e.target.value = "";
                        }}
                    />
                    <input
                        ref={folderRef}
                        type="file"
                        multiple
                        hidden
                        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                        onChange={(e) => {
                            void importFolder(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>
                {skills.length ? (
                    <div className="thin-scrollbar max-h-[55vh] space-y-1 overflow-y-auto">
                        {skills.map((s: LocalSkill) => {
                            const refCount = s.files ? Object.keys(s.files).length : 0;
                            return (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-2.5 rounded-lg border border-black/10 px-2.5 py-2 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                                >
                                    <Switch
                                        size="small"
                                        checked={s.enabled}
                                        title={s.enabled ? "常用：已显示在面板顶栏" : "未设为常用：不显示在顶栏"}
                                        onChange={(enabled) => updateSkill(s.id, { enabled })}
                                    />
                                    <span className="shrink-0 font-medium">{s.name}</span>
                                    {refCount > 0 ? (
                                        <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400">
                                            +{refCount} 文件
                                        </span>
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate opacity-55">{s.description}</span>
                                    <Popconfirm title={`删除 Skill「${s.name}」？`} okText="删除" cancelText="取消" onConfirm={() => removeSkill(s.id)}>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                    </Popconfirm>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未导入技能" />
                )}
            </div>
        </Modal>
    );
}
