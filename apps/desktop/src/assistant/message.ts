/** What a tool says when the desktop app is closed or the assistant is off. */
export const OFFLINE = 'Open redcolumn and turn on the local assistant.';

/** How long the page may take to answer. Long enough for someone to Allow or Deny. */
export const PAGE_WAIT_MS = 130_000;

/** The loopback client waits slightly longer than the page, so a slow answer is not "the app is closed". */
export const CLIENT_WAIT_MS = 140_000;

export const ASSISTANT_METHODS = [
  'list_open_documents',
  'list_markups',
  'set_markup',
  'list_commands',
  'run_command',
  'get_page',
  'select_markups',
  'place_markup',
  'update_markup',
  'delete_markups',
] as const;

export type AssistantMethod = (typeof ASSISTANT_METHODS)[number];

export function isAssistantMethod(method: string): method is AssistantMethod {
  return (ASSISTANT_METHODS as readonly string[]).includes(method);
}

interface ToolDef {
  name: AssistantMethod;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { destructiveHint?: boolean };
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
  {
    name: 'list_commands',
    description: 'Lists every command the menus and the command palette can run, with whether it is available right now.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'File, Edit, View, Document, Bulk, Tools, Window, or Help. Every category when omitted.' },
      },
    },
  },
  {
    name: 'run_command',
    description: 'Runs one command from list_commands. Commands that open a dialog return immediately and wait for the person in redcolumn. Deletes, saves, and document changes wait for Allow in redcolumn before they run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Command id from list_commands, such as edit.delete or view.zoomIn.' },
      },
    },
  },
  {
    name: 'get_page',
    description: 'The size of one page in PDF points, and its scale when one is set. Point origin is the top-left of the page, y down.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. The page on screen when omitted.' },
      },
    },
  },
  {
    name: 'select_markups',
    description: 'Selects markups on the drawing that is on screen, so a later run_command (align, group, copy) acts on them. An empty list clears the selection.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        ids: { type: 'array', items: { type: 'string' }, description: 'Markup ids from list_markups.' },
      },
    },
  },
  {
    name: 'place_markup',
    description: 'Draws one markup on a page. One undo step. Image, stamp, signature, and file attachment need a file: run that tool with run_command instead.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number.' },
        type: {
          type: 'string',
          description:
            'Markup type, such as rect, cloud, length, or text. Also cloudPlus (a cloud with a callout; text goes on the callout) and dynamicFill (Smart Fill: one point inside a closed outline makes the fill type chosen in redcolumn, area by default). Both need the drawing on screen.',
        },
        points: {
          type: 'array',
          description: 'PDF points, origin at the top-left, y down. A line, rectangle, ellipse, cloud, cloudPlus, text box, or redaction is two opposite corners. A callout is the tip, the knee, and the box\'s two corners. A pen or highlight is the path. A polygon, area, or space is its vertices.',
          items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        },
        text: { type: 'string' },
        comment: { type: 'string' },
        subject: { type: 'string' },
      },
    },
  },
  {
    name: 'update_markup',
    description: "Changes one markup's points, text, or style (stroke, fill, width, opacity, font size). Locked markups stay locked. One undo step. Status, comment, subject, and columns stay on set_markup.",
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        id: { type: 'string', description: 'Markup id from list_markups.' },
        seq: { type: 'integer', description: 'Markup number shown in the list, when id is omitted.' },
        points: {
          type: 'array',
          description: 'Replacement points, in the same order place_markup uses for this type.',
          items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        },
        text: { type: 'string', description: 'Replacement text. Empty clears it.' },
        style: {
          type: 'object',
          properties: {
            stroke: { type: 'string', description: 'CSS hex color, such as #ff0000.' },
            fill: { type: ['string', 'null'], description: 'CSS hex color, or null for none.' },
            width: { type: 'number', description: 'Line width in PDF points.' },
            opacity: { type: 'number', description: '0 to 1.' },
            fontSize: { type: 'number', description: 'Font size in points.' },
          },
        },
      },
    },
  },
  {
    name: 'delete_markups',
    description: 'Deletes markups by id. redcolumn asks for Allow first. One undo step after Allow.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        ids: { type: 'array', items: { type: 'string' }, description: 'Markup ids from list_markups.' },
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
