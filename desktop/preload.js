// Exposes the desktop shell's built-in proxy to the web app (see web/src/lib/desktop-bridge.ts).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const arg = (name) => {
    const prefix = `--${name}=`;
    const found = process.argv.find((item) => item.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
};

contextBridge.exposeInMainWorld("hemosiDesktop", {
    platform: process.platform,
    version: arg("hemosi-version"),
    proxyUrl: arg("hemosi-proxy"),
    getDataPath: () => ipcRenderer.invoke("get-data-path"),
    selectDataDirectory: () => ipcRenderer.invoke("select-data-directory"),
    setDataDirectory: (targetDir) => ipcRenderer.invoke("set-data-directory", targetDir),
});
