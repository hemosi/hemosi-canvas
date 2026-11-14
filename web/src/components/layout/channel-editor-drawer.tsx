import { Button, Drawer, Input, Modal, Segmented, Select, Space, Switch } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { API_CALL_FORMATS, API_FORMAT_LABELS, OFFICIAL_CHANNEL_PRESETS, defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, normalizeImageEditOptions, type ImageEditOptions, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { defaultModelRuleOf, modelRulePresetsOf, seedModelRule } from "@/lib/model-prompt-presets";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type RuleTarget = { name: string; kind: "image" | "video"; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [ruleTarget, setRuleTarget] = useState<RuleTarget | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = API_CALL_FORMATS.map((value) => ({ label: API_FORMAT_LABELS[value], value }));
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });
    const imageEdit = normalizeImageEditOptions(draft.imageEdit);
    const patchImageEdit = (value: Partial<ImageEditOptions>) => patch({ imageEdit: { ...imageEdit, ...value } });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setPromptRule = (name: string, promptRule: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, promptRule } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                    {OFFICIAL_CHANNEL_PRESETS.find((preset) => preset.id === draft.id || preset.apiFormat === draft.apiFormat) ? <span className="mt-1 block text-xs text-stone-500">Key 在哪里拿：{(OFFICIAL_CHANNEL_PRESETS.find((preset) => preset.id === draft.id) || OFFICIAL_CHANNEL_PRESETS.find((preset) => preset.apiFormat === draft.apiFormat))!.keyHint}。Key 只存在本机浏览器，请求由前端直连官方接口。</span> : null}
                </label>
            </div>

            {draft.apiFormat === "openai" ? (
                <div className="mt-6 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="text-sm font-semibold">{t("config.channelEditor.imageEdit.title")}</div>
                    <div className="mt-0.5 mb-3 text-xs text-stone-500">{t("config.channelEditor.imageEdit.description")}</div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.imageEdit.mode")}</span>
                            <Segmented
                                block
                                value={imageEdit.mode}
                                options={[
                                    { label: t("config.channelEditor.imageEdit.multipart"), value: "multipart" },
                                    { label: "JSON", value: "json" },
                                ]}
                                onChange={(value) => patchImageEdit({ mode: value as ImageEditOptions["mode"] })}
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.imageEdit.field")}</span>
                            <Segmented
                                block
                                disabled={imageEdit.mode !== "multipart"}
                                value={imageEdit.field}
                                options={[
                                    { label: "image", value: "image" },
                                    { label: "image[]", value: "image[]" },
                                ]}
                                onChange={(value) => patchImageEdit({ field: value as ImageEditOptions["field"] })}
                            />
                        </label>
                        <label className="flex items-center justify-between gap-3 md:col-span-2">
                            <span className="text-sm">{t("config.channelEditor.imageEdit.extraParams")}</span>
                            <Switch checked={imageEdit.extraParams} onChange={(checked) => patchImageEdit({ extraParams: checked })} />
                        </label>
                    </div>
                </div>
            ) : null}

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />

            <Modal
                open={Boolean(ruleTarget)}
                title={`提示词写法 · ${ruleTarget?.name || ""}`}
                okText="保存"
                cancelText="取消"
                width={560}
                onCancel={() => setRuleTarget(null)}
                onOk={() => {
                    if (ruleTarget) setPromptRule(ruleTarget.name, ruleTarget.value.trim());
                    setRuleTarget(null);
                }}
            >
                {ruleTarget ? (
                    <div className="space-y-2 text-xs">
                        <div className="text-stone-500">分镜 Agent 给这个{ruleTarget.kind === "image" ? "图片" : "视频"}模型写提示词时按这里的写法；跟着这条模型走，分镜表里也能临时改。点渠道抽屉右上「保存」后生效。留空＝用通用写法。</div>
                        <Select
                            className="w-full"
                            placeholder="从内置预设填入…"
                            value={null}
                            options={[{ value: "default", label: "通用写法" }, ...modelRulePresetsOf(ruleTarget.kind).map((p) => ({ value: p.id, label: p.label }))]}
                            onChange={(id) => setRuleTarget({ ...ruleTarget, value: id === "default" ? defaultModelRuleOf(ruleTarget.kind) : modelRulePresetsOf(ruleTarget.kind).find((p) => p.id === id)?.rule || ruleTarget.value })}
                        />
                        <Input.TextArea rows={8} value={ruleTarget.value} placeholder={defaultModelRuleOf(ruleTarget.kind)} onChange={(e) => setRuleTarget({ ...ruleTarget, value: e.target.value })} />
                    </div>
                ) : null}
            </Modal>
        </Drawer>
    );
}
