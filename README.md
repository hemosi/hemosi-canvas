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

## 来源与许可

基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT）修改。原项目版权声明见 [LICENSE](LICENSE)。
