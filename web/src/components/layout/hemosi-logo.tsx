import { cn } from "@/lib/utils";

// Hemosi mark: letter H in a rounded square, single accent color.
export function HemosiLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden="true">
            <rect x="2" y="2" width="60" height="60" rx="16" fill="var(--hemosi-accent, #00c8c8)" />
            <path d="M20 16h7v13.5h10V16h7v32h-7V35.5H27V48h-7z" fill="#0f1012" />
        </svg>
    );
}
