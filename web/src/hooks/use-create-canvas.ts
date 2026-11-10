import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

// Create a new canvas project and open it (same naming as the canvas library page).
export function useCreateCanvas() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);

    const createCanvas = useCallback(() => {
        const count = useCanvasStore.getState().projects.length + 1;
        const id = createProject(t("canvas.defaultTitle", { count }));
        navigate(`/canvas/${id}`);
    }, [createProject, navigate, t]);

    return { createCanvas, ready: hydrated };
}
