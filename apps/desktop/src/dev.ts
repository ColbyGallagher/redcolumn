import { app } from 'electron';

/** Dev loads the Vite server. Packaged builds load app://redcolumn and a separate library. */
export const isDev = () => !app.isPackaged && process.env.ELECTRON_DEV === '1';

export const DEV_ORIGIN = 'http://127.0.0.1:5173';
