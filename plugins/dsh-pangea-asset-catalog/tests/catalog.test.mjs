import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import { discoverDataRoot, generateCatalog, saveOverride, scanAssets } from '../src/catalog.js'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-asset-catalog-'))
  const dataRoot = path.join(root, 'pangea-data')
  const inbox = path.join(dataRoot, 'inbox')
  const automation = path.join(dataRoot, 'test-automation', 'chap')
  await mkdir(inbox, { recursive: true })
  await mkdir(automation, { recursive: true })
  const requirementPath = path.join(inbox, 'lifecycle-requirements.md')
  const protocolPath = path.join(inbox, 'nvme-tcp-chap-spec.md')
  const automationPath = path.join(automation, 'run_case.py')
  await writeFile(requirementPath, '# Lifecycle Requirements\n\n- REQ-LIFE-001: `stop_session` 失败时保持 running。\n', 'utf8')
  await writeFile(protocolPath, '# NVMe/TCP CHAP 分析资料\n\n本资料仅作为协议语义和测试表达参考，最终行为以当前源码为准。\n\n- 生命周期关注重认证、断开和清理。\n- 测试步骤使用黑盒语义。\n', 'utf8')
  await writeFile(automationPath, [
    'import argparse',
    'import os',
    'def setup_environment(): pass',
    'def cleanup(): pass',
    'def main():',
    '    parser = argparse.ArgumentParser()',
    '    parser.add_argument("--target")',
    '    token = os.getenv("ARRAY_TOKEN")',
    '    assert token',
    'if __name__ == "__main__": main()',
  ].join('\n'), 'utf8')
  return { root, dataRoot, requirementPath, protocolPath, automationPath }
}

async function documentFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-document-normalize-'))
  const dataRoot = path.join(root, 'pangea-data')
  const inbox = path.join(dataRoot, 'inbox')
  await mkdir(inbox, { recursive: true })

  const docxPath = path.join(inbox, 'historical-incident.docx')
  const word = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Historical Incident Report', heading: HeadingLevel.HEADING_1 }),
    new Paragraph('Trigger: reconnect while cleanup is still running.'),
    new Table({ rows: [
      new TableRow({ children: [new TableCell({ children: [new Paragraph('Field')] }), new TableCell({ children: [new Paragraph('Value')] })] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph('Root cause')] }), new TableCell({ children: [new Paragraph('shared callback state')] })] }),
    ] }),
  ] }] })
  await writeFile(docxPath, await Packer.toBuffer(word))

  const pdfPath = path.join(inbox, 'historical-report.pdf')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const firstPage = pdf.addPage([595, 842])
  firstPage.drawText('Historical incident: timeout cleanup failed', { x: 50, y: 780, size: 12, font })
  const secondPage = pdf.addPage([595, 842])
  secondPage.drawText('Regression check: verify recovery state', { x: 50, y: 780, size: 12, font })
  await writeFile(pdfPath, await pdf.save())

  const xlsxPath = path.join(inbox, 'historical-issues.xlsx')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Issues')
  sheet.addRow(['Issue ID', 'Symptom', 'Count'])
  sheet.addRow(['BUG-101', 'State leaked to peer instance', 2])
  sheet.getCell('C3').value = { formula: '1+2', result: 3 }
  sheet.getCell('A3').value = 'BUG-102'
  sheet.getCell('B3').value = 'Cleanup timed out'
  await workbook.xlsx.writeFile(xlsxPath)

  return { root, dataRoot, docxPath, pdfPath, xlsxPath }
}

