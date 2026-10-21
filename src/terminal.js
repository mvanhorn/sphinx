const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
export const stripAnsi = value => String(value).replace(ANSI, '');

export function colorEnabled({ stream = process.stdout, env = process.env } = {}) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false;
  if (Object.hasOwn(env, 'FORCE_COLOR')) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '';
  return !!stream.isTTY && env.TERM !== 'dumb';
}

function chunks(word, length) {
  const parts = word.match(/\x1b\[[0-?]*[ -/]*[@-~]|[^]/gu) || [];
  const result = []; let current = '', count = 0;
  for (const part of parts) {
    if (!part.startsWith('\x1b') && count === length) { result.push(current); current = ''; count = 0; }
    current += part;
    if (!part.startsWith('\x1b')) count++;
  }
  if (current) result.push(current);
  return result;
}

export function wrapText(value, width = 80, indent = '') {
  const room = Math.max(1, width - stripAnsi(indent).length);
  return String(value).split('\n').flatMap(paragraph => {
    if (!paragraph.trim()) return [''];
    const lines = []; let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      if (line && stripAnsi(line).length + 1 + stripAnsi(word).length > room) { lines.push(indent + line); line = ''; }
      const pieces = chunks(word, room);
      for (let i = 0; i < pieces.length; i++) {
        if (line) line += ' ';
        line += pieces[i];
        if (i < pieces.length - 1) { lines.push(indent + line); line = ''; }
      }
    }
    if (line) lines.push(indent + line);
    return lines;
  }).join('\n');
}

// The Sphinx mark in half-blocks, matching the SVG logo: crowned nemes with a
// forehead band, striped lappets, eyes, mouth, and the false beard.
export const SPHINX = [
  '      ▄██████████▄',
  '    ▄██████████████▄',
  '    ████████████████',
  '   ███▄▄▄▄▄▄▄▄▄▄▄▄███',
  '  ▀▀▀▀▀██      ██▀▀▀▀▀',
  '   ▀▀▀▀██ ▀  ▀ ██▀▀▀▀',
  '   ▀▀▀▀██      ██▀▀▀▀',
  '   ▀▀▀▀██  ▀▀  ██▀▀▀▀',
  '   ▀▀▀▀██▄    ▄██▀▀▀▀',
  '   ▀▀▀▀███ ▄▄ ███▀▀▀▀',
  '   ▀▀▀▀███ ██ ███▀▀▀▀',
  '   ██████████████████',
];

export function createTerminal({ stream = process.stdout, env = process.env, width } = {}) {
  const colored = colorEnabled({ stream, env });
  const columns = Number(width ?? stream.columns ?? env.COLUMNS ?? 80);
  const size = Number.isFinite(columns) && columns > 0 ? Math.max(20, Math.min(100, columns)) : 80;
  const paint = (code, text) => colored ? `\x1b[${code}m${text}\x1b[0m` : String(text);
  const style = {
    strong: text => paint('1', text), amber: text => paint('38;5;179', text),
    green: text => paint('32', text), muted: text => paint('2', text),
  };
  const write = text => stream.write(`${text}\n`);
  const paragraph = (text, indent = '') => write(wrapText(text, size, indent));
  const section = text => { write(''); paragraph(style.strong(text)); };
  const rows = entries => {
    const maxLabel = Math.max(0, ...entries.map(([label]) => stripAnsi(label).length));
    const inline = size >= 68 && maxLabel <= Math.floor(size * 0.45);
    for (const [label, description] of entries) {
      if (!inline) { paragraph(style.strong(label), '  '); paragraph(description, '    '); continue; }
      const left = `  ${label}${' '.repeat(maxLabel - stripAnsi(label).length + 3)}`;
      const lines = wrapText(description, size - maxLabel - 5).split('\n');
      write(style.strong(left) + lines[0]);
      for (const line of lines.slice(1)) write(' '.repeat(maxLabel + 5) + line);
    }
  };
  // Columns align when they fit; narrow terminals get wrapped label/value rows.
  const table = (head, body) => {
    const widths = head.map((_, column) => Math.max(...[head, ...body].map(row => stripAnsi(row[column]).length)));
    if (2 + widths.reduce((sum, width) => sum + width + 3, -3) > size) {
      rows(body.map(([label, ...cells]) => [label, cells.map((cell, index) => `${head[index + 1]} ${cell}`).join(' · ')]));
      return;
    }
    const pad = (cell, column) => {
      const room = ' '.repeat(widths[column] - stripAnsi(cell).length);
      return column === 0 ? cell + room : room + cell;
    };
    write(style.muted(`  ${head.map(pad).join('   ')}`));
    for (const [label, ...cells] of body) write(`  ${[style.strong(pad(label, 0)), ...cells.map((cell, index) => pad(cell, index + 1))].join('   ')}`);
  };
  const banner = () => {
    write('');
    if (size >= 65) {
      const side = { 4: style.strong('sphinx'), 6: 'You can outsource your thinking,', 7: 'but not your understanding.' };
      SPHINX.forEach((line, index) => write(style.amber(line.padEnd(28)) + (side[index] || '')));
    } else {
      if (size >= 30) SPHINX.forEach(line => write(style.amber(line)));
      paragraph(style.strong('sphinx'));
      paragraph('You can outsource your thinking, but not your understanding.');
    }
    write('');
  };
  return {
    width: size, style, line: paragraph, paragraph, section, rows, table, banner,
    blank: () => write(''),
    success: text => paragraph(`${style.green('✓')} ${text}`),
    warning: text => paragraph(`${style.amber('!')} ${text}`),
    note: text => paragraph(style.muted(text)),
    command: text => paragraph(style.amber(text), '  '),
  };
}

export async function withProgress(label, operation, { stream = process.stderr, env = process.env, enabled = true } = {}) {
  const show = enabled && stream.isTTY && env.TERM !== 'dumb';
  const ui = createTerminal({ stream, env });
  if (show) ui.note(`${label}…`);
  return operation();
}

export function formatError(error, { stream = process.stderr, env = process.env, plain = false } = {}) {
  const ui = createTerminal({ stream, env: plain ? { ...env, NO_COLOR: '1' } : env });
  const message = error?.message || String(error);
  ui.line(`${ui.style.amber('Sphinx:')} ${message}`);
  if (plain) return;
  let next;
  if (/not a git repository|not inside.*repository/i.test(message)) next = 'Run this command inside a Git repository. For machine-wide setup, use sphinx install.';
  else if (/unknown (?:command|option)|unexpected argument/i.test(message)) next = 'Use sphinx --help for commands, or sphinx <command> --help for its options.';
  else if (/API key|requires a key/i.test(message)) next = 'Run sphinx auth, or choose your signed-in coding agent with sphinx install --provider codex.';
  else if (/already running/i.test(message)) next = 'Let the current assessment finish, then run sphinx check to resume.';
  if (next && !message.includes(next)) { ui.blank(); ui.note(next); }
}
