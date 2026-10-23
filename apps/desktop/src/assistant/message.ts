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
  'get_page_image',
  'get_page_text',
  'select_markups',
  'place_markup',
  'place_markups',
  'update_markup',
  'update_markups',
  'delete_markups',
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

const regionProp = {
  type: 'object',
  description: 'Part of the page, in PDF points from the top-left: x, y, w, h. The whole page when omitted.',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
  required: ['x', 'y', 'w', 'h'],
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
    name: 'get_page_image',
    title: 'See a page',
    description:
      'A picture of a page, or part of one, as the drawing shows it. The reply has the image and, as text, its scale in pixels per PDF point and the region it covers, so a pixel at (px, py) is the page point (region.x + px / scale, region.y + py / scale). The whole page is scaled to fit maxSize, so small linework and lettering blur: look at the whole page first to find what you need, then ask for a region a few hundred points across. Markups are drawn over the page unless markups is false.',
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. The page on screen when omitted.' },
        region: regionProp,
        dpi: { type: 'number', minimum: 18, maximum: 600, description: 'Resolution in pixels per inch (72 = one pixel per point). The picture is still kept within maxSize, so a whole sheet may come back at less than this. 200 when omitted.' },
        maxSize: { type: 'integer', minimum: 256, maximum: 4096, description: 'Most pixels on the longer side. 1600 when omitted.' },
        markups: { type: 'boolean', description: 'false leaves the markups off, showing the drawing alone. true when omitted.' },
      },
    },
    annotations: READS,
  },
  {
    name: 'get_page_text',
    title: 'Read page text',
    description:
      "The text on a page as the PDF holds it, word by word with each word's box in PDF points (x0, y0 top-left; x1, y1 bottom-right) and font size, in reading order. Narrow it with region or search. Scanned pages have no text until they are OCRed (document.ocr). 1000 words per call when limit is omitted; the reply has total, and nextOffset while more remain.",
    inputSchema: {
      type: 'object',
      properties: {
        document: documentProp,
        page: { type: 'integer', description: '1-based page number. The page on screen when omitted.' },
        region: regionProp,
        search: { type: 'string', description: 'Only words containing this, ignoring case.' },
        limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'Most words to return. 1000 when omitted.' },
        offset: { type: 'integer', minimum: 0, description: 'Words to skip, from nextOffset of the last reply.' },
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

/** A picture a tool returns beside its text: base64 bytes and their media type. */
interface ToolImage {
  mimeType: string;
  data: string;
}

function imageOf(value: unknown): ToolImage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const image = (value as { image?: unknown }).image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  const { mimeType, data } = image as { mimeType?: unknown; data?: unknown };
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/') || typeof data !== 'string' || !data) return null;
  return { mimeType, data };
}

/**
 * What a tool answered, as MCP content. A reply with an `image` (get_page_image) becomes a text
 * block for the rest of it and an image block the client shows the model.
 */
export function toolContent(value: unknown) {
  if (typeof value === 'string') return toolText(value, false);
  const image = imageOf(value);
  if (!image) return toolText(JSON.stringify(value), false);
  const { image: _, ...rest } = value as { image: unknown } & Record<string, unknown>;
  return { content: [{ type: 'text', text: JSON.stringify(rest) }, { type: 'image', mimeType: image.mimeType, data: image.data }], isError: false };
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
          return rpcResult(id, toolContent(value));
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
