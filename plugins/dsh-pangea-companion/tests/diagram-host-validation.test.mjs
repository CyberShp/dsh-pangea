import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { renderCandidate } from '../src/architecture-render.mjs'
import { validateView, cancelViewRender, updateView, listViews, viewArtifact } from '../src/architecture-views.js'
import { createDiagramRun } from '../src/diagram-acp.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = path.join(root, 'runs/run/派生视图/archify/view')
  const archify = path.join(root, 'archify')
  await mkdir(folder, { recursive: true }); await mkdir(path.join(archify, 'bin'), { recursive: true })
  const task = { data_root: root, run_id: 'run', task_id: 'task' }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ ...task, view_id: 'view', type: 'workflow', status: 'generating', created_at: new Date().toISOString(), budget_ms: 20000, max_render_attempts: 3 }))
  await writeFile(path.join(archify, 'bin/archify.mjs'), `
    import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    import path from 'node:path';
    const [command, type, input, output] = process.argv.slice(2);
    const bytes=readFileSync(input), c=JSON.parse(bytes), root=path.dirname(input);
    appendFileSync(path.join(root,'commands.jsonl'),JSON.stringify({command,input,sha:createHash('sha256').update(bytes).digest('hex')})+'\\n');
    if(c.delay){writeFileSync(path.join(root,'started'),'1'); await new Promise(r=>setTimeout(r,c.delay));}
    const ok=c.n===3 || command==='deliver' && c.forceDeliver;
    const receipt={ok,error:ok?null:'fixture layout failure',diagnostics:[{code:'fixture/layout'}]};
    if(command==='deliver' && ok){writeFileSync(output,'<html><svg><text>'+c.n+'</text></svg></html>');receipt.specification={sha256:createHash('sha256').update(bytes).digest('hex')};}
    if(command==='deliver' && !ok && c.draft){const draft=process.argv[process.argv.indexOf('--draft-output')+1];writeFileSync(draft,'<html>DRAFT<svg></svg></html>');receipt.draft={output:draft,sha256:createHash('sha256').update(readFileSync(draft)).digest('hex')};}
    if(c.mutate && command==='validate')writeFileSync(input,JSON.stringify({...c,mutated:true}));
    console.log(JSON.stringify(receipt));process.exitCode=ok?0:1;
  `)
  const candidate = value => writeFile(path.join(folder, 'candidate.json'), JSON.stringify(value))
  return { root, folder, archify, task, candidate, env: { PANGEA_ARCHIFY_ROOT: archify } }
}

