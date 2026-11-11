export const APP_VERSION = __APP_VERSION__ || "dev";

// Docs button target; override with VITE_DOC_URL.
export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://github.com/hemosi/hemosi-canvas#readme";

// Plugin registry URL for the plugin manager's official list; override with VITE_PLUGIN_REGISTRY_URL.
// Hemosi has no registry of its own yet, so the default still points at the upstream basketikun/infinite-canvas plugins-dist build.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
