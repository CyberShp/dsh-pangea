# dsh-pangea

PANGEA 在 DSH 中的工作台基座。它依赖 `dsh-better-sidebar`，只向侧边栏注册一个
单实例 `PANGEA` Tab，然后通过浏览器侧的 `ctx.pangea` 服务接收功能页面。

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
稳定排列。每个 DSH 会话分别记住当前页面，一个页面渲染失败不会影响其他页面。

服务还提供：

- `openPage(scope, pageId)`：打开 PANGEA Tab 并切到指定功能页。
- `openFile(scope, path, title)`：通过 Better Sidebar 的编辑器打开文件。
- `getPages()`：读取当前已注册页面。
- `subscribe(listener)`：监听页面注册、注销与当前页变化。

## 验证

```bash
npm test
```
