import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewer, reviewedData } from '../src/reviewer.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { QUESTION_SCHEMA, validateQuestion } from '../src/evaluator.js';

const snapshot = { id: 'recovery-snapshot', version: 2, files: ['worker.js'], projectContext: { path: '.sphinxcontext.md', text: 'A retry worker.', hash: 'context' } };
// These cases exercise explicitly configured allowances (the pre-1.0 defaults).
const config = { ...structuredClone(DEFAULT_CONFIG), maxModelCalls: 20, agentMaxTurns: 8, changeTier: 'large', timeoutSeconds: 5 };
const question = { id: 'retry', concept: 'Retry behavior', prompt: 'Will a duplicate id execute the operation again? Explain why.', choices: [], expectedAnswer: 'No, the stored id is checked before executing.', rationale: 'The changed worker delegates to the guard.', evidence: [{ path: 'worker.js', reason: 'Calls the retry guard.' }] };
const assessmentSchema = { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 1, items: QUESTION_SCHEMA } }, required: ['questions'] };
const base = { snapshot, config, assessmentSchema, assessmentInstructions: 'Ask one consequence question.', validateAssessment: (assessment, paths) => assessment.questions.map(item => validateQuestion(item, paths)) };
const finish = (candidate = question, evidenceIds) => ({ action: 'finish', calls: [], assessment: { questions: [candidate] }, summary: 'The retry guard owns duplicate prevention.', ...(evidenceIds === undefined ? {} : { evidenceIds }) });
const action = (name, args) => ({ action: 'tools', calls: [{ name, arguments: JSON.stringify(args) }], assessment: null, summary: '' });
function space({ rejectReads = false } = {}) {
  const evidencePaths = new Set(), reads = [];
  return { evidencePaths, reads, tools: ['list_files', 'read_file', 'read_diff', 'search'].map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })),
    async execute(name, args) {
      if (rejectReads) assert.fail('Resume must reuse archived reads');
      reads.push({ name, args });
      if (name === 'list_files') return { files: ['worker.js', '.sphinxcontext.md'], evidencePaths: [] };
      if (args.path === '.env') return { error: { code: 'PATH_UNAVAILABLE' }, evidencePaths: [] };
      evidencePaths.add(args.path);
      return { path: args.path, revision: name === 'read_diff' ? 'base..head' : 'head', baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), offset: 0, nextOffset: null, truncated: false,
        text: name === 'read_diff' ? `diff --git a/${args.path} b/${args.path}\n--- a/${args.path}\n+++ b/${args.path}\n@@ -1 +1 @@\n-old();\n+guard(id);\n` : 'if (seen.has(id)) return; seen.add(id); operation();', evidencePaths: [args.path] };
    } };
}
function checkpoint() {
  let state = null, saves = 0;
  return { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); saves++; }, get state() { return state; }, get saves() { return saves; } };
}

test('seeded context citations retain actual observations despite omitted or invented ID hints', async () => {
  const candidate = { ...question, evidence: [...question.evidence, { path: '.sphinxcontext.md', reason: 'The changed context describes the retry boundary.' }] };
  for (const nativeTools of [false, true]) {
    let calls = 0;
    const workspace = space();
    const provider = async args => { await args.beforeCall(); calls++; const result = finish(candidate, ['e1', 'e999']); return nativeTools ? { calls: [{ id: 'finish', name: 'finish_review', arguments: { assessment: result.assessment, summary: result.summary, evidenceIds: result.evidenceIds } }] } : result; };
    const result = await runReviewer({ ...base, snapshot: { ...snapshot, files: ['.sphinxcontext.md', 'worker.js'] }, workspace, nativeTools, runModel: provider, runToolModel: provider });
    assert.deepEqual(workspace.reads.map(read => read.args.path), ['worker.js', '.sphinxcontext.md']);
    assert.equal(calls, 1); assert.deepEqual(result.review.evidence.map(item => item.id), ['e1', 'e2']);
    assert.deepEqual(reviewedData(snapshot, result.review, candidate, config).allowedEvidencePaths, ['worker.js', '.sphinxcontext.md']);
  }
});

