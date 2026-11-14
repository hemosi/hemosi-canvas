import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Select } from "antd";
import { ImagePlus, X } from "lucide-react";

import { saveCustomPrompt, type CustomPromptInput } from "@/services/api/prompts";

/** Shrink a cover picture to at most 640px and keep it as a JPEG data URL (stored with the prompt in localforage). */
async function coverFromFile(file: Blob): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("图片读取失败"));
            el.src = url;
        });
        const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Create / edit one of the user's own prompts. `value` null = closed, `{}` = new. */
export function CustomPromptDialog({ value, tagOptions, onClose, onSaved }: { value: CustomPromptInput | null; tagOptions: string[]; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<CustomPromptInput>({ title: "", prompt: "", tags: [] });
    const [saving, setSaving] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (value) setDraft({ ...value });
    }, [value]);

    const setCover = async (file: Blob | null | undefined) => {
        if (!file || !file.type.startsWith("image/")) return;
        try {
            setDraft((d) => ({ ...d, coverUrl: "" }));
            const coverUrl = await coverFromFile(file);
            setDraft((d) => ({ ...d, coverUrl }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片读取失败");
        }
    };

    const save = async () => {
        if (!draft.prompt.trim()) return message.warning("请填写提示词正文");
        setSaving(true);
        try {
            await saveCustomPrompt(draft);
            message.success(draft.id ? "已保存" : "已添加到「我的提示词」");
            onSaved();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={Boolean(value)} title={draft.id ? "编辑提示词" : "新建提示词"} okText="保存" cancelText="取消" confirmLoading={saving} onOk={() => void save()} onCancel={onClose} width={600} centered>
            <div className="space-y-3" onPaste={(e) => void setCover([...e.clipboardData.files].find((f) => f.type.startsWith("image/")))}>
                <Input placeholder="标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                <Input.TextArea rows={8} placeholder="提示词正文" value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
                <Select mode="tags" className="w-full" placeholder="标签（回车添加）" value={draft.tags} options={tagOptions.map((t) => ({ value: t, label: t }))} onChange={(tags) => setDraft({ ...draft, tags })} />
                <div className="flex items-center gap-3">
                    {draft.coverUrl ? (
                        <div className="relative">
                            <img src={draft.coverUrl} alt="" className="h-20 w-28 rounded-lg object-cover" />
                            <button type="button" className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-black/60 text-white" title="去掉封面" onClick={() => setDraft({ ...draft, coverUrl: "" })}>
                                <X className="size-3" />
                            </button>
                        </div>
                    ) : null}
                    <Button icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
                        {draft.coverUrl ? "换封面" : "上传封面（可选）"}
                    </Button>
                    <span className="text-xs text-stone-500">也可以直接在这个窗口里粘贴图片</span>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                            void setCover(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                    />
                </div>
            </div>
        </Modal>
    );
}
