import { expect, test } from '../support/app.ts';

// Erase Content with an outline removes only what lies inside the outline.
// On page 1 "DOOR 2" is set at x 420, baseline y 330, 12 pt. The triangle below has the box
// 410-480 by 315-340 as its bounds but only its upper-right half: the end of the word is in it, the start is not.
test.describe('erase content', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('clicking the corners erases what is inside the outline, not the whole box', async ({ app }) => {
    expect(await app.search('DOOR 2')).toEqual([1, 2]);
    await app.cmd('edit.eraseContent');
    await app.clicks([[410, 315], [480, 315], [480, 340], [410, 315]]);
    await expect.poll(() => app.search('DOOR 2'), { timeout: 30_000 }).toEqual([2]);
    // What lies in the bounds but outside the outline stays.
    expect(await app.search('DOO')).toContain(1);
    expect(await app.search('DOOR 1')).toEqual([1, 2]);
    expect(await app.markups()).toEqual([]);
    // The tool stays on, for the next area.
    expect((await app.toolState()).tool).toBe('eraseContent');
  });

  test('edit.cutContent with an outline copies it and removes only what is inside', async ({ app }) => {
    await app.cmd('edit.cutContent');
    await app.clicks([[410, 315], [480, 315], [480, 340], [410, 315]]);
    await expect.poll(() => app.search('DOOR 2'), { timeout: 30_000 }).toEqual([2]);
    expect(await app.search('DOO')).toContain(1);
    await expect.poll(async () => (await app.command('edit.paste')).enabled).toBe(true);
    expect((await app.toolState()).tool).toBe('select');
  });

  test('on a sheet turned by /Rotate 90, the outline lands where it was drawn', async ({ app }) => {
    // Page 2 shows "TYPICAL CROSS SECTIONS" at x 100, baseline y 200, 20 pt. The triangle's upper-right half
    // takes the end of the line (from about x 290); the box it sits in also holds the start, which stays.
    await app.open('rotated.pdf');
    await app.cmd('view.nextPage');
    await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
    expect(await app.search('SECTIONS')).toEqual([2]);
    await app.cmd('edit.eraseContent');
    await app.clicks([[200, 170], [360, 170], [360, 210], [200, 170]]);
    await expect.poll(() => app.search('SECTIONS'), { timeout: 30_000 }).toEqual([]);
    expect(await app.search('TYPICAL')).toEqual([2]);
  });

  test('dragging still erases the whole box', async ({ app }) => {
    await app.tool('eraseContent');
    await app.drag([410, 315], [480, 340]);
    await expect.poll(() => app.search('DOOR 2'), { timeout: 30_000 }).toEqual([2]);
    expect(await app.search('DOOR 1')).toEqual([1, 2]);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
