import { Tooltip } from "antd";
import { Feather } from "lucide-react";
import { useTranslation } from "react-i18next";

/** "草稿" switch shown on image/video generation nodes; when on, generation uses the cheapest parameters. */
export function CanvasDraftToggle({ checked, onChange, className = "" }: { checked: boolean; onChange: (checked: boolean) => void; className?: string }) {
    const { t } = useTranslation();
    return (
        <Tooltip title={t("hemosi.draft.tooltip")}>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition ${className}`}
                style={checked ? { borderColor: "var(--hemosi-accent)", color: "var(--hemosi-accent)", background: "var(--hemosi-accent-soft)" } : { borderColor: "rgba(127,127,127,.35)", opacity: 0.8 }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onChange(!checked)}
            >
                <Feather className="size-3.5" />
                <span>{t("hemosi.draft.label")}</span>
            </button>
        </Tooltip>
    );
}
