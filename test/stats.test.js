import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readStats, recordAnswer, recordCheck, scoreSummary, CALIBRATION_QUESTIONS } from '../src/stats.js';
import { collectGarbage } from '../src/storage.js';

async function home(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sphinx-stats-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { SPHINX_HOME: dir };
}

test('the score calibrates first, then reports first-try accuracy, streak, and skip rate per repository', async t => {
  const env = await home(t), repoRoot = '/work/billing';
  assert.equal(scoreSummary(await readStats(repoRoot, env)).calibrating, true);
  for (const correct of [true, true, false, true]) await recordAnswer({ repoRoot, correct, env });
  let score = scoreSummary(await readStats(repoRoot, env));
  assert.deepEqual([score.calibrating, score.accuracy, score.needed], [true, null, CALIBRATION_QUESTIONS - 4], 'No percentage before five answers');
  await recordAnswer({ repoRoot, correct: true, env });
  await recordCheck({ repoRoot, outcome: 'completed', env }); await recordCheck({ repoRoot, outcome: 'completed', env }); await recordCheck({ repoRoot, outcome: 'skipped', env });
  score = scoreSummary(await readStats(repoRoot, env));
  assert.deepEqual([score.calibrating, score.accuracy, score.streak, score.bestStreak, score.skipRate], [false, 80, 2, 2, 33]);
  assert.equal(scoreSummary(await readStats('/work/other', env)).answered, 0, 'Each repository keeps its own score');
  await collectGarbage({ env, now: Date.now() + 365 * 86400000 });
  assert.equal((await readStats(repoRoot, env)).answered, 5, 'Cleanup never removes the score');
});
