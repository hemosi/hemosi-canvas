import { Input, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { defaultModelRuleOf, modelRulePresetsOf } from "@/lib/model-prompt-presets";
import { useConfigStore, type ModelChannel } from "@/stores/use-config-store";

/** Settings → 提示词写法: every image/video model of every channel gets a box (may stay empty = generic rule). */
export function ModelRulesPanel({ channels, active, onChange }: { channels: ModelChannel[]; active: boolean; onChange: (channels: ModelChannel[]) => void }) {
    const focusModel = useConfigStore((state) => state.configFocusModel);
    const rootRef = useRef<HTMLDivElement>(null);
    const rows = channels.flatMap((channel) => channel.models.filter((model) => model.capability === "image" || model.capability === "video").map((model) => ({ channel, model, kind: model.capability as "image" | "video" })));

    useEffect(() => {
        if (!active || !focusModel) return;
        const el = rootRef.current?.querySelector(`[data-model="${CSS.escape(focusModel)}"]`);
        el?.scrollIntoView({ block: "center" });
    }, [active, focusModel]);

    const save = (channelId: string, name: string, rule: string) =>
        onChange(channels.map((channel) => (channel.id === channelId ? { ...channel, models: channel.models.map((model) => (model.name === name ? { ...model, promptRule: rule } : model)) } : channel)));

    if (!rows.length) return <div className="py-10 text-center text-sm text-stone-500">还没有图片或视频模型。先在「渠道」里添加模型。</div>;
    return (
        <div ref={rootRef} className="space-y-3">
            <div className="text-xs text-stone-500">分镜 Agent 给这个模型写提示词时按这里的写法。留空＝用通用写法。分镜表里也能临时改单张表。</div>
            {rows.map(({ channel, model, kind }) => (
                <RuleRow key={`${channel.id}:${model.name}`} name={model.name} channelName={channel.name} kind={kind} value={model.promptRule || ""} highlight={focusModel === model.name} onSave={(rule) => save(channel.id, model.name, rule)} />
            ))}
        </div>
    );
}

function RuleRow({ name, channelName, kind, value, highlight, onSave }: { name: string; channelName: string; kind: "image" | "video"; value: string; highlight: boolean; onSave: (rule: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = (next: string) => {
        if (next.trim() !== value.trim()) onSave(next.trim());
    };
    return (
        <div data-model={name} className={`rounded-md border p-3 ${highlight ? "border-teal-500" : "border-stone-200 dark:border-stone-800"}`}>
            <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] dark:bg-stone-800">{kind === "image" ? "图片" : "视频"}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={name}>
                    {name}
                </span>
                <span className="text-xs text-stone-500">{channelName}</span>
                <Select
                    size="small"
                    className="w-40"
                    placeholder="填入预设…"
                    value={null}
                    options={[{ value: "default", label: "通用写法" }, ...modelRulePresetsOf(kind).map((p) => ({ value: p.id, label: p.label }))]}
                    onChange={(id) => {
                        const next = id === "default" ? defaultModelRuleOf(kind) : modelRulePresetsOf(kind).find((p) => p.id === id)?.rule || draft;
                        setDraft(next);
                        commit(next);
                    }}
                />
            </div>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} value={draft} placeholder={`留空＝通用写法：${defaultModelRuleOf(kind).slice(0, 60)}…`} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft)} />
        </div>
    );
}
