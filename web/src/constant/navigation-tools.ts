import { Clapperboard, FolderKanban, House, Keyboard, Library, ImagePlus, Images, LayoutTemplate, ScrollText, Settings2, Video, type LucideIcon } from "lucide-react";

export type NavigationToolSlug = "home" | "projects" | "shortcuts" | "canvas" | "storyboard" | "image" | "video" | "assets" | "prompts" | "templates" | "config";

export type NavigationTool = {
    slug: NavigationToolSlug;
    path: string;
    icon: LucideIcon;
};

// Sidebar main group, in display order.
export const navigationTools: NavigationTool[] = [
    { slug: "home", path: "/", icon: House },
    { slug: "projects", path: "/projects", icon: Library },
    { slug: "canvas", path: "/canvas", icon: FolderKanban },
    { slug: "storyboard", path: "/storyboard", icon: Clapperboard },
    { slug: "image", path: "/image", icon: ImagePlus },
    { slug: "video", path: "/video", icon: Video },
    { slug: "assets", path: "/assets", icon: Images },
    { slug: "prompts", path: "/prompts", icon: ScrollText },
    { slug: "templates", path: "/templates", icon: LayoutTemplate },
];

// Sidebar bottom group.
export const navigationBottomTools: NavigationTool[] = [
    { slug: "shortcuts", path: "/shortcuts", icon: Keyboard },
    { slug: "config", path: "/config", icon: Settings2 },
];

export function getActiveToolSlug(pathname: string): NavigationToolSlug | undefined {
    if (pathname === "/") return "home";
    const slug = pathname.split("/").filter(Boolean)[0];
    return [...navigationTools, ...navigationBottomTools].find((tool) => tool.slug === slug)?.slug;
}
