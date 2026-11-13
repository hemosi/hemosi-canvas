import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Input } from "antd";
import { Check, ChevronRight, Loader2, Send, Square, Trash2, Undo2, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { AGENT_MAX_AUTO_STEPS, agentSystemPrompt, buildAgentChange, isReadCall, parseAgentReply, runReadCall } from "@/lib/canvas/agent/agent-tools";
import { requestImageQuestion } from "@/services/api/image";
import { useCanvasAgentStore, type CanvasAgentMessage } from "@/stores/canvas/use-canvas-agent-store";
import { useCloneStore } from "@/stores/canvas/use-clone-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { modelNotReadyReason, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

const EMPTY: CanvasAgentMessage[] = [];

/** 画布 Agent：聊天框。读画布自动执行；改画布先出改动卡，点「应用」才落地；生成再走生成确认卡。 */
export function CanvasAgentChat() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvas = useAgentStore((state) => state.canvasContext);
    const projectId = canvas?.snapshot.projectId || "";
    const messages = useCanvasAgentStore((state) => (projectId ? state.threads[projectId] : undefined)) || EMPTY;
    const { load, push, patch, clear } = useCanvasAgentStore.getState();
    const [model, setModel] = useState(() => localStorage.getItem("hemosi:agent-model") || config.textModel);
    const [onlySelected, setOnlySelected] = useState(false);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [streamed, setStreamed] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (projectId) void load(projectId);
    }, [projectId, load]);
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages.length, streamed]);

    const pickModel = (value: string) => {
        setModel(value);
        localStorage.setItem("hemosi:agent-model", value);
    };

    /** 让模型想一轮：只读工具自动跑，写工具攒成改动卡后停下等用户。 */
    const think = async (pid: string) => {
        const reason = modelNotReadyReason(config, model);
        if (reason) {
            push(pid, { kind: "error", text: `思考模型不可用：${reason}` });
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        try {
            for (let step = 0; step < AGENT_MAX_AUTO_STEPS; step += 1) {
                setStreamed("");
                const history = (useCanvasAgentStore.getState().threads[pid] || []).flatMap((item) => (item.forModel ? [item.forModel] : []));
                const text = await requestImageQuestion({ ...config, model }, [{ role: "system", content: agentSystemPrompt() }, ...history], (delta) => setStreamed((prev) => prev + delta), { signal: controller.signal });
                setStreamed("");
                const reply = parseAgentReply(text);
                push(pid, { kind: "agent", text: reply.say || (reply.calls.length ? "" : "（没有回复内容）"), forModel: { role: "assistant", content: text } });
                const snapshot = useAgentStore.getState().canvasContext?.snapshot;
                if (!reply.calls.length || !snapshot) return;
                const reads = reply.calls.filter(isReadCall);
                if (reads.length) {
                    const results = reads.map((call) => `【${call.tool}】\n${runReadCall(call, snapshot)}`);
                    const skipped = reply.calls.length - reads.length;
                    const label = reads.map((call) => (call.tool === "read_canvas" ? `读了画布（${snapshot.nodes.length} 个节点）` : `读了节点 ${String(call.args?.id || "")}`)).join("、");
                    push(pid, { kind: "tool", text: label, forModel: { role: "user", content: `[工具结果]\n${results.join("\n\n")}${skipped ? `\n\n（你同时发的 ${skipped} 个改动工具没有执行：先看结果，再单独发改动。）` : ""}` } });
                    continue;
                }
                const change = buildAgentChange(reply.calls, snapshot);
                if (!change.steps.length) {
                    push(pid, { kind: "tool", text: `改动都无效：${change.errors.join("；")}`, forModel: { role: "user", content: `[改动无效] ${change.errors.join("；")}` } });
                    continue;
                }
                push(pid, { kind: "change", text: "", change, changeStatus: "pending" });
                return;
            }
            push(pid, { kind: "error", text: `连续自动读了 ${AGENT_MAX_AUTO_STEPS} 步还没给出结果，先停下。你可以补一句再让它继续。` });
        } catch (error) {
            if (!controller.signal.aborted) push(pid, { kind: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
            setStreamed("");
            abortRef.current = null;
        }
    };

    const send = () => {
        const text = input.trim();
        if (!projectId) return message.warning("先打开一张画布");
        if (!text || busy) return;
        const selected = canvas?.snapshot.selectedNodeIds || [];
        const scope = onlySelected && selected.length ? `\n（只处理我选中的节点：${selected.join(", ")}）` : "";
        // 有未处理的改动卡时，用户说话就视为不要它
        messages.filter((item) => item.changeStatus === "pending").forEach((item) => patch(projectId, item.id, { changeStatus: "rejected" }));
        push(projectId, { kind: "user", text, forModel: { role: "user", content: `${text}${scope}` } });
        setInput("");
        void think(projectId);
    };

    const apply = async (item: CanvasAgentMessage) => {
        const ctx = useAgentStore.getState().canvasContext;
        if (!ctx || !item.change) return;
        const { change } = item;
        patch(projectId, item.id, { changeStatus: "applied" });
        const results: string[] = [];
        if (change.ops.length) ctx.applyOps(change.ops);
        if (Object.keys(change.keys).length) results.push(`新节点：${Object.entries(change.keys).map(([key, id]) => `${key}=${id}`).join("，")}`);
        for (const batch of change.shots) {
            if (!ctx.runShots) {
                results.push("当前画布不支持批量生成分镜");
                break;
            }
            const result = await ctx.runShots(batch.ids, batch.kind, "agent");
            results.push(result.canceled ? `${batch.kind === "video" ? "视频" : "图片"}生成：用户在确认卡取消了，没花钱` : `${batch.kind === "video" ? "视频" : "图片"}生成：成功 ${result.ok}，失败 ${result.failed}`);
        }
        if (change.cloneNodeId) {
            useCloneStore.getState().open(projectId, change.cloneNodeId);
            results.push("已打开爆款复刻弹窗，由用户在弹窗里操作");
        }
        if (change.errors.length) results.push(`跳过：${change.errors.join("；")}`);
        push(projectId, { kind: "tool", text: results.join("；") || "已应用", forModel: { role: "user", content: `[用户已应用改动] ${results.join("；") || "完成"}` } });
        void think(projectId);
    };

    const reject = (item: CanvasAgentMessage) => {
        patch(projectId, item.id, { changeStatus: "rejected" });
        push(projectId, { kind: "tool", text: "你没要这次改动", forModel: { role: "user", content: "[用户拒绝了这次改动，没有执行。等用户说原因。]" } });
    };

    const undo = (item: CanvasAgentMessage) => {
        const result = useAgentStore.getState().canvasContext?.undoOps();
        if (!result) return message.info("没有可撤销的 Agent 改动");
        patch(projectId, item.id, { changeStatus: "undone" });
        push(projectId, { kind: "tool", text: "已撤销", forModel: { role: "user", content: "[用户撤销了上一次改动，画布已恢复原样]" } });
    };

    const lastAppliedId = [...messages].reverse().find((item) => item.changeStatus === "applied")?.id;

    return (
        <div className="flex min-h-0 flex-1 flex-col text-sm" data-canvas-shortcuts-ignore>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <ModelPicker config={config} value={model} capability="text" onChange={pickModel} onMissingConfig={() => openConfigDialog(true)} className="min-w-0 flex-1" placeholder="选思考模型" />
                <Checkbox checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)}>
                    <span className="text-xs">只看选中{canvas?.snapshot.selectedNodeIds.length ? `（${canvas.snapshot.selectedNodeIds.length}）` : ""}</span>
                </Checkbox>
                <Button size="small" type="text" title="清空对话" icon={<Trash2 className="size-3.5" />} disabled={busy || !messages.length} onClick={() => projectId && clear(projectId)} />
            </div>

            <div ref={listRef} className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3 py-3">
                {!messages.length ? (
                    <div className="m-auto max-w-[280px] space-y-2 text-center text-xs" style={{ color: theme.node.muted }}>
                        <div>直接说要做什么，例如：</div>
                        <div>「把选中的文字拆成 6 个分镜，主角是穿白 T 的丸子头女生」</div>
                        <div>「所有分镜改成 9:16」</div>
                        <div>「拆解这条视频做爆款复刻」</div>
                        <div className="pt-1 opacity-70">改画布前会先给你看清单，生成前还会弹确认卡。</div>
                    </div>
                ) : null}
                {messages.map((item) => {
                    if (item.kind === "user")
                        return (
                            <div key={item.id} className="ml-8 self-end whitespace-pre-wrap rounded-2xl rounded-br-sm px-3 py-2" style={{ background: "var(--hemosi-accent)", color: "#0a0c0e" }}>
                                {item.text}
                            </div>
                        );
                    if (item.kind === "agent") return item.text ? <div key={item.id} className="mr-6 whitespace-pre-wrap leading-relaxed">{item.text}</div> : null;
                    if (item.kind === "tool")
                        return (
                            <div key={item.id} className="flex items-start gap-1 text-[11px]" style={{ color: theme.node.muted }}>
                                <ChevronRight className="mt-0.5 size-3 shrink-0" />
                                <span className="break-all">{item.text}</span>
                            </div>
                        );
                    if (item.kind === "error")
                        return (
                            <div key={item.id} className="whitespace-pre-wrap break-all rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-500">
                                {item.text}
                            </div>
                        );
                    const change = item.change!;
                    return (
                        <div key={item.id} className="rounded-xl border p-2.5 text-xs" style={{ borderColor: item.changeStatus === "pending" ? "var(--hemosi-accent)" : theme.node.stroke, opacity: item.changeStatus === "rejected" || item.changeStatus === "undone" ? 0.55 : 1 }}>
                            <div className="mb-1.5 font-medium">改动清单</div>
                            <ol className="list-decimal space-y-0.5 pl-4">
                                {change.steps.map((step, index) => (
                                    <li key={index} className={step.danger ? "text-red-500" : undefined}>
                                        {step.text}
                                    </li>
                                ))}
                            </ol>
                            {change.errors.length ? <div className="mt-1 opacity-60">跳过：{change.errors.join("；")}</div> : null}
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                                {item.changeStatus === "pending" ? (
                                    <>
                                        <Button size="small" icon={<X className="size-3.5" />} disabled={busy} onClick={() => reject(item)}>
                                            不要
                                        </Button>
                                        <Button size="small" type="primary" icon={<Check className="size-3.5" />} disabled={busy} onClick={() => void apply(item)}>
                                            应用
                                        </Button>
                                    </>
                                ) : item.changeStatus === "applied" ? (
                                    <>
                                        <span style={{ color: theme.node.muted }}>已应用</span>
                                        {item.id === lastAppliedId && canvas?.canUndo ? (
                                            <Button size="small" type="text" icon={<Undo2 className="size-3.5" />} disabled={busy} onClick={() => undo(item)}>
                                                撤销
                                            </Button>
                                        ) : null}
                                    </>
                                ) : (
                                    <span style={{ color: theme.node.muted }}>{item.changeStatus === "undone" ? "已撤销" : "没要"}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
                {busy ? (
                    <div className="flex items-start gap-2 text-xs" style={{ color: theme.node.muted }}>
                        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                        <span className="line-clamp-3 break-all">{streamed ? streamed.slice(-200) : "在想…"}</span>
                    </div>
                ) : null}
            </div>

            <div className="shrink-0 border-t p-2.5" style={{ borderColor: theme.node.stroke }}>
                <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    value={input}
                    placeholder={projectId ? "说要做什么（回车发送，Shift+回车换行）" : "先打开一张画布"}
                    disabled={!projectId}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            send();
                        }
                    }}
                />
                <div className="mt-2 flex justify-end">
                    {busy ? (
                        <Button size="small" icon={<Square className="size-3.5" />} onClick={() => abortRef.current?.abort()}>
                            停止
                        </Button>
                    ) : (
                        <Button size="small" type="primary" icon={<Send className="size-3.5" />} disabled={!input.trim() || !projectId} onClick={send}>
                            发送
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