test('background context alone never authorizes a citation and the model can remove it after feedback', async () => {
  let calls = 0;
  const candidate = { ...question, evidence: [...question.evidence, { path: '.sphinxcontext.md', reason: 'Only background; no immutable observation.' }] };
  const result = await runReviewer({ ...base, workspace: space(), runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) return finish(candidate);
    assert.match(args.prompt, /outside the supplied evidence/);
    return finish();
  } });
  assert.equal(calls, 2); assert.deepEqual(result.review.evidencePaths, ['worker.js']);
});

test('failed investigation resumes from durable Pi state and exact evidence with one request remaining', async () => {
  const storage = checkpoint(), workspace = space(); let calls = 0;
  await assert.rejects(runReviewer({ ...base, workspace, reviewerCheckpoint: storage, runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) return action('read_file', { path: 'lib/guard.js' });
    throw new Error('Provider unavailable');
  } }), /Provider unavailable/);
  assert.equal(calls, 2); assert.equal(storage.state.calls, 2);
  assert.equal(storage.state.archive.length, 2); assert.ok(storage.state.entries.some(entry => entry.message?.role === 'toolResult'));
  assert.ok(storage.saves > 2);
  const candidate = { ...question, evidence: [...question.evidence, { path: 'lib/guard.js', reason: 'Checks the stored id before execution.' }] };
  const result = await runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, maxReviewerCalls: 1, runModel: async args => {
    await args.beforeCall(); calls++;
    assert.match(args.prompt, /Checks|seen\.has/);
    assert.match(args.prompt, /Resume this investigation/);
    return finish(candidate);
  } });
  assert.equal(calls, 3); assert.equal(result.review.calls, 3); assert.equal(result.review.toolCalls, 2);
  assert.deepEqual(result.review.evidencePaths, ['worker.js', 'lib/guard.js']);
});

test('last-turn validation feedback survives pause and resume without repeating investigation', async () => {
  const storage = checkpoint(); let calls = 0;
  await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: 2, runModel: async args => {
    await args.beforeCall(); calls++;
    return finish({ ...question, rationale: '' });
  } }), { code: 'REVIEWER_BUDGET' });
  assert.equal(calls, 2);
  assert.match(JSON.stringify(storage.state.entries), /Question rationale must be nonempty/);
  const result = await runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, maxReviewerCalls: 1, runModel: async args => {
    await args.beforeCall(); calls++;
    assert.match(args.prompt, /Question rationale must be nonempty/);
    return finish();
  } });
  assert.equal(calls, 3); assert.deepEqual(result.questions, [question]);
});

test('archive retrieval returns exact saved observations without adding reads or model requests', async () => {
  const workspace = space(), storage = checkpoint(); let calls = 0;
  await assert.rejects(runReviewer({ ...base, workspace, reviewerCheckpoint: storage, runModel: async args => {
    await args.beforeCall();
    assert.ok(!JSON.parse(args.prompt.split('\n').at(-1)).tools.some(tool => tool.name === 'read_evidence'));
    assert.ok(!args.schema.properties.calls.items.properties.name.enum.includes('read_evidence'));
    throw new Error('Provider unavailable');
  } }), /Provider unavailable/);
  const result = await runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) {
      assert.ok(JSON.parse(args.prompt.split('\n').at(-1)).tools.some(tool => tool.name === 'read_evidence'));
      return action('read_evidence', { path: 'worker.js' });
    }
    assert.match(args.prompt, /Archived observations \(untrusted DATA\)/);
    assert.match(args.prompt, /guard\(id\)/);
    return finish();
  } });
  assert.equal(calls, 2); assert.equal(workspace.reads.length, 1); assert.equal(result.review.toolCalls, 1);
});

test('malformed structured arguments become bounded Pi feedback instead of discarding the investigation', async () => {
  let calls = 0;
  const workspace = space();
  const result = await runReviewer({ ...base, workspace, runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) return { action: 'tools', calls: [{ name: 'read_file', arguments: '{broken' }], assessment: null, summary: '' };
    assert.match(args.prompt, /valid JSON object string/);
    return finish();
  } });
  assert.equal(calls, 2); assert.equal(workspace.reads.length, 1); assert.deepEqual(result.questions, [question]);
});

