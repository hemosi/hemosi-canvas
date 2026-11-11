import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { CanvasTemplateList } from "@/components/canvas/canvas-templates";
import type { CanvasTemplate } from "@/lib/canvas/canvas-templates";
import { templateName } from "@/lib/canvas/canvas-templates";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/canvas/use-workspace-store";

export default function TemplatesPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const createProject = useCanvasStore((state) => state.createProject);

    // Insert from the library opens a new canvas; the canvas page inserts the template once it has loaded.
    const insertToNewCanvas = (template: CanvasTemplate) => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
        navigate(`/canvas/${id}?template=${encodeURIComponent(template.id)}`);
    };

    // Clone: a new project container with one canvas built from the template.
    const cloneToNewProject = (template: CanvasTemplate) => {
        const wsId = useWorkspaceStore.getState().createWorkspace(templateName(template));
        const id = createProject(`${templateName(template)} · 第 1 张`, wsId);
        navigate(`/canvas/${id}?template=${encodeURIComponent(template.id)}`);
    };

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-800 dark:text-stone-100">
            <div className="mx-auto max-w-5xl px-6 py-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("hemosi.templates.pageTitle")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("hemosi.templates.pageDescription")}</p>
                </div>
                <CanvasTemplateList insertLabel={t("hemosi.templates.insertToNewCanvas")} onInsert={insertToNewCanvas} onClone={cloneToNewProject} />
            </div>
        </main>
    );
}
