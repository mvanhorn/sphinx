import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getPaths } from './config.js';

// Transports report token usage into whichever assessment is running, without
// threading a callback through every reviewer and grading layer.
const meter = new AsyncLocalStorage();
export const withUsageMeter = (sink, operation) => meter.run(sink, operation);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function reportUsage({ inputTokens, outputTokens, cost, provider, model } = {}) {
  const usage = { inputTokens: count(inputTokens), outputTokens: count(outputTokens), cost: Number.isFinite(cost) && cost >= 0 ? cost : null };
  const sink = meter.getStore();
  if (sink) try { sink(usage); } catch {}
  const env = ledger.getStore();
  if (env) recordUsage({ provider, model, purpose: purpose.getStore(), input: usage.inputTokens, output: usage.outputTokens, cost: usage.cost }, { env });
}

// Persistent usage ledger: one compact JSON line per model call in
// <home>/usage/YYYY-MM.jsonl. Only processes that opt in (the CLI entry point)
// write it, so tests and embedders never touch a real home by accident.
const ledger = new AsyncLocalStorage();
const purpose = new AsyncLocalStorage();
export const withUsageLedger = (env, operation) => ledger.run(env, operation);
/** Tag model calls made inside operation, e.g. 'review', 'grading', 'context'. */
export const withUsagePurpose = (label, operation) => purpose.run(label, operation);
export const USAGE_MONTHS_KEPT = 12;
export const TIERS = Object.freeze(['free', 'paid', 'endpoint', 'plan']);
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/u;
export const usageDir = env => path.join(getPaths(env).home, 'usage');
const label = value => typeof value === 'string' && value ? value.slice(0, 120) : null;
const purposeOf = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/u.test(value) ? value : null;

export function usageTier(provider, model) {
  if (provider === 'openai') return 'endpoint';
  if (provider === 'claude' || provider === 'codex') return 'plan';
  const id = model || 'openrouter/free';
  return id === 'openrouter/free' || id.endsWith(':free') ? 'free' : 'paid';
}

/** Best effort: a ledger failure never reaches the model call or the check. */
export function recordUsage({ provider, model, purpose: tag, input, output, cost, at = new Date() }, { env = process.env } = {}) {
  try {
    const name = label(provider) ?? 'openrouter';
    const line = { at: at.toISOString(), provider: name, model: label(model), tier: usageTier(name, model), ...(purposeOf(tag) ? { purpose: tag } : {}), input: count(input), output: count(output), cost: Number.isFinite(cost) && cost >= 0 ? cost : null };
    const dir = usageDir(env), file = `${line.at.slice(0, 7)}.jsonl`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const months = readdirSync(dir).filter(entry => MONTH_FILE.test(entry));
    appendFileSync(path.join(dir, file), `${JSON.stringify(line)}\n`, { mode: 0o600 });
    if (!months.includes(file)) pruneUsage(dir, [...months, file]);
    return true;
  } catch { return false; }
}

function pruneUsage(dir, months) {
  for (const old of months.sort().slice(0, -USAGE_MONTHS_KEPT)) try { unlinkSync(path.join(dir, old)); } catch {}
}

