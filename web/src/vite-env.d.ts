/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Docs link (topbar / canvas menu); defaults to the repo README.
    readonly VITE_DOC_URL?: string;
    // Plugin registry JSON for the plugin manager's official list.
    readonly VITE_PLUGIN_REGISTRY_URL?: string;
}
