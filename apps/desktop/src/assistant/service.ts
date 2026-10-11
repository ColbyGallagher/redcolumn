import { newToken, readEndpoint, writeEndpoint, type AssistantEndpoint } from './endpoint';
import { listenForAssistant, type AssistantHandler } from './server';

/**
 * Listens only while the person has turned the assistant on. The token changes each time
 * listening starts, which is once per launch of the desktop app.
 */
export class AssistantService {
  private open: { port: number; close: () => Promise<void> } | null = null;
  private readonly file: string;
  private readonly handler: AssistantHandler;

  constructor(file: string, handler: AssistantHandler) {
    this.file = file;
    this.handler = handler;
  }

  current(): AssistantEndpoint {
    const saved = readEndpoint(this.file);
    if (this.open) return { enabled: true, port: this.open.port, token: saved.token };
    return { enabled: saved.enabled };
  }

  async restore() {
    if (readEndpoint(this.file).enabled) await this.start();
  }

  async setEnabled(on: boolean): Promise<AssistantEndpoint> {
    if (!on) {
      await this.stop();
      writeEndpoint(this.file, { enabled: false });
      return { enabled: false };
    }
    if (!this.open) await this.start();
    return readEndpoint(this.file);
  }

  /** The app is quitting. Remember the switch, and drop the port so nothing dials a dead listener. */
  suspend() {
    const enabled = readEndpoint(this.file).enabled;
    const open = this.open;
    this.open = null;
    void open?.close();
    writeEndpoint(this.file, { enabled });
  }

  private async start() {
    await this.stop();
    const token = newToken();
    const open = await listenForAssistant(token, this.handler);
    this.open = open;
    writeEndpoint(this.file, { enabled: true, port: open.port, token });
  }

  private async stop() {
    const open = this.open;
    this.open = null;
    if (open) await open.close();
  }
}
