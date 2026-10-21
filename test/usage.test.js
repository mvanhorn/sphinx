import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reportUsage, recordUsage, readUsage, summarizeUsage, printUsage, usageTier, withUsageLedger, withUsageMeter, withUsagePurpose, USAGE_MONTHS_KEPT } from '../src/usage.js';
import { callOpenRouter } from '../src/openrouter.js';
import { createEvaluator } from '../src/evaluator.js';
import { createTerminal, stripAnsi } from '../src/terminal.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));

async function home(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sphinx-usage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, env: { SPHINX_HOME: path.join(directory, 'sphinx'), SPHINX_USER_HOME: directory } };
}

test('model calls are classified into free, paid, endpoint, and plan tiers', () => {
  assert.equal(usageTier('openrouter', 'openrouter/free'), 'free');
  assert.equal(usageTier('openrouter', 'qwen/qwen3-coder:free'), 'free');
  assert.equal(usageTier('openrouter', undefined), 'free', 'the OpenRouter default model is the free router');
  assert.equal(usageTier('openrouter', 'anthropic/claude-haiku-4.5'), 'paid');
  assert.equal(usageTier('openai', 'gpt-5-mini'), 'endpoint');
  assert.equal(usageTier('claude', 'haiku'), 'plan');
  assert.equal(usageTier('codex', null), 'plan');
});

test('reported usage is appended to the monthly ledger only inside a ledger scope, with its purpose', async t => {
  const { env } = await home(t);
  reportUsage({ inputTokens: 1, outputTokens: 1, provider: 'openrouter', model: 'openrouter/free' });
  assert.deepEqual(readUsage({ env }), [], 'no ledger scope means nothing is written');
  const metered = [];
  await withUsageMeter(usage => metered.push(usage), () => withUsageLedger(env, async () => {
    reportUsage({ inputTokens: 100, outputTokens: 20, cost: 0, provider: 'openrouter', model: 'openrouter/free' });
    await withUsagePurpose('review', async () => {
      reportUsage({ inputTokens: 300, outputTokens: 50, cost: 0.0123, provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
      await withUsagePurpose('context', async () => reportUsage({ inputTokens: 7, outputTokens: 3, provider: 'openai', model: 'gpt-5-mini' }));
    });
    await withUsagePurpose('Not A Label!', async () => reportUsage({ inputTokens: 9, outputTokens: 1, provider: 'codex' }));
  }));
  assert.equal(metered.length, 4, 'the session meter still receives every call');
  const entries = readUsage({ env });
  assert.deepEqual(entries.map(({ at, ...entry }) => entry), [
    { provider: 'openrouter', model: 'openrouter/free', tier: 'free', input: 100, output: 20, cost: 0 },
    { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', tier: 'paid', purpose: 'review', input: 300, output: 50, cost: 0.0123 },
    { provider: 'openai', model: 'gpt-5-mini', tier: 'endpoint', purpose: 'context', input: 7, output: 3, cost: null },
    { provider: 'codex', model: null, tier: 'plan', input: 9, output: 1, cost: null },
  ]);
  const files = await readdir(path.join(env.SPHINX_HOME, 'usage'));
  assert.deepEqual(files, [`${entries[0].at.slice(0, 7)}.jsonl`]);
  const lines = (await readFile(path.join(env.SPHINX_HOME, 'usage', files[0]), 'utf8')).trim().split('\n');
  assert.ok(lines.every(line => line.length < 300), 'ledger lines stay compact');
});

test('real transports report provider and model to the ledger', async t => {
  const { env } = await home(t);
  const config = { ...structuredClone(DEFAULT_CONFIG), model: 'anthropic/claude-haiku-4.5', allowPaid: true };
  const fetchImpl = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"questions":[]}' } }], usage: { prompt_tokens: 40, completion_tokens: 8, cost: 0.002 } });
  const runner = async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 30, cache_read_input_tokens: 10, output_tokens: 5 }, structured_output: { questions: [] } }) });
  await withUsageLedger(env, async () => {
    await callOpenRouter({ prompt: 'p', schema: { type: 'object' }, config, env: { ...env, OPENROUTER_API_KEY: 'test-only-key' }, fetchImpl });
    await createEvaluator({ runner, env }).runModel({ prompt: 'p', schema: { type: 'object' }, config: { provider: 'claude', model: 'haiku', timeoutSeconds: 5 } });
  });
  assert.deepEqual(readUsage({ env }).map(({ provider, model, tier, input, output, cost }) => ({ provider, model, tier, input, output, cost })), [
    { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', tier: 'paid', input: 40, output: 8, cost: 0.002 },
    { provider: 'claude', model: 'haiku', tier: 'plan', input: 40, output: 5, cost: null },
  ]);
});

