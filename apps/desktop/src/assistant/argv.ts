import path from 'node:path';

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Node binary shipped beside the assistant script. A packaged app cannot run as Node. */
export function assistantNodePath(dir: string, platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return join(dir, name);
}

/**
 * How a client starts the assistant.
 *
 * Unpackaged Electron honors `ELECTRON_RUN_AS_NODE`, which is what makes that GUI executable
 * read stdin. A packaged build turns the RunAsNode fuse off, so the same variable is ignored
 * and the executable starts a second copy of the app. Clients then run the Node binary shipped
 * beside the script.
 */
export function mcpLaunch(execPath: string, script: string, nodePath?: string, compact?: boolean): McpLaunch {
  const args = compact ? [script, '--compact'] : [script];
  if (nodePath) return { command: nodePath, args, env: {} };
  return { command: execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

export interface ParsedMcpCliArgs {
  compact: boolean;
  error?: string;
}

/** Parses CLI flags passed to `mcp-cli`. Unknown flags are rejected so typos fail fast. */
export function parseMcpCliArgs(argv: readonly string[]): ParsedMcpCliArgs {
  let compact = false;
  for (const arg of argv) {
    if (arg === '--compact') {
      compact = true;
    } else {
      return { compact: false, error: `Unknown argument: ${arg}\nUsage: mcp-cli [--compact]` };
    }
  }
  return { compact };
}
