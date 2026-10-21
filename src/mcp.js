import { TextDecoder } from 'node:util';
import { VERSION } from './version.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = new Set([MCP_PROTOCOL_VERSION, '2025-06-18']);
const SUMMARY_STATUSES = new Set(['passed', 'pending', 'not-required', 'unsupported', 'error', 'busy']);
const CHECKPOINT_STATUSES = new Set(['passed', 'pending', 'error']);
const ARGUMENT_KEYS = ['cwd', 'host', 'hookEvent', 'hostSession'];
const MAX_TEXT = 32000;

export const CHECKPOINT_TOOL = {
  name: 'sphinx_checkpoint',
  description: 'Present queued Sphinx understanding checkpoints directly through the host native form. Called by the configured lifecycle hook. Questions and human answers stay inside the form exchange; this tool accepts no answers and returns only completion status.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      cwd: { type: 'string', minLength: 1, maxLength: 8192, description: 'Repository working directory supplied by the host hook.' },
      host: { type: 'string', enum: ['codex', 'claude'], description: 'Coding-agent host.' },
      hookEvent: { type: 'string', minLength: 1, maxLength: 128, description: 'Lifecycle event supplied by the host.' },
      hostSession: { type: 'string', minLength: 1, maxLength: 512, description: 'Session identifier supplied by the host.' },
    },
    required: ARGUMENT_KEYS,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

export class McpTransportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'McpTransportError';
    this.code = code;
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requestId = value => typeof value === 'string' || Number.isSafeInteger(value);
const ownKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const boundedString = (value, limit = MAX_TEXT) => typeof value === 'string' && value.length <= limit;
const count = value => Number.isSafeInteger(value) && value >= 0;

export function supportsFormElicitation(capabilities) {
  const elicitation = capabilities?.elicitation;
  return object(elicitation) && (Object.keys(elicitation).length === 0 || object(elicitation.form));
}

function fieldOptions(schema) {
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 16 || schema.enum.some(value => !boundedString(value, 4000))) return null;
    return schema.enum;
  }
  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || !schema.oneOf.length || schema.oneOf.length > 16) return null;
    if (schema.oneOf.some(item => !object(item) || !ownKeys(item, ['const', 'title']) || !boundedString(item.const, 4000) || (item.title !== undefined && !boundedString(item.title, 4000)))) return null;
    return schema.oneOf.map(item => item.const);
  }
  return undefined;
}

/** Sphinx needs only a small, flat subset of the MCP form schema. */
export function validateFormSchema(schema) {
  const fail = () => { throw new McpTransportError('Sphinx could not construct a supported native form. The checkpoint remains pending.', 'INVALID_FORM_SCHEMA'); };
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || !ownKeys(schema, ['type', 'properties', 'required', 'additionalProperties', 'title', 'description'])) fail();
  const names = Object.keys(schema.properties);
  if (!names.length || names.length > 8 || names.some(name => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name))) fail();
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) fail();
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(name => !names.includes(name)) || new Set(schema.required).size !== schema.required.length)) fail();
  for (const key of ['title', 'description']) if (schema[key] !== undefined && !boundedString(schema[key])) fail();
  for (const field of Object.values(schema.properties)) {
    if (!object(field) || !['string', 'boolean', 'number', 'integer'].includes(field.type) || !ownKeys(field, ['type', 'title', 'description', 'default', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'oneOf'])) fail();
    for (const key of ['title', 'description']) if (field[key] !== undefined && !boundedString(field[key])) fail();
    for (const key of ['minLength', 'maxLength']) if (field[key] !== undefined && (field.type !== 'string' || !count(field[key]) || field[key] > MAX_TEXT)) fail();
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) fail();
    for (const key of ['minimum', 'maximum']) if (field[key] !== undefined && (!['number', 'integer'].includes(field.type) || !Number.isFinite(field[key]))) fail();
    if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) fail();
    if (field.enum !== undefined && field.oneOf !== undefined) fail();
    const options = fieldOptions(field);
    if (options === null || (options && (field.type !== 'string' || new Set(options).size !== options.length))) fail();
    if (field.default !== undefined && !validFieldValue(field.default, field)) fail();
  }
  // Copy to prevent a controller mutating a schema after its question is displayed.
  return JSON.parse(JSON.stringify(schema));
}

