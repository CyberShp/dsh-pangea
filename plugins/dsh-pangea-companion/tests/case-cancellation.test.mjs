import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { runPangea } from '../src/pangea-api.js'

test('verification cancellation lets Python write evidence and release its temporary resources', {
  skip: process.platform !== 'win32' || !process.env.PANGEA_CASE_CC || !process.env.PANGEA_PYTHON,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-cancel-test-'))
  try {
    await mkdir(path.join(root,'.agents/pangea'),{recursive:true})
    await writeFile(path.join(root,'.agents/pangea/dsh.md'),'# fixture')
    const run=path.join(root,'runs/run-cancel'), internal=path.join(run,'内部索引')
    await mkdir(path.join(internal,'执行校验方案'),{recursive:true})
    await mkdir(path.join(run,'inputs/source/repository'),{recursive:true})
    await mkdir(path.join(run,'活文档'))
    await writeFile(path.join(run,'inputs/source/repository/module.c'),'int value(void){return 7;}')
    await writeFile(path.join(run,'活文档/黑盒测试用例.md'),'Cancellation fixture')
    await writeFile(path.join(internal,'工作台投影.json'),JSON.stringify({test_cases:[{test_case_id:'TC-1'}]}))
    await writeFile(path.join(internal,'执行校验方案/loop.c'),'#include "module.c"\nint main(void){volatile int n=value(); for(;;) n=7;}')
    await writeFile(path.join(internal,'执行校验计划.json'),JSON.stringify({run_id:'run-cancel',review_request_id:'review-cancel',cases:[{case_id:'TC-1',probe:'loop.c'}]}))
    const before = new Set((await readdir(os.tmpdir())).filter(name=>name.startsWith('pangea-verification-cancel-')))
    const controller=new AbortController()
    const done=assert.rejects(runPangea({cwd:root,signal:controller.signal,args:['runs','verify-cases','--data-root',root,'--run-id','run-cancel','--review-request-id','review-cancel']}),/已取消/)
    await delay(3000)
    controller.abort()
    await done
    const receipt=JSON.parse(await readFile(path.join(internal,'执行校验结果/review-cancel/执行记录.json'),'utf8'))
    assert.equal(receipt.cases[0].status,'cancelled')
    assert.equal(receipt.cases[0].exit_code ?? null,null)
    const after=(await readdir(os.tmpdir())).filter(name=>name.startsWith('pangea-verification-cancel-')&&!before.has(name))
    assert.deepEqual(after,[])
  } finally { await rm(root,{recursive:true,force:true}) }
})
