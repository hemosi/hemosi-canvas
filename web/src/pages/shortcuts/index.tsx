import { CanvasShortcutsList } from "@/components/canvas/canvas-shortcuts-list";

export default function ShortcutsPage() {
    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto w-full max-w-4xl px-6 py-10">
                <header className="mb-8 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <p className="text-xs text-stone-500">画布</p>
                    <h1 className="mt-3 text-3xl font-semibold">快捷键清单</h1>
                    <p className="mt-2 text-sm text-stone-500">在画布里按 ? 也能随时打开。Mac 上 Ctrl 换成 ⌘。</p>
                </header>
                <CanvasShortcutsList />
            </div>
        </main>
    );
}
