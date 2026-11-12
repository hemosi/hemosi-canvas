import { cn } from "@/lib/utils";

// HemosiTV mark: 180-degree center-symmetric sharp slash H in emerald cyan.
export function HemosiLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden="true">
            <defs>
                <linearGradient id="hemositv-logo-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#2ef5e8" />
                    <stop offset="55%" stopColor="#00d0c4" />
                    <stop offset="100%" stopColor="#009e95" />
                </linearGradient>
            </defs>
            <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#hemositv-logo-bg)" />
            <path
                d="M16 18 C16 16.34 17.34 15 19 15 H22.5 C24.16 15 25.5 16.34 25.5 18 V27.5 H32.5 L29.5 36.5 H25.5 V46 C25.5 47.66 24.16 49 22.5 49 H19 C17.34 49 16 47.66 16 46 Z"
                fill="#081212"
            />
            <path
                d="M38.5 18 C38.5 16.34 39.84 15 41.5 15 H45 C46.66 15 48 16.34 48 18 V46 C48 47.66 46.66 49 45 49 H41.5 C39.84 49 38.5 47.66 38.5 46 V36.5 H31.5 L34.5 27.5 H38.5 Z"
                fill="#081212"
            />
        </svg>
    );
}
