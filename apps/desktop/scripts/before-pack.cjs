// electron-builder beforePack hook (electron-builder.yml).
//
// The NSIS installer carries the app as a 7z archive. For arm64 binaries 7-Zip picks its ARM64
// branch filter (7-Zip 23 and later), which the Nsis7z plugin that extracts the archive at install
// time cannot decode: the install ends up with every .exe and .dll missing and app.asar empty.
// Forcing the x86 BCJ filter keeps the archive readable; it only costs a little compression on
// the arm64 binaries. x64 builds already get BCJ, so they are unchanged.
//
// electron-builder reads ELECTRON_BUILDER_7Z_FILTER when it writes the archive, after this hook.

/** builder-util's Arch enum: ia32 0, x64 1, armv7l 2, arm64 3, universal 4. */
const ARM64 = 3;

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'win32' && context.arch === ARM64 && !process.env.ELECTRON_BUILDER_7Z_FILTER) {
    process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ';
  }
};
