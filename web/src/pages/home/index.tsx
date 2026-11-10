import { ArrowRight, FolderKanban, ImagePlus, Images, LayoutTemplate, Plus, ScrollText, Settings2, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";

import { useCreateCanvas } from "@/hooks/use-create-canvas";
import { collectImageStorageKeys, ensureImagePreview, resolveImageUrl } from "@/services/image-storage";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

const RECENT_LIMIT = 8;

type QuickEntry = { key: string; icon: LucideIcon; to?: string };

const quickEntries: QuickEntry[] = [
    { key: "newCanvas", icon: Plus },
    { key: "image", icon: ImagePlus, to: "/image" },
    { key: "video", icon: Video, to: "/video" },
    { key: "assets", icon: Images, to: "/assets" },
    { key: "prompts", icon: ScrollText, to: "/prompts" },
    { key: "config", icon: Settings2, to: "/config" },
];

function useProjectThumbnail(project: CanvasProject) {
    const storageKey = useMemo(() => collectImageStorageKeys(project.nodes).values().next().value as string | undefined, [project.nodes]);
    const [url, setUrl] = useState<string>();

    useEffect(() => {
        let cancelled = false;
        if (!storageKey) {
            setUrl(undefined);
            return;
        }
        void (async () => {
            const preview = await ensureImagePreview(storageKey).catch(() => undefined);
            const resolved = preview || (await resolveImageUrl(storageKey).catch(() => ""));
            if (!cancelled) setUrl(resolved || undefined);
        })();
        return () => {
            cancelled = true;
        };
    }, [storageKey]);

    return url;
}

function RecentProjectCard({ project }: { project: CanvasProject }) {
    const { t } = useTranslation();
    const thumbnail = useProjectThumbnail(project);

    return (
        <Link to={`/canvas/${project.id}`} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-panel transition hover:-translate-y-0.5 hover:border-hemosi/60">
            <div className="relative aspect-video overflow-hidden bg-stone-100 dark:bg-white/[0.03]">
                {thumbnail ? (
                    <img src={thumbnail} alt={project.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(rgba(120,120,120,.18)_1px,transparent_1px)] [background-size:14px_14px]">
                        <LayoutTemplate className="size-8 text-stone-400 dark:text-stone-600" />
                    </div>
                )}
            </div>
            <div className="px-3.5 py-3">
                <h3 className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{project.title}</h3>
                <p className="mt-1 flex items-center justify-between gap-2 text-xs text-stone-500">
                    <span className="truncate">{t("home.updatedAt", { time: dayjs(project.updatedAt).format("YYYY-MM-DD HH:mm") })}</span>
                    <span className="shrink-0">{t("home.nodes", { count: project.nodes.length })}</span>
                </p>
            </div>
        </Link>
    );
}

export default function HomePage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { createCanvas, ready } = useCreateCanvas();
    const projects = useCanvasStore((state) => state.projects);
    const recentProjects = useMemo(() => [...projects].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, RECENT_LIMIT), [projects]);

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-6 md:px-8 md:py-8">
                {/* Hero */}
                <section className="relative overflow-hidden rounded-2xl border border-border bg-[linear-gradient(120deg,rgba(0,200,200,0.28)_0%,rgba(0,200,200,0.08)_40%,transparent_75%)] bg-panel px-6 py-9 md:px-10 md:py-12">
                    <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-hemosi/20 blur-3xl" />
                    <div className="pointer-events-none absolute bottom-[-40%] right-[20%] size-56 rounded-full bg-hemosi/10 blur-3xl" />
                    <div className="relative max-w-xl">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-hemosi">
                            <Sparkles className="size-3.5" />
                            {t("home.heroEyebrow")}
                        </p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{t("home.heroTitle")}</h1>
                        <p className="mt-3 text-sm leading-6 text-stone-600 md:text-base dark:text-stone-400">{t("home.heroSubtitle")}</p>
                        <div className="mt-7 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                disabled={!ready}
                                onClick={createCanvas}
                                className="flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-hemosi px-7 text-base font-semibold text-[#0f1012] shadow-[0_10px_30px_-10px_var(--hemosi-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Plus className="size-5" />
                                {t("home.newCanvas")}
                            </button>
                            <button type="button" onClick={() => navigate("/canvas")} className="flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-border px-5 text-sm text-stone-700 transition hover:border-hemosi/60 hover:text-hemosi dark:text-stone-300">
                                <FolderKanban className="size-4" />
                                {t("home.openProjects")}
                            </button>
                        </div>
                    </div>
                </section>

                {/* Quick entries */}
                <section>
                    <h2 className="mb-3 text-base font-semibold">{t("home.quickTitle")}</h2>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                        {quickEntries.map((entry) => {
                            const Icon = entry.icon;
                            const className = "group flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border border-border bg-panel px-2 py-5 text-sm text-stone-700 transition hover:border-hemosi/60 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white";
                            const content = (
                                <>
                                    <span className="flex size-10 items-center justify-center rounded-lg bg-hemosi-soft text-hemosi transition group-hover:scale-105">
                                        <Icon className="size-5" />
                                    </span>
                                    <span className="truncate">{t(`home.quick.${entry.key}`)}</span>
                                </>
                            );
                            return entry.to ? (
                                <Link key={entry.key} to={entry.to} className={className}>
                                    {content}
                                </Link>
                            ) : (
                                <button key={entry.key} type="button" disabled={!ready} onClick={createCanvas} className={className}>
                                    {content}
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* Recent projects */}
                <section className="pb-6">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-base font-semibold">{t("home.recentTitle")}</h2>
                        {projects.length ? (
                            <Link to="/canvas" className="flex items-center gap-1 text-sm text-stone-500 transition hover:text-hemosi">
                                {t("home.viewAll")}
                                <ArrowRight className="size-3.5" />
                            </Link>
                        ) : null}
                    </div>
                    {!ready ? (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-stone-500">{t("home.loading")}</div>
                    ) : recentProjects.length ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {recentProjects.map((project) => (
                                <RecentProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
                            <LayoutTemplate className="size-10 text-stone-400 dark:text-stone-600" />
                            <h3 className="mt-4 text-base font-medium">{t("home.emptyTitle")}</h3>
                            <p className="mt-1.5 text-sm text-stone-500">{t("home.emptyDescription")}</p>
                            <button type="button" onClick={createCanvas} className="mt-5 flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-hemosi px-5 text-sm font-semibold text-[#0f1012] transition hover:brightness-110">
                                <Plus className="size-4" />
                                {t("home.newCanvas")}
                            </button>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
