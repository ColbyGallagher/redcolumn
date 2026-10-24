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
  'set_markups',
  'list_commands',
  'run_command',
  'get_page',
  'select_markups',
  'place_markup',
  'place_markups',
  'update_markup',
  'update_markups',
  'delete_markups',
  'list_assemblies',
  'propose_takeoff',
  'list_takeoff_proposals',
] as const;

export type AssistantMethod = (typeof ASSISTANT_METHODS)[number];

export function isAssistantMethod(method: string): method is AssistantMethod {
  return (ASSISTANT_METHODS as readonly string[]).includes(method);
}

/**
 * MCP tool hints. A client treats a tool that is not read-only as destructive unless it says
 * otherwise, so every tool states all of these. Reads can then run without a prompt, and the
 * tools that only add or change things (each one undo step in redcolumn) are not flagged.
 */
interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: false;
}

const READS: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const CHANGES: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const REMOVES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

interface ToolDef {
  name: AssistantMethod;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

const documentProp = { type: 'string', description: 'Document name or id. The active document when omitted.' };

const pointsProp = {
  type: 'array',
  description: 'PDF points, origin at the top-left, y down.',
  items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
};

const styleProp = {
  type: 'object',
  properties: {
    stroke: { type: 'string', description: 'CSS hex color, such as #ff0000.' },
    fill: { type: ['string', 'null'], description: 'CSS hex color, or null for none.' },
    width: { type: 'number', description: 'Line width in PDF points.' },
    opacity: { type: 'number', description: '0 to 1.' },
    fontSize: { type: 'number', description: 'Font size in points.' },
  },
};

const setFields = {
  status: { type: 'string', description: 'Status name or id, such as Accepted or completed.' },
  comment: { type: 'string' },
  subject: { type: 'string' },
  field: { type: 'string', description: 'Custom column name or id.' },
  value: { type: 'string', description: 'Value for field.' },
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_open_documents',
    title: 'List open drawings',
    description: "Lists drawings open in redcolumn: name, page count, the page on screen, and that page's sheet number.",
    inputSchema: { type: 'object', properties: {} },
    annotations: READS,
  },
  {
    name: 'list_markups',
    title: 'List markups',
    description:
      'Lists markups on an open drawing, with type, page, text, status, and measurement. Filter with page, type, status, or search, and page through with limit and offset (500 markups per call when limit is omitted; the reply has total, and nextOffset while more remain). detail "brief" leaves out points, style, and author. summary true returns only counts by type, status, and page. On a big drawing, start with summary or a filter.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. Every page when omitted.' },
        type: { type: 'string', description: 'Only this markup type, such as rect, cloud, or length.' },
        status: { type: 'string', description: 'Only markups with this status name or id.' },
        search: { type: 'string', description: 'Only markups whose text, subject, or comment contains this, ignoring case.' },
        detail: { type: 'string', enum: ['full', 'brief'], description: 'brief leaves out points, style, and author. full when omitted.' },
        summary: { type: 'boolean', description: 'Counts by type, status, and page instead of the markups.' },
        limit: { type: 'integer', minimum: 1, maximum: 2000, description: 'Most markups to return. 500 when omitted.' },
        offset: { type: 'integer', minimum: 0, description: 'Markups to skip, from nextOffset of the last reply.' },
      },
    },
    annotations: READS,
  },
  {
    name: 'set_markup',
    title: 'Set markup status or comment',
    description: "Updates one markup's status, comment, subject, or a custom column. The change is one undo step in redcolumn. For several markups use set_markups.",
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        id: { type: 'string', description: 'Markup id from list_markups.' },
        seq: { type: 'integer', description: 'Markup number shown in the list, when id is omitted.' },
        ...setFields,
      },
    },
    annotations: CHANGES,
  },
  {
    name: 'set_markups',
    title: 'Set status or comment on many markups',
    description:
      'Gives many markups the same status, comment, subject, or custom column value, as one undo step in redcolumn. Name them with ids, seqs, or both (up to 500). Everything is checked first, so a bad status changes nothing. Markups that redcolumn then refuses to change are listed in failed.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        ids: { type: 'array', items: { type: 'string' }, description: 'Markup ids from list_markups.' },
        seqs: { type: 'array', items: { type: 'integer' }, description: 'Markup numbers shown in the list.' },
        ...setFields,
      },
    },
    annotations: CHANGES,
  },
  {
    name: 'list_commands',
    title: 'List commands',
    description: 'Lists commands the menus and the command palette can run, with whether each is available right now. Narrow it with category, query, or available: the full list is long.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'File, Edit, View, Document, Bulk, Tools, Window, or Help. Every category when omitted.' },
        query: { type: 'string', description: 'Only commands whose id or label contains this, ignoring case, such as zoom or rotate.' },
        available: { type: 'boolean', description: 'true leaves out commands that cannot run right now.' },
      },
    },
    annotations: READS,
  },
  {
    name: 'run_command',
    title: 'Run a command',
    description: 'Runs one command from list_commands. Commands that open a dialog return immediately and wait for the person in redcolumn. Deletes, saves, and document changes wait for Allow in redcolumn before they run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Command id from list_commands, such as edit.delete or view.zoomIn.' },
      },
    },
    annotations: REMOVES,
  },
  {
    name: 'get_page',
    title: 'Get page size and scale',
    description: 'The size of one page in PDF points, and its scale when one is set. Point origin is the top-left of the page, y down.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. The page on screen when omitted.' },
      },
    },
    annotations: READS,
  },
  {
    name: 'select_markups',
    title: 'Select markups',
    description: 'Selects markups on the drawing that is on screen, so a later run_command (align, group, copy) acts on them. An empty list clears the selection.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        ids: { type: 'array', items: { type: 'string' }, description: 'Markup ids from list_markups.' },
      },
    },
    annotations: CHANGES,
  },
  {
    name: 'place_markup',
    title: 'Draw a markup',
    description: 'Draws one markup on a page. One undo step. Image, stamp, signature, and file attachment need a file: run that tool with run_command instead. To draw several, use place_markups.',
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
    annotations: ADDS,
  },
  {
    name: 'place_markups',
    title: 'Draw many markups',
    description:
      'Draws many markups as one undo step in redcolumn (up to 500). Each item is what place_markup takes: type, points, and optionally page, text, comment, and subject; a page on the call is the default for items without one. Everything is checked first, so one bad item draws nothing. Not for cloudPlus or dynamicFill, which need place_markup. The reply lists each new markup\'s id, seq, type, and page.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number for items that do not give their own.' },
        markups: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            properties: {
              page: { type: 'integer', description: '1-based page number.' },
              type: { type: 'string', description: 'Markup type, such as rect, cloud, length, or text.' },
              points: { ...pointsProp, description: 'PDF points, as for place_markup: two opposite corners for a line, rectangle, ellipse, cloud, text box, or redaction; the path for a pen or highlight; the vertices for a polygon, area, or space.' },
              text: { type: 'string' },
              comment: { type: 'string' },
              subject: { type: 'string' },
            },
            required: ['type', 'points'],
          },
        },
      },
      required: ['markups'],
    },
    annotations: ADDS,
  },
  {
    name: 'update_markup',
    title: 'Edit a markup',
    description: "Changes one markup's points, text, or style (stroke, fill, width, opacity, font size). Locked markups stay locked. One undo step. Status, comment, subject, and columns stay on set_markup. For several markups use update_markups.",
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
        style: styleProp,
      },
    },
    annotations: CHANGES,
  },
  {
    name: 'update_markups',
    title: 'Edit many markups',
    description:
      'Changes the points, text, or style of many markups as one undo step in redcolumn (up to 500). Each item is what update_markup takes, with an id or seq. Everything is checked first, so one bad item changes nothing. Markups that redcolumn then refuses to change are listed in failed.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        markups: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Markup id from list_markups.' },
              seq: { type: 'integer', description: 'Markup number shown in the list, when id is omitted.' },
              points: { ...pointsProp, description: 'Replacement points, in the same order place_markup uses for this type.' },
              text: { type: 'string', description: 'Replacement text. Empty clears it.' },
              style: styleProp,
            },
          },
        },
      },
      required: ['markups'],
    },
    annotations: CHANGES,
  },
  {
    name: 'delete_markups',
    title: 'Delete markups',
    description: 'Deletes markups by id. redcolumn asks for Allow first. One undo step after Allow.',
    annotations: REMOVES,
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        ids: { type: 'array', items: { type: 'string' }, description: 'Markup ids from list_markups.' },
      },
    },
  },
  {
    name: 'list_assemblies',
    title: 'List takeoff assemblies',
    description:
      "Lists the drawing's takeoff assemblies: each one's items with their units and formulas, and its variables. formulaNames are the measured values a formula can use ([Length], [Area], [Count]...). Use this before propose_takeoff.",
    inputSchema: { type: 'object', properties: { document: documentProp } },
    annotations: READS,
  },
  {
    name: 'propose_takeoff',
    title: 'Propose takeoff assemblies',
    description:
      'Proposes an assembly for each of some measurements (from list_markups), with your reasoning and, optionally, the quantities you expect. Proposals do not change the drawing: they wait in Takeoff Review, where the person approves, edits or rejects each one. Nothing is added to the takeoff until they approve it. Up to 500 per call; a new proposal for a measurement replaces its earlier pending one.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        source: { type: 'string', description: 'Your name, shown to the person as who proposed it.' },
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Measurement markup id from list_markups.' },
              seq: { type: 'integer', description: 'Measurement number, when id is omitted.' },
              assembly: { type: 'string', description: 'Assembly name or id from list_assemblies.' },
              reasoning: { type: 'string', description: 'Why this assembly fits this measurement, for the person checking it.' },
              expected: {
                type: 'array',
                description: 'The quantities you expect, checked against what the assembly works out.',
                items: { type: 'object', properties: { item: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' } }, required: ['item', 'quantity'] },
              },
            },
            required: ['assembly', 'reasoning'],
          },
        },
      },
      required: ['proposals'],
    },
    annotations: ADDS,
  },
  {
    name: 'list_takeoff_proposals',
    title: 'List takeoff proposals',
    description: 'Lists takeoff proposals on a drawing and where each stands: pending, approved (and by whom, and whether they edited it) or rejected.',
    inputSchema: { type: 'object', properties: { document: documentProp } },
    annotations: READS,
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