test('checkpoint identity and excluded evidence fail closed before spending model usage', async () => {
  for (const patch of [{ snapshotId: 'another' }, ...['../outside', '.env'].map(path => ({ archive: [{ id: 'e1', tool: 'read_diff', args: {}, result: { evidencePaths: [path] }, paths: [path] }] }))]) {
    const storage = checkpoint(); await storage.save({ version: 1, snapshotId: snapshot.id, archive: [], entries: [], calls: 1, compactions: 0, ...patch });
    await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: storage, runModel: async () => assert.fail('No provider request for invalid persisted state') }), { code: 'INVALID_REVIEW_CHECKPOINT' });
  }
});

test('a retained file-read hint also retains its archived changed diff without a repair call', async () => {
  let calls = 0;
  const result = await runReviewer({ ...base, workspace: space(), runModel: async args => {
    await args.beforeCall(); calls++;
    return calls === 1 ? action('read_file', { path: 'worker.js' }) : finish(question, ['e2']);
  } });
  assert.equal(calls, 2);
  assert.deepEqual(result.review.evidence.map(item => item.id), ['e2', 'e1']);
});

test('abort waits for pending persistence and never saves after the reviewer rejects', async () => {
  const controller = new AbortController();
  let saves = 0, rejected = false, activeSave = 0, requests = 0;
  const storage = { load: async () => null, save: async () => {
    activeSave++;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(rejected, false, 'A checkpoint write cannot outlive the session lock owner');
    saves++; activeSave--;
  } };
  await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: storage, signal: controller.signal, runModel: async args => {
    await args.beforeCall(); requests++;
    controller.abort(new Error('Cancelled by human'));
    return new Promise(() => {});
  } }), /Cancelled by human/);
  rejected = true; const done = saves;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests, 1); assert.equal(activeSave, 0); assert.equal(saves, done);
});

test('bootstrap prioritizes changed behavior over an alphabetical run of documentation', async () => {
  const workspace = space(), files = [...Array.from({ length: 10 }, (_, index) => `docs/${index}.md`), 'worker.js', 'package-lock.json'];
  const result = await runReviewer({ ...base, snapshot: { ...snapshot, files }, workspace, runModel: async args => { await args.beforeCall(); return finish(); } });
  assert.equal(workspace.reads[0].args.path, 'worker.js');
  assert.equal(workspace.reads.length, 8);
  assert.deepEqual(result.review.evidencePaths, ['worker.js']);
});

test('independent audit corrects a key within the same small-review allowance', async () => {
  let providerCalls = 0, auditCalls = 0, charges = 0;
  const incorrect = { ...question, expectedAnswer: 'Yes, duplicates always execute.' };
  const result = await runReviewer({ ...base, config: { ...config, changeTier: 'small' }, workspace: space(), beforeCall: async () => { charges++; }, runModel: async args => {
    await args.beforeCall(); providerCalls++;
    if (providerCalls === 1) return action('read_file', { path: 'worker.js' });
    assert.deepEqual(args.schema.properties.action.enum, ['tools', 'finish'], 'A grounded proposal can finish before the ceiling');
    return finish(incorrect);
  }, auditAssessment: async args => {
    await args.beforeCall(); auditCalls++;
    assert.equal(args.questions[0].expectedAnswer, incorrect.expectedAnswer);
    assert.deepEqual(args.review.evidencePaths, ['worker.js']);
    return { questions: [question] };
  } });
  assert.equal(providerCalls, 2); assert.equal(auditCalls, 1); assert.equal(charges, 3);
  assert.equal(result.review.calls, 3); assert.deepEqual(result.questions, [question]);
});

