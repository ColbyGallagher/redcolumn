import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { handleMcpMessage, takeLines, type ToolCall } from './message';

/** Reads MCP from `input` and writes replies to `output`. Nothing else is written there. */
export function attachStdio(input: Readable, output: Writable, call: ToolCall, version?: string): { feed: (chunk: Buffer | string) => void; stop: () => void; closeWhenDrained: () => void } {
  const decoder = new StringDecoder('utf8');
  const state = { buf: '' };
  let pending = 0;
  let closing = false;
  const drained = () => {
    if (closing && pending === 0) input.emit('mcp-idle');
  };
  const feed = (chunk: Buffer | string) => {
    let lines: string[];
    try {
      lines = takeLines(state, decoder.write(chunk));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      state.buf = '';
      return;
    }
    for (const line of lines) {
      pending += 1;
      const settle = () => {
        pending -= 1;
        drained();
      };
      void handleMcpMessage(line, call, version)
        .then((reply) => {
          if (!reply) {
            settle();
            return;
          }
          output.write(reply + '\n', () => settle());
        })
        .catch((err: unknown) => {
          console.error(err instanceof Error ? err.message : err);
          settle();
        });
    }
    drained();
  };
  input.on('data', feed);
  return {
    feed,
    stop: () => input.off('data', feed),
    closeWhenDrained: () => {
      closing = true;
      drained();
    },
  };
}
