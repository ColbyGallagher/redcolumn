// File Attachment: pick a file, then click where the paperclip goes.
const { demo, WIDE } = require('../gifs-lib.cjs');

module.exports = demo('tool-attachment', {
  viewport: WIDE,
  async setup() {},
  async play({ click, tool, chooseFile }) {
    await chooseFile(() => tool('attachment'), 'specification.txt');
    await click(24, 20);
  },
});
