import { createHash } from 'node:crypto';
import path from 'node:path';
import { getPaths, readJson, writeJson } from './config.js';

// A small per-repository understanding score. Checks are cleaned up after a
// day, so the score keeps its own counters: questions answered correctly on
// the first try, questions answered, the current first-try streak, and how
// many checks were completed or skipped. Updates are best-effort.
export const CALIBRATION_QUESTIONS = 5;
const RECENT = 10;
const digest = value => createHash('sha256').update(value).digest('hex');
export const statsFile = (repoRoot, env = process.env) => path.join(getPaths(env).home, 'stats', `${digest(repoRoot)}.json`);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export async function readStats(repoRoot, env = process.env) {
  const stored = await readJson(statsFile(repoRoot, env), null).catch(() => null);
  return {
    version: 1, repoRoot,
    answered: count(stored?.answered), firstTry: count(stored?.firstTry), streak: count(stored?.streak), bestStreak: count(stored?.bestStreak),
    completed: count(stored?.completed), skipped: count(stored?.skipped), updatedAt: stored?.updatedAt ?? null,
    recent: Array.isArray(stored?.recent) ? stored.recent.filter(item => typeof item === 'boolean').slice(-RECENT) : [],
  };
}

async function update(repoRoot, env, change) {
  try {
    const stats = change(await readStats(repoRoot, env));
    await writeJson(statsFile(repoRoot, env), { ...stats, updatedAt: new Date().toISOString() });
  } catch { /* The score never affects a check. */ }
}

/** One question's first graded answer: correct on the first try, or not. */
export const recordAnswer = ({ repoRoot, correct, env = process.env }) => update(repoRoot, env, stats => {
  const streak = correct ? stats.streak + 1 : 0;
  return { ...stats, answered: stats.answered + 1, firstTry: stats.firstTry + (correct ? 1 : 0), streak, bestStreak: Math.max(stats.bestStreak, streak), recent: [...stats.recent, Boolean(correct)].slice(-RECENT) };
});

/** A check that asked questions was completed, or the human skipped it. */
export const recordCheck = ({ repoRoot, outcome, env = process.env }) => update(repoRoot, env, stats => ({
  ...stats, completed: stats.completed + (outcome === 'completed' ? 1 : 0), skipped: stats.skipped + (outcome === 'skipped' ? 1 : 0),
}));

/** What the questionnaire and CLI show. Accuracy stays hidden while calibrating. */
export function scoreSummary(stats) {
  const calibrating = stats.answered < CALIBRATION_QUESTIONS;
  const checks = stats.completed + stats.skipped;
  return {
    calibrating, answered: stats.answered, needed: Math.max(0, CALIBRATION_QUESTIONS - stats.answered),
    accuracy: calibrating ? null : Math.round((stats.firstTry / stats.answered) * 100),
    streak: stats.streak, bestStreak: stats.bestStreak,
    skipRate: checks ? Math.round((stats.skipped / checks) * 100) : null, checks,
    recent: stats.recent,
  };
}
