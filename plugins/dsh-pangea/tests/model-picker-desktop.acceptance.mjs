/**
 * Run in the real Desktop renderer via Playwright run-code, after opening
 * discovery for an unsaved provider backed by a local three-model fixture.
 * Both the Desktop model view and the shipped PANGEA plugin CSS must be loaded.
 * The caller chooses the screenshot directory; no profile/config writes occur.
 */
export default async function modelPickerAcceptance(page, screenshots) {
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const dialog = page.getByRole('dialog', { name: '选择接口模型', exact: true })
  const toggle = dialog.locator('.pangea-model-candidate-select-all')
  const boxes = dialog.getByRole('checkbox')
  const search = dialog.getByRole('searchbox')
  const results = []
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 1000 })
    assert(await dialog.isVisible(), 'Real model picker must be open')
    assert(await boxes.count() === 3, 'Expected three real fixture candidates')
    assert(await boxes.evaluateAll(nodes => nodes.every(n => !n.checked)), 'Start unselected')
    assert(await toggle.isVisible(), 'Combined Desktop/plugin CSS hides select-all')
    const layout = await toggle.evaluate(el => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { display: getComputedStyle(el).display, width: rect.width, height: rect.height,
        clickable: hit === el || el.contains(hit), inside: rect.left >= 0 && rect.right <= innerWidth }
    })
    assert(layout.width > 0 && layout.height > 0 && layout.clickable && layout.inside,
      'Select-all must occupy visible, unobstructed space within the viewport')
    assert((await toggle.innerText()).trim() === '全选', 'Initial localized label')
    await boxes.first().check()
    assert((await toggle.innerText()).trim() === '全选', 'Partial selection still offers select-all')
    await toggle.click()
    assert(await boxes.evaluateAll(nodes => nodes.every(n => n.checked)), 'Select-all must check every candidate')
    assert((await toggle.innerText()).trim() === '取消全选', 'Selected localized label')
    assert(await dialog.getByText('已选 3 个', { exact: true }).isVisible(), 'Selected count must update')
    if (screenshots) await page.screenshot({ path: `${screenshots}/selected-${width}.png` })
    await toggle.focus()
    await page.keyboard.press('Enter')
    assert(await boxes.evaluateAll(nodes => nodes.every(n => !n.checked)), 'Keyboard deselect-all must clear candidates')
    assert((await toggle.innerText()).trim() === '全选', 'Reset localized label')
    assert(await dialog.getByText('已选 0 个', { exact: true }).isVisible(), 'Cleared count must update')
    if (screenshots) await page.screenshot({ path: `${screenshots}/cleared-${width}.png` })
    // Search changes presentation, not the native all-candidates selection scope.
    await search.fill('acceptance-vision')
    assert(await boxes.count() === 1, 'Search should narrow visible rows')
    await toggle.click()
    await search.fill('')
    assert(await boxes.evaluateAll(nodes => nodes.every(n => n.checked)), 'Native select-all scope remains all candidates')
    await toggle.click()
    assert(await boxes.evaluateAll(nodes => nodes.every(n => !n.checked)), 'Leave the unsaved picker clean')
    results.push({ width, layout, partialToAll: true, keyboardClear: true, filteredSelection: true })
  }
  return results
}
