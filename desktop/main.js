// Hemosi desktop: an Electron window around the built web app, served from a local server that also forwards
// AI API requests (built-in proxy, no CORS, no separate canvas-proxy process).
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const { createAppServer, listen, PROXY_PREFIX } = require("./server");

// 便携模式与自定义数据路径
function setupUserDataPath() {
    const exeDir = path.dirname(app.getPath("exe"));
    const portableDataDir = path.join(exeDir, "HemosiData");
    if (fs.existsSync(portableDataDir)) {
        app.setPath("userData", portableDataDir);
        return;
    }
    const customPathFile = path.join(app.getPath("userData"), "custom-data-path.txt");
    if (fs.existsSync(customPathFile)) {
        try {
            const customPath = fs.readFileSync(customPathFile, "utf-8").trim();
            if (customPath && fs.existsSync(customPath)) {
                app.setPath("userData", customPath);
            }
        } catch {}
    }
}
setupUserDataPath();

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
        ipcMain.handle("get-data-path", () => {
            const current = app.getPath("userData");
            const exeDir = path.dirname(app.getPath("exe"));
            const isPortable = current === path.join(exeDir, "HemosiData");
            return { current, isPortable };
        });

        ipcMain.handle("select-data-directory", async () => {
            const res = await dialog.showOpenDialog(mainWindow, {
                properties: ["openDirectory", "createDirectory"],
                title: "选择数据存放文件夹",
            });
            if (res.canceled || !res.filePaths[0]) return null;
            return res.filePaths[0];
        });

        ipcMain.handle("set-data-directory", async (_, targetDir) => {
            if (!targetDir || !fs.existsSync(targetDir)) return { success: false, error: "目录不存在" };
            const oldPath = app.getPath("userData");
            // 将迁移标记写入旧目录
            const customPathFile = path.join(oldPath, "custom-data-path.txt");
            fs.writeFileSync(customPathFile, targetDir, "utf-8");
            
            // 复制旧数据到新目录
            try {
                fs.cpSync(oldPath, targetDir, { recursive: true, force: false });
            } catch (err) {
                console.error("迁移旧数据失败:", err);
            }
            return { success: true, targetDir };
        });

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
