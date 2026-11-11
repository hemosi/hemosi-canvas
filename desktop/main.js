// Hemosi desktop: an Electron window around the built web app, served from a local server that also forwards
// AI API requests (built-in proxy, no CORS, no separate canvas-proxy process).
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, shell } = require("electron");
const { createAppServer, listen, PROXY_PREFIX } = require("./server");

const PREFERRED_PORT = 23230;
app.setName("Hemosi");
if (process.platform === "win32") app.setAppUserModelId("io.github.hemosi.canvas");

let mainWindow = null;
let baseUrl = "";

function webRoot() {
    const packaged = path.join(process.resourcesPath || "", "web-dist");
    if (app.isPackaged && fs.existsSync(packaged)) return packaged;
    return path.join(__dirname, "..", "web", "dist");
}

function iconPath() {
    const file = path.join(__dirname, "icon.png");
    return fs.existsSync(file) ? file : undefined;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        title: "Hemosi",
        icon: iconPath(),
        backgroundColor: "#0f1012",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            additionalArguments: [`--hemosi-proxy=${baseUrl}${PROXY_PREFIX}`, `--hemosi-version=${app.getVersion()}`],
        },
    });
    mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
    // Links to other sites (docs, GitHub, provider consoles) open in the system browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(baseUrl)) return { action: "allow" };
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith(baseUrl)) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    void mainWindow.loadURL(`${baseUrl}/`);
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);
        const server = createAppServer({ root: webRoot(), log: (line) => console.log(`[proxy] ${line}`) });
        const port = await listen(server, PREFERRED_PORT);
        if (port !== PREFERRED_PORT) console.warn(`[hemosi] port ${PREFERRED_PORT} busy, using ${port}; data saved under the default port is not visible this session.`);
        baseUrl = `http://127.0.0.1:${port}`;
        createWindow();
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
        app.on("before-quit", () => server.close());
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
