# dsh-mass-effect-theme

一套非官方、原创制作的 DSH Web 沉浸式太空舰桥主题。视觉方向来自《质量效应》的诺曼底舰桥氛围，但不包含游戏截图或原始美术资源。

## 视觉

- 深黑蓝舰桥和全景星图背景。
- 冷蓝色信息与选中状态。
- N7 风格红色关键操作和警告色。
- 半透明装甲面板，保留代码、日志和长对话可读性。
- 舰桥指挥状态栏，会根据实际运行中的工具状态显示 `ACTIVE` 或 `STANDBY`。
- 战术模块风格的思考、工具调用和终端输出，以及独立的指挥输入控制台。
- 小屏隐藏角标并调整背景焦点。
- 鼠标移动时背景会产生不超过约 4px 的轻微视差，不追随光斑，也不影响界面操作。
- 遵循系统的“减少动态效果”偏好。

## 安装

先克隆仓库并进入项目目录：

```bash
git clone https://github.com/CyberShp/dsh-pangea.git
cd dsh-pangea
```

从仓库根目录安装主题插件：

```bash
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-mass-effect-theme"
```

然后重启 DSH Web：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

首次加载会应用 `Normandy Command`。之后可以从两个地方切换：

- `设置 → Normandy / 诺曼底`：启用舰桥主题，或一键回到 DSH 默认外观。
- `设置 → 通用设置 → 外观`：正常选择浅色、深色或跟随系统；选择后舰桥背景、HUD 和装饰会退出，不会被插件强制切回。

选择会保存在当前浏览器。卸载插件并重启也会恢复 DSH 官方外观：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-mass-effect-theme
```

## 更新

插件以本地链接方式安装。进入仓库执行更新，然后重启 DSH Web 即可使用新版本：

```bash
git pull
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

## 开发

背景图位于 `assets/normandy-command.jpg`，构建时会嵌入浏览器 bundle，因此主题离线可用。生成图的最终提示词保存在 `assets/PROMPT.md`。

```bash
npm test
```

本插件是同人主题，与 BioWare、Electronic Arts 或《质量效应》官方无关。