function validFieldValue(value, schema) {
  if (schema.type === 'string') {
    if (!boundedString(value) || (schema.minLength !== undefined && [...value].length < schema.minLength) || (schema.maxLength !== undefined && [...value].length > schema.maxLength)) return false;
    const options = fieldOptions(schema);
    return options !== null && (!options || options.includes(value));
  }
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
}

export function validateElicitationResult(result, schema) {
  const invalid = () => { throw new McpTransportError('The host returned invalid form input. The checkpoint remains pending.', 'INVALID_FORM_RESPONSE'); };
  if (!object(result) || !['accept', 'decline', 'cancel'].includes(result.action) || !ownKeys(result, ['action', 'content', '_meta'])) invalid();
  if (result.action !== 'accept') return { action: result.action };
  if (!object(result.content) || !ownKeys(result.content, Object.keys(schema.properties))) invalid();
  if ((schema.required ?? []).some(name => !Object.hasOwn(result.content, name))) invalid();
  for (const [name, value] of Object.entries(result.content)) if (!validFieldValue(value, schema.properties[name])) invalid();
  return { action: 'accept', content: JSON.parse(JSON.stringify(result.content)) };
}

/** Only fixed statuses, numeric progress, optional usage limits, and checkpoint IDs may reach the model. */
export function sanitizeCheckpointSummary(value) {
  if (!object(value) || !SUMMARY_STATUSES.has(value.status)) throw new McpTransportError('Invalid checkpoint summary.', 'INVALID_CHECKPOINT_SUMMARY');
  const summary = { status: value.status, checkpoints: [] };
  if (value.checkpoints !== undefined) {
    if (!Array.isArray(value.checkpoints) || value.checkpoints.length > 100) throw new McpTransportError('Invalid checkpoint summary.', 'INVALID_CHECKPOINT_SUMMARY');
    for (const checkpoint of value.checkpoints) {
      if (!object(checkpoint) || typeof checkpoint.id !== 'string' || !/^[a-f0-9]{64}$/u.test(checkpoint.id) || !CHECKPOINT_STATUSES.has(checkpoint.status)) throw new McpTransportError('Invalid checkpoint summary.', 'INVALID_CHECKPOINT_SUMMARY');
      const item = { id: checkpoint.id, status: checkpoint.status };
      for (const [field, keys] of [['progress', ['completed', 'total']], ['usage', ['calls', 'limit']]]) {
        if (checkpoint[field] !== undefined) {
          if (!object(checkpoint[field]) || keys.some(key => !(field === 'usage' && key === 'limit' && checkpoint[field][key] === null) && !count(checkpoint[field][key]))) throw new McpTransportError('Invalid checkpoint summary.', 'INVALID_CHECKPOINT_SUMMARY');
          item[field] = Object.fromEntries(keys.map(key => [key, checkpoint[field][key]]));
        }
      }
      summary.checkpoints.push(item);
    }
  }
  for (const field of ['completed', 'total', 'calls']) if (value[field] !== undefined) {
    if (!count(value[field])) throw new McpTransportError('Invalid checkpoint summary.', 'INVALID_CHECKPOINT_SUMMARY');
    summary[field] = value[field];
  }
  return summary;
}

