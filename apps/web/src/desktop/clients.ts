export interface AssistantLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClientSetup {
  id: string;
  title: string;
  note: string;
  /** Text the person copies into that client. */
  copy: string;
  href?: string;
  hrefLabel?: string;
}

/** A single-quoted shell word. Backslashes stay literal, which a Windows path needs. */
function quote(value: string): string {
  if (!/[\s']/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function toml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function encodeConfig(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function claudeConfigPath(platform: 'win' | 'mac' | 'other'): string {
  if (platform === 'win') return '%APPDATA%\\Claude\\claude_desktop_config.json';
  if (platform === 'mac') return '~/Library/Application Support/Claude/claude_desktop_config.json';
  return 'Claude Desktop → Settings → Developer → Edit Config';
}

/** One install action per client. Each starts the Node program shipped with this installation. */
export function clientSetups(launch: AssistantLaunch, platform: 'win' | 'mac' | 'other'): ClientSetup[] {
  const command = quote(launch.command);
  const args = launch.args.map(quote).join(' ');
  const server = {
    command: launch.command,
    args: launch.args,
    ...(Object.keys(launch.env).length > 0 ? { env: launch.env } : {}),
  };
  const cursorConfig = server;
  const vscodeConfig = { type: 'stdio', ...server };
  const claude = { mcpServers: { redcolumn: server } };
  const copilot = { servers: { redcolumn: vscodeConfig } };
  const envLines = Object.entries(launch.env).map(([key, value]) => `${key} = ${toml(value)}`).join('\n');
  const envTable = envLines ? `\n\n[mcp_servers.redcolumn.env]\n${envLines}` : '';
  const tomlBlock = `[mcp_servers.redcolumn]\ncommand = ${toml(launch.command)}\nargs = [${launch.args.map(toml).join(', ')}]${envTable}`;
  const envFlags = Object.entries(launch.env).map(([key, value]) => `--env ${key}=${quote(value)}`).join(' ');
  const envPrefix = envFlags ? `${envFlags} ` : '';
  return [
    {
      id: 'copilot',
      title: 'GitHub Copilot',
      note: 'In VS Code, run MCP: Open User Configuration and add redcolumn under servers. That file is your user profile, so Copilot Chat can use it in every workspace. Do not put it in a project’s .vscode/mcp.json.',
      copy: JSON.stringify(copilot, null, 2),
      href: `https://vscode.dev/redirect/mcp/install?name=redcolumn&config=${encodeURIComponent(encodeConfig(vscodeConfig))}`,
      hrefLabel: 'Add to VS Code',
    },
    {
      id: 'claude',
      title: 'Claude Desktop',
      note: `Add redcolumn inside mcpServers in ${claudeConfigPath(platform)}. If that file already has other servers, add redcolumn beside them, then quit Claude and open it again.`,
      copy: JSON.stringify(claude, null, 2),
    },
    {
      id: 'claude-code',
      title: 'Claude Code',
      note: 'User scope, so the assistant is available in every project.',
      copy: `claude mcp add --scope user redcolumn ${envPrefix}-- ${command} ${args}`,
    },
    {
      id: 'codex',
      title: 'Codex',
      note: 'This writes ~/.codex/config.toml, which the Codex CLI, the IDE extension, and the ChatGPT desktop app share. The table below is the same entry if you edit the file yourself.',
      copy: `codex mcp add redcolumn ${envPrefix}-- ${command} ${args}\n\n${tomlBlock}`,
    },
    {
      id: 'cursor',
      title: 'Cursor',
      note: 'Cursor asks you to confirm, then starts redcolumn the next time you chat.',
      copy: JSON.stringify({ mcpServers: { redcolumn: cursorConfig } }, null, 2),
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=redcolumn&config=${encodeURIComponent(encodeConfig(cursorConfig))}`,
      hrefLabel: 'Add to Cursor',
    },
  ];
}
