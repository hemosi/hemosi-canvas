import { Modal } from "antd";

import type { StoryboardQueueTask, StoryboardRunGroup } from "@/lib/canvas/storyboard-queue";

export type StoryboardConfirmState = {
    title: string;
    tasks: StoryboardQueueTask[];
    /** One entry per kind + model; images run first, videos after all images finish. */
    groups: StoryboardRunGroup[];
    ready: boolean;
    reason?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
};

export function StoryboardConfirmModal({ state }: { state: StoryboardConfirmState | null }) {
    if (!state) return null;

    return (
        <Modal
            title={state.title || "生成确认"}
            open
            centered
            width={540}
            okText={`确认生成 (${state.tasks.length} 项)`}
            cancelText="取消"
            okButtonProps={{ disabled: !state.ready }}
            onOk={state.onConfirm}
            onCancel={state.onCancel}
        >
            <div className="flex flex-col gap-3 py-2 text-xs">
                <div className="space-y-1.5 rounded-lg border border-black/10 p-2.5 dark:border-white/10">
                    {state.groups.map((g) => (
                        <div key={`${g.kind}-${g.modelName}-${g.channelName}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span className="font-medium">{g.kind === "image" ? "图片" : "视频"} × {g.count}</span>
                            <span>
                                <span className="opacity-60">模型：</span>
                                {g.modelName}
                            </span>
                            <span>
                                <span className="opacity-60">渠道：</span>
                                {g.channelName}
                            </span>
                            <span className="opacity-60">{g.concurrency === 1 ? "串行（本机渠道）" : `并发 ${g.concurrency}`}</span>
                        </div>
                    ))}
                    {state.groups.some((g) => g.kind === "image") && state.groups.some((g) => g.kind === "video") ? (
                        <div className="opacity-60">先生成全部图片，图片完成后再生成视频（视频会用上新图作参考）。</div>
                    ) : null}
                    <div className="opacity-60">共 {state.tasks.length} 项，每项按它的模型生成，会产生费用。</div>
                </div>

                {!state.ready && state.reason ? (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-red-500">
                        {state.reason}
                    </div>
                ) : null}

                <div className="thin-scrollbar max-h-64 space-y-2 overflow-y-auto pr-1">
                    {state.tasks.map((task) => (
                        <div
                            key={`${task.nodeId}-${task.kind}`}
                            className="rounded-lg border border-black/10 p-2 dark:border-white/10"
                        >
                            <div className="mb-1 flex items-center justify-between font-medium">
                                <span>{task.label}</span>
                                <span className="opacity-60">{task.kind === "image" ? "图片" : "视频"}</span>
                            </div>
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] opacity-80">
                                {task.prompt || "（空提示词）"}
                            </pre>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}
