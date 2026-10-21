// Prints a setup hint after `npm install -g`. It changes nothing on the machine.
// npm 7+ hides lifecycle output, so write to the terminal device directly and
// stay silent when there is none (CI, Docker, IDEs).
import { openSync, writeSync, closeSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const env = process.env;
const global = env.npm_config_global === 'true' || env.npm_config_location === 'global';
if (global && !(env.CI && !['false', '0'].includes(env.CI))) {
  const home = env.SPHINX_HOME || path.join(env.SPHINX_USER_HOME || homedir(), '.config', 'sphinx');
  const setUp = existsSync(path.join(home, 'install.json'));
  const color = !env.NO_COLOR && env.TERM !== 'dumb';
  const amber = text => color ? `\x1b[38;5;179m${text}\x1b[0m` : text;
  const bold = text => color ? `\x1b[1m${text}\x1b[0m` : text;
  const message = setUp
    ? `\n  ${amber('sphinx')} updated. Apply it to your Git and agent hooks (your settings are kept):\n\n    ${bold('sphinx install')}\n\n`
    : `\n  ${amber('sphinx')} is installed. Finish setup to connect Git and your coding agents:\n\n    ${bold('sphinx install')}\n\n`;
  try {
    const tty = openSync(process.platform === 'win32' ? 'CON' : '/dev/tty', 'w');
    try { writeSync(tty, message); } finally { closeSync(tty); }
  } catch { /* No terminal: nothing to show. */ }
}
