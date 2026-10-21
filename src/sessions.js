import path from 'node:path';
import { withUsageMeter, addUsage } from './usage.js';
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { DEFAULT_CONFIG, getPaths, readJson, writeJson, policyHash } from './config.js';
import { selectRoute, evaluatorConfig, questionLimit } from './routing.js';
import { generateAssessment, gradeAnswer } from './evaluator.js';
import { setTimeout as delay } from 'node:timers/promises';

const now = () => new Date().toISOString();
export function sessionFile(id, env = process.env) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid assessment ID. Run sphinx pending to find it.');
  return path.join(getPaths(env).sessions, `${id}.json`);
}
async function withLock(id, env, operation, { signal, deadline = 0 } = {}) {
  signal?.throwIfAborted();
  const file = `${sessionFile(id, env)}.lock`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Another process may have created its lock but not yet written the PID.
    const lock = await readJson(file, {}).catch(() => ({}));
    // A process can die after exclusive creation but before writing its PID.
    // Leave new partial locks alone; recover old orphaned ones on explicit retry.
    let alive = await stat(file).then(info => Date.now() - info.mtimeMs < 30000).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
    if (Number.isInteger(lock.pid) && lock.pid > 0) {
      try { process.kill(lock.pid, 0); alive = true; } catch (err) { alive = err.code !== 'ESRCH'; }
    }
    if (alive) {
      if (deadline > Date.now()) {
        await delay(Math.min(200, deadline - Date.now()), undefined, { signal });
        return withLock(id, env, operation, { signal, deadline });
      }
      throw Object.assign(new Error('This assessment is already running. Wait for preparation to finish, then resume the check.'), { code: 'SPHINX_SESSION_BUSY' });
    }
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return withLock(id, env, operation, { signal, deadline });
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: now() }));
    return await operation();
  } finally { await handle.close(); await unlink(file).catch(() => {}); }
}
function validReceipt(session, config) {
  return session?.status === 'passed' && session.policy === policyHash(config) && Date.parse(session.expiresAt) > Date.now();
}
function callLimit(session) {
  const limit = session.callLimit === undefined ? session.config.maxModelCalls : session.callLimit;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('The assessment call limit is invalid.');
  return limit;
}
// A saved candidate can resume its independent audit directly. An investigation
// without a candidate still needs synthesis plus audit, even with exact reads saved.
const minimumReviewerCalls = session => session.reviewerCheckpoint?.pendingAssessment ? 1 : 2;
const retryHint = session => `Run sphinx check --id ${session.id} --retry-review to explicitly authorize a fresh review allowance; prior usage will be retained.`;
function withRecoveryMessage(error, message) {
  // Preserve only the transport's sanitized diagnostic metadata. A provider
  // payload or request must never leak through a nested cause in CLI output.
  const failure = new Error(message);
  failure.name = error.name || 'Error';
  for (const key of ['code', 'status', 'errorType']) if (error[key] !== undefined) failure[key] = error[key];
  if (Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0 && error.retryAfterSeconds <= 86400) failure.retryAfterSeconds = error.retryAfterSeconds;
  return failure;
}
function reviewFailure(error, session, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return error;
  const limit = callLimit(session);
  if (limit === null) {
    if (!['OPENROUTER_PROVIDER_ERROR', 'REVIEWER_BUDGET'].includes(error?.code)) return error;
    return withRecoveryMessage(error, `${error.message} When ready, continue the check: sphinx check --id ${session.id}.`);
  }
  const remaining = limit - session.calls - questionLimit(session.config.level, session.route.tier);
  const minimum = minimumReviewerCalls(session);
  if (['OPENROUTER_PROVIDER_ERROR', 'REVIEWER_BUDGET'].includes(error?.code) && remaining >= minimum) {
    const totalRemaining = callLimit(session) - session.calls;
    return withRecoveryMessage(error, `${error.message} ${totalRemaining} model calls remain in the existing assessment allowance (${session.calls}/${callLimit(session)} used). When ready, retry within that allowance: sphinx check --id ${session.id}.`);
  }
  if (error?.code !== 'REVIEWER_BUDGET' && remaining >= minimum) return error;
  return withRecoveryMessage(error, `${error.message} ${retryHint(session)}`);
}
// Accumulate reported tokens on the in-memory session; the next per-call save
// or the final save persists them alongside the call count.
const meterFor = session => usage => { session.tokens = addUsage(session.tokens, usage); };

