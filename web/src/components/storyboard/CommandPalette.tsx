import React, { useEffect, useState } from 'react';
import { Command } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  items: CommandItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ items }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[16vh]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-stone-300/70 bg-[#fbfaf7] text-stone-900 shadow-2xl dark:border-stone-700 dark:bg-[#1c1a17] dark:text-stone-100"
      >
        <div className="flex items-center gap-2 border-b border-stone-300/60 px-3 py-2.5 dark:border-stone-800">
          <Command className="h-4 w-4 text-stone-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令..."
            className="flex-1 bg-transparent text-[12.5px] outline-none"
          />
          <span className="text-[10.5px] text-stone-400">ESC</span>
        </div>

        <div className="max-h-64 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-[11.5px] text-stone-400">
              无匹配命令
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  item.run();
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span>{item.label}</span>
                {item.hint && (
                  <span className="text-[10.5px] text-stone-400">{item.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
