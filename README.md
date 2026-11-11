<p align="center">
  <img src="web/public/logo.svg" width="88" alt="Hemosi logo">
</p>

<h1 align="center">Hemosi</h1>

Hemosi 是一个本地优先的 AI 创作工作台：在无限画布上编排图片、文字、视频节点，配合生图 / 视频生成、提示词库和素材库，把一次次生成串成连续的创作流程。界面参考剪映桌面版的布局，默认深色主题。

数据默认保存在浏览器本地（IndexedDB / localStorage），模型接口在「模型配置」里填你自己的地址和密钥。

## 本地运行

```bash
cd web
bun install
bun dev
```

或者用 npm：

```bash
cd web
npm install --legacy-peer-deps
npm run dev
```

打开终端里显示的地址（默认 http://localhost:3000）即可。

构建静态文件：`cd web && bun run build`（或 `npm run build`），产物在 `web/dist`。

## Windows 桌面版

`desktop/` 是一个很薄的 Electron 外壳：窗口里跑的就是 `web/dist`，由本机 `127.0.0.1` 上的小服务器提供页面，同时内置了和 `canvas-proxy` 一样的转发代理（`/__proxy/<完整接口地址>`）。所以桌面版**不用再单独开代理、也不会被 CORS 拦**；第一次启动会自动把「设置 › 本地代理」填好并打开，之后想关可以自己关。

### 从 Actions 下载

1. 打开仓库的 [Actions › Desktop (Windows)](https://github.com/hemosi/hemosi-canvas/actions/workflows/desktop.yml)。每次改动 `web/` 或 `desktop/` 推到 main 都会自动构建，也可以点 **Run workflow** 手动跑。
2. 点进最新一次绿色（成功）的运行，页面底部 **Artifacts** 里下载 `Hemosi-windows-x64`（需要登录 GitHub）。
3. 解压后有两个文件：
   - `Hemosi-Setup-<版本>-x64.exe`：安装版，可选安装目录，装完有桌面快捷方式；
   - `Hemosi-<版本>-x64-portable.zip`：免安装版，解压后双击 `Hemosi.exe`。
4. 安装包没有代码签名，Windows 可能弹「已保护你的电脑」，点「更多信息 › 仍要运行」。

数据保存在桌面版自己的浏览器存储里（固定端口 23230 对应的本地页面），和你在浏览器里打开网页版的数据是分开的；需要搬数据可以用设置里的导出 / 导入。

### 本地构建

需要 Node 18+，在 Windows 上：

```bash
cd web
npm install --legacy-peer-deps --no-package-lock   # 不读旧 lock，Windows 原生依赖才装得上（或用 bun install）
npm run build

cd ../desktop
npm ci
npm start          # 直接运行，调试用
npm run dist:win   # 生成 desktop/release 下的安装包和免安装 zip
```

在 Linux / macOS 上打 Windows 包需要装 wine，建议直接用 Actions。`npm run check` 只做语法检查和内置服务器的自测。

## 来源与许可

基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT）修改。原项目版权声明见 [LICENSE](LICENSE)。