/** The unsent text for the current question, or null. Kept out of publicSession, which reaches the coding agent. */
export function savedDraft(session) {
  const draft = session?.draft, question = session?.questions?.[session.index];
  if (!draft || !question || draft.questionId !== question.id || session.status === 'passed') return null;
  return { kind: draft.kind, text: draft.text };
}

export function publicSession(session) {
  const q = session.questions[session.index];
  return {
    id: session.id, status: session.status, event: session.snapshot.event,
    target: session.snapshot.target.ref, route: session.route,
    progress: { completed: session.index, total: session.questions.length },
    usage: { calls: session.calls, limit: callLimit(session) },
    tokens: { input: session.tokens?.input ?? 0, output: session.tokens?.output ?? 0, cost: session.tokens?.cost ?? null },
    ...(session.reviewRetries?.length ? { reviewAttempts: session.reviewRetries.length + 1 } : {}),
    ...(session.preparation ? { preparation: { status: session.preparation.status, ...(session.reviewerCheckpoint ? { resumable: true, minimumReviewerCalls: minimumReviewerCalls(session) } : {}), ...(session.review ? { toolCalls: session.review.toolCalls, compactions: session.review.compactions } : {}) } } : {}),
    // Concept labels are evaluator metadata and may themselves reveal the answer.
    ...(q && session.status !== 'passed' ? { question: { id: q.id, prompt: q.prompt, choices: q.choices } } : {}),
    ...(session.lastFeedback ? { feedback: session.lastFeedback } : {}),
    ...(session.status === 'passed' ? { expiresAt: session.expiresAt } : {}),
  };
}

