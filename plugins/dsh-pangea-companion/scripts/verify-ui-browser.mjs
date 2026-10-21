// Real Chromium verification of shipped React components with isolated fixtures.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1] }
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.resolve(option('--desktop', path.join(cwd, '../../../pangea-desktop')))
const agent = path.resolve(option('--agent', path.join(desktop, '../pangea-agent')))
const output = path.resolve(option('--output', path.join(desktop, '.pangea-build/uiux-verification')))
const require = createRequire(path.join(desktop, 'package.json'))
const { chromium } = require(option('--playwright', 'playwright'))
const adapter = option('--chromium-adapter')
const args = adapter ? (await import(pathToFileURL(adapter))).default.args : []
const server = spawn(process.execPath, ['scripts/preview-ui.mjs', '--desktop', desktop, '--agent', agent, ...(option('--tools') ? ['--tools', option('--tools')] : []), ...(option('--python') ? ['--python', option('--python')] : [])], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
let browser, stderr = ''
server.stderr.on('data', chunk => { stderr += chunk })
try {
  const url = await new Promise((resolve, reject) => { let data = ''; server.stdout.on('data', chunk => { data += chunk; for (const line of data.split('\n')) { try { const value = JSON.parse(line); if (value.url) resolve(value.url) } catch {} } }); server.on('exit', code => reject(new Error(`server exited ${code}: ${stderr}`))); setTimeout(() => reject(new Error('preview server did not start')), 15000).unref() })
  browser = await chromium.launch({ headless: true, args, ...(option('--executable') ? { executablePath: option('--executable') } : {}), env: { ...process.env, ...(option('--ldpath') ? { LD_LIBRARY_PATH: option('--ldpath') } : {}) } })
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } })
  const errors=[];page.on('pageerror', error => {errors.push(error.stack || error.message);console.log('PAGEERROR', error.message)})
  page.on('console', item => { if (item.type() === 'error') console.log('CONSOLE', item.text().slice(0, 250)) })

  const out=output;await mkdir(out,{recursive:true})
  let active='start';const checks=[]
  const snap=async name=>{active=name;await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${out}/${name}.png`});checks.push(name);console.log('PASS',name)}
  const ready=async()=>{await page.locator('#app h1').first().waitFor();await page.waitForTimeout(180)}
  const scene=async(value,count=40)=>{await page.request.get(`${url}/fixture?scene=${value}&count=${count}`);await page.goto(url);await ready();await page.locator('.b03-overview-status').waitFor();await page.waitForTimeout(750)}
  const tab=name=>page.getByRole('navigation',{name:'PANGEA 分析页面'}).getByRole('button',{name})
  const cases=async()=>{await tab(/^测试用例/).click();await page.locator('.b05-case-table').waitFor()}
  try {
    await scene('complete');assert.equal(await page.locator('#app h1').count(),1)
    assert.match(await page.locator('.b03-overview-status').innerText(),/已完成/)
    assert.equal(await page.locator('.b03-overview-main h3').first().innerText(),'分析发现与验证缺口');await snap('overview-complete-1380')
    const info=page.getByRole('button',{name:'任务信息',exact:true});await info.click()
    await page.getByRole('dialog',{name:'任务信息'}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(80)
    assert.equal(await info.evaluate(el=>el===document.activeElement),true)
    await cases();await snap('cases-40-1380')
    await page.getByRole('checkbox',{name:'选择 TC-001',exact:true}).check()
    await page.locator('.b05-case-table tbody tr').first().getByRole('button',{name:'查看 ›',exact:true}).click()
    await page.getByRole('button',{name:'采纳此用例',exact:true}).click();await page.getByRole('button',{name:'撤销决定',exact:true}).waitFor()
    assert.match(await page.locator('.pangea-case-review-actions').innerText(),/1 \/ 40.*已采纳/s);await snap('case-adopted-1380')
    await page.getByRole('button',{name:'下一条',exact:true}).click();assert.match(await page.locator('.pangea-case-review-actions').innerText(),/2 \/ 40.*未评审/s)
    await page.getByRole('button',{name:'上一条',exact:true}).click();await tab(/^测试用例/).click()
    assert.equal(await page.getByRole('checkbox',{name:'选择 TC-001',exact:true}).isChecked(),true)
    await page.getByRole('combobox',{name:'分析单元',exact:true}).selectOption('unit-cleanup')
    assert.match(await page.locator('.b05-selected-bar').innerText(),/含 1 条筛选外选择/)
    await page.getByRole('button',{name:'导出所选',exact:true}).click()
    const modal=page.getByRole('dialog',{name:'导出测试用例'});assert.equal(await modal.getByRole('radio',{name:/已勾选/}).isChecked(),true)
    await modal.getByRole('combobox',{name:'文件格式'}).selectOption('csv');await snap('export-selected-1380')
    const downloadPromise=page.waitForEvent('download');await modal.getByRole('button',{name:'导出 1 条',exact:true}).click()
    const download=await downloadPromise;await download.saveAs(`${out}/selected-case.csv`)
    const csv=await readFile(`${out}/selected-case.csv`,'utf8');assert.match(csv,/TC-001/);assert.doesNotMatch(csv,/TC-002/)
    await page.reload();await ready();await cases();await page.getByRole('combobox',{name:'评审状态',exact:true}).selectOption('adopted')
    assert.equal(await page.locator('.b05-case-table tbody tr').count(),1);await snap('review-persisted')
    await scene('complete',120);await cases();assert.equal(await page.locator('.b05-case-table tbody tr').count(),50)
    await page.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await page.locator('.b05-case-table tbody tr').count(),50)
    await page.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await page.locator('.b05-case-table tbody tr').count(),20);await snap('cases-120-page3')
    await tab(/^业务流程/).click();await page.getByRole('textbox',{name:'搜索分支',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:/^查看分支 /}).count(),20)
    await page.getByRole('button',{name:'下一页分支',exact:true}).click();assert.equal(await page.getByRole('button',{name:/^查看分支 /}).count(),7);await snap('flow-branches-page2')
    await page.getByRole('button',{name:'流程图视图',exact:true}).click();await page.locator('.pangea-graph-canvas').first().waitFor();await snap('flow-graph-1380')
    const canvas=page.locator('.pangea-graph-canvas').first();const transform=()=>canvas.locator('svg > g').first().getAttribute('transform')
    await canvas.hover();const initialTransform=await transform();await page.mouse.wheel(0,120);await page.waitForTimeout(120);assert.equal(await transform(),initialTransform)
    await canvas.hover();await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await page.waitForTimeout(120);assert.notEqual(await transform(),initialTransform)
    await page.getByRole('combobox',{name:'高亮路径',exact:true}).selectOption('normal');await page.getByRole('button',{name:'聚焦所选路径',exact:true}).click();await page.getByRole('button',{name:'全屏阅读流程图',exact:true}).click();await page.waitForFunction(()=>document.fullscreenElement);await snap('flow-fullscreen');await page.evaluate(()=>document.exitFullscreen());assert.equal(await page.getByRole('combobox',{name:'高亮路径',exact:true}).inputValue(),'normal')
    for(const value of ['running','failed','stopping','partial']){await scene(value);const badge=await page.locator('.b03-overview-status').innerText();if(['failed','stopping'].includes(value))assert.doesNotMatch(badge,/已完成/);await tab('运行过程').click();await page.locator('.pangea-run-workspace').waitFor();await snap(`run-${value}-1380`)}
    await page.getByText('执行详情与 Agent 会话',{exact:true}).click();await page.getByRole('button',{name:'Agent 会话管理',exact:true}).click()
    await page.getByRole('dialog',{name:'Agent 会话管理'}).waitFor();await page.locator('.agent-session-transcript').waitFor()
    assert.match(await page.locator('.agent-session-transcript').innerText(),/模拟读取错误/)
    assert.equal(await page.locator('.agent-tool details[open]').count(),0);await snap('session-markdown-error');await page.keyboard.press('Escape')
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:900,height:640}]){
      await page.setViewportSize(viewport);await scene('complete');await cases()
      for(const assistant of [false,true]){await page.evaluate(value=>document.body.classList.toggle('preview-assistant',value),assistant);await snap(`cases-${viewport.width}-${assistant?'assistant':'plain'}`);assert.equal(await page.locator('#app').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,`${viewport.width}: horizontal overflow`)}
    }
    await page.evaluate(()=>document.body.classList.remove('preview-assistant'));await page.setViewportSize({width:1380,height:900})
    for(const name of ['home','tasks','create','assets','settings','environment']){await page.evaluate(name=>window.previewMount(name,name==='home'?'home':name==='environment'?'execution':'analysis'),name);await ready();if(name==='tasks'){await page.waitForTimeout(800);await page.getByRole('button',{name:'返回任务列表',exact:true}).click();await page.locator('.b03-task-screen').waitFor()}await snap(`${name}-1380`)
      if(name==='create'){
        const range=page.getByRole('textbox',{name:'源码冻结范围',exact:true});assert.equal(await range.inputValue(),'')
        await page.getByRole('textbox',{name:'分析目标',exact:true}).fill('TLS fixture')
        await page.getByRole('button',{name:'选择目录或文件',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择源码范围'})
        await picker.getByRole('checkbox',{name:'tls',exact:true}).check();await picker.getByRole('button',{name:'完成选择',exact:true}).click()
        await page.getByRole('button',{name:'预览命中文件',exact:true}).click();await page.locator('.pangea-scope-preview strong').filter({hasText:'42'}).waitFor({timeout:15000});await snap('scope-preview-42')
        await page.getByRole('button',{name:'选择整个仓库',exact:true}).click();assert.equal(await page.locator('.pangea-scope-preview').count(),0);assert.equal(await range.inputValue(),'.')
        await page.getByRole('button',{name:'预览命中文件',exact:true}).click();await page.locator('.pangea-scope-preview strong').filter({hasText:'整个仓库'}).waitFor({timeout:15000});await snap('scope-preview-entire')
      }}
    assert.deepEqual(errors,[]);await Promise.all(['failure.txt','failure.png'].map(file=>rm(path.join(out,file),{force:true})));await writeFile(`${out}/verification.json`,JSON.stringify({browser:await browser.version(),checks,windowsNative:'not-tested'},null,2));console.log('COMPLETE',checks.length)
  } catch(error){await page.screenshot({path:`${out}/failure.png`});await writeFile(`${out}/failure.txt`,`step=${active}\n${error.stack}\n${await page.locator('body').innerText()}`);throw error}
} finally { await browser?.close(); server.kill('SIGTERM') }
