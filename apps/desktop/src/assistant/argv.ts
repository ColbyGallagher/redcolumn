export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * How a client starts the assistant. The executable is a GUI program, so it does not receive
 * stdin; `ELECTRON_RUN_AS_NODE` runs that same executable as Node, which does.
 */
export function mcpLaunch(execPath: string, script: string): McpLaunch {
  return { command: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
