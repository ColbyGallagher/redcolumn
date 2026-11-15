import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Markup } from '@nb/markup';
import { canHaveCutout, cutoutBlocker, cutoutTargetOf } from './cutoutTarget';

const m = (type: string, extra: Partial<Markup> = {}) => ({ id: type, type, ...extra }) as unknown as Markup;

describe('cutout target', () => {
  it('areas and volumes can have cutouts, other measurements cannot', () => {
    assert.equal(canHaveCutout(m('area')), true);
    assert.equal(canHaveCutout(m('volume')), true);
    assert.equal(canHaveCutout(m('length')), false);
    assert.equal(canHaveCutout(m('perimeter')), false);
    assert.equal(canHaveCutout(m('rectangle')), false);
  });

  it('needs exactly one unlocked area selected', () => {
    assert.equal(cutoutTargetOf([m('area')])?.id, 'area');
    assert.equal(cutoutTargetOf([]), null);
    assert.equal(cutoutTargetOf([m('area'), m('volume')]), null);
    assert.equal(cutoutTargetOf([m('area', { locked: true })]), null);
    assert.equal(cutoutTargetOf([m('count')]), null);
  });

  it('honours the edit rule, as drawing a cutout does', () => {
    const notMine = (x: Markup) => x.id !== 'area';
    assert.equal(cutoutTargetOf([m('area')], notMine), null);
    assert.equal(cutoutBlocker([m('area')], notMine), 'You can’t edit the selected area');
  });

  it('says why it is disabled', () => {
    assert.equal(cutoutBlocker([]), 'Select one unlocked area or volume first');
    assert.equal(cutoutBlocker([m('count')]), 'Select one unlocked area or volume first');
    assert.equal(cutoutBlocker([m('area'), m('volume')]), 'Select only one area or volume');
    assert.equal(cutoutBlocker([m('area', { locked: true })]), 'The selected area is locked');
    assert.equal(cutoutBlocker([m('area')]), null);
  });
});
