import { desktop, type DesktopToken, type RedcolumnDesktop } from './host';
import { tokenHandle } from './tokens';

/** Feeds launchQueue from the command line and the operating system's Open With. */
export function installDesktopBridge() {
  const host = desktop();
  if (!host) return;
  installLaunch(host);
}

function installLaunch(host: RedcolumnDesktop) {
  // Chromium exposes launchQueue here, and nothing feeds it: Electron has no web manifest
  // file handler. Replace it so files from the command line reach consumeLaunchFiles.
  type Consumer = (params: { files: FileSystemFileHandle[] }) => void;
  let consumer: Consumer | null = null;
  const buffer: DesktopToken[] = [];
  const deliver = (items: DesktopToken[]) => {
    if (!items.length) return;
    if (!consumer) {
      buffer.push(...items);
      return;
    }
    consumer({ files: items.map((item) => tokenHandle(item.token, item.name)) });
  };
  host.onLaunchFiles(deliver);
  const queue = {
    setConsumer(fn: Consumer) {
      consumer = fn;
      const queued = buffer.splice(0);
      if (queued.length) fn({ files: queued.map((item) => tokenHandle(item.token, item.name)) });
      void host.takeLaunchFiles().then((items) => {
        if (items.length) fn({ files: items.map((item) => tokenHandle(item.token, item.name)) });
      });
    },
  };
  // Chromium's launchQueue is a getter with no setter, so assigning it throws in a module.
  // The property is configurable: redefine it.
  Object.defineProperty(window, 'launchQueue', { configurable: true, enumerable: true, value: queue, writable: false });
}