test('a rejected audit can inspect the missing dependency and finish within five small-review calls', async () => {
  let calls = 0, audits = 0, charges = 0;
  const candidate = { ...question, evidence: [...question.evidence, { path: 'lib/guard.js', reason: 'Checks stored ids before invoking the operation.' }] };
  const workspace = space();
  const result = await runReviewer({ ...base, config: { ...config, changeTier: 'small' }, workspace, beforeCall: async () => { charges++; }, runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) return finish();
    if (calls === 2) {
      assert.match(args.prompt, /Inspect the guard implementation/);
      assert.deepEqual(args.schema.properties.action.enum, ['tools', 'finish']);
      return action('read_file', { path: 'lib/guard.js' });
    }
    assert.deepEqual(args.schema.properties.action.enum, ['finish']);
    return finish(candidate);
  }, auditAssessment: async args => {
    await args.beforeCall(); audits++;
    if (audits === 1) throw Object.assign(new Error('The question needs more evidence.'), { recoverable: true, reviewFeedback: 'Inspect the guard implementation before claiming duplicate prevention.' });
    assert.ok(args.review.evidence.some(item => item.tool === 'read_file' && item.args.path === 'lib/guard.js'));
    return { questions: args.questions };
  } });
  assert.equal(charges, 5); assert.equal(calls, 3); assert.equal(audits, 2);
  assert.equal(workspace.reads.length, 2); assert.deepEqual(result.questions, [candidate]);
});

test('audit headroom respects medium and explicit configured ceilings for both transports', async () => {
  for (const nativeTools of [false, true]) for (const [changeTier, agentMaxTurns, limit] of [['small', 8, 5], ['medium', 8, 7], ['small', 3, 3]]) {
    let charges = 0;
    const provider = async args => {
      await args.beforeCall();
      const last = charges === limit - 1;
      if (!nativeTools) {
        assert.deepEqual(args.schema.properties.action.enum, last ? ['finish'] : ['tools', 'finish']);
        return last ? finish() : action('read_file', { path: 'worker.js' });
      }
      assert.ok(!args.tools.some(tool => tool.function.name === 'read_evidence'));
      assert.deepEqual(args.toolChoice, last ? { type: 'function', function: { name: 'finish_review' } } : undefined);
      return { calls: [{ id: `call-${charges}`, name: last ? 'finish_review' : 'read_file', arguments: last ? { assessment: { questions: [question] }, summary: 'The worker invokes its guard.' } : { path: 'worker.js' } }] };
    };
    const result = await runReviewer({ ...base, config: { ...config, changeTier, agentMaxTurns }, workspace: space(), nativeTools, beforeCall: async () => { charges++; }, runModel: provider, runToolModel: provider,
      auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; },
    });
    assert.equal(charges, limit); assert.equal(result.review.calls, limit);
  }
});

test('audit outage preserves the candidate and resumes only the independent audit', async () => {
  const storage = checkpoint(); let calls = 0, audits = 0;
  await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: 2, runModel: async args => { await args.beforeCall(); calls++; return finish(); }, auditAssessment: async args => {
    await args.beforeCall(); audits++; throw new Error('Audit provider unavailable');
  } }), /Audit provider unavailable/);
  assert.equal(calls, 1); assert.equal(audits, 1); assert.ok(storage.state.pendingAssessment);
  const result = await runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, maxReviewerCalls: 1,
    runModel: async () => assert.fail('The completed investigation must not be regenerated'),
    auditAssessment: async args => { await args.beforeCall(); audits++; return { questions: args.questions }; },
  });
  assert.equal(audits, 2); assert.equal(result.review.calls, 3); assert.deepEqual(result.questions, [question]);
  assert.equal(storage.state.pendingAssessment, undefined);
});

