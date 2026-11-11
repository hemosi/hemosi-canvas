import { Alert, Button, message, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, FolderEdit, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { isDesktopApp } from "@/lib/desktop-bridge";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    image_previews: "imagePreviews",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [desktopPathInfo, setDesktopPathInfo] = useState<{ current: string; isPortable: boolean } | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setUsage(await readLocalStorageUsage());
            if (isDesktopApp() && window.hemosiDesktop?.getDataPath) {
                const info = await window.hemosiDesktop.getDataPath();
                setDesktopPathInfo(info);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    const handleChangeLocation = async () => {
        if (!window.hemosiDesktop?.selectDataDirectory || !window.hemosiDesktop?.setDataDirectory) return;
        const selected = await window.hemosiDesktop.selectDataDirectory();
        if (!selected) return;
        const res = await window.hemosiDesktop.setDataDirectory(selected);
        if (res.success) {
            message.success("数据目录已更改，重启应用后将自动把旧数据搬过去！");
            void refresh();
        } else {
            message.error(res.error || "更改失败");
        }
    };

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const indexedDbBytes = usage?.contentBytes ?? 0;
    const percent = usage?.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

    return (
        <div className="space-y-3">
            {/* 桌面端数据存放位置及更改 */}
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <FolderEdit className="size-4 text-amber-500" />
                            数据存放位置
                            {desktopPathInfo?.isPortable ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">便携模式 (HemosiData)</span> : null}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                            {desktopPathInfo ? (
                                <span className="font-mono text-stone-700 dark:text-stone-300">{desktopPathInfo.current}</span>
                            ) : (
                                "浏览器网页版数据存储于当前浏览器本地数据库（IndexedDB）。如需便携或存放到指定盘符，请使用桌面版并在程序旁建 HemosiData 文件夹。"
                            )}
                        </div>
                    </div>
                    {isDesktopApp() && (
                        <Button size="small" type="primary" onClick={() => void handleChangeLocation()}>
                            更改位置…
                        </Button>
                    )}
                </div>
                <div className="mt-2 text-[11px] text-stone-400">
                    选好文件夹后，重启时自动把旧数据搬过去；程序旁建 HemosiData 文件夹即自动进入便携模式。
                </div>
            </section>

            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />
                            {t("config.localStorage.title")}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">{t("config.localStorage.description")}</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        {t("config.localStorage.refresh")}
                    </Button>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message={t("config.localStorage.readFailed")} description={error} /> : null}
                {!usage && loading ? (
                    <div className="flex min-h-48 items-center justify-center"><Spin /></div>
                ) : usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.indexedDbUsage")} value={formatStorageBytes(indexedDbBytes)} hint={t("config.localStorage.contentEstimate")} />
                            <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.siteUsage")} value={formatStorageBytes(usage.usage)} hint={t("config.localStorage.siteUsageHint")} />
                            <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.quota")} value={formatStorageBytes(usage.quota)} hint={usage.quota ? t("config.localStorage.quotaHint") : t("config.localStorage.quotaUnavailable")} />
                        </div>
                        {usage.quota ? (
                            <div className="mt-4">
                                <div className="mb-1 flex justify-between text-xs text-stone-500">
                                    <span>{t("config.localStorage.quotaProgress")}</span>
                                    <span className="tabular-nums">{percent.toFixed(2)}%</span>
                                </div>
                                <Progress percent={percent} showInfo={false} />
                            </div>
                        ) : null}
                    </>
                ) : null}
            </section>
            {usage?.databases.map((database) => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{database.name} · v{database.version}</div>
                        </div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map((store) => (
                            <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{storeLabel(store.name, t)}</div>
                                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{store.name}</div>
                                </div>
                                <div className="text-right text-xs text-stone-500 tabular-nums">{t("config.localStorage.records", { count: store.records })}</div>
                                <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(store.bytes)}</div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number | null) {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
