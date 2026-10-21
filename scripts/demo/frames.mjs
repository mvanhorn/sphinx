// Renders the README demo GIF frame by frame: a terminal push, the real
// questionnaire page driven by scripted state, and the push continuing.
// Usage: node scripts/demo/frames.mjs <outDir>   (then scripts/demo/build.sh)
import { browserPage } from '../../src/browser-page.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'demo-frames');
mkdirSync(out, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 12, DURATION = 19.5, W = 1200, H = 720;

const QUESTION = 'Your queue can redeliver a job after a worker crashes mid-charge. With this change, what happens to the customer on that redelivery, and why?';
const ANSWER = 'They get charged twice. Nothing is saved before charge(), so a redelivery after the crash runs the whole job again.';
// A correct answer gets no grader feedback: the page goes straight to the pass message.
const GRADED_AT = 12.6;
// Repository understanding score before and after this check's first-try answer.
const SCORE = { calibrating: false, answered: 23, needed: 0, accuracy: 78, streak: 3, bestStreak: 6, skipRate: 4, checks: 9, recent: [true, true, false, true, true, true, false, true, true, true] };
const SCORED = { ...SCORE, answered: 24, accuracy: 79, streak: 4, checks: 10, recent: [...SCORE.recent.slice(1), true] };
const ROUTE = { provider: 'claude', model: 'sonnet' };
const ACTIVITY = ['Read the diff for 11 changed files', 'Reading src/jobs/charge-invoice.js', 'Searching for “billing.charge”', 'Reading src/queue/index.js', 'Drafting questions', 'Checking the questions against the source'];

const files = [
  { path: 'src/jobs/charge-invoice.js', status: 'added', additions: 17, deletions: 0 },
  { path: 'src/billing/client.js', status: 'modified', additions: 3, deletions: 2 },
  { path: 'src/webhooks/payment-webhook.js', status: 'modified', additions: 7, deletions: 9 },
  { path: 'src/queue/index.js', status: 'modified', additions: 41, deletions: 12 },
];
const header = { repository: 'billing-service', event: 'pre-push', destination: 'refs/heads/main', remote: 'origin', base: 'b'.repeat(40), head: 'c'.repeat(40), checkpoint: 'x' };
const totals = { files: 11, additions: 5012, deletions: 3147, binaryFiles: 0, uncountedFiles: 0 };
const change = { status: 'ready', header, totals, files, listed: 4 };
const diff = { path: 'src/jobs/charge-invoice.js', status: 'added', additions: 17, deletions: 0, context: '3', hunks: [] };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const typed = (text, t, start, cps) => text.slice(0, clamp(Math.floor((t - start) * cps), 0, text.length));
const ease = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

function questionnaireState(t) {
  const base = { id: 'a'.repeat(64), sequence: Math.round(t * 100), revision: 'r', event: 'pre-push', waitingGit: true, target: 'refs/heads/main', repoRoot: '/work/billing-service', progress: { completed: 0, total: 1 }, usage: { calls: 6, limit: null }, route: ROUTE, score: t < GRADED_AT ? SCORE : SCORED, change: { status: 'ready', header, totals } };
  const steps = Math.min(ACTIVITY.length, 1 + Math.floor((t - 3.2) / 0.35));
  const activity = ACTIVITY.slice(0, Math.max(1, steps)).map((text, i) => ({ id: 'a' + i, role: 'sphinx', kind: 'activity', text }));
  const tokens = { input: Math.round(800 + clamp(t - 3, 0, 3) * 1400), output: Math.round(120 + clamp(t - 3, 0, 3) * 260), cost: +(0.0002 + clamp(t - 3, 0, 3) * 0.00028).toFixed(6) };
  const q = { id: 'q1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: QUESTION, choices: [] };
  if (t < 5.4) return { ...base, phase: 'working', message: 'Reviewing the change…', tokens, messages: activity };
  const done = { ...tokens, input: 5000, output: 900, cost: 0.00104 };
  if (t < 10.2) return { ...base, phase: 'question', question: { id: 'q1', prompt: QUESTION, choices: [] }, tokens: done, messages: [...activity, q] };
  const human = { id: 'h1', role: 'human', kind: 'answer', text: ANSWER, status: t < GRADED_AT ? 'checking' : 'graded' };
  const graded = { ...done, input: 6200, output: 1180, cost: 0.00131 };
  if (t < GRADED_AT) return { ...base, phase: 'working', message: 'Checking your reasoning…', question: { id: 'q1', prompt: QUESTION, choices: [] }, tokens: t < 10.9 ? done : graded, messages: [...activity, q, human] };
  return { ...base, phase: 'passed', progress: { completed: 1, total: 1 }, tokens: graded, message: 'You passed. You can close this tab; Git is finishing the push on its own.\nThis records your answers, not a review of every changed line.', messages: [...activity, q, human] };
}

function questionnaireHtml(t) {
  const state = questionnaireState(t);
  const answer = t >= 5.9 && t < 10.2 ? typed(ANSWER, t, 6.0, 30) : '';
  // Mirror the page's .fresh pop (0.3 → 1.25 → 1) since every frame is a fresh page load.
  const p = (t - GRADED_AT) / 0.5, pop = p < 0 || p >= 1 ? 1 : p < 0.7 ? 0.3 + 0.95 * p / 0.7 : 1.25 - 0.25 * (p - 0.7) / 0.3;
  const shim = `<script nonce="n">window.EventSource=class{constructor(){setTimeout(()=>{this.onmessage({data:${JSON.stringify(JSON.stringify(state))}});const r=document.getElementById('response');if(r){r.value=${JSON.stringify(answer)};r.style.height='auto';r.style.height=Math.min(r.scrollHeight||76,180)+'px';}const d=document.querySelector('#score-dots i:last-child');if(d){d.style.animation='none';d.style.transform='scale(${pop})';}},5)}close(){}};window.fetch=async u=>({ok:true,status:200,json:async()=>(String(u).includes('/change')?${JSON.stringify(change)}:${JSON.stringify(diff)})});</script>`;
  return browserPage({ token: 't', nonce: 'n' }).replace('<script nonce="n">', shim + '<script nonce="n">');
}

const TERMINAL = [
  [0.2, 'cmd', 'git push origin main'],
  [1.5, 'sphinx', 'Sphinx: understanding check needed for refs/heads/main (11 files, +5,012 −3,147).'],
  [2.0, 'sphinx', 'Sphinx: Git is waiting for your answers in the local questionnaire.'],
  [2.5, 'dim', 'Sphinx: questionnaire opened in a background browser tab.'],
  [16.0, 'ok', 'Sphinx: understanding check complete. Continuing this Git operation.'],
  [16.7, 'plain', 'To github.com:acme/billing-service.git'],
  [17.0, 'plain', '   4f2a1c9..8b7e3d0  main -> main'],
];

function stageHtml(t, frameFile) {
  const lines = TERMINAL.filter(([at]) => t >= at).map(([at, kind, text]) => {
    const shown = kind === 'cmd' ? typed(text, t, at, 22) : text;
    const caret = kind === 'cmd' && shown.length < text.length ? '<span class="caret">▍</span>' : '';
    return `<div class="l ${kind}">${kind === 'cmd' ? '<span class="p">~/billing-service</span> <span class="g">main</span> $ ' : ''}${shown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}${caret}</div>`;
  }).join('');
  const spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(t * 10) % 10];
  const waiting = t >= 2.5 && t < 16 ? `<div class="l dim wait">${spin} waiting…</div>` : '';
  const prompt = t >= 17.4 ? '<div class="l cmd"><span class="p">~/billing-service</span> <span class="g">main</span> $ <span class="caret">▍</span></div>' : '';
  const show = ease((t - 3.0) / 0.5) * (1 - ease((t - 15.2) / 0.5));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(160deg,#efe9df,#e2d9cc);font-family:-apple-system,BlinkMacSystemFont,sans-serif}
  .win{position:absolute;border-radius:11px;overflow:hidden;box-shadow:0 18px 50px rgba(40,30,20,.28),0 0 0 1px rgba(0,0,0,.08)}
  .bar{height:30px;display:flex;align-items:center;gap:7px;padding:0 12px}.dot{width:11px;height:11px;border-radius:50%}
  .term{left:36px;top:40px;width:760px;height:430px;background:#1d1a17}.term .bar{background:#2a2622}.term .title{flex:1;text-align:center;color:#9a9083;font-size:12px;margin-right:40px}
  .tbody{white-space:pre-wrap;padding:14px 16px;font:13.5px/1.62 Menlo,ui-monospace,monospace;color:#e9e3d9}
  .p{color:#8fbf77}.g{color:#d7af5f}.sphinx{color:#e0b46b}.dim{color:#8a8276}.ok{color:#8fbf77}.caret{color:#e9e3d9;animation:none}.wait{margin-top:2px}
  .browser{left:${330 + (1 - show) * 60}px;top:${86 + (1 - show) * 24}px;width:840px;height:600px;background:#faf8f5;opacity:${show}}
  .browser .bar{background:#ebe5dc;height:38px}.url{flex:1;margin:0 10px 0 6px;height:24px;border-radius:6px;background:#fff;color:#6b6259;font-size:12px;display:flex;align-items:center;padding:0 10px}
  iframe{border:0;width:1120px;height:747px;transform:scale(.75);transform-origin:0 0;display:block}
  .label{position:absolute;left:36px;bottom:26px;font:15px/1.4 Georgia,serif;color:#6b6259}.label b{color:#16130f;font-weight:600}
  </style></head><body>
  <div class="win term"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">billing-service — zsh</span></div><div class="tbody">${lines}${waiting}${prompt}</div></div>
  ${show > 0.01 ? `<div class="win browser"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="url">127.0.0.1:50247 · Sphinx — understanding check</span></div><iframe src="${frameFile}"></iframe></div>` : ''}
  </body></html>`;
}

const total = Math.round(FPS * DURATION);
// DEMO_TIMES=2,4.5 renders only those seconds, for checking keyframes.
const only = process.env.DEMO_TIMES?.split(',').map(Number);
for (let i = 0; i < (only ? only.length : total); i++) {
  const t = only ? only[i] : i / FPS, n = String(i).padStart(4, '0');
  const q = `q-${n}.html`, s = path.join(out, `s-${n}.html`);
  writeFileSync(path.join(out, q), questionnaireHtml(t));
  writeFileSync(s, stageHtml(t, q));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--blink-settings=preferredColorScheme=1', `--window-size=${W},${H}`, '--virtual-time-budget=800', `--screenshot=${path.join(out, `f-${n}.png`)}`, `file://${s}`], { stdio: 'ignore' });
  if (i % 24 === 0) process.stderr.write(`frame ${i}/${total}\n`);
}
