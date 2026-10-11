/** What a tool says when the desktop app is closed or the assistant is off. */
export const OFFLINE = 'Open redcolumn and turn on the local assistant.';

export const ASSISTANT_METHODS = ['list_open_documents', 'list_markups', 'set_markup'] as const;

export type AssistantMethod = (typeof ASSISTANT_METHODS)[number];

export function isAssistantMethod(method: string): method is AssistantMethod {
  return (ASSISTANT_METHODS as readonly string[]).includes(method);
}

interface ToolDef {
  name: AssistantMethod;
  description: string;
  inputSchema: Record<string, unknown>;
}

const documentProp = { type: 'string', description: 'Document name or id. The active document when omitted.' };

const TOOLS: ToolDef[] = [
  {
    name: 'list_open_documents',
    description: "Lists drawings open in redcolumn: name, page count, the page on screen, and that page's sheet number.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_markups',
    description: 'Lists markups on an open drawing, with type, page, text, status, and measurement.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. Every page when omitted.' },
      },
    },
  },
  {
    name: 'set_markup',
    description: "Updates one markup's status, comment, subject, or a custom column. The change is one undo step in redcolumn.",
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        id: { type: 'string', description: 'Markup id from list_markups.' },
        seq: { type: 'integer', description: 'Markup number shown in the list, when id is omitted.' },
        status: { type: 'string', description: 'Status name or id, such as Accepted or completed.' },
        comment: { type: 'string' },
        subject: { type: 'string' },
        field: { type: 'string', description: 'Custom column name or id.' },
        value: { type: 'string', description: 'Value for field.' },
      },
    },
  },
];

export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** Lines already split. A chunk that ends mid-line stays in `buf`. */
export function takeLines(state: { buf: string }, chunk: string, max = 8_000_000): string[] {
  state.buf += chunk;
  if (state.buf.length > max) {
    state.buf = '';
    throw new Error('Message too large');
  }
  const lines: string[] = [];
  let nl = state.buf.indexOf('\n');
  while (nl >= 0) {
    const line = state.buf.slice(0, nl).replace(/\r$/, '');
    state.buf = state.buf.slice(nl + 1);
    if (line) lines.push(line);
    nl = state.buf.indexOf('\n');
  }
  return lines;
}

function rpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function rpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolText(text: string, isError: boolean) {
  return { content: [{ type: 'text', text }], isError };
}

function argsOf(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  const record = params as { arguments?: unknown };
  const args = record.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

/**
 * One MCP message, newline-delimited JSON, the framing Copilot, Claude, Codex, and Cursor use.
 * Notifications get no reply. A missing app becomes the tool's text, not a protocol failure.
 */
export async function handleMcpMessage(line: string, call: ToolCall, version = '0.1.0'): Promise<string | null> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid request');
  const rec = msg as { id?: unknown; method?: unknown; params?: unknown };
  const hasId = 'id' in rec && rec.id !== undefined && rec.id !== null;
  const id = hasId ? rec.id : null;
  if (typeof rec.method !== 'string') return hasId ? rpcError(id, -32600, 'Invalid request') : null;
  if (!hasId) return null;

  try {
    switch (rec.method) {
      case 'initialize': {
        const params = rec.params as { protocolVersion?: unknown } | undefined;
        const protocolVersion = typeof params?.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion : '2025-03-26';
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'redcolumn', version },
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS });
      case 'tools/call': {
        const params = rec.params as { name?: unknown } | undefined;
        const name = params?.name;
        if (typeof name !== 'string' || !isAssistantMethod(name)) return rpcResult(id, toolText('Unknown tool.', true));
        try {
          const value = await call(name, argsOf(rec.params));
          return rpcResult(id, toolText(typeof value === 'string' ? value : JSON.stringify(value), false));
        } catch (err) {
          const message = err instanceof Error && err.message ? err.message : OFFLINE;
          return rpcResult(id, toolText(message, message !== OFFLINE));
        }
      }
      default:
        return rpcError(id, -32601, 'Method not found');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return rpcError(id, -32603, message);
  }
}
