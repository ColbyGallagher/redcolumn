declare const __APP_VERSION__: string | undefined;

/** The release this build belongs to (the desktop app's version, which releases bump); "dev" outside a build. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
