import { callAssistant } from './client';
import { endpointFile } from './endpoint';
import { attachStdio } from './stdio';

/**
 * Speaks MCP on stdin and forwards each tool to the desktop app, when that app is open and the
 * assistant is on. Packaged builds start this with the bundled Node binary. Development starts it
 * by running Electron as Node. Either way the process is a console program and stdin arrives.
 */
const mcp = attachStdio(process.stdin, process.stdout, (method, params) => callAssistant(endpointFile(), method, params));
const exit = () => process.exit(0);
process.stdin.on('mcp-idle', exit);
process.stdin.on('end', () => mcp.closeWhenDrained());
process.stdin.on('close', () => mcp.closeWhenDrained());
