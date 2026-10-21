import path from 'node:path';
import { loadConfig, policyHash } from './config.js';
import { repository, pushSnapshots, commitSnapshot, revalidateSnapshot } from './git.js';
import { createSessionStore } from './sessions.js';
import { queuePresentation, claimPresentation, listPresentations } from './presentations.js';
import { createBrowserInterview } from './browser-interview.js';
import { yoloStatus, recordOverride } from './overrides.js';

async function snapshotsFor({ event, args, input, cwd, config, env }) {
  if (event === 'pre-push') return pushSnapshots({ cwd, remote: args[0], remoteUrl: args[1], input, config, env });
  if (event === 'pre-commit') return [await commitSnapshot({ cwd, config, env })].filter(Boolean);
  return [];
}

/** Preserve Git's operation context while the human questionnaire runs. */
export function interviewEnvironment(cwd, env) {
  const scoped = { ...env };
  for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) {
    if (typeof env[key] === 'string' && env[key]) scoped[key] = path.resolve(cwd, env[key]);
    else delete scoped[key];
  }
  return scoped;
}

/** Wait inside Git's original hook. Never reconstruct or replay a Git command. */
export async function runGitGate({ event, args = [], input = '', cwd = process.cwd(), env = process.env, signal,
  store: providedStore, readConfig = loadConfig, snapshotsFor: collectSnapshots = snapshotsFor,
  revalidate = revalidateSnapshot, present, readYolo = yoloStatus, logOverride = recordOverride,
  queue = queuePresentation, claim = claimPresentation, listRequests = listPresentations,
  output = line => process.stderr.write(`${line}\n`), watchMs = 1000,
} = {}) {
  if (env.SPHINX_EVALUATOR === '1') return 0;
  signal?.throwIfAborted();
  const repo = await repository(cwd);
  const config = await readConfig(repo.root, env);
  const snapshots = await collectSnapshots({ event, args, input, cwd, config, env });
  if (!snapshots.length) return 0;
  // Names what invalidated a snapshot: 'settings', 'source', or null if it still applies.
  const staleness = async (snapshot, expected) => {
    const current = await readConfig(snapshot.repoRoot, env);
    if (policyHash(current) !== policyHash(expected)) return 'settings';
    return await revalidate(snapshot, current, { env }) ? null : 'source';
  };
  const validate = async (snapshot, expected) => {
    signal?.throwIfAborted();
    if (await staleness(snapshot, expected)) {
      throw new Error('The code, project context, or policy changed while Git was waiting. This operation was stopped; start a new Git operation for the updated change.');
    }
    signal?.throwIfAborted();
  };
  // Yolo is a straight bypass: no check is created, so nothing resurfaces later.
  const yolo = await readYolo(repo.root, env);
  if (yolo) {
    for (const snapshot of snapshots) await logOverride({ kind: 'yolo', repoRoot: repo.root, target: snapshot.target.ref, id: snapshot.id, head: snapshot.head, reason: yolo.reason }, env);
    output(`Sphinx: yolo mode is on ${yolo.scope === 'repo' ? 'for this repository' : 'globally'}; skipping the understanding check. Run sphinx yolo${yolo.scope === 'global' ? ' outside a repository' : ''} to turn it off.`);
    return 0;
  }
  const store = providedStore ?? createSessionStore({ env, validate });
  const pending = [];
  for (const snapshot of snapshots) {
    signal?.throwIfAborted();
    if (await store.approved(snapshot, config)) continue;
    const session = await store.ensure(snapshot, config);
    pending.push({ snapshot, session });
    output(`Sphinx: understanding check needed for ${snapshot.target.ref} (${session.route.tier} change).`);
  }

  const requests = [], skipped = new Set();
  const browser = present ? null : createBrowserInterview({ env, signal, output });
  // A settings or source change makes the waiting checks inapplicable (sphinx
  // pending stops listing them). Release Git promptly instead of leaving it
  // blocked on a questionnaire that can no longer approve this operation.
  const watcher = new AbortController();
  const waitSignal = signal ? AbortSignal.any([signal, watcher.signal]) : watcher.signal;
  const retry = event === 'pre-commit' ? 'git commit' : 'git push';
  let checking = false;
  const watch = setInterval(async () => {
    if (checking || watcher.signal.aborted) return;
    checking = true;
    try {
      for (const snapshot of snapshots) {
        if (skipped.has(snapshot.id)) continue;
        const reason = await staleness(snapshot, config);
        if (!reason) continue;
        watcher.abort(Object.assign(new Error(reason === 'settings'
          ? `Sphinx settings changed while Git was waiting, so this check was discarded. This Git operation was stopped; run ${retry} again to start a fresh check.`
          : `The code or project context changed while Git was waiting, so this check was discarded. This Git operation was stopped; run ${retry} again for the updated change.`), { code: 'SPHINX_STALE' }));
        break;
      }
    } catch {} // A transient read failure is retried on the next tick; the final validation still applies.
    finally { checking = false; }
  }, watchMs);
  const discarded = () => watcher.signal.aborted && !signal?.aborted;
  try {
    // These requests belong to the waiting hook, not a post-tool callback.
    // Mark the whole batch before launching so sibling tools cannot open forms.
    for (const { session, snapshot } of pending) {
      signal?.throwIfAborted();
      const request = await queue(session, { env, delivery: 'hook' });
      requests.push({ ...request, event: snapshot.event });
      const old = await listRequests({ cwd: request.repoRoot, host: request.host, hostSession: request.hostSession, env });
      for (const previous of old.filter(item => item.id === request.id)) await claim(previous, { env });
    }
    if (requests.length) output('Sphinx: Git is waiting for your answers in the local Sphinx questionnaire. It will continue automatically after you pass. Do not start another copy of this Git operation.');
    const interviewEnv = interviewEnvironment(cwd, env);
    for (let index = 0; index < requests.length; index++) {
      signal?.throwIfAborted();
      const result = await (present || browser.present)({ request: requests[index], env: interviewEnv, signal: waitSignal }).catch(error => {
        if (!discarded()) throw error;
      });
      if (discarded()) { output(`Sphinx: ${watcher.signal.reason.message}`); return 1; }
      signal?.throwIfAborted();
      if (result?.status === 'unavailable') {
        // Native callbacks only run after Git exits. Keep that explicit fallback
        // for noninteractive environments without a local browser handoff.
        for (const { session } of pending.slice(index)) {
          await queue(session, { env });
          output(`Outside a supported agent, run sphinx check --id ${session.id} in your terminal.`);
        }
        output('Sphinx: no local questionnaire is available in this environment. This Git operation was stopped. Complete the queued check, then start the Git operation again.');
        return 1;
      }
      if (result?.status === 'skipped') { skipped.add(requests[index].id); output('Sphinx: understanding check skipped for this push and logged.'); continue; }
      if (result?.status !== 'passed') {
        output('Sphinx: the understanding check is incomplete, cancelled, or timed out. This Git operation was stopped; progress is saved.');
        return 1;
      }
    }

    // The interview result is only a wake-up signal. Every original destination
    // needs a current receipt, including snapshots approved before the wait.
    for (const snapshot of snapshots) {
      if (skipped.has(snapshot.id)) continue;
      await validate(snapshot, config);
      if (!(await store.approved(snapshot, config))) {
        output('Sphinx: no valid completion exists for this exact change and destination. This Git operation was stopped.');
        return 1;
      }
    }
    signal?.throwIfAborted();
    if (requests.length) output('Sphinx: understanding check complete. Continuing this Git operation.');
    return 0;
  } finally {
    clearInterval(watch);
    // A paused or cancelled batch must not reopen from an after-tool callback.
    for (const request of requests) await claim(request, { env });
    await browser?.close();
  }
}