test('scans inbox and test automation into non-binding suggested roles', async () => {
  const value = await fixture()
  const snapshot = await scanAssets({ dataRoot: value.dataRoot })
  assert.equal(snapshot.status, 'ok')
  assert.equal(snapshot.counts.materials, 2)
  assert.equal(snapshot.counts.automations, 1)
  assert.equal(snapshot.generated_files_are_non_binding, true)

  const requirement = snapshot.assets.find(asset => asset.source_path.endsWith('lifecycle-requirements.md'))
  assert.equal(requirement.kind, 'requirement')
  assert.ok(requirement.suggested_roles.includes('input_candidate'))
  assert.deepEqual(requirement.requirement_ids, ['REQ-LIFE-001'])
  assert.deepEqual(requirement.applicability_hints.symbols, ['stop_session'])

  const protocol = snapshot.assets.find(asset => asset.source_path.endsWith('nvme-tcp-chap-spec.md'))
  assert.ok(protocol.suggested_roles.includes('semantic_reference'))
  assert.ok(protocol.suggested_roles.includes('example_reference'))
  assert.ok(protocol.suggested_roles.includes('methodology_candidate'))
  assert.equal(protocol.declared_restrictions.length, 1)
  assert.equal(protocol.methodology_points.length, 1)

  const automation = snapshot.assets.find(asset => asset.source_group === 'test-automation')
  assert.deepEqual(automation.suggested_roles, ['automation_capability'])
  assert.equal(automation.entrypoint_candidate, true)
  assert.deepEqual(automation.parameters, ['--target'])
  assert.deepEqual(automation.environment_variables, ['ARRAY_TOKEN'])
  assert.ok(automation.phase_locations.setup.length > 0)
  assert.ok(automation.phase_locations.assertions.length > 0)
  assert.ok(automation.phase_locations.cleanup.length > 0)
})

test('generates stable JSON outputs without modifying source assets', async () => {
  const value = await fixture()
  const before = new Map()
  for (const source of [value.requirementPath, value.protocolPath, value.automationPath]) {
    const info = await stat(source)
    before.set(source, { content: await readFile(source, 'utf8'), modified: info.mtimeMs })
  }

  const snapshot = await generateCatalog({ dataRoot: value.dataRoot })
  const outputRoot = path.join(value.dataRoot, 'asset-catalog')
  const catalog = JSON.parse(await readFile(path.join(outputRoot, 'catalog.json'), 'utf8'))
  const methods = JSON.parse(await readFile(path.join(outputRoot, 'methodology-candidates.json'), 'utf8'))
  const capabilities = JSON.parse(await readFile(path.join(outputRoot, 'automation-capabilities.json'), 'utf8'))
  const diagnostics = JSON.parse(await readFile(path.join(outputRoot, 'diagnostics.json'), 'utf8'))
  assert.equal(catalog.generator, 'dsh-pangea-asset-catalog')
  assert.equal(catalog.generated_files_are_non_binding, true)
  assert.equal(catalog.assets.length, 3)
  assert.equal(methods.non_binding, true)
  assert.equal(methods.candidates.length, 1)
  assert.equal(methods.candidates[0].candidate_rules.length, 1)
  assert.equal(capabilities.non_binding, true)
  assert.equal(capabilities.capabilities.length, 1)
  assert.ok(Array.isArray(diagnostics.diagnostics))
  assert.equal(snapshot.output_root, outputRoot)

  for (const [source, expected] of before) {
    const info = await stat(source)
    assert.equal(await readFile(source, 'utf8'), expected.content)
    assert.equal(info.mtimeMs, expected.modified)
  }
})

