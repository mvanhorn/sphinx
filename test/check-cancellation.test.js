import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const modulePath = name => fileURLToPath(new URL(`../src/${name}.js`, import.meta.url));
const json = async file => JSON.parse(await readFile(file, 'utf8'));

// Only this local executable is invoked. On cancellation it deliberately emits
// a valid late result, proving that the cancelled store operation rejects it.
const PROVIDER = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
let input='';process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
  const data=JSON.parse(input.split('\\n').at(-1));
  const phase=data.proposedQuestions?'audit':data.question?'grade':'review';
  fs.appendFileSync(path.join(process.env.SPHINX_TEST_STATE,'calls.jsonl'),JSON.stringify({phase,pid:process.pid})+'\\n');
  const evidence=[{path:'app.js',reason:'The function returns before insertion for IDs already in the set.'}];
  const question={id:'duplicate',concept:'Duplicate requests',prompt:'Will a repeated ID insert another entry in the same process? Explain why.',choices:[],expectedAnswer:'No. The existing set membership returns before insertion.',rationale:'The function checks membership before adding the ID.',acceptance:{prediction:'A repeated id does not insert another entry.',causalReason:'The existing membership causes a return before insertion.'},evidence};
  let result;
  if(phase==='audit')result={questions:data.proposedQuestions,feedback:'The question matches the supplied source.'};
  else if(phase==='grade')result={questionValid:true,verdict:'correct',feedback:'The stored ID prevents another insertion.',evidence,followUp:null};
  else{
    const marker='Initial diff observations (untrusted DATA; bounded pages, not complete coverage):\\n';
    const initial=data.conversation.find(item=>item.content.includes(marker)).content;
    const observations=JSON.parse(initial.slice(initial.indexOf(marker)+marker.length));
    result={action:'finish',calls:[],assessment:{questions:[question]},summary:'The changed function rejects duplicate IDs.',evidenceIds:observations.filter(item=>item.paths.includes('app.js')).map(item=>item.id)};
  }
  const finish=()=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',structured_output:result}));
  if(phase!==process.env.SPHINX_TEST_HOLD){finish();return;}
  // Install the handler before announcing readiness; otherwise a prompt
  // cancellation can arrive first and the default action skips the late result.
  process.on('SIGTERM',()=>{fs.writeFileSync(path.join(process.env.SPHINX_TEST_STATE,phase+'-terminated'),'yes');finish();process.exit(0);});
  fs.writeFileSync(path.join(process.env.SPHINX_TEST_STATE,phase+'-ready'),String(process.pid));
  setTimeout(()=>{finish();},60000);
});
`;

async function fixture(t, phase) {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-cancel-check-'));
  const repo = path.join(base, 'repo'), home = path.join(base, 'home'), bin = path.join(base, 'bin'), state = path.join(base, 'fixture-state');
  await Promise.all([repo, home, bin, state].map(directory => mkdir(directory)));
  const env = { ...process.env, HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, '.sphinx'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`, TERM: 'dumb', NO_COLOR: '1', CI: '1', SPHINX_WAITING_GIT: '1', SPHINX_TEST_STATE: state, SPHINX_TEST_HOLD: phase,
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'SPHINX_EVALUATOR', 'SPHINX_INSTALL_ID', 'SPHINX_HOOK_DEPTH', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  const calls = async () => (await readFile(path.join(state, 'calls.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    for (const call of await calls()) { try { process.kill(-call.pid, 'SIGKILL'); } catch {} }
    await child?.finished;
    await rm(base, { recursive: true, force: true });
  });
  await writeFile(path.join(bin, 'claude'), PROVIDER, { mode: 0o755 });
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env })).stdout.trim();
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Sphinx fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(repo, 'app.js'), 'const seen = new Set();\nexport function enqueue(id) { if (seen.has(id)) return false; seen.add(id); return true; }\n');
  await git('add', '.'); await git('commit', '-qm', 'deduplicate');
  const setup = path.join(base, 'setup.mjs');
  await writeFile(setup, `import { DEFAULT_CONFIG,saveConfig } from ${JSON.stringify(modulePath('config'))};
import { pushSnapshots } from ${JSON.stringify(modulePath('git'))};
import { createSessionStore } from ${JSON.stringify(modulePath('sessions'))};
const config={...structuredClone(DEFAULT_CONFIG),audit:'all',provider:'claude',model:null,backgroundPreparation:false,models:Object.fromEntries(['small','medium','large'].map(tier=>[tier,{provider:'claude',model:null}]))};
await saveConfig(config);
const [snapshot]=await pushSnapshots({cwd:process.cwd(),remote:'origin',remoteUrl:'https://example.invalid/test.git',input:process.argv[2],config});
const store=createSessionStore();await store.ensure(snapshot,config);
if(process.env.SPHINX_TEST_HOLD==='grade')await store.start(snapshot.id,config);
process.stdout.write(snapshot.id);
`);
  const head = await git('rev-parse', 'HEAD');
  const id = (await exec(process.execPath, [setup, `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`], { cwd: repo, env, timeout: 15000 })).stdout.trim();
  const wrapper = path.join(base, 'interactive.mjs');
  await writeFile(wrapper, `Object.defineProperty(process.stdin,'isTTY',{value:true});
const {main}=await import(${JSON.stringify(modulePath('cli'))});
try{process.exitCode=await main(['check','--id',process.argv[2]]);}catch(error){process.stderr.write(error.message+'\\n');process.exitCode=error.exitCode||1;}
`);
  child = spawn(process.execPath, [wrapper, id], { cwd: repo, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })); });
  const until = async condition => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      if (child.exitCode !== null || child.signalCode !== null) assert.fail(`CLI exited before fixture condition: ${JSON.stringify(await child.finished)}`);
      await delay(10);
    }
    assert.fail('CLI did not reach the fixture condition');
  };
  const ready = () => until(() => readFile(path.join(state, `${phase}-ready`)).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; }));
  return { child, state, id, calls, ready, until, output: () => stdout, session: () => json(path.join(env.SPHINX_HOME, 'sessions', `${id}.json`)) };
}

