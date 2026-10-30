import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssetContentRenderer } from '../src/content-renderer.js'

const h = (type, props, ...children) => ({ type, props: props ?? {}, children })
const renderer = createAssetContentRenderer(h)
function nodes(tree) {
  return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.children)] : []
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.children) : String(tree ?? '')

test('document steps become ordered lists with original numbering, emphasis and nested lists', () => {
  const tree = renderer.body('# 处理说明\n\n3. **读取** `input`\n   - 保留 0\n   - 保留 false\n7. 保存结果\n\n1.2 版本说明')
  const all = nodes(tree)
  assert.equal(all.filter(node => node.type === 'h3').length, 1)
  assert.equal(all.filter(node => node.type === 'h4').length, 0)
  assert.equal(all.find(node => node.type === 'ol').props.start, 3)
  assert.deepEqual(all.filter(node => node.type === 'li' && node.props.value != null).map(node => node.props.value), [3, 7])
  assert.equal(all.filter(node => node.type === 'ul').length, 1)
  assert.equal(text(all.find(node => node.type === 'strong')), '读取')
  assert.equal(text(all.find(node => node.type === 'code')), 'input')
  assert.ok(text(tree).includes('1.2 版本说明'))
})

test('tables keep escaped pipes, code pipes and extra cells in semantic table rows', () => {
  const tree = renderer.body('| 字段 | 内容 |\n| --- | --- |\n| **名称** | `a | b` |\n| a\\|b | 保留 | 额外字段 |')
  const all = nodes(tree)
  assert.equal(all.filter(node => node.type === 'table').length, 1)
  assert.equal(all.filter(node => node.type === 'th').length, 3)
  assert.equal(all.filter(node => node.type === 'td').length, 6)
  assert.ok(all.filter(node => node.type === 'th').every(node => node.props.scope === 'col'))
  for (const value of ['名称', 'a | b', 'a|b', '保留', '额外字段']) assert.ok(text(tree).includes(value), value)
})

test('fenced code and unsupported markup retain literal source without creating active HTML', () => {
  const code = 'if (a < b) return "**literal**";\n<script>alert(1)</script>'
  const source = `<img src=x onerror=alert(1)>\n\n[执行](javascript:alert(1))\n\n\`\`\`js\n${code}\n\`\`\``
  const tree = renderer.body(source)
  const all = nodes(tree)
  assert.equal(text(all.find(node => node.type === 'pre')), code)
  assert.ok(text(tree).includes('<img src=x onerror=alert(1)>'))
  assert.ok(text(tree).includes('[执行](javascript:alert(1))'))
  assert.ok(all.every(node => !['script', 'img', 'iframe', 'a'].includes(node.type)))
  assert.ok(all.every(node => !('dangerouslySetInnerHTML' in node.props)))
})

test('structured values preserve nested keys, zero, false, null, empty containers and full source references', () => {
  const input = [{ timeout_ms: 0, enabled: false, missing: null, empty_list: [], empty_object: {},
    source_references: [{ path: '设计.md', location: '第 2 节', quote: '原始引文不能丢' }] }]
  const snapshot = JSON.stringify(input)
  const tree = renderer.value(input)
  const all = nodes(tree)
  assert.equal(tree.type, 'ul')
  assert.ok(all.some(node => node.type === 'dl'))
  const output = text(tree)
  for (const value of ['timeout_ms', '0', 'enabled', 'false', 'missing', 'null', 'empty_list', '[]', 'empty_object', '{}', 'path', '设计.md', 'location', '第 2 节', 'quote', '原始引文不能丢']) assert.ok(output.includes(value), value)
  assert.equal(JSON.stringify(input), snapshot)
})

test('quoted material uses blockquotes and source identifiers retain literal underscores and backslashes', () => {
  const tree = renderer.body('> **材料说明**\n>\n> 1. 保留这条引文\n\n正文')
  assert.equal(nodes(tree).filter(node => node.type === 'blockquote').length, 1)
  assert.ok(nodes(tree).some(node => node.type === 'strong'))
  const path = 'C:\\code\\__foo__\\_private.md'
  const code = '__value__ = "<script>"'
  const fields = renderer.value({ path, code })
  assert.ok(text(fields).includes(path))
  assert.ok(text(fields).includes(code))
  assert.equal(nodes(fields).some(node => node.type === 'strong'), false)
})