test('a ledger write failure never throws into the model call', async t => {
  const { directory } = await home(t);
  const blocked = path.join(directory, 'not-a-directory');
  await writeFile(blocked, 'x');
  const env = { SPHINX_HOME: blocked };
  assert.equal(recordUsage({ provider: 'openrouter', model: 'openrouter/free', input: 1, output: 1 }, { env }), false);
  const metered = [];
  await withUsageMeter(usage => metered.push(usage), () => withUsageLedger(env, async () => {
    assert.doesNotThrow(() => reportUsage({ inputTokens: 5, outputTokens: 1, provider: 'claude' }));
  }));
  assert.equal(metered.length, 1);
  assert.deepEqual(readUsage({ env }), []);
});

test('writing a new month keeps only the most recent monthly files', async t => {
  const { env } = await home(t);
  const dir = path.join(env.SPHINX_HOME, 'usage');
  await mkdir(dir, { recursive: true });
  const old = ['2024-11', '2024-12', ...Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, '0')}`)];
  for (const month of old) await writeFile(path.join(dir, `${month}.jsonl`), '');
  await writeFile(path.join(dir, 'notes.txt'), 'keep');
  assert.equal(recordUsage({ provider: 'codex', input: 1, output: 1, at: new Date('2026-03-04T05:06:07Z') }, { env }), true);
  const months = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
  assert.equal(months.length, USAGE_MONTHS_KEPT);
  assert.equal(months[0], '2025-02.jsonl');
  assert.equal(months.at(-1), '2026-03.jsonl');
  assert.ok((await readdir(dir)).includes('notes.txt'), 'unrelated files are untouched');
  recordUsage({ provider: 'codex', input: 1, output: 1, at: new Date('2026-03-05T05:06:07Z') }, { env });
  assert.equal((await readdir(dir)).filter(name => name.endsWith('.jsonl')).length, USAGE_MONTHS_KEPT, 'appending to an existing month prunes nothing');
});

const entries = [
  { at: '2026-10-18T09:00:00', tier: 'free', provider: 'openrouter', model: 'openrouter/free', purpose: 'review', input: 1000, output: 200, cost: 0 },
  { at: '2026-10-18T10:00:00', tier: 'plan', provider: 'claude', model: 'haiku', purpose: 'grading', input: 500, output: 100, cost: null },
  { at: '2026-10-14T10:00:00', tier: 'paid', provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', purpose: 'review', input: 10000, output: 2000, cost: 0.05 },
  { at: '2026-09-25T10:00:00', tier: 'endpoint', provider: 'openai', model: 'gpt-5-mini', purpose: 'context', input: 3000, output: 300, cost: null },
  { at: '2026-03-01T10:00:00', tier: 'paid', provider: 'openrouter', model: 'openai/gpt-5', input: 20000, output: 4000, cost: 0.25 },
].map(entry => ({ ...entry, at: new Date(entry.at).toISOString() }));
const now = new Date('2026-10-18T12:00:00');

test('usage is aggregated by window, tier, and purpose', () => {
  const { windows } = summarizeUsage(entries, now);
  assert.deepEqual(Object.keys(windows), ['today', 'last7Days', 'last30Days', 'allTime']);
  assert.deepEqual([windows.today.calls, windows.last7Days.calls, windows.last30Days.calls, windows.allTime.calls], [2, 3, 4, 5]);
  assert.deepEqual(windows.today.tiers.free, { calls: 1, input: 1000, output: 200, cost: 0 });
  assert.deepEqual(windows.today.tiers.plan, { calls: 1, input: 500, output: 100, cost: null }, 'plan routes carry no cost');
  assert.deepEqual(windows.today.tiers.paid, { calls: 0, input: 0, output: 0, cost: null });
  assert.equal(windows.last7Days.cost, 0.05);
  assert.ok(Math.abs(windows.allTime.cost - 0.3) < 1e-9);
  assert.deepEqual(windows.last30Days.tiers.endpoint, { calls: 1, input: 3000, output: 300, cost: null });
  assert.deepEqual(Object.keys(windows.allTime.purposes).sort(), ['context', 'grading', 'other', 'review']);
  assert.deepEqual(windows.allTime.purposes.review, { calls: 2, input: 11000, output: 2200, cost: 0.05 });
});

test('human usage output is a table with tokens, costs, and a plan note, and fits narrow terminals', () => {
  for (const width of [24, 40, 80]) {
    let text = '';
    const ui = createTerminal({ stream: { isTTY: false, write: chunk => { text += chunk; } }, env: { NO_COLOR: '1' }, width });
    printUsage(ui, summarizeUsage(entries, now), { ledgerPath: '/tmp/sphinx/usage' });
    assert.ok(text.split('\n').every(line => stripAnsi(line).length <= width), `overflowed ${width} columns`);
    if (width === 80) {
      assert.match(text, /Free OpenRouter\s+1\.2k\s+1\.2k\s+1\.2k\s+1\.2k\n/);
      assert.match(text, /Paid OpenRouter\s+-\s+12\.0k \$0\.05\s+12\.0k \$0\.05\s+36\.0k \$0\.30\n/);
      assert.match(text, /Coding plans\s+600\s+600\s+600\s+600\n/, 'plan routes show tokens only');
      assert.match(text, /By purpose/);
      assert.match(text, /count against your Claude Code\s+or Codex plan/);
      assert.match(text, /last 12\s+months/);
    }
  }
});

test('sphinx usage --json reads the ledger from SPHINX_HOME', async t => {
  const { directory, env } = await home(t);
  const at = new Date();
  recordUsage({ provider: 'openrouter', model: 'openrouter/free', purpose: 'review', input: 100, output: 20, cost: 0, at }, { env });
  recordUsage({ provider: 'codex', model: 'gpt-6-luna', purpose: 'grading', input: 50, output: 10, at }, { env });
  await writeFile(path.join(env.SPHINX_HOME, 'usage', `${at.toISOString().slice(0, 7)}.jsonl`), 'not json\n', { flag: 'a' });
  const run = args => spawnSync(process.execPath, [CLI, 'usage', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: directory, NO_COLOR: '1', ...env } });
  const result = run(['--json']);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ledger, path.join(env.SPHINX_HOME, 'usage'));
  assert.equal(data.monthsKept, 12);
  assert.deepEqual(Object.keys(data.windows), ['today', 'last7Days', 'last30Days', 'allTime']);
  assert.deepEqual(Object.keys(data.windows.allTime.tiers), ['free', 'paid', 'endpoint', 'plan']);
  assert.deepEqual(data.windows.today.tiers.plan, { calls: 1, input: 50, output: 10, cost: null });
  assert.deepEqual(data.windows.today.purposes.review, { calls: 1, input: 100, output: 20, cost: 0 });
  const human = run([]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Model usage/);
  assert.match(human.stdout, /Coding plans/);
  assert.equal(run(['--model', 'x']).status, 1, 'unknown options are rejected');
});
