import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button } from "antd";
import { FileUp, FolderOpen, Plus } from "lucide-react";
import dayjs from "dayjs";

import { importCanvasPackage } from "@/lib/canvas/canvas-import";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/canvas/use-workspace-store";

/** 项目首页: every project with its canvases and materials; a project is canvases + script + materials in one container. */
export default function ProjectsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const workspacesHydrated = useWorkspaceStore((state) => state.hydrated);
    const canvasesHydrated = useCanvasStore((state) => state.hydrated);
    const hydrated = workspacesHydrated && canvasesHydrated;
    const canvases = useCanvasStore((state) => state.projects);
    const loose = canvases.filter((canvas) => !canvas.workspaceId || !workspaces.some((item) => item.id === canvas.workspaceId)).length;

    const create = () => {
        const id = useWorkspaceStore.getState().createWorkspace(`项目 ${workspaces.length + 1}`);
        navigate(`/projects/${id}`);
    };
    const importPackage = async (file?: File) => {
        if (!file) return;
        try {
            const result = await importCanvasPackage(file);
            message.success(`已导入 ${result.canvases} 张画布${result.workspaces ? `、${result.workspaces} 个项目` : ""}`);
            if (result.workspaceId) navigate(`/projects/${result.workspaceId}`);
        } catch (error) {
            message.error(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">项目 = 多张画布 + 剧本 + 全部素材</p>
                        <h1 className="mt-3 text-3xl font-semibold">项目</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入项目包
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={create}>
                            新建项目
                        </Button>
                    </div>
                </header>
                {!hydrated ? (
                    <div className="py-20 text-center text-sm text-stone-500">加载中…</div>
                ) : workspaces.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {workspaces.map((workspace) => {
                            const own = canvases.filter((canvas) => canvas.workspaceId === workspace.id);
                            return (
                                <button key={workspace.id} type="button" className="flex min-h-40 flex-col justify-between rounded-2xl bg-[#f1eee8] p-5 text-left transition hover:bg-[#ebe6dc] dark:bg-white/5 dark:hover:bg-white/10" onClick={() => navigate(`/projects/${workspace.id}`)}>
                                    <div>
                                        <div className="flex items-center gap-2 text-lg font-semibold">
                                            <FolderOpen className="size-5 opacity-60" />
                                            <span className="truncate">{workspace.title}</span>
                                        </div>
                                        <p className="mt-2 line-clamp-2 text-xs text-stone-500">{workspace.script.trim() ? workspace.script.trim().slice(0, 80) : "还没有剧本"}</p>
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                                        <span>{own.length} 张画布</span>
                                        <span>{workspace.materials.length} 个素材</span>
                                        <span>{own.reduce((sum, canvas) => sum + canvas.nodes.length, 0)} 个节点</span>
                                        <span>更新于 {dayjs(workspace.updatedAt).format("MM-DD HH:mm")}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <section className="flex min-h-[300px] flex-col items-center justify-center text-center">
                        <h2 className="text-xl font-medium">还没有项目</h2>
                        <p className="mt-3 text-sm text-stone-500">一个项目装一部片：剧本、各集/各场的画布、外部生成回来的素材都在里面。</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={create}>
                            新建项目
                        </Button>
                    </section>
                )}
                {loose ? (
                    <p className="text-xs text-stone-500">
                        另有 {loose} 张画布还没进项目，打开它们时会自动建一个同名项目。
                        <button type="button" className="ml-1 underline" onClick={() => navigate("/canvas")}>
                            查看全部画布
                        </button>
                    </p>
                ) : null}
            </div>
            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importPackage(event.target.files?.[0])} />
        </main>
    );
}
