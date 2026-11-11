import { CANVAS_SHORTCUTS, shortcutKeyLabel } from "@/lib/canvas/canvas-shortcuts";

/** The shortcut sheet, shared by the /shortcuts page and the in-canvas modal. */
export function CanvasShortcutsList() {
    return (
        <div className="grid gap-6 sm:grid-cols-2">
            {CANVAS_SHORTCUTS.map((group) => (
                <section key={group.group}>
                    <h3 className="mb-2 text-sm font-semibold">{group.group}</h3>
                    <div className="space-y-1.5">
                        {group.items.map((item) => (
                            <div key={item.action + item.keys.join()} className="flex items-center justify-between gap-3 text-sm">
                                <span className="opacity-80">{item.action}</span>
                                <span className="flex shrink-0 gap-1">
                                    {item.keys.map((key) => (
                                        <kbd key={key} className="rounded-md border border-current/20 px-1.5 py-0.5 font-mono text-xs opacity-80">
                                            {shortcutKeyLabel(key)}
                                        </kbd>
                                    ))}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
