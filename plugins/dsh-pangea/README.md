# dsh-pangea

PANGEA 在 DSH 中的侧边栏基座。用户只安装这个包；它自动带上固定版本的
`dsh-better-sidebar`、Companion 和 Asset Catalog，并通过浏览器侧的 `ctx.pangea`
服务把“分析”“执行”“资产”注册成原生单实例页签。

基座使用 Better Sidebar 的公开注册接口做适配，不复制其源代码。`+` 菜单固定为
`分析 / 执行 / 资产 / 文件 / 任务管理 / 浏览器`。源码管理被移除；终端只从右上角
按钮展开到底部面板，不出现在 `+` 菜单中。

基座不读取 PANGEA Run，不扫描资产，不执行测试，也不改变 `pangea-agent` 的代码、
Graph 或决策。

## 页面注册 API

```js
const dispose = ctx.pangea.registerPage({
  id: 'my-feature',
  title: '我的功能',
  order: 50,
  component: props => React.createElement(MyPage, props),
  available: (ctx, scope) => Boolean(scope?.cwd),
  badge: () => 3,
})
```

`registerPage()` 返回注销函数；重复页面 ID 会直接报错。页面会按 `order` 和注册顺序
稳定排列，并分别作为 Better Sidebar 原生页签打开。

服务还提供：

- `openPage(scope, pageId)`：打开指定原生功能页签。
- `openFile(scope, path, title)`：通过 Better Sidebar 的编辑器打开文件。
- `getPages()`：读取当前已注册页面。
- `subscribe(listener)`：监听页面注册与注销。

## 验证

```bash
npm test
```
