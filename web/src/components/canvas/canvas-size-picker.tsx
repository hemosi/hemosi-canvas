import { useEffect, useRef, useState } from "react";
import { Select } from "antd";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

const sizeOptions = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];

type CanvasSizePickerProps = {
    value: string;
    className?: string;
    onChange: (value: string) => void;
};

export function CanvasSizePicker({ value, className, onChange }: CanvasSizePickerProps) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [customWidth, setCustomWidth] = useState("1024");
    const [customHeight, setCustomHeight] = useState("1024");
    const normalizedSearch = search.trim().replace(/[×*xX\s]+/g, "x");
    const extraOptions = [value, normalizedSearch].filter((item) => item && !sizeOptions.includes(item));
    const options = [...sizeOptions, ...Array.from(new Set(extraOptions))].map((size) => ({ value: size, label: size === "auto" ? t("settingsPanels.common.auto") : size }));
    const selectSize = (next: string) => {
        onChange(next.trim().replace(/[×*X\s]+/g, "x"));
        setSearch("");
        setOpen(false);
    };
    const applyCustomSize = () => {
        const w = Math.max(64, Math.min(8192, Math.floor(Number(customWidth) || 1024)));
        const h = Math.max(64, Math.min(8192, Math.floor(Number(customHeight) || 1024)));
        selectSize(`${w}x${h}`);
    };

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target && (rootRef.current?.contains(target) || target.closest(".ant-select-dropdown"))) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", close, true);
        return () => window.removeEventListener("pointerdown", close, true);
    }, [open]);

    return (
        <div ref={rootRef} className={className}>
            <Select
                showSearch
                open={open}
                className={cn("canvas-compact-control canvas-control-select h-full w-full")}
                value={value || undefined}
                searchValue={search}
                placeholder={t("canvas.controls.ratio")}
                options={options}
                popupMatchSelectWidth={false}
                popupRender={(menu) => (
                    <div onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        {menu}
                        <div className="mt-1 flex items-center gap-1 border-t border-white/10 px-2 pt-2 pb-1 text-xs">
                            <input
                                type="number"
                                min={64}
                                max={8192}
                                value={customWidth}
                                placeholder="宽"
                                className="w-14 rounded border border-white/15 bg-transparent px-1.5 py-0.5 text-center text-xs outline-none"
                                onChange={(e) => setCustomWidth(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && applyCustomSize()}
                            />
                            <span className="opacity-50">×</span>
                            <input
                                type="number"
                                min={64}
                                max={8192}
                                value={customHeight}
                                placeholder="高"
                                className="w-14 rounded border border-white/15 bg-transparent px-1.5 py-0.5 text-center text-xs outline-none"
                                onChange={(e) => setCustomHeight(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && applyCustomSize()}
                            />
                            <button
                                type="button"
                                className="ml-auto cursor-pointer rounded bg-[#00d0c4]/20 px-2 py-0.5 text-[11px] font-medium text-[#00d0c4] hover:bg-[#00d0c4]/30"
                                onClick={applyCustomSize}
                            >
                                自由尺寸
                            </button>
                        </div>
                    </div>
                )}
                onOpenChange={setOpen}
                onSearch={setSearch}
                onChange={selectSize}
                onBlur={() => {
                    if (search.trim()) selectSize(search);
                }}
                onInputKeyDown={(event) => {
                    if (event.key === "Enter" && search.trim()) selectSize(search);
                }}
            />
        </div>
    );
}
