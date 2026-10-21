import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { install } from '../src/install.js';
import { DEFAULT_CONFIG, saveConfig } from '../src/config.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));
// An executable fixture, not a model. This exercises the production CLI
// transport, Pi reviewer, audit, grading, browser server, and receipt checks.
const PROVIDER = `#!/usr/bin/env node
const fs=require('node:fs');let input='';
process.stdin.on('data',part=>input+=part);
process.stdin.on('end',()=>{
 const data=JSON.parse(input.split('\\n').at(-1));
 const phase=data.proposedQuestions?'audit':data.question?'grade':'review';
 fs.appendFileSync(process.env.SPHINX_FIXTURE_CALLS,JSON.stringify({phase,leaked:input.includes('FIXTURE_IGNORED_SECRET')})+'\\n');
 const evidence=[{path:'app.js',reason:'Set membership is checked before adding a repeated id.'}];
 const question={id:'duplicate',concept:'Duplicate suppression',prompt:'Within one running process, does a repeated id enqueue another entry? Give the causal reason.',choices:[],expectedAnswer:'No. The membership test returns before insertion.',rationale:'The existing id causes the early return.',acceptance:{prediction:'A repeated id does not enqueue another entry.',causalReason:'The membership check returns before insertion.'},evidence};
 let result;
 if(phase==='audit')result={questions:data.proposedQuestions,feedback:'The question matches the supplied source.'};
 else if(phase==='grade')result={questionValid:true,verdict:'correct',feedback:'The existing id causes an early return.',evidence,followUp:null};
 else{
  const seen=(data.conversation||[]).filter(item=>item.content.startsWith('Workspace observation')).map(item=>JSON.parse(item.content.slice(item.content.indexOf('\\n')+1)));
  result=seen.length?{action:'finish',calls:[],assessment:{questions:[question]},summary:'Set membership rejects repeated ids.',evidenceIds:seen.map(item=>item.id)}:{action:'tools',calls:[{name:'read_diff',arguments:JSON.stringify({path:'app.js'})}],assessment:null,summary:'',evidenceIds:[]};
 }
 process.stdout.write(JSON.stringify({type:'result',subtype:'success',structured_output:result}));
});
`;

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-browser-git-'));
  const home = path.join(base, 'home'), repo = path.join(base, 'repo'), bin = path.join(base, 'bin'), remote = path.join(base, 'remote.git');
  await Promise.all([home, repo, bin].map(directory => mkdir(directory)));
  const env = {
    HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, '.sphinx'),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    // SSH mode prints the local URL and cannot invoke any desktop launcher.
    // CI must be false to exercise the actual browser default, not fallback.
    SSH_CONNECTION: 'disposable-test-no-desktop', CI: 'false', TERM: 'dumb', NO_COLOR: '1',
    SPHINX_FIXTURE_CALLS: path.join(base, 'calls.jsonl'), SPHINX_FIXTURE_HOOKS: path.join(base, 'hooks.txt'),
  };
  await writeFile(path.join(bin, 'claude'), PROVIDER, { mode: 0o755 });
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    await Promise.allSettled(children.map(child => child.finished));
    await rm(base, { recursive: true, force: true });
  });
  const git = async (...args) => (await exec('git', args, { cwd: repo, env, timeout: 15000 })).stdout.trimEnd();
  const bare = (...args) => git('--git-dir', remote, ...args);
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Sphinx browser fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'commit.gpgsign', 'false'); await git('init', '--bare', '-q', remote); await git('remote', 'add', 'origin', remote);
  const app = 'const seen=new Set();\nexport function enqueue(id){if(seen.has(id))return false;seen.add(id);return true;}\n';
  await writeFile(path.join(repo, 'app.js'), app);
  await writeFile(path.join(repo, '.sphinxignore'), '.env\n'); await writeFile(path.join(repo, '.env'), 'FIXTURE_IGNORED_SECRET=never-transmit\n');
  await git('add', '.'); await git('commit', '-qm', 'Fixture queue');
  await writeFile(path.join(repo, '.git/hooks/pre-push'), '#!/bin/sh\nprintf "pre-push\\n" >> "$SPHINX_FIXTURE_HOOKS"\ncat > /dev/null\n', { mode: 0o755 });
  const config = { ...structuredClone(DEFAULT_CONFIG), provider: 'claude', model: null, models: Object.fromEntries(['small', 'medium', 'large'].map(tier => [tier, { provider: 'claude', model: null }])), backgroundPreparation: false };
  await saveConfig(config, env); await install({ config, cwd: repo, env, agents: 'none', cliPath: CLI });
  const startPush = () => {
    const child = spawn('git', ['push', 'origin', 'main'], { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })); });
    child.output = () => stderr;
    return child;
  };
  const question = async child => {
    const deadline = Date.now() + 20000; let url;
    while (Date.now() < deadline) {
      url ||= child.output().match(/Sphinx questionnaire: (http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+)/u)?.[1];
      if (url) {
        const state = await (await fetch(`${url}/state`)).json();
        if (state.phase === 'question') return { url, state };
        assert.ok(!['error', 'recovery'].includes(state.phase), JSON.stringify(state));
      }
      if (child.exitCode !== null || child.signalCode !== null) assert.fail(`Git exited before the browser question: ${JSON.stringify(await child.finished)}`);
      await delay(20);
    }
    assert.fail(`Browser question did not become ready: ${child.output()}`);
  };
  const submit = ({ url, state }, action, response) => fetch(`${url}/action`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: new URL(url).origin, 'X-Sphinx-Token': new URL(url).pathname.slice(1),
  }, body: JSON.stringify({ id: state.id, revision: state.revision, action, ...(action === 'answer' ? { questionId: state.question.id, response } : {}) }) });
  const hooks = async () => (await readFile(env.SPHINX_FIXTURE_HOOKS, 'utf8')).trim().split('\n');
  return { repo, env, app, git, bare, startPush, question, submit, hooks, children };
}