function toolResult(summary, args, message, isError = ['error', 'unsupported', 'busy'].includes(summary.status)) {
  const instructions = {
    passed: 'The human completed the fallback native questionnaire. This does not resume an exited Git process. Before retrying, verify that the original Git operation has exited with a Sphinx blocking failure. Never duplicate a waiting operation or repeat a successful operation.',
    pending: 'The fallback native questionnaire remains pending. Do not retry the Git operation until the human asks to resume and the previous Git process has exited. Never duplicate a waiting operation.',
    unsupported: 'Native forms are unavailable in this client. No evaluator was called. The checkpoint remains pending; the human can use sphinx check in a terminal.',
    error: 'The fallback native checkpoint could not complete and remains pending. Do not retry until the human asks to resume and the previous Git process has exited; sphinx check in a terminal can inspect or resume it.',
    busy: 'A Sphinx questionnaire is already open. Wait for the human to finish it; do not open another interview or duplicate a waiting Git operation.',
    'not-required': 'No native checkpoint is queued.',
  };
  const hookOutput = summary.status === 'not-required' && summary.checkpoints.length === 0 ? {} : {
    hookSpecificOutput: {
      hookEventName: args.hookEvent,
      additionalContext: `Sphinx: ${JSON.stringify(summary)}. ${message || instructions[summary.status]}`,
    },
  };
  return { content: [{ type: 'text', text: JSON.stringify(hookOutput) }], structuredContent: summary, isError };
}

function validateArguments(args) {
  if (!object(args) || !ownKeys(args, ARGUMENT_KEYS)) return false;
  for (const key of ARGUMENT_KEYS) {
    const limit = CHECKPOINT_TOOL.inputSchema.properties[key].maxLength ?? 128;
    if (!boundedString(args[key], limit) || !args[key].trim() || /[\u0000-\u001f\u007f]/u.test(args[key])) return false;
  }
  return ['codex', 'claude'].includes(args.host);
}

/**
 * A newline-framed stdio MCP server. The sole tool never accepts human answers.
 * Test callers inject streams and checkpointHandler; production loads the controller lazily.
 */
