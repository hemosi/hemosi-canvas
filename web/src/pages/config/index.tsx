import { Trans, useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("config.title")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("config.description")}</p>
                </div>
                <AppConfigPanel />
                <p className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-white/10">
                    <Trans i18nKey="config.about" components={{ link: <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noopener noreferrer" className="text-[var(--hemosi-accent)] hover:underline" /> }} />
                </p>
            </div>
        </main>
    );
}
