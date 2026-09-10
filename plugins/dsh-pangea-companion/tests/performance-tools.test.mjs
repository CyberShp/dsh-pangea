import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceFirstTools, TaskStore } from '../src/index.js'

test('whole-file planning passes explicit ownership unchanged and retains old region input', async () => {
  const registered = []; const calls = []
  sourceFirstTools({ tools: { register(tool) { registered.push(tool); return () => {} } } }, async (_exec, command, args) => { calls.push({command,args}); return {ok:true} })
  const tool=registered.find(t=>t.name==='pangea_plan_write')
  assert.deepEqual(tool.parameters.properties.unit.required,['title','purpose'])
  assert.ok(tool.parameters.properties.unit.properties.owned_files)
  for (const choice of [{owned_files:[{repo_id:'r',path:'a.c'}]}, {owned_regions:['r-1']}]) {
    const unit={title:'unit',purpose:'原文',...choice}
    await tool.execute({data_root:'/d',run_id:'r',action_id:'a',task_id:'t',expected_revision:0,unit},{})
    const {args}=calls.at(-1)
    assert.deepEqual(JSON.parse(args[args.indexOf('--unit')+1]),unit)
  }
})

test('explicit context budget survives task persistence and reopening without changing old defaults', async () => {
  const root=await mkdtemp(join(tmpdir(),'pangea-budget-'))
  try {
    const storePath=join(root,'tasks.json')
    const store=new TaskStore({storePath})
    const task=await store.create({workspace:root,input:{repository:'r',target:'analysis',effective_context_budget:204800}})
    assert.equal(task.effective_context_budget,204800)
    const reopened=new TaskStore({storePath})
    assert.equal((await reopened.get(task.task_id)).effective_context_budget,204800)
    const old=await store.create({workspace:root,input:{repository:'r',target:'unchanged default'}})
    assert.equal(old.effective_context_budget,undefined)
  } finally {await rm(root,{recursive:true,force:true})}
})
