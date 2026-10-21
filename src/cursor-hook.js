import { cursorAgentHook } from './lifecycle-integrations.js';

// Cursor's command hook protocol. Never pass shell commands or their output to
// an evaluator; the adapter extracts only strict checkpoint IDs from Git's
// existing notice when Cursor has not tagged a cross-directory shell operation.
let input = '', bytes = 0;
try {
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) throw new Error('Hook input exceeds limit.');
    input += chunk;
  }
  const payload = JSON.parse(input || '{}');
  const { hook_event_name, session_id, conversation_id, cwd, workspace_roots, tool_name, tool_output, error_message } = payload;
  process.stdout.write(`${JSON.stringify(await cursorAgentHook({ input: { hook_event_name, session_id, conversation_id, cwd, workspace_roots, tool_name, tool_output, error_message } }))}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ additional_context: 'Sphinx could not inspect this hook event. The human can run sphinx doctor and sphinx check in their own terminal.' })}\n`);
}
