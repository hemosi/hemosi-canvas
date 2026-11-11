import { useConfigStore } from "@/stores/use-config-store";

declare global {
    interface Window {
        /** Set by the Electron preload (desktop/preload.js) when running inside the Hemosi desktop app. */
        hemosiDesktop?: { platform: string; version: string; proxyUrl: string };
    }
}

const DESKTOP_PROXY_KEY = "hemosi:desktop-proxy-url";

/**
 * Desktop app: point the local-proxy setting at the built-in proxy on first launch, so AI requests work without CORS
 * and without running canvas-proxy. Later launches only follow a changed proxy address and keep the user's on/off choice.
 */
export function applyDesktopProxyDefaults() {
    const proxyUrl = typeof window !== "undefined" ? window.hemosiDesktop?.proxyUrl : "";
    if (!proxyUrl) return;
    const previous = localStorage.getItem(DESKTOP_PROXY_KEY);
    const { config, updateConfig } = useConfigStore.getState();
    if (previous === null) {
        updateConfig("proxyUrl", proxyUrl);
        updateConfig("proxyEnabled", true);
    } else if (previous !== proxyUrl && config.proxyUrl === previous) {
        updateConfig("proxyUrl", proxyUrl);
    }
    localStorage.setItem(DESKTOP_PROXY_KEY, proxyUrl);
}

export const isDesktopApp = () => typeof window !== "undefined" && Boolean(window.hemosiDesktop);
