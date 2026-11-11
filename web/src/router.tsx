import { createBrowserRouter, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import TemplatesPage from "@/pages/templates";
import VideoPage from "@/pages/video";
import ShortcutsPage from "@/pages/shortcuts";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/projects/detail";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/templates", element: <TemplatesPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/shortcuts", element: <ShortcutsPage /> },
            { path: "/projects", element: <ProjectsPage /> },
            { path: "/projects/:id", element: <ProjectDetailPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