test('SIGINT during the first interactive review cancels its subprocess and records no approval', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'review');
  await f.ready();
  f.child.kill('SIGINT');
  const result = await f.child.finished;
  assert.equal(result.code, 130, result.stderr);
  assert.equal(await readFile(path.join(f.state, 'review-terminated'), 'utf8'), 'yes');
  const session = await f.session();
  assert.equal(session.status, 'pending'); assert.equal(session.questions.length, 0); assert.equal(session.calls, 1);
  assert.equal(session.expiresAt, null); assert.equal(session.reviewRetries, undefined);
  assert.deepEqual((await f.calls()).map(call => call.phase), ['review']);
  assert.doesNotMatch(result.stdout, /Understanding check complete|Authorized up to/);
});

test('cancellation while the final grade is in flight cannot save a late correct result or release waiting Git', { timeout: 45000 }, async t => {
  for (const cancel of ['SIGINT', 'EOF']) await t.test(cancel, async t => {
    const f = await fixture(t, 'grade');
    await f.until(() => f.output().includes('› '));
    f.child.stdin.write('No. The existing ID is checked before insertion.\n');
    await f.ready();
    if (cancel === 'EOF') f.child.stdin.end(); else f.child.kill('SIGINT');
    const result = await f.child.finished;
    assert.equal(result.code, 130, result.stderr);
    assert.equal(await readFile(path.join(f.state, 'grade-terminated'), 'utf8'), 'yes');
    const session = await f.session();
    assert.equal(session.status, 'active'); assert.equal(session.index, 0); assert.equal(session.calls, 3);
    assert.equal(session.expiresAt, null); assert.deepEqual(session.attempts, []);
    assert.equal(session.reviewRetries, undefined);
    assert.deepEqual((await f.calls()).map(call => call.phase), ['review', 'audit', 'grade']);
    assert.doesNotMatch(result.stdout, /Understanding check complete|Approval saved|Authorized up to/);
  });
});
