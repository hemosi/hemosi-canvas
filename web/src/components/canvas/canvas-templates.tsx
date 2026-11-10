import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { Image as ImageIcon, Music2, Settings2, Trash2, Type, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getBuiltinTemplates, templateDescription, templateName, type CanvasTemplate } from "@/lib/canvas/canvas-templates";
import { useTemplateStore } from "@/stores/use-template-store";
import { CanvasNodeType } from "@/types/canvas";

const TYPE_ICONS: Partial<Record<string, typeof Type>> = {
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Config]: Settings2,
};

/** Built-in + user templates with insert/delete actions; shared by the canvas 模板 panel and the /templates page. */
export function CanvasTemplateList({ insertLabel, onInsert }: { insertLabel: string; onInsert: (template: CanvasTemplate) => void }) {
    const { t, i18n } = useTranslation();
    const { modal, message } = App.useApp();
    const userTemplates = useTemplateStore((state) => state.templates);
    const deleteTemplate = useTemplateStore((state) => state.deleteTemplate);
    // Rebuild built-ins when the language changes so their titles and prompts follow it.
    const builtinTemplates = useMemo(() => getBuiltinTemplates(), [i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

    const confirmDelete = (template: CanvasTemplate) => {
        modal.confirm({
            title: t("hemosi.templates.delete"),
            content: t("hemosi.templates.deleteConfirm", { name: templateName(template) }),
            okText: t("hemosi.templates.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: () => {
                deleteTemplate(template.id);
                message.success(t("hemosi.templates.deleted"));
            },
        });
    };

    return (
        <div className="space-y-5">
            <section>
                <h3 className="mb-2 text-sm font-semibold">{t("hemosi.templates.mineTitle")}</h3>
                {userTemplates.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        {userTemplates.map((template) => (
                            <TemplateCard key={template.id} template={template} insertLabel={insertLabel} onInsert={onInsert} onDelete={confirmDelete} />
                        ))}
                    </div>
                ) : (
                    <p className="rounded-xl border border-dashed border-stone-300 px-4 py-5 text-sm opacity-70 dark:border-white/15">{t("hemosi.templates.empty")}</p>
                )}
            </section>
            <section>
                <h3 className="mb-2 text-sm font-semibold">{t("hemosi.templates.builtinTitle")}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                    {builtinTemplates.map((template) => (
                        <TemplateCard key={template.id} template={template} insertLabel={insertLabel} onInsert={onInsert} />
                    ))}
                </div>
            </section>
        </div>
    );
}

function TemplateCard({ template, insertLabel, onInsert, onDelete }: { template: CanvasTemplate; insertLabel: string; onInsert: (template: CanvasTemplate) => void; onDelete?: (template: CanvasTemplate) => void }) {
    const { t } = useTranslation();
    const description = templateDescription(template);
    const typeCounts = template.nodes.reduce((map, node) => map.set(node.type, (map.get(node.type) || 0) + 1), new Map<string, number>());

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[.03]">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-medium">{templateName(template)}</span>
                        {template.builtin ? <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "var(--hemosi-accent-soft)", color: "var(--hemosi-accent)" }}>{t("hemosi.templates.builtinTag")}</span> : null}
                    </div>
                    {description ? <p className="mt-1 text-xs leading-5 opacity-60">{description}</p> : null}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
                {[...typeCounts.entries()].map(([type, count]) => {
                    const Icon = TYPE_ICONS[type] || Settings2;
                    return (
                        <span key={type} className="inline-flex items-center gap-1">
                            <Icon className="size-3.5" />
                            {count}
                        </span>
                    );
                })}
                <span>{t("hemosi.templates.connectionCount", { count: template.connections.length })}</span>
            </div>
            <div className="mt-auto flex gap-2 pt-1">
                <Button type="primary" size="small" onClick={() => onInsert(template)}>
                    {insertLabel}
                </Button>
                {onDelete ? (
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(template)}>
                        {t("hemosi.templates.delete")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

export function CanvasTemplateModal({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (template: CanvasTemplate) => void }) {
    const { t } = useTranslation();
    return (
        <Modal title={t("hemosi.templates.title")} open={open} centered width={720} footer={null} onCancel={onClose} destroyOnHidden>
            <div className="thin-scrollbar max-h-[64vh] overflow-y-auto pr-1 pt-1" data-canvas-shortcuts-ignore onWheelCapture={(event) => event.stopPropagation()}>
                <CanvasTemplateList insertLabel={t("hemosi.templates.insert")} onInsert={onInsert} />
            </div>
        </Modal>
    );
}

export function CanvasSaveTemplateModal({ open, defaultName, onCancel, onSave }: { open: boolean; defaultName: string; onCancel: () => void; onSave: (name: string) => void }) {
    const { t } = useTranslation();
    const [name, setName] = useState(defaultName);
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(defaultName);
        setTouched(false);
    }, [defaultName, open]);

    const submit = () => {
        setTouched(true);
        if (name.trim()) onSave(name.trim());
    };

    return (
        <Modal
            title={t("hemosi.templates.saveTitle")}
            open={open}
            centered
            width={420}
            onCancel={onCancel}
            destroyOnHidden
            footer={
                <>
                    <Button onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={submit}>
                        {t("hemosi.templates.save")}
                    </Button>
                </>
            }
        >
            <div className="space-y-1.5 pt-1" data-canvas-shortcuts-ignore>
                <label className="text-xs opacity-70">{t("hemosi.templates.nameLabel")}</label>
                <Input autoFocus maxLength={40} value={name} placeholder={t("hemosi.templates.namePlaceholder")} status={touched && !name.trim() ? "error" : undefined} onChange={(event) => setName(event.target.value)} onPressEnter={submit} />
                {touched && !name.trim() ? <div className="text-xs text-red-400">{t("hemosi.templates.nameRequired")}</div> : null}
            </div>
        </Modal>
    );
}