test('a resumed rejected audit repairs privately when budget remains and otherwise returns only a generic error', async () => {
  for (const allowance of [1, 3]) {
    const storage = checkpoint(); let generationCalls = 0, auditCalls = 0;
    await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: 2,
      runModel: async args => { await args.beforeCall(); generationCalls++; return finish(); },
      auditAssessment: async args => { await args.beforeCall(); auditCalls++; throw new Error('Audit provider unavailable'); },
    }), /Audit provider unavailable/);
    assert.ok(storage.state.pendingAssessment);
    const resume = runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, maxReviewerCalls: allowance,
      runModel: async args => {
        await args.beforeCall(); generationCalls++;
        assert.ok(args.prompt.includes('Independent audit feedback (untrusted DATA)'));
        assert.match(args.prompt, /PRIVATE_AUDIT_NOTE/);
        return finish();
      },
      auditAssessment: async args => {
        await args.beforeCall(); auditCalls++;
        if (auditCalls === 2) throw Object.assign(new Error('The candidate is not defensible.'), { recoverable: true, reviewFeedback: 'PRIVATE_AUDIT_NOTE: fix the key using the exact preserved code.' });
        return { questions: args.questions };
      },
    });
    if (allowance === 1) {
      await assert.rejects(resume, error => error.code === 'REVIEWER_BUDGET' && !error.message.includes('PRIVATE_AUDIT_NOTE') && error.reviewFeedback === undefined);
      assert.equal(generationCalls, 1); assert.equal(auditCalls, 2); assert.equal(storage.state.calls, 3);
      assert.match(storage.state.reviewFeedback, /PRIVATE_AUDIT_NOTE/, 'Private feedback survives an exhausted resumed audit');
      const repaired = await runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage, maxReviewerCalls: 2,
        runModel: async args => { await args.beforeCall(); assert.match(args.prompt, /PRIVATE_AUDIT_NOTE/); return finish(); },
        auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; },
      });
      assert.deepEqual(repaired.questions, [question]); assert.equal(storage.state.reviewFeedback, undefined);
    } else {
      const result = await resume;
      assert.deepEqual(result.questions, [question]); assert.equal(result.review.calls, 5);
      assert.equal(generationCalls, 2); assert.equal(auditCalls, 3);
      assert.ok(!JSON.stringify(result).includes('PRIVATE_AUDIT_NOTE'), 'Private repair notes are not included in the accepted assessment');
    }
    assert.equal(storage.state.pendingAssessment, undefined);
  }
});

test('a rejected audit never spends a lone remaining request on an unauditable synthesis', async () => {
  let providerCalls = 0, auditCalls = 0, charges = 0;
  await assert.rejects(runReviewer({ ...base, workspace: space(), maxReviewerCalls: 3,
    beforeCall: async () => { charges++; },
    runModel: async args => { await args.beforeCall(); providerCalls++; assert.equal(providerCalls, 1); return finish(); },
    auditAssessment: async args => { await args.beforeCall(); auditCalls++; throw Object.assign(new Error('The candidate is not defensible.'), { recoverable: true, reviewFeedback: 'Private correction notes.' }); },
  }), { code: 'REVIEWER_BUDGET' });
  assert.equal(providerCalls, 1); assert.equal(auditCalls, 1); assert.equal(charges, 2);
});

test('one bounded repair window can read a missing citation after late final validation without extending shared allowance', async () => {
  for (const shared of [5, 8]) {
    const storage = checkpoint(); let turns = 0, charges = 0, audits = 0;
    const candidate = { ...question, evidence: [...question.evidence, { path: 'lib/guard.js', reason: 'Checks the stored id before executing.' }] };
    const result = runReviewer({ ...base, config: { ...config, changeTier: 'small' }, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: shared,
      beforeCall: async () => { charges++; },
      runModel: async args => {
        await args.beforeCall(); turns++;
        if (turns < 4) return action('read_file', { path: 'worker.js' });
        if (turns === 4) return finish({ ...question, evidence: [...question.evidence, { path: '.sphinxcontext.md', reason: 'Unread background citation.' }] });
        if (turns === 5) {
          assert.match(args.prompt, /outside the supplied evidence/);
          assert.deepEqual(args.schema.properties.action.enum, ['tools', 'finish']);
          return action('read_file', { path: 'lib/guard.js' });
        }
        assert.equal(turns, 6); return finish(candidate);
      },
      auditAssessment: async args => { await args.beforeCall(); audits++; return { questions: args.questions }; },
    });
    if (shared === 5) {
      await assert.rejects(result, { code: 'REVIEWER_BUDGET' });
      assert.equal(charges, 4); assert.equal(audits, 0);
    } else {
      assert.deepEqual((await result).questions, [candidate]);
      assert.equal(charges, 7); assert.equal(audits, 1);
    }
    assert.equal(storage.state.calls, charges); assert.equal(storage.state.repairWindowUsed, true);
  }
});

test('a second audit rejection cannot extend the same repair window again', async () => {
  const storage = checkpoint(); let turns = 0, charges = 0, audits = 0;
  await assert.rejects(runReviewer({ ...base, config: { ...config, changeTier: 'small', agentMaxTurns: 12 }, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: 12,
    beforeCall: async () => { charges++; },
    runModel: async args => { await args.beforeCall(); turns++; return turns <= 3 || turns === 5 ? action('read_file', { path: 'worker.js' }) : finish(); },
    auditAssessment: async args => { await args.beforeCall(); audits++; throw Object.assign(new Error('Rejected candidate.'), { recoverable: true }); },
  }), { code: 'REVIEWER_BUDGET' });
  assert.equal(charges, 8); assert.equal(audits, 2); assert.equal(storage.state.repairWindowUsed, true);
});

