import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { loadIgnorePolicy } from './ignore.js';
import { workspaceDiffText } from './review-workspace.js';
import { repositoryName } from './git.js';

const exec = promisify(execFile);
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const REGULAR = new Set(['100644', '100755']);
// Display limits only. The reviewer's own evidence limits are unchanged.
export const VIEW_LIMITS = Object.freeze({ files: 2000, rows: 3000, bytes: 2 * 1024 * 1024, evidenceBytes: 8 * 1024 * 1024 });
export const CONTEXT_LEVELS = Object.freeze({ 3: 3, 25: 25, all: 1000000 });

class ChangeViewError extends Error {
  constructor(message) { super(message); this.code = 'CHANGE_VIEW_UNAVAILABLE'; }
}
const unavailable = message => { throw new ChangeViewError(message); };
const decoder = () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

async function git(root, args, { env, buffer = false, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await exec('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, encoding: buffer ? 'buffer' : 'utf8', maxBuffer, timeout: 30000,
      env: { ...process.env, ...env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return null;
    unavailable('The checkpoint’s Git objects are unavailable.');
  }
}

function treeEntries(raw) {
  const entries = new Map();
  for (const row of raw.split('\0').filter(Boolean)) {
    const match = /^(\d{6}) (?:blob|tree|commit) ([a-f0-9]+)\t([\s\S]*)$/u.exec(row);
    if (!match || !OID.test(match[2])) unavailable('The checkpoint inventory is malformed.');
    entries.set(match[3], { mode: match[1], oid: match[2] });
  }
  return entries;
}

// `git diff --raw -z -M`: rename rows carry two paths.
function rawRows(raw) {
  const fields = raw.split('\0'), rows = [];
  for (let index = 0; index < fields.length - 1;) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/u.exec(fields[index++]);
    if (!match) unavailable('The checkpoint comparison is malformed.');
    const [, oldMode, newMode, oldOid, newOid, status] = match;
    const first = fields[index++], second = status === 'R' || status === 'C' ? fields[index++] : undefined;
    if (!first || (second === '' )) unavailable('The checkpoint comparison is malformed.');
    rows.push({ status, oldMode, newMode, oldOid, newOid, oldPath: first, newPath: second ?? first });
  }
  return rows;
}

// `git diff --numstat -z -M`: renames use an empty path field followed by both paths.
function numstatRows(raw) {
  const fields = raw.split('\0'), stats = new Map();
  for (let index = 0; index < fields.length - 1;) {
    const row = fields[index++], first = row.indexOf('\t'), second = row.indexOf('\t', first + 1);
    if (first < 0 || second < 0) unavailable('The checkpoint line counts are malformed.');
    const added = row.slice(0, first), deleted = row.slice(first + 1, second);
    let path = row.slice(second + 1);
    if (!path) { index++; path = fields[index++]; }
    const binary = added === '-' || deleted === '-';
    stats.set(path, binary ? { binary: true, additions: null, deletions: null } : { binary: false, additions: Number(added), deletions: Number(deleted) });
  }
  return stats;
}

const kind = mode => !mode || /^0+$/u.test(mode) ? null : REGULAR.has(mode) ? 'file' : mode === '120000' ? 'symlink' : mode === '160000' ? 'submodule' : 'other';

/** Parse unified diff text into hunks with old/new line numbers. */
export function parseHunks(text) {
  const hunks = [];
  let hunk, oldLine = 0, newLine = 0;
  for (const line of text.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(line);
    if (header) {
      hunk = { oldStart: Number(header[1]), oldLines: header[2] === undefined ? 1 : Number(header[2]), newStart: Number(header[3]), newLines: header[4] === undefined ? 1 : Number(header[4]), section: header[5].trim(), rows: [] };
      hunks.push(hunk); oldLine = hunk.oldStart; newLine = hunk.newStart; continue;
    }
    if (!hunk || !line) continue;
    const sign = line[0], body = line.slice(1);
    if (sign === ' ') hunk.rows.push({ type: 'context', old: oldLine++, new: newLine++, text: body });
    else if (sign === '-') hunk.rows.push({ type: 'deletion', old: oldLine++, new: null, text: body });
    else if (sign === '+') hunk.rows.push({ type: 'addition', old: null, new: newLine++, text: body });
    else if (sign === '\\' && hunk.rows.length) hunk.rows.at(-1).noNewline = true;
  }
  return hunks;
}

function wholeFileHunk(text, side) {
  const lines = text.split('\n'), noNewline = text.length > 0 && !text.endsWith('\n');
  if (!noNewline) lines.pop();
  if (!lines.length) return [];
  const rows = lines.map((line, index) => side === 'new'
    ? { type: 'addition', old: null, new: index + 1, text: line }
    : { type: 'deletion', old: index + 1, new: null, text: line });
  if (noNewline) rows.at(-1).noNewline = true;
  return [side === 'new'
    ? { oldStart: 0, oldLines: 0, newStart: 1, newLines: rows.length, section: '', rows }
    : { oldStart: 1, oldLines: rows.length, newStart: 0, newLines: 0, section: '', rows }];
}

function mergeRanges(ranges) {
  const merged = [];
  for (const range of [...ranges].sort((a, b) => a.side.localeCompare(b.side) || a.start - b.start)) {
    const last = merged.at(-1);
    if (last && last.side === range.side && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** A display model of exactly one frozen checkpoint comparison. Every byte comes
 * from immutable blob IDs recorded for the checkpoint, never the working tree. */
export async function loadChangeView(snapshot, config, { env = process.env } = {}) {
  const root = snapshot?.repoRoot;
  if (typeof root !== 'string' || !Array.isArray(snapshot.files)) unavailable('This checkpoint has no recorded file inventory.');
  if (snapshot.base && !OID.test(snapshot.base)) unavailable('The checkpoint base is not an immutable Git object.');
  const commit = snapshot.event === 'pre-commit';
  if (commit && !Array.isArray(snapshot.indexEntries)) unavailable('This older commit checkpoint did not record its staged file inventory.');
  if (!commit && !OID.test(snapshot.head || '')) unavailable('The checkpoint head is not an immutable Git object.');
  const run = (args, options = {}) => git(root, args, { ...options, env });
  const ignore = await loadIgnorePolicy(root, { env, exclude: config.exclude });
  if (snapshot.ignoreHash && ignore.hash !== snapshot.ignoreHash) unavailable('The exclusion rules changed after this checkpoint was created.');
  const format = (await run(['rev-parse', '--show-object-format']))?.trim();
  const emptyTree = createHash(format === 'sha256' ? 'sha256' : 'sha1').update('tree 0\0').digest('hex');
  const base = snapshot.base ? treeEntries(await run(['ls-tree', '-r', '-z', '--full-tree', snapshot.base]) ?? '') : new Map();
  const head = commit
    ? new Map(snapshot.indexEntries.map(entry => [entry.path, { mode: entry.mode, oid: entry.oid }]))
    : treeEntries(await run(['ls-tree', '-r', '-z', '--full-tree', snapshot.head]) ?? '');
  const comparison = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', ...(commit ? ['--cached', snapshot.base || emptyTree] : [snapshot.base || emptyTree, snapshot.head])];
  const raw = await run([...comparison, '--raw', '-z', '--no-abbrev', '--']);
  const numstat = await run([...comparison, '--numstat', '-z', '--']);
  if (raw === null || numstat === null) unavailable('The checkpoint comparison is too large to display.');
  // A commit checkpoint compares against the live index. Accept it only when
  // it still matches the pinned index entries and did not move mid-read.
  if (commit && (await run([...comparison, '--raw', '-z', '--no-abbrev', '--'])) !== raw) unavailable('The staged changes moved while loading the checkpoint.');
  const stats = numstatRows(numstat), files = [], seen = new Set();
  const allowed = path => !ignore.matches(path);
  for (const row of rawRows(raw)) {
    const oldSide = row.status === 'A' ? null : { path: row.oldPath, mode: row.oldMode, oid: row.oldOid };
    const newSide = row.status === 'D' ? null : { path: row.newPath, mode: row.newMode, oid: row.newOid };
    for (const [side, tree] of [[oldSide, base], [newSide, head]]) {
      if (side && allowed(side.path) && tree.get(side.path)?.oid !== side.oid) unavailable('The checkpoint comparison no longer matches its recorded Git objects.');
    }
    let from = oldSide && allowed(oldSide.path) ? oldSide : null, to = newSide && allowed(newSide.path) ? newSide : null;
    if (!from && !to) continue;
    // A rename across an exclusion boundary must not reveal the excluded name.
    const split = row.status === 'R' && (!from || !to);
    if (from) seen.add(from.path);
    if (to) seen.add(to.path);
    const status = from && to ? (row.status === 'R' ? 'renamed' : 'modified') : to ? 'added' : 'deleted';
    const counted = split ? { binary: false, additions: null, deletions: null } : stats.get((to || from).path) ?? { binary: false, additions: null, deletions: null };
    files.push({
      path: (to || from).path, ...(status === 'renamed' ? { oldPath: from.path } : {}), status,
      binary: counted.binary, additions: counted.additions, deletions: counted.deletions,
      oldKind: kind(from?.mode), newKind: kind(to?.mode),
      ...(from && to && from.mode !== to.mode ? { modeChange: { from: from.mode, to: to.mode } } : {}),
      oldOid: from?.oid ?? null, newOid: to?.oid ?? null,
    });
  }
  const recorded = new Set(snapshot.files);
  if (seen.size !== recorded.size || [...seen].some(path => !recorded.has(path))) unavailable('The displayed comparison does not match the reviewed file list.');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const byPath = new Map(files.map(file => [file.path, file]));
  const totals = summarize(files);
  const header = {
    checkpoint: snapshot.id, repository: await repositoryName(root).catch(() => basename(root)), event: snapshot.event,
    remote: snapshot.target?.remote ?? null, destination: snapshot.target?.ref ?? null,
    base: snapshot.base ?? null, head: commit ? null : snapshot.head, staged: commit,
    excludedFiles: Array.isArray(snapshot.omitted) ? snapshot.omitted.length : 0,
  };

  async function blobText(oid) {
    const body = await run(['cat-file', 'blob', oid], { buffer: true, maxBuffer: VIEW_LIMITS.bytes });
    if (body === null) return { note: 'too-large' };
    if (body.includes(0)) return { note: 'binary' };
    try { return { text: decoder().decode(body) }; } catch { return { note: 'non-utf8' }; }
  }

  async function diff(path, { context = 3 } = {}) {
    const file = byPath.get(path);
    if (!file) unavailable('That file is not part of this checkpoint.');
    const level = Object.hasOwn(CONTEXT_LEVELS, context) ? context : 3;
    const result = { path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), status: file.status, binary: file.binary, additions: file.additions, deletions: file.deletions, ...(file.modeChange ? { modeChange: file.modeChange } : {}), context: String(level), hunks: [], truncated: null, note: null };
    const kinds = [file.oldKind, file.newKind].filter(Boolean);
    if (file.binary) return { ...result, note: 'binary' };
    if (kinds.some(value => value !== 'file')) return { ...result, note: kinds.includes('submodule') ? 'submodule' : kinds.includes('symlink') ? 'symlink' : 'unsupported' };
    let hunks;
    if (file.oldOid && file.newOid) {
      if (file.oldOid === file.newOid) return { ...result, note: file.status === 'renamed' ? 'rename-only' : 'mode-only' };
      const body = await run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--full-index', `--unified=${CONTEXT_LEVELS[level]}`, file.oldOid, file.newOid, '--'], { buffer: true, maxBuffer: VIEW_LIMITS.bytes });
      if (body === null) return { ...result, note: 'too-large' };
      let text;
      try { text = decoder().decode(body); } catch { return { ...result, note: 'non-utf8' }; }
      hunks = parseHunks(text);
    } else {
      const blob = await blobText(file.newOid || file.oldOid);
      if (blob.note) return { ...result, note: blob.note };
      hunks = wholeFileHunk(blob.text, file.newOid ? 'new' : 'old');
      if (!hunks.length) return { ...result, note: 'empty' };
    }
    const total = hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0);
    if (total > VIEW_LIMITS.rows) {
      let remaining = VIEW_LIMITS.rows;
      hunks = hunks.filter(() => remaining > 0).map(hunk => {
        const rows = hunk.rows.slice(0, remaining); remaining -= rows.length;
        return { ...hunk, rows, ...(rows.length < hunk.rows.length ? { cut: true } : {}) };
      });
      result.truncated = { shownRows: VIEW_LIMITS.rows, totalRows: total };
    }
    return { ...result, hunks };
  }

  // Map one retained read_diff page back to file lines, after checking that its
  // exact bytes still occur at the recorded offset of the regenerated text.
  const diffTexts = new Map();
  async function workspaceText(path) {
    if (diffTexts.has(path)) return diffTexts.get(path);
    const chunks = []; let size = 0, text = null;
    try {
      for await (const chunk of workspaceDiffText(root, path, base.get(path), head.get(path), env)) {
        size += chunk.length; if (size > VIEW_LIMITS.evidenceBytes) throw new Error('too large');
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks);
    } catch { text = null; }
    diffTexts.set(path, text); return text;
  }
  function diffLineMap(buffer, synthetic) {
    const lines = [], starts = [];
    let at = 0, oldLine = 0, newLine = 0, inHunk = synthetic, header = synthetic ? 0 : -1;
    const text = buffer.toString('utf8').split('\n');
    for (const line of text) {
      starts.push(at); at += Buffer.byteLength(line) + 1;
      let mapped = null;
      if (line.startsWith('File modes: ') && lines.length === 0) { lines.push(null); continue; }
      if (synthetic && header < 2) { header++; lines.push(null); if (header === 2) { oldLine = 1; newLine = 1; } continue; }
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
      if (!synthetic && hunk) { inHunk = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); lines.push(null); continue; }
      if (inHunk && line) {
        if (line[0] === ' ') mapped = { side: 'new', line: newLine++, oldLine: oldLine++ };
        else if (line[0] === '+') mapped = { side: 'new', line: newLine++ };
        else if (line[0] === '-') mapped = { side: 'old', line: oldLine++ };
      }
      lines.push(mapped);
    }
    return { lines, starts };
  }
  async function diffRanges(path, observation) {
    const result = observation.result, before = base.get(path), after = head.get(path);
    if (result.path !== path || result.binary || typeof result.text !== 'string' || !Number.isSafeInteger(result.offset)) return [];
    if ((result.baseOid ?? null) !== (before?.oid ?? null) || (result.headOid ?? null) !== (after?.oid ?? null)) return [];
    const buffer = await workspaceText(path);
    if (!buffer) return [];
    const observed = Buffer.from(result.text);
    if (!buffer.subarray(result.offset, result.offset + observed.length).equals(observed)) return [];
    const { lines, starts } = diffLineMap(buffer, !(before && after));
    const end = result.offset + observed.length, ranges = [];
    for (let index = 0; index < lines.length; index++) {
      const lineEnd = index + 1 < starts.length ? starts[index + 1] : buffer.length;
      if (!lines[index] || lineEnd <= result.offset || starts[index] >= end) continue;
      ranges.push({ side: lines[index].side, start: lines[index].line, end: lines[index].line });
    }
    return ranges;
  }

  /** Verified locations for one question: only exact observations whose blob
   * IDs match this checkpoint become line ranges. Model text never does. */
  async function evidenceFor(question, review) {
    const cited = [...new Set((question?.evidence ?? []).map(item => item?.path).filter(path => typeof path === 'string' && allowed(path)))];
    const observations = review?.snapshotId === snapshot.id && Array.isArray(review.evidence) ? review.evidence : [];
    const refs = [];
    for (const path of cited) {
      const ranges = [];
      for (const item of observations) {
        if (!Array.isArray(item?.paths) || !item.paths.includes(path) || !item.result || typeof item.result !== 'object') continue;
        if (item.tool === 'read_file') {
          const side = item.result.revision === 'base' ? 'old' : 'new', entry = (side === 'old' ? base : head).get(path);
          if (item.result.path === path && entry && item.result.oid === entry.oid && Number.isSafeInteger(item.result.startLine) && Number.isSafeInteger(item.result.endLine) && item.result.endLine >= item.result.startLine) ranges.push({ side, start: item.result.startLine, end: item.result.endLine });
        } else if (item.tool === 'search' && Array.isArray(item.result.matches)) {
          for (const match of item.result.matches) {
            const side = match?.revision === 'base' ? 'old' : 'new', entry = (side === 'old' ? base : head).get(path);
            if (match?.path === path && entry && match.oid === entry.oid && Number.isSafeInteger(match.line)) ranges.push({ side, start: match.line, end: match.line });
          }
        } else if (item.tool === 'read_diff') ranges.push(...await diffRanges(path, item));
      }
      const file = byPath.get(path) ?? files.find(candidate => candidate.oldPath === path);
      refs.push({ path, inChange: Boolean(file), ...(file ? { viewPath: file.path } : {}), ranges: mergeRanges(ranges) });
    }
    return refs;
  }

  return {
    header, totals,
    summary: () => ({ header, totals, files: files.slice(0, VIEW_LIMITS.files).map(({ oldOid, newOid, oldKind, newKind, ...file }) => ({ ...file, ...(oldKind && oldKind !== 'file' || newKind && newKind !== 'file' ? { special: newKind !== 'file' ? newKind : oldKind } : {}) })), listed: Math.min(files.length, VIEW_LIMITS.files) }),
    diff, evidenceFor,
  };
}

export function summarize(files) {
  const totals = { files: files.length, additions: 0, deletions: 0, binaryFiles: 0, uncountedFiles: 0 };
  for (const file of files) {
    if (file.binary) totals.binaryFiles++;
    else if (file.additions === null || file.deletions === null) totals.uncountedFiles++;
    else { totals.additions += file.additions; totals.deletions += file.deletions; }
  }
  return totals;
}