test('actual default browser hook continues one original push after direct fixture input, while Pause stops a changed push', { timeout: 60000 }, async t => {
  const f = await fixture(t), firstHead = await f.git('rev-parse', 'HEAD');
  const first = f.startPush(), page = await f.question(first);
  assert.equal(first.exitCode, null); assert.equal(page.state.waitingGit, true);
  assert.equal(page.state.question.id, 'duplicate');
  assert.equal(page.state.question.expectedAnswer, undefined);
  assert.equal(page.state.question.acceptance, undefined);
  await assert.rejects(f.bare('rev-parse', '--verify', 'refs/heads/main'));
  assert.deepEqual(await f.hooks(), ['pre-push']);
  assert.match(first.output(), /No application was brought to the foreground/);
  const answer = await f.submit(page, 'answer', 'No. Set membership returns before another insertion in the same process.');
  assert.equal(answer.status, 202);
  const passed = await first.finished;
  assert.equal(passed.code, 0, passed.stderr);
  assert.match(passed.stderr, /Continuing this Git operation/);
  assert.equal(await f.bare('rev-parse', 'refs/heads/main'), firstHead);
  assert.equal(f.children.length, 1, 'Completion cannot start a second Git invocation');
  assert.deepEqual(await f.hooks(), ['pre-push']);
  assert.doesNotMatch(passed.stderr, /Set membership returns|Within one running process/);
  await assert.rejects(fetch(`${page.url}/state`), 'The per-operation listener must close after Git finishes');

  await writeFile(path.join(f.repo, 'app.js'), `${f.app}\nexport const retryLimit=3;\n`);
  await f.git('add', 'app.js'); await f.git('commit', '-qm', 'Change fixture retry limit');
  const second = f.startPush(), nextPage = await f.question(second);
  assert.notEqual(nextPage.state.id, page.state.id); assert.equal(second.exitCode, null);
  assert.equal(await f.bare('rev-parse', 'refs/heads/main'), firstHead);
  assert.equal((await f.submit(nextPage, 'pause')).status, 200);
  const paused = await second.finished;
  assert.notEqual(paused.code, 0); assert.match(paused.stderr, /This Git operation was stopped/);
  assert.equal(await f.bare('rev-parse', 'refs/heads/main'), firstHead);
  assert.deepEqual(await f.hooks(), ['pre-push', 'pre-push']);
  const pending = JSON.parse((await exec(process.execPath, [CLI, 'pending', '--json'], { cwd: f.repo, env: f.env })).stdout);
  assert.equal(pending.length, 1); assert.equal(pending[0].id, nextPage.state.id); assert.equal(pending[0].status, 'active');
  const calls = (await readFile(f.env.SPHINX_FIXTURE_CALLS, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(call => call.phase === 'grade').length, 1, 'Pause never grades an answer');
  assert.ok(calls.every(call => !call.leaked), 'Ignored fixture data must never enter any outbound prompt');
  await assert.rejects(fetch(`${nextPage.url}/state`));
});

test('a check passed with sphinx answer while the browser page waits lets the same push continue', { timeout: 60000 }, async t => {
  const f = await fixture(t), head = await f.git('rev-parse', 'HEAD');
  const push = f.startPush(), page = await f.question(push);
  const answered = JSON.parse((await exec(process.execPath, [CLI, 'answer', page.state.id, '--text', 'No. Set membership returns before another insertion in the same process.', '--json'], { cwd: f.repo, env: f.env, timeout: 20000 })).stdout);
  assert.equal(answered.status, 'passed');
  const passed = await Promise.race([push.finished, delay(15000).then(() => assert.fail(`The push kept waiting after the CLI pass: ${push.output()}`))]);
  assert.equal(passed.code, 0, passed.stderr); assert.match(passed.stderr, /Continuing this Git operation/);
  assert.equal(await f.bare('rev-parse', 'refs/heads/main'), head);
  assert.equal(f.children.length, 1); assert.deepEqual(await f.hooks(), ['pre-push']);
});
