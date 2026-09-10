# Archify SVG 导出包含未转义的样式文本

发现时间：2026-09-09（UTC+8）；报告人：Codex，Windows 成品验收。

## 复现与证据

在 Desktop `093b63b`、Companion `e7a4708` 的独立 Dev 解包目录运行
`scripts/verify-flow-runtime.mjs`，使用 vendored Archify 的 web-app 示例并设置中文标题。
HTML 成功渲染，但导出的 SVG 经内嵌 Python ElementTree 读取报错：
`ParseError: not well-formed (invalid token): line 62, column 12`。
该行是字体许可证的 `PERMISSION & CONDITIONS`。

## 根因与修复

`architecture-render.mjs` 从 HTML 取出样式后直接嵌入 XML `<style>`，未转义文本中的 XML 保留字符。
只对嵌入样式中的 `&`、`<`、`>` 做 XML 文本转义，保留 HTML、字体许可和图形内容。
不更改 Archify 原始代码或语义校验。

## 调查与验收

先由真实成品解析失败定位，再读取出错行及导出器。诊断范围限定单次离线渲染，命令超时 120 秒；没有读取真实报告、修改主 Run 或操作用户安装。

修复前成品检查失败；修复后相同检查通过，包内 Python 3.12.10、Node 24.9.0 实际生成中文 HTML 和可解析的 SVG。
同时验证失败的新图保留上一张成功图，主 Run 的投影与状态不变。
新增 `architecture-render.test.mjs` 覆盖字体许可、CSS 中的 XML 保留字符以及中文图形文本；Companion 全套 156 项通过。

证据在 Desktop 隔离工作区：`flow-runtime-01.log`、`flow-runtime-02.log`、`.pangea-build/flow-runtime-02/`。
