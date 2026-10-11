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
export function mcpLaunch(execPath: string, script: string, nodePath?: string): McpLaunch {
  if (nodePath) return { command: nodePath, args: [script], env: {} };
  return { command: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