test('Pi final-tool schema rejection opens only the same bounded repair window', async () => {
  for (const shared of [5, 8]) {
    const storage = checkpoint(); let turns = 0, charges = 0, audits = 0;
    const result = runReviewer({ ...base, config: { ...config, changeTier: 'small' }, workspace: space(), reviewerCheckpoint: storage, maxReviewerCalls: shared, nativeTools: true,
      beforeCall: async () => { charges++; },
      runToolModel: async args => {
        await args.beforeCall(); turns++;
        if (turns < 4) return { calls: [{ id: `read-${turns}`, name: 'read_file', arguments: { path: 'worker.js' } }] };
        if (turns === 4) return { calls: [{ id: 'invalid-finish', name: 'finish_review', arguments: { summary: 'A malformed final response.', assessment: { padding: 8 } } }] };
        assert.equal(turns, 5);
        assert.match(JSON.stringify(args.messages), /Validation failed for tool/);
        assert.match(JSON.stringify(args.messages), /assessment.questions/);
        return { calls: [{ id: 'corrected-finish', name: 'finish_review', arguments: { summary: 'The retry guard prevents repeated execution.', assessment: { questions: [question] } } }] };
      },
      auditAssessment: async args => { await args.beforeCall(); audits++; return { questions: args.questions }; },
    });
    if (shared === 5) {
      await assert.rejects(result, { code: 'REVIEWER_BUDGET' });
      assert.equal(charges, 4); assert.equal(audits, 0);
    } else {
      assert.deepEqual((await result).questions, [question]);
      assert.equal(charges, 6); assert.equal(audits, 1);
    }
    assert.equal(storage.state.calls, charges);
    assert.equal(storage.state.repairWindowUsed, true);
  }
});

test('audit cannot add unread citations or exceed its reserved allowance', async () => {
  let calls = 0, audits = 0;
  await assert.rejects(runReviewer({ ...base, workspace: space(), maxReviewerCalls: 2,
    runModel: async args => { await args.beforeCall(); calls++; return finish(); },
    auditAssessment: async args => { await args.beforeCall(); audits++; return { questions: [{ ...question, evidence: [{ path: 'unread.js', reason: 'Invented.' }] }] }; },
  }), { code: 'REVIEWER_BUDGET' });
  assert.equal(calls, 1); assert.equal(audits, 1);
});

test('checkpoint storage failures stop before another model request and settle all writes', async () => {
  let saves = 0, requests = 0;
  await assert.rejects(runReviewer({ ...base, workspace: space(), reviewerCheckpoint: { load: async () => null, save: async () => { saves++; throw new Error('Checkpoint disk unavailable'); } },
    runModel: async () => { requests++; assert.fail('Persistence must succeed before inference'); },
  }), /Checkpoint disk unavailable/);
  assert.equal(saves, 1); assert.equal(requests, 0);
});

test('oversized persisted state is rejected before workspace reads or inference', async () => {
  const storage = checkpoint();
  await storage.save({ version: 1, snapshotId: snapshot.id, archive: [], entries: [], calls: 1, compactions: 0, padding: 'x'.repeat(2 * 1024 * 1024) });
  await assert.rejects(runReviewer({ ...base, workspace: space({ rejectReads: true }), reviewerCheckpoint: storage,
    runModel: async () => assert.fail('Oversized state must not reach a provider'),
  }), { code: 'INVALID_REVIEW_CHECKPOINT' });
});

