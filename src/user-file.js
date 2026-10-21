import { lstat, realpath, stat } from 'node:fs/promises';

/**
 * Agent settings are often symlinks into a dotfiles repository (Stow, Dotbot,
 * chezmoi, home-manager). Resolve a symlink to the user's own regular file so
 * Sphinx edits that target in place and the link stays intact. A missing file
 * resolves to itself; anything else that is not the user's regular file fails.
 */
export async function settingsTarget(file) {
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return { path: file, linked: false }; throw error; }
  if (!info.isSymbolicLink()) return { path: file, linked: false };
  let target;
  try { target = await realpath(file); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${file} is a symlink to a missing file. Create the target or remove the link, then retry.`);
    throw error;
  }
  const resolved = await stat(target);
  if (!resolved.isFile()) throw new Error(`${file} links to ${target}, which is not a regular file.`);
  if (typeof process.getuid === 'function' && resolved.uid !== process.getuid()) throw new Error(`${file} links to ${target}, which you do not own. Sphinx only edits your own files.`);
  return { path: target, linked: true };
}