/** Every readable ledger entry, oldest month first; malformed lines are skipped. */
export function readUsage({ env = process.env } = {}) {
  let months;
  try { months = readdirSync(usageDir(env)).filter(entry => MONTH_FILE.test(entry)).sort(); } catch { return []; }
  const entries = [];
  for (const month of months) {
    let text;
    try { text = readFileSync(path.join(usageDir(env), month), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      try { const entry = JSON.parse(raw); if (TIERS.includes(entry?.tier) && Number.isFinite(Date.parse(entry.at))) entries.push(entry); } catch {}
    }
  }
  return entries;
}

const emptyTotals = () => ({ calls: 0, input: 0, output: 0, cost: null });
function add(total, entry) {
  total.calls++; total.input += count(entry.input); total.output += count(entry.output);
  if (Number.isFinite(entry.cost)) total.cost = (total.cost ?? 0) + entry.cost;
}

/** Totals per window (today since local midnight, rolling 7 and 30 days, all kept history), by tier and purpose. */
export function summarizeUsage(entries, now = new Date()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const starts = { today: midnight.getTime(), last7Days: now.getTime() - 7 * day, last30Days: now.getTime() - 30 * day, allTime: -Infinity };
  const windows = Object.fromEntries(Object.keys(starts).map(name => [name, { ...emptyTotals(), tiers: Object.fromEntries(TIERS.map(tier => [tier, emptyTotals()])), purposes: {} }]));
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    for (const [name, start] of Object.entries(starts)) {
      if (at < start) continue;
      const window = windows[name], tag = purposeOf(entry.purpose) ?? 'other';
      add(window, entry); add(window.tiers[entry.tier], entry);
      add(window.purposes[tag] ??= emptyTotals(), entry);
    }
  }
  return { generatedAt: now.toISOString(), monthsKept: USAGE_MONTHS_KEPT, windows };
}
export function addUsage(total = {}, usage) {
  return {
    input: count(total.input) + usage.inputTokens,
    output: count(total.output) + usage.outputTokens,
    // Cost is only known for billed API routes; subscription CLIs report none.
    cost: usage.cost === null ? (total.cost ?? null) : (total.cost ?? 0) + usage.cost,
  };
}

export const compact = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
export const money = cost => cost === 0 ? '$0' : cost < 0.0001 ? '<$0.0001' : cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
/** Tokens and running cost; a configured call cap is shown only when one is set. */
export const modelUsageText = ({ calls, limit } = {}, tokens = {}) => [
  `${compact(count(tokens?.input) + count(tokens?.output))} tokens`,
  ...(Number.isFinite(tokens?.cost) ? [money(tokens.cost)] : []),
  ...(limit !== null && limit !== undefined ? [`${calls}/${limit} calls`] : []),
].join(' · ');

export const modelLimitText = limit => limit === null ? 'no limit' : `${limit} model calls per assessment`;

const WINDOW_LABELS = [['today', 'Today'], ['last7Days', '7 days'], ['last30Days', '30 days'], ['allTime', 'All time']];
const TIER_LABELS = { free: 'Free OpenRouter', paid: 'Paid OpenRouter', endpoint: 'OpenAI-compatible', plan: 'Coding plans' };
// Free and plan routes carry no dollar cost (plan tokens count against the
// subscription instead), so a cell shows a cost only when one was billed.
const cell = (totals, { tokensOnly = false } = {}) => totals.calls === 0 ? '-'
  : [compact(totals.input + totals.output), ...(!tokensOnly && totals.cost > 0 ? [money(totals.cost)] : [])].join(' ');

/** Human `sphinx usage` output for a summarizeUsage result. */
export function printUsage(ui, summary, { ledgerPath } = {}) {
  const windows = WINDOW_LABELS.map(([key]) => summary.windows[key]);
  const head = ['', ...WINDOW_LABELS.map(([, text]) => text)];
  ui.section('Model usage');
  if (summary.windows.allTime.calls === 0) {
    ui.paragraph('No model calls recorded yet. Sphinx records each model call as it happens.');
  } else {
    ui.table(head, [
      ...TIERS.map(tier => [TIER_LABELS[tier], ...windows.map(window => cell(window.tiers[tier], { tokensOnly: tier === 'free' || tier === 'plan' }))]),
      ['Total', ...windows.map(window => cell(window))],
      ['Calls', ...windows.map(window => String(window.calls))],
    ]);
    const purposes = Object.keys(summary.windows.allTime.purposes).sort((a, b) => (a === 'other') - (b === 'other') || a.localeCompare(b));
    ui.section('By purpose');
    ui.table(head, purposes.map(name => [name, ...windows.map(window => cell(window.purposes[name] ?? { calls: 0 }))]));
    ui.blank();
    ui.note('Tokens are input plus output. Coding-plan tokens count against your Claude Code or Codex plan, so no dollar cost is shown. OpenAI-compatible endpoints show cost only when they report it.');
  }
  ui.note(`Today starts at local midnight; 7 and 30 days are rolling. The ledger keeps the last ${summary.monthsKept} months${ledgerPath ? `: ${ledgerPath}` : '.'}`);
}