export function runMcpServer({
  input = process.stdin, output = process.stdout, env = process.env,
  checkpointHandler, signal,
  elicitationTimeoutMs = 10 * 60 * 1000, requestTimeoutMs = 30 * 60 * 1000,
  maxInputBytes = 256 * 1024, maxOutputBytes = 256 * 1024,
} = {}) {
  for (const value of [elicitationTimeoutMs, requestTimeoutMs, maxInputBytes, maxOutputBytes]) if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('MCP limits must be positive integers.');
  const handler = checkpointHandler ?? (async args => (await import('./native-check.js')).runNativeCheckpoint(args));
  const active = new Map();
  const forms = new Map();
  let buffer = Buffer.alloc(0);
  let negotiation;
  let ready = false;
  let closed = false;
  let formSequence = 0;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });

  function send(message) {
    if (closed || output.destroyed || output.writableEnded) return false;
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > maxOutputBytes || (output.writableLength ?? 0) > maxOutputBytes * 4) { shutdown(); return false; }
    try { output.write(line); return true; } catch { shutdown(); return false; }
  }
  const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
  const rpcError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  function rejectForms(context, error) {
    for (const [id, form] of forms) if (form.context === context) {
      forms.delete(id);
      clearTimeout(form.timer);
      send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'The checkpoint request ended.' } });
      form.reject(error);
    }
  }

  function abortContext(context, error, suppressResponse = false) {
    context.suppressResponse ||= suppressResponse;
    if (!context.controller.signal.aborted) context.controller.abort(error);
    rejectForms(context, error);
    context.rejectAbort(error);
  }

  function shutdown() {
    if (closed) return;
    closed = true;
    buffer = Buffer.alloc(0);
    for (const context of active.values()) {
      clearTimeout(context.timer);
      abortContext(context, new McpTransportError('The MCP client disconnected.', 'MCP_DISCONNECTED'), true);
    }
    input.off('data', onData);
    input.off('end', shutdown);
    input.off('close', shutdown);
    input.off('error', shutdown);
    input.pause?.();
    output.off('close', shutdown);
    // Keep the error listener until this stream is closed; a queued write can fail later.
    signal?.removeEventListener('abort', shutdown);
    finish(0);
  }

  function elicit(context, request) {
    if (closed || context.controller.signal.aborted) return Promise.reject(context.controller.signal.reason ?? new McpTransportError('The MCP client disconnected.', 'MCP_DISCONNECTED'));
    if (!context.supportsForm) return Promise.reject(new McpTransportError('The client does not support native forms.', 'MCP_ELICITATION_UNSUPPORTED'));
    if (!object(request) || !boundedString(request.message) || !request.message.trim()) return Promise.reject(new McpTransportError('Invalid form request.', 'INVALID_FORM_SCHEMA'));
    let schema;
    try { schema = validateFormSchema(request.requestedSchema); } catch (error) { return Promise.reject(error); }
    if ([...forms.values()].some(form => form.context === context)) return Promise.reject(new McpTransportError('Only one native question may be shown at a time.', 'FORM_ALREADY_PENDING'));
    const id = `sphinx-form-${++formSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!forms.has(id)) return;
        forms.delete(id);
        send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'The form response timed out.' } });
        reject(new McpTransportError('The native form timed out. The checkpoint remains pending.', 'MCP_ELICITATION_TIMEOUT'));
      }, elicitationTimeoutMs);
      forms.set(id, { context, schema, timer, resolve, reject });
      const params = { ...(negotiation.protocolVersion === '2025-06-18' ? {} : { mode: 'form' }), message: request.message, requestedSchema: schema };
      if (!send({ jsonrpc: '2.0', id, method: 'elicitation/create', params })) {
        forms.delete(id); clearTimeout(timer);
        reject(new McpTransportError('The MCP client disconnected.', 'MCP_DISCONNECTED'));
      }
    });
  }

  async function callCheckpoint(id, args) {
    if (active.size) {
      result(id, toolResult({ status: 'busy', checkpoints: [] }, args));
      return;
    }
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const context = { id, controller: new AbortController(), rejectAbort, suppressResponse: false, supportsForm: supportsFormElicitation(negotiation.capabilities) };
    active.set(id, context);
    context.timer = setTimeout(() => abortContext(context, new McpTransportError('The checkpoint request timed out.', 'MCP_REQUEST_TIMEOUT')), requestTimeoutMs);
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => {
          context.controller.signal.throwIfAborted();
          // The controller checks the queue first, then refuses unsupported clients before inference.
          return handler({ ...args, env, supportsForm: context.supportsForm, elicit: request => elicit(context, request), signal: context.controller.signal });
        }),
        aborted,
      ]);
      if (!closed && !context.suppressResponse && !context.controller.signal.aborted) result(id, toolResult(sanitizeCheckpointSummary(response), args));
    } catch (error) {
      if (!closed && !context.suppressResponse) {
        const timedOut = error?.code === 'MCP_ELICITATION_TIMEOUT' || error?.code === 'MCP_REQUEST_TIMEOUT';
        result(id, toolResult({ status: timedOut ? 'pending' : 'error', checkpoints: [] }, args, timedOut
          ? 'The fallback native checkpoint timed out and remains pending. Do not retry until the human asks to resume and the previous Git process has exited; sphinx check in a terminal can resume it.'
          : undefined, true));
      }
    } finally {
      clearTimeout(context.timer);
      rejectForms(context, new McpTransportError('The checkpoint request ended.', 'MCP_REQUEST_ENDED'));
      active.delete(id);
    }
  }

  function handleResponse(message) {
    const form = forms.get(message.id);
    if (!form) return; // Never associate an unsolicited or late answer with a new question.
    forms.delete(message.id);
    clearTimeout(form.timer);
    if (Object.hasOwn(message, 'error') || !Object.hasOwn(message, 'result')) {
      form.reject(new McpTransportError('The client could not display the native form. The checkpoint remains pending.', 'MCP_CLIENT_ERROR'));
      return;
    }
    try { form.resolve(validateElicitationResult(message.result, form.schema)); } catch (error) { form.reject(error); }
  }

  function handleMessage(message) {
    if (!object(message) || message.jsonrpc !== '2.0' || (Object.hasOwn(message, 'id') && !requestId(message.id))) {
      rpcError(null, -32600, 'Invalid JSON-RPC message.'); return;
    }
    if (!Object.hasOwn(message, 'method')) { if (Object.hasOwn(message, 'id')) handleResponse(message); else rpcError(null, -32600, 'Invalid JSON-RPC message.'); return; }
    if (typeof message.method !== 'string' || !message.method) { rpcError(Object.hasOwn(message, 'id') ? message.id : null, -32600, 'Invalid JSON-RPC method.'); return; }
    const isRequest = Object.hasOwn(message, 'id');
    if (!isRequest) {
      if (message.method === 'notifications/initialized' && negotiation) ready = true;
      else if (message.method === 'notifications/cancelled' && requestId(message.params?.requestId)) {
        const context = active.get(message.params.requestId);
        if (context) abortContext(context, new McpTransportError('The client cancelled the checkpoint.', 'MCP_CANCELLED'), true);
      }
      return;
    }
    const { id, method, params } = message;
    if (active.has(id)) { abortContext(active.get(id), new McpTransportError('A request id was reused.', 'MCP_DUPLICATE_ID'), true); rpcError(id, -32600, 'The request id is already in use.'); return; }
    if (method === 'ping') { result(id, {}); return; }
    if (method === 'initialize') {
      if (negotiation) { rpcError(id, -32600, 'The MCP connection is already initialized.'); return; }
      if (!object(params) || !boundedString(params.protocolVersion, 64) || !params.protocolVersion || !object(params.capabilities) || !object(params.clientInfo)) { rpcError(id, -32602, 'Initialize requires protocolVersion, capabilities, and clientInfo.'); return; }
      negotiation = { protocolVersion: SUPPORTED_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSION, capabilities: params.capabilities };
      result(id, { protocolVersion: negotiation.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'sphinx', title: 'Sphinx', version: VERSION } });
      return;
    }
    if (!ready) { rpcError(id, -32002, 'Initialize the MCP connection before using tools.'); return; }
    if (method === 'tools/list') { result(id, { tools: [CHECKPOINT_TOOL] }); return; }
    if (method === 'tools/call') {
      if (!object(params) || params.name !== CHECKPOINT_TOOL.name || !ownKeys(params, ['name', 'arguments', '_meta']) || !validateArguments(params.arguments)) { rpcError(id, -32602, 'sphinx_checkpoint requires only cwd, host, hookEvent, and hostSession string arguments.'); return; }
      void callCheckpoint(id, params.arguments);
      return;
    }
    rpcError(id, -32601, 'Method not found.');
  }

  function onData(chunk) {
    if (closed) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let newline;
    while (!closed && (newline = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > maxInputBytes) { rpcError(null, -32600, 'MCP message exceeds the input limit.'); shutdown(); return; }
      if (!line.length || (line.length === 1 && line[0] === 13)) continue;
      let message;
      try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { rpcError(null, -32700, 'Invalid JSON.'); continue; }
      handleMessage(message);
    }
    if (buffer.length > maxInputBytes) { rpcError(null, -32600, 'MCP message exceeds the input limit.'); shutdown(); }
  }

  input.on('data', onData);
  input.on('end', shutdown);
  input.on('close', shutdown);
  input.on('error', shutdown);
  output.on('error', shutdown);
  output.on('close', shutdown);
  signal?.addEventListener('abort', shutdown, { once: true });
  if (signal?.aborted || input.readableEnded || input.destroyed || output.destroyed) shutdown();
  return done;
}