test('third Worker candidate is validated and delivered with the same digest, with no fourth turn', async t => {
  const f = await fixture(t); await f.candidate({n:1,draft:true})
  let turns=1
  const worker={id:'same',result:Promise.resolve({stopReason:'completed'}),readDiagnostics:()=>({}),dispose:async()=>{},
    continuePrompt:async()=>{await f.candidate({n:++turns,draft:true});return {stopReason:'completed'}}}
  const run=await createDiagramRun({subagents:{start:async()=>worker},signal:new AbortController().signal,
    inspect:options=>validateView(f.task,'view',options,f.env),budgetMs:10000})
  assert.equal((await run.result).stopReason,'completed');assert.equal(turns,3)
  const receipt=JSON.parse(await readFile(path.join(f.folder,'validation-receipt.json')))
  assert.equal(receipt.ok,true);assert.equal(receipt.attempt,3)
  assert.equal(receipt.candidate_sha256,receipt.specification.sha256)
  assert.deepEqual(JSON.parse(await readFile(receipt.candidate_snapshot)),{n:3,draft:true})
  const commands=(await readFile(path.join(f.folder,'commands.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(commands.length,6);assert.equal(commands[4].input,commands[5].input);assert.equal(commands[4].sha,commands[5].sha)
  const limit=await renderCandidate(f.folder,f.archify);assert.equal(limit.attempts_exhausted,true)
  assert.equal((await readFile(path.join(f.folder,'commands.jsonl'),'utf8')).trim().split('\n').length,6)
  await run.dispose()
})

test('editing a validated candidate makes it unverified while retaining the labelled previous preview', async t => {
  const f=await fixture(t);await f.candidate({n:3});await validateView(f.task,'view',{},f.env)
  await f.candidate({n:4})
  const [view]=await listViews(f.task)
  assert.equal(view.available,false);assert.equal(view.candidate_unverified,true)
  assert.equal(view.preview_kind,'verified');assert.equal(view.preview_is_previous,true)
})

test('manual validation uses no extra model round and a failed latest candidate preserves the previous formal bytes', async t => {
  const f=await fixture(t);await f.candidate({n:3});await validateView(f.task,'view',{},f.env)
  const html=await readFile(path.join(f.folder,'diagram.html'),'utf8')
  await f.candidate({n:0,forceDeliver:true})
  const receipt=await validateView(f.task,'view',{manual:true},f.env)
  assert.equal(receipt.ok,false);assert.equal(receipt.manual,true)
  assert.equal(await readFile(path.join(f.folder,'diagram.html'),'utf8'),html)
  const [view]=await listViews(f.task)
  assert.equal(view.status,'failed');assert.equal(view.available,false);assert.equal(view.preview_is_previous,true)
  assert.equal((await viewArtifact(f.task,'view','html')).toString(),html)
  assert.equal(JSON.parse(await readFile(path.join(f.folder,'render-attempts.json'))).attempts,1)
})

test('draft followed by unrenderable candidate preserves a labelled previous draft, not a current draft receipt', async t => {
  const f=await fixture(t);await f.candidate({n:1,draft:true});await validateView(f.task,'view',{},f.env)
  await f.candidate({n:2});const receipt=await validateView(f.task,'view',{},f.env)
  assert.equal(receipt.ok,false);assert.equal(receipt.draft,undefined);assert.ok(receipt.previous_draft)
  const [view]=await listViews(f.task)
  assert.equal(view.available,false);assert.equal(view.preview_kind,'draft');assert.equal(view.preview_is_previous,true)
  assert.match((await viewArtifact(f.task,'view','html','draft')).toString(),/DRAFT/)
})

test('stopping during validation aborts the compiler and never overwrites stopped with ready', async t => {
  const f=await fixture(t);await f.candidate({n:3,delay:5000})
  const pending=validateView(f.task,'view',{},f.env)
  const deadline=Date.now()+5000
  while(!(await readFile(path.join(f.folder,'started')).catch(()=>null))){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10))}
  cancelViewRender(f.task,'view');await updateView(f.task,'view',{status:'stopped'})
  const receipt=await pending
  assert.equal(receipt.ok,false);assert.equal(receipt.terminal,true)
  const [view]=await listViews(f.task);assert.equal(view.status,'stopped');assert.equal(view.available,false)
  assert.equal(await readFile(path.join(f.folder,'diagram.html')).catch(()=>null),null)
})

test('mutated validation snapshot cannot be promoted even if the delivery command returns success', async t => {
  const f=await fixture(t);await f.candidate({n:3,mutate:true})
  const receipt=await renderCandidate(f.folder,f.archify)
  assert.equal(receipt.ok,false);assert.match(receipt.error,/字节发生变化/)
  assert.equal(await readFile(path.join(f.folder,'diagram.html')).catch(()=>null),null)
})

test('native aborted turn never validates or queues another model turn', async t => {
  const { launchArchitectureSession, isNativeDiagramRunning } = await import('../src/workbench-api.js')
  const f=await fixture(t)
  await mkdir(path.join(f.root,'.agents/pangea'),{recursive:true})
  await writeFile(path.join(f.root,'.agents/pangea/dsh.md'),'# fixture')
  const ok=value=>({result:{ok:true,value}})
  let prompts=0, inspections=0, finish
  const finished=new Promise(resolve=>{finish=resolve})
  const api={
    llm:{providers:async()=>ok({providers:[{provider:'m',active:true,declared:true,settingsNs:'llm-pi-ai',settingsPath:['providers','m']}]}),
      models:async()=>ok({groups:[{id:'m',models:[{id:'model'}]}],failures:[]})},
    settings:{describe:async()=>ok({namespaces:[{ns:'llm-pi-ai',value:{providers:{m:{apiKeyEnv:'TEST_KEY'}}}}]})},
    credentials:{describe:async()=>ok({credentials:{TEST_KEY:{configured:true}}})},
    sessions:{create:async()=>ok({sessionId:'native-abort'}),rename:async()=>ok({}),selectModel:async()=>ok({}),
      prompt:async()=>{prompts++;return ok({})},cancel:async()=>ok({}),
      history:async()=>ok({events:[{event:{type:'turn/end',data:{turn:1,reason:{kind:'aborted'}}}}]})},
  }
  await launchArchitectureSession(api,{cwd:f.root,task:{target:'fixture',model_route:{provider:'m',model:'model'}},prompt:'candidate',
    onSession:async()=>{},onEvent:async e=>{if(e.terminal)finish(e)},inspect:async()=>{inspections++;return {ok:false}},check:async()=>({}),budgetMs:1000},{})
  const event=await finished
  assert.match(event.error,/aborted/);assert.equal(prompts,1);assert.equal(inspections,0)
  await new Promise(resolve=>setImmediate(resolve));assert.equal(isNativeDiagramRunning('native-abort'),false)
})