test('normalizes DOCX PDF and XLSX into auditable Markdown without changing sources', async () => {
  const value = await documentFixture()
  const sourceBytes = new Map()
  for (const source of [value.docxPath, value.pdfPath, value.xlsxPath]) sourceBytes.set(source, await readFile(source))

  const preview = await scanAssets({ dataRoot: value.dataRoot })
  assert.equal(preview.counts.materials, 3)
  assert.equal(preview.counts.normalizable_documents, 3)
  assert.equal(preview.counts.normalized_documents, 3)
  assert.equal(preview.counts.normalization_failures, 0)
  assert.equal(preview.assets.some(asset => '_normalized_markdown' in asset), false)
  for (const asset of preview.assets) {
    assert.ok(['converted', 'converted_with_warnings'].includes(asset.normalization.status))
    assert.match(asset.normalization.markdown_path, /^asset-catalog\/normalized\/.+\.md$/)
  }

  await generateCatalog({ dataRoot: value.dataRoot })
  const outputRoot = path.join(value.dataRoot, 'asset-catalog')
  const assets = preview.assets
  const docxAsset = assets.find(asset => asset.file_type === 'docx')
  const pdfAsset = assets.find(asset => asset.file_type === 'pdf')
  const xlsxAsset = assets.find(asset => asset.file_type === 'xlsx')
  const docxMarkdown = await readFile(path.join(value.dataRoot, docxAsset.normalization.markdown_path), 'utf8')
  const pdfMarkdown = await readFile(path.join(value.dataRoot, pdfAsset.normalization.markdown_path), 'utf8')
  const xlsxMarkdown = await readFile(path.join(value.dataRoot, xlsxAsset.normalization.markdown_path), 'utf8')
  assert.match(docxMarkdown, /# Historical Incident Report/)
  assert.match(docxMarkdown, /\| Field \| Value \|/)
  assert.match(docxMarkdown, /#block=1/)
  assert.match(pdfMarkdown, /## Page 1/)
  assert.match(pdfMarkdown, /#page=2/)
  assert.match(pdfMarkdown, /Regression check: verify recovery state/)
  assert.match(xlsxMarkdown, /## Sheet: Issues/)
  assert.match(xlsxMarkdown, /Used range: `A1:C3`/)
  assert.match(xlsxMarkdown, /BUG-101/)
  assert.match(xlsxMarkdown, /formula: `=1\+2`/)
  const materialRecord = JSON.parse(await readFile(path.join(outputRoot, 'materials', `${docxAsset.asset_id}.json`), 'utf8'))
  assert.equal('_normalized_markdown' in materialRecord, false)
  assert.equal(materialRecord.normalization.location_scheme, 'normalized_block')

  for (const [source, expected] of sourceBytes) assert.deepEqual(await readFile(source), expected)
})

test('manual override changes only generated metadata and is retained on regeneration', async () => {
  const value = await fixture()
  const initial = await scanAssets({ dataRoot: value.dataRoot })
  const target = initial.assets.find(asset => asset.source_path.endsWith('lifecycle-requirements.md'))
  const original = await readFile(value.requirementPath, 'utf8')
  const updated = await saveOverride({
    dataRoot: value.dataRoot,
    assetId: target.asset_id,
    suggestedRoles: ['semantic_reference'],
    kind: 'requirement',
  })
  const overridden = updated.assets.find(asset => asset.asset_id === target.asset_id)
  assert.deepEqual(overridden.suggested_roles, ['semantic_reference'])
  assert.equal(overridden.suggestion_source, 'user_override')
  assert.equal(await readFile(value.requirementPath, 'utf8'), original)

  const rescanned = await scanAssets({ dataRoot: value.dataRoot })
  assert.deepEqual(rescanned.assets.find(asset => asset.asset_id === target.asset_id).suggested_roles, ['semantic_reference'])
})

test('discovers pangea-data upward and reports invalid documents honestly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-asset-discovery-'))
  const dataRoot = path.join(root, 'pangea-data')
  const nested = path.join(root, 'workspace', 'nested')
  await mkdir(path.join(dataRoot, 'inbox'), { recursive: true })
  await mkdir(nested, { recursive: true })
  await writeFile(path.join(dataRoot, 'inbox', 'design.docx'), Buffer.from([0, 1, 2, 3]))
  assert.equal(await discoverDataRoot(root), dataRoot)

  const snapshot = await scanAssets({ cwd: root })
  assert.equal(snapshot.counts.materials, 1)
  assert.equal(snapshot.assets[0].parse_status, 'conversion_failed')
  assert.equal(snapshot.assets[0].normalization.status, 'failed')
  assert.ok(snapshot.diagnostics.some(item => item.kind === 'content_not_parsed' && item.error_code === 'conversion_failed'))
  assert.ok(snapshot.diagnostics.some(item => item.kind === 'missing_input_directory' && item.path === 'test-automation'))
})
