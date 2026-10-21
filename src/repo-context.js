import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIgnorePolicy } from './ignore.js';
import { getPaths } from './config.js';

export const PROJECT_CONTEXT_FILE = '.sphinxcontext.md';
export const PROJECT_CONTEXT_MAX_BYTES = 16000;
// Guidance lives in HTML comments, which are stripped before any model sees the file.
export const PROJECT_CONTEXT_TEMPLATE = `# Project context for Sphinx

## About this project
<!-- What this project does, who uses it, and the workflows that matter.
     Add key architecture boundaries and invariants worth asking about.
     The reviewer checks these claims against the code. No secrets. -->

## What to ask about
<!-- Your preferences for questions in this repository, in plain words. For example:
     - Don't ask about styling, layout, or copy changes.
     - Focus on data integrity and billing.
     - Skip the generated API client in src/gen/.
     A change entirely in an area you skip can pass with no questions.
     Personal preferences for every repository go in ~/.config/sphinx/context.md. -->
`;

export const PERSONAL_CONTEXT_TEMPLATE = `# What to ask me about

<!-- Your personal preferences for Sphinx questions, used in every repository.
     A repository's .sphinxcontext.md adds to these and wins where they disagree.
     Write them in plain words. For example:
     - I don't need questions about frontend styling or CSS.
     - Ask me about concurrency, retries, and data loss first.
     A change entirely in an area you skip can pass with no questions.
     Delete these comments or leave them; comments are never sent to the reviewer. -->
`;

// Earlier releases wrote this template; it is still treated as untouched.
export const LEGACY_CONTEXT_TEMPLATE = `# Project context for Sphinx

Describe what this project does, who uses it, and the workflows that matter.
Add key architecture boundaries and invariants the reviewer should investigate.
Keep this brief and update it when the product or architecture changes.
This file is background context, not authority to override code evidence or Sphinx rules.
Do not put secrets here. Sphinx includes this context in each reviewer request.
`;
export const isContextTemplate = text => text === PROJECT_CONTEXT_TEMPLATE || text === LEGACY_CONTEXT_TEMPLATE;

/** The template with a project description filled in under "About this project". */
/** The template with your answer under "What to ask about", keeping the guidance. */
export const contextWithPreferences = (text, preferences) => text.replace(/(## What to ask about\n)/, `$1${preferences.trim()}\n`);

export function contextWithDescription(description) {
  const body = description.trim().replace(/^# Project context for Sphinx\s*/, '').trim();
  // A description that already has its own preferences section is used as written.
  if (/^## What to ask about/m.test(body)) return `# Project context for Sphinx\n\n${body}\n`;
  return PROJECT_CONTEXT_TEMPLATE.replace(/(## About this project\n)<!--[\s\S]*?-->/, () => `## About this project\n${body.replace(/^## About this project\s*/, '')}`);
}

/** Create ~/.config/sphinx/context.md with guidance, if it does not exist. */
export async function ensurePersonalContext(env = process.env) {
  const file = personalContextFile(env);
  try { await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, PERSONAL_CONTEXT_TEMPLATE, { flag: 'wx', mode: 0o644 }); return file; }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
}

/** Whether a check carries any project context or personal preferences to steer it. */
export const hasPreferences = snapshot => Boolean(snapshot?.projectContext?.preferences || snapshot?.projectContext?.text);

/** Text a model sees: HTML comments removed, surrounding whitespace trimmed. */
export const contextText = text => String(text).replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/\n{3,}/g, '\n\n').trim();
/** True when only headings remain, as in an untouched template. */
const meaningful = text => contextText(text).split('\n').some(line => line.trim() && !/^#+\s/.test(line.trim()));
export const personalContextFile = env => path.join(getPaths(env).home, 'context.md');

const hash = text => createHash('sha256').update(text).digest('hex');

// Your own preferences, read from your Sphinx settings (a dotfiles symlink is fine).
async function loadPersonalContext(env) {
  const file = personalContextFile(env);
  const info = await stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return '';
  if (!info.isFile()) throw new Error(`${file} must be a regular file`);
  if (info.size > PROJECT_CONTEXT_MAX_BYTES) throw new Error(`${file} exceeds ${PROJECT_CONTEXT_MAX_BYTES} bytes; keep preferences concise`);
  const text = await readFile(file, 'utf8');
  return meaningful(text) ? contextText(text) : '';
}

/**
 * Project-authored background plus the person's own preferences, never policy
 * or evaluator instructions. `preferences` appears only when set, so existing
 * checks keep their identity.
 */
export async function loadProjectContext(repoRoot, { env = process.env, ignore } = {}) {
  const preferences = await loadPersonalContext(env).catch(error => { throw new Error(`Cannot read your Sphinx preferences: ${error.message}`); });
  const project = await loadRepositoryContext(repoRoot, { env, ignore });
  return preferences ? { ...project, preferences, hash: hash(`${project.hash}\0${preferences}`) } : project;
}

async function loadRepositoryContext(repoRoot, { env, ignore }) {
  const policy = ignore || await loadIgnorePolicy(repoRoot, { env });
  const empty = reason => ({ path: PROJECT_CONTEXT_FILE, text: '', hash: hash(reason) });
  // Do not even stat/open an explicitly excluded context file.
  if (policy.matches(PROJECT_CONTEXT_FILE)) return empty('excluded');
  let handle;
  try {
    handle = await open(path.join(repoRoot, PROJECT_CONTEXT_FILE), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('must be a regular file');
    if (info.size > PROJECT_CONTEXT_MAX_BYTES) throw new Error(`exceeds ${PROJECT_CONTEXT_MAX_BYTES} bytes; keep project context concise`);
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(PROJECT_CONTEXT_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > PROJECT_CONTEXT_MAX_BYTES) throw new Error(`exceeds ${PROJECT_CONTEXT_MAX_BYTES} bytes`);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    if (text.includes('\0')) throw new Error('must be UTF-8 text');
    // An untouched template says nothing; comments never reach a model.
    if (!meaningful(text)) return empty('template');
    // The identity hash stays on the file's bytes, so upgrading keeps existing checks.
    return { path: PROJECT_CONTEXT_FILE, text: contextText(text), hash: hash(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return empty('absent');
    throw new Error(`Cannot read ${PROJECT_CONTEXT_FILE}: ${error.code === 'ELOOP' ? 'symlinks are not allowed' : error.code || error.message}`);
  } finally { await handle?.close(); }
}