test('without a call cap, valid investigation can pass the planning target and reports live progress', async () => {
  let calls = 0;
  const events = [];
  const uncapped = { ...config, maxModelCalls: null, agentMaxTurns: null, changeTier: 'small' };
  const result = await runReviewer({ ...base, config: uncapped, workspace: space(), onProgress: text => events.push(text), runModel: async args => {
    await args.beforeCall(); calls++;
    if (calls <= 5) {
      assert.doesNotMatch(args.prompt, /planning target for this change size is reached/);
      return action('read_file', { path: 'lib/guard.js', startLine: calls });
    }
    assert.match(args.prompt, /planning target for this change size is reached/);
    return finish();
  }, auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; } });
  assert.equal(calls, 6, 'The old small-change ceiling of five would have stopped this review');
  assert.deepEqual(result.questions, [question]);
  assert.ok(events.includes('Reading lib/guard.js'));
  assert.ok(events.includes('Drafting questions'));
  assert.ok(events.includes('Checking the questions against the source'));
});

test('without a call cap, three consecutive invalid responses stop the review', async () => {
  let calls = 0;
  const uncapped = { ...config, maxModelCalls: null, agentMaxTurns: null, changeTier: 'small' };
  await assert.rejects(runReviewer({ ...base, config: uncapped, workspace: space(), runModel: async args => {
    await args.beforeCall(); calls++;
    return { action: 'nonsense' };
  } }), { code: 'REVIEWER_STALLED' });
  assert.equal(calls, 3);
});

test('without a call cap, identical reads are not re-run and repeated duplicates close investigation', async () => {
  let calls = 0, closedAt;
  const workspace = space();
  const uncapped = { ...config, maxModelCalls: null, agentMaxTurns: null, changeTier: 'large' };
  const result = await runReviewer({ ...base, config: uncapped, workspace, runModel: async args => {
    await args.beforeCall(); calls++;
    if (args.schema.properties.action.enum.length === 1) { closedAt ??= calls; return finish(); }
    if (calls > 2) assert.match(args.prompt, /already made; its result is archived/);
    return action('list_files', { prefix: 'src/' });
  }, auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; } });
  assert.equal(workspace.reads.filter(read => read.name === 'list_files' && read.args.prefix === 'src/').length, 1, 'The identical listing ran once');
  assert.equal(closedAt, 5, 'One real read, three duplicates, then finish-only');
  assert.deepEqual(result.questions, [question]);
});

test('without a call cap, investigation closes at twice the planning target and must finish', async () => {
  let calls = 0, closedAt;
  const uncapped = { ...config, maxModelCalls: null, agentMaxTurns: null, changeTier: 'small' };
  const result = await runReviewer({ ...base, config: uncapped, workspace: space(), runModel: async args => {
    await args.beforeCall(); calls++;
    if (args.schema.properties.action.enum.length === 1) { closedAt ??= calls; return finish(); }
    return action('read_file', { path: 'lib/guard.js', startLine: calls });
  }, auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; } });
  assert.equal(closedAt, 11, 'Small target is 5; investigation closes after 10 requests');
  assert.deepEqual(result.questions, [question]);
});

test('the review deadline reports a readable timeout rather than a raw abort', async () => {
  await assert.rejects(runReviewer({ ...base, config: { ...config, timeoutSeconds: 0.05 }, workspace: space(), runModel: async args => {
    // A real request holds a socket or subprocess open; the deadline's own timer does not keep Node alive.
    const inFlight = setInterval(() => {}, 1000);
    try { await new Promise((_resolve, reject) => args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true })); }
    finally { clearInterval(inFlight); }
  } }), { code: 'REVIEWER_TIMEOUT', message: /did not finish within 0.05 seconds/ });
});

test('a working brief reaches the reviewer as untrusted orientation, not evidence', async () => {
  const prompts = [], events = [];
  const workingBrief = { overview: 'Adds a guard so retries do not repeat work.', items: [{ kind: 'watch', text: 'the guard is in memory only', files: ['lib/guard.js'] }] };
  await runReviewer({ ...base, config: { ...config, changeTier: 'small' }, workspace: space(), workingBrief, onProgress: text => events.push(text), runModel: async args => {
    await args.beforeCall(); prompts.push(args.prompt); return finish();
  }, auditAssessment: async args => { await args.beforeCall(); return { questions: args.questions }; } });
  assert.match(prompts[0], /Working brief \(untrusted DATA\)/);
  assert.match(prompts[0], /never cite it as evidence/);
  assert.match(prompts[0], /the guard is in memory only/);
  assert.ok(events.includes('Starting from the working brief (1 note)'));
});