export function createSessionStore({ env = process.env, generate = generateAssessment, grade = gradeAnswer, validate = async () => {} } = {}) {
  const read = id => readJson(sessionFile(id, env));
  const save = (session, options) => writeJson(sessionFile(session.id, env), session, options);
  async function syncCallLimit(session, config) {
    // A terminal may have been opened before a global ceiling edit. Reload it
    // under the assessment lock, including immediately before each model call.
    // Injected/in-memory settings remain usable when no global file exists.
    const global = await readJson(getPaths(env).config, undefined);
    if (global !== undefined && (!global || typeof global !== 'object' || Array.isArray(global))) throw new Error('Global Sphinx configuration must be a JSON object.');
    const configuredLimit = global === undefined ? config.maxModelCalls : Object.hasOwn(global, 'maxModelCalls') ? global.maxModelCalls : DEFAULT_CONFIG.maxModelCalls;
    if (configuredLimit !== null && (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 100)) throw new Error('maxModelCalls must be null (unlimited) or an integer between 1 and 100.');
    if (session.config.maxModelCalls === configuredLimit) return;
    const at = now(), previousLimit = callLimit(session);
    session.budgetChanges = [...(session.budgetChanges || []), { at, calls: session.calls, previousConfiguredLimit: session.config.maxModelCalls, configuredLimit, previousLimit, limit: configuredLimit }];
    session.config = { ...session.config, maxModelCalls: configuredLimit };
    session.callLimit = configuredLimit;
    session.updatedAt = at;
    await save(session);
  }
  async function refreshBudget(id, config, { signal } = {}) {
    return withLock(id, env, async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Start a fresh check.');
      await validate(session.snapshot, config);
      signal?.throwIfAborted();
      await syncCallLimit(session, config);
      return publicSession(session);
    }, { signal });
  }
  async function limitPendingQuestions(session, config) {
    if (session.status === 'passed' || !session.questions.length) return;
    // Older checkpoints used depth alone. Keep completed work and the current
    // question (including a learning follow-up), and drop only the unused tail.
    // Never award completion merely because an upgrade lowered the ceiling.
    const limit = Math.max(questionLimit(config.level, session.route.tier), session.index + 1);
    if (session.questions.length <= limit) return;
    session.questions = session.questions.slice(0, limit);
    session.updatedAt = now();
    await save(session);
  }
  async function budget(session, reserve = 0) {
    await syncCallLimit(session, session.config);
    const limit = callLimit(session);
    if (limit !== null && reserve && session.calls >= limit - reserve) throw new Error(`Assessment call limit (${limit}) leaves no investigation calls after reserving ${reserve} for grading. No additional model request was made.`);
    if (limit !== null && session.calls >= limit) throw new Error(`Assessment call limit (${limit}) reached. No additional model request was made.${session.questions.length ? '' : ` ${retryHint(session)}`}`);
    if (!Number.isSafeInteger(session.calls + 1)) throw new Error('The assessment usage counter cannot be incremented safely.');
    session.calls += 1;
    session.updatedAt = now();
    await save(session); // Failed requests also consume the local attempt budget.
  }
  async function ensure(snapshot, config) {
    const reusable = old => old && old.status !== 'skipped' && old.policy === policyHash(config) && (old.status !== 'passed' || validReceipt(old, config));
    // Hook reads must remain fast while the worker holds the assessment lock.
    const cached = await readJson(sessionFile(snapshot.id, env), null);
    if (reusable(cached)) return cached;
    return withLock(snapshot.id, env, async () => {
      const old = await readJson(sessionFile(snapshot.id, env), null);
      if (reusable(old)) return old;
      const session = {
        version: 2, id: snapshot.id, snapshot, config, policy: policyHash(config),
        route: selectRoute(snapshot,config), status: 'pending', questions: [], index: 0,
        calls: 0, attempts: [], createdAt: now(), updatedAt: now(), expiresAt: null,
      };
      await save(session);
      return session;
    });
  }
  async function approved(snapshot, config) {
    // A final answer is not committed until its writer releases the lock. In
    // particular, never expose a receipt while cancellation is rolling it back.
    // Reading under that same lock also prevents observing an old receipt inode
    // across an entire write-and-rollback cycle.
    try {
      return await withLock(snapshot.id, env, async () => validReceipt(await readJson(sessionFile(snapshot.id, env), null), config));
    } catch (error) {
      if (error.code === 'SPHINX_SESSION_BUSY') return false;
      throw error;
    }
  }
  async function retryReview(id, config, { signal } = {}) {
    return withLock(id, env, async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Retry your push or start a fresh check.');
      await validate(session.snapshot, config);
      signal?.throwIfAborted();
      await syncCallLimit(session, config);
      if (session.status !== 'pending' || session.questions.length || session.preparation?.status !== 'failed') throw new Error('Only a failed review with no questions can be restarted. Active questions and completed checks are preserved.');
      // Unlimited assessments need no additional authorization. Preserve their
      // failed state so an ordinary start can resume saved investigation work.
      if (callLimit(session) === null) return publicSession(session);
      const reserve = questionLimit(config.level, session.route.tier);
      const minimum = minimumReviewerCalls(session);
      const extension = config.maxModelCalls ?? session.config.maxModelCalls;
      if (extension < reserve + minimum) throw new Error(`A ${minimum === 1 ? 'saved audit' : 'review'} needs at least ${minimum} investigation call(s) and ${reserve} reserved grading call(s). The configured allowance of ${extension} cannot fit this review. No model request was made.`);
      // A recovery menu may predate a global ceiling increase. An explicit
      // one-attempt extension must never lower that newly adopted ceiling.
      const previousLimit = callLimit(session), limit = Math.max(previousLimit, session.calls + extension);
      if (!Number.isSafeInteger(limit)) throw new Error('The assessment call limit cannot be extended further.');
      const at = now();
      session.reviewRetries = [...(session.reviewRetries || []), { at, calls: session.calls, previousLimit, limit }];
      session.callLimit = limit;
      session.preparation = { status: 'pending', authorizedAt: at };
      session.updatedAt = at;
      signal?.throwIfAborted();
      await save(session);
      return publicSession(session);
    }, { signal });
  }
  async function prepare(id, config, {signal, wait = false, onProgress} = {}) {
    return withLock(id,env,async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Retry your push or start a fresh check.');
      await validate(session.snapshot, config);
      signal?.throwIfAborted();
      await syncCallLimit(session, config);
      if (validReceipt(session,config)) return publicSession(session);
      await limitPendingQuestions(session, config);
      signal?.throwIfAborted();
      if (!session.questions.length) {
        const reserve = questionLimit(config.level, session.route.tier);
        const limit = callLimit(session);
        const available = Math.min(config.agentMaxTurns ?? Infinity, limit === null ? Infinity : limit - session.calls - reserve);
        const maxReviewerCalls = available === Infinity ? null : available;
        const minimumCalls = minimumReviewerCalls(session);
        if (maxReviewerCalls !== null && maxReviewerCalls < minimumCalls) {
          session.preparation = { status: 'failed', completedAt: now() };
          session.updatedAt = now();
          await save(session);
          if (limit === null || config.agentMaxTurns !== null && config.agentMaxTurns < minimumCalls) throw new Error(`Configured reviewer turn limit (${config.agentMaxTurns}) cannot fit this review; at least ${minimumCalls} investigation call(s) are required. No model request was made.`);
          throw new Error(`Assessment call limit (${limit}) leaves ${Math.max(0, maxReviewerCalls)} investigation call(s); review needs at least ${minimumCalls}, plus ${reserve} reserved grading call(s). No model request was made. ${retryHint(session)}`);
        }
        session.preparation = { status: 'running', startedAt: now() };
        await save(session);
        let requests = 0;
        const beforeCall = async () => {
          signal?.throwIfAborted();
          if (maxReviewerCalls !== null && requests >= maxReviewerCalls) throw new Error('Reviewer call limit reached. The check remains pending.');
          await validate(session.snapshot, config);
          await budget(session, reserve);
          requests++;
          signal?.throwIfAborted();
        };
        // Private, bounded Pi state shares the assessment lock and atomic write.
        // It never crosses publicSession or becomes a completion receipt.
        const reviewerCheckpoint = {
          load: async () => structuredClone(session.reviewerCheckpoint ?? null),
          save: async state => {
            if (!state || state.version !== 1 || state.snapshotId !== session.snapshot.id
              || Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024) {
              throw new Error('The reviewer checkpoint is invalid or exceeds its storage limit.');
            }
            session.reviewerCheckpoint = structuredClone(state);
            session.updatedAt = now();
            await save(session);
          },
        };
        try {
          const result = await withUsageMeter(meterFor(session), () => generate(session.snapshot,evaluatorConfig(config,session.route),{beforeCall,signal,maxReviewerCalls,reviewerCheckpoint,onProgress,env}));
          signal?.throwIfAborted();
          if (!Array.isArray(result.questions) || !result.questions.length) throw new Error('Evaluator returned no grounded questions. The check remains pending.');
          if (result.questions.length > reserve) throw new Error('Evaluator exceeded the question limit. The check remains pending.');
          await validate(session.snapshot, config);
          signal?.throwIfAborted();
          session.questions = result.questions;
          if (result.review) session.review = result.review;
          delete session.reviewerCheckpoint;
          session.status = 'active';
          session.preparation = { status: 'ready', completedAt: now() };
          await save(session);
        } catch (error) {
          session.preparation = { status: 'failed', completedAt: now() };
          await save(session);
          throw reviewFailure(error, session, signal);
        }
      }
      return publicSession(session);
    }, { signal, deadline: wait ? Date.now() + (config.timeoutSeconds + 5) * 1000 : 0 });
  }
  const start = (id, config, options = {}) => prepare(id, config, { ...options, wait: true });
  async function answer(id, text, config, {dispute=false, learn=false, expectedQuestionId, signal} = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('An answer is required.');
    if (text.length > 8000) throw new Error('Please keep your answer below 8,000 characters.');
    return withLock(id,env,async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Start a fresh check.');
      await validate(session.snapshot,config);
      signal?.throwIfAborted();
      await syncCallLimit(session, config);
      if (validReceipt(session,config)) return publicSession(session);
      if (session.status !== 'active') throw new Error('Start this assessment with sphinx check first.');
      await limitPendingQuestions(session, config);
      signal?.throwIfAborted();
      const question = session.questions[session.index];
      if (expectedQuestionId !== undefined && question?.id !== expectedQuestionId) {
        const error = new Error('The question changed while you were answering. Retry the Git operation to reopen the current question.');
        error.code = 'SPHINX_STALE_QUESTION';
        throw error;
      }
      if (callLimit(session) !== null && session.calls >= callLimit(session)) throw new Error(`Assessment call limit (${callLimit(session)}) reached. No additional model request was made.`);
      // Keep the human's text until a grade is saved, so a provider failure or
      // cancellation never makes them type it again (see savedDraft).
      if (!learn) {
        session.draft = {questionId:question.id,kind:dispute?'dispute':'answer',text:text.trim(),at:now()};
        await save(session);
      }
      const beforeCall = async () => { signal?.throwIfAborted(); await budget(session); signal?.throwIfAborted(); };
      let result;
      try {
        result = await withUsageMeter(meterFor(session), () => grade({snapshot:session.snapshot,question,answer:text.trim(),config:evaluatorConfig(config,session.route),review:session.review,dispute,beforeCall,signal,env}));
      } catch (error) {
        if (learn || signal?.aborted || error?.name === 'AbortError') throw error;
        throw withRecoveryMessage(error, `${error.message} Your ${dispute ? 'dispute reason' : 'answer'} was saved and is offered again when you resume this question.`);
      }
      signal?.throwIfAborted();
      if (!['correct','incorrect','ambiguous'].includes(result.verdict)) throw new Error('Evaluator returned an invalid verdict. The check remains pending.');
      if ((learn || dispute) && result.verdict === 'correct') throw new Error('A learning request or dispute cannot complete a concept. The check remains pending.');
      // Capture after charging the grade: cancellation rolls back progress, not
      // model usage, and leaves the same question available to the human.
      const beforeAnswer = structuredClone(session);
      delete session.draft;
      session.attempts.push({questionId:question.id,answer:text.trim(),verdict:result.verdict,feedback:result.feedback,at:now()});
      session.lastFeedback = result.feedback;
      if (result.verdict === 'correct') {
        session.index += 1;
        if (session.index === session.questions.length) {
          await validate(session.snapshot,config);
          signal?.throwIfAborted();
          session.status = 'passed';
          session.expiresAt = new Date(Date.now()+config.receiptHours*3600000).toISOString();
        }
      } else if (result.followUp) {
        if (result.followUp.prompt.trim() === question.prompt.trim()) throw new Error('The evaluator repeated the question. Retry; no concept was marked complete.');
        session.questions[session.index] = result.followUp;
      } else if (result.verdict === 'incorrect' || learn) {
        throw new Error('The evaluator did not provide a transfer question. The concept remains pending.');
      }
      session.updatedAt = now();
      signal?.throwIfAborted();
      try {
        await save(session, { signal });
        signal?.throwIfAborted();
      } catch (error) {
        try { await save(beforeAnswer); }
        catch (rollbackError) {
          // If storage cannot restore pending progress, remove the possible
          // receipt before releasing the lock. Losing progress must fail closed.
          await unlink(sessionFile(id, env)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          throw new AggregateError([error, rollbackError], 'Could not save this answer; no approval was retained.');
        }
        throw error;
      }
      return {...publicSession(session), verdict:result.verdict};
    });
  }
  async function pending(repoRoot) {
    const files = await readdir(getPaths(env).sessions).catch(e => {if(e.code==='ENOENT')return [];throw e;});
    const records = [];
    for (const f of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const session = await readJson(path.join(getPaths(env).sessions,f));
      if (session.snapshot.repoRoot === repoRoot && !['passed', 'skipped'].includes(session.status)) records.push(session);
    }
    return records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  /** Close a check the human chose to skip. It never becomes a receipt or resurfaces. */
  async function skip(id) {
    return withLock(id, env, async () => {
      const session = await read(id);
      if (session.status === 'passed') return publicSession(session);
      session.status = 'skipped'; session.updatedAt = now();
      await save(session);
      return publicSession(session);
    });
  }
  /** Remove a check that never made a model call or produced a question. Anything with progress is kept. */
  async function discard(id) {
    return withLock(id, env, async () => {
      const session = await readJson(sessionFile(id, env), null);
      if (!session || session.status !== 'pending' || session.calls || session.questions.length || session.reviewerCheckpoint) return false;
      await unlink(sessionFile(id, env)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      return true;
    });
  }
  return {ensure,approved,prepare,start,retryReview,refreshBudget,answer,pending,read,skip,discard,public:publicSession};
}
