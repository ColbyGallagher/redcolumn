import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeReadout, parseRotationInput } from './rotationInput.ts';

const parse = (s: string) => {
  const r = parseRotationInput(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r;
};
const deg = (s: string) => parse(s).degrees;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
const RAD = 180 / Math.PI;

describe('parseRotationInput', () => {
  it('keeps plain numbers as clockwise degrees', () => {
    assert.equal(deg('45'), 45);
    assert.equal(deg('45°'), 45);
    assert.equal(deg('-90'), 270);
    assert.equal(deg('360'), 0);
    near(deg('12.5'), 12.5);
  });

  it('turns a percentage fall into an angle (negative falls to the right = clockwise)', () => {
    near(deg('-2%'), 1.1458);
    near(deg('2%'), 360 - 1.1458);
    near(deg('-100%'), 45);
    near(deg('100%'), 315);
    near(deg('2.5 %'), 360 - Math.atan(0.025) * RAD);
    assert.equal(deg('0%'), 0);
  });

  it('accepts a 1:N ratio with a sign', () => {
    near(deg('-1:50'), Math.atan(1 / 50) * RAD);
    near(deg('1:50'), 360 - Math.atan(1 / 50) * RAD);
    near(deg('1 : 1'), 315);
  });

  it('reads out the equivalent', () => {
    assert.equal(parse('2%').readout, '≈ 1.146°');
    assert.ok(parse('1:50').readout.includes('1.146°'));
    assert.ok(parse('1:50').readout.includes('2%'));
    assert.equal(gradeReadout(1.1458), '≈ -2%');
    assert.equal(gradeReadout(358.8542), '≈ 2%');
    assert.equal(gradeReadout(90), undefined);
    assert.equal(gradeReadout(0), '≈ 0.00%');
  });

  it('warns above 100% but still applies', () => {
    assert.ok(parse('150%').warning);
    assert.ok(parse('-150%').warning);
    assert.equal(parse('100%').warning, undefined);
    assert.equal(parse('2%').warning, undefined);
  });

  it('rejects bad input', () => {
    for (const s of ['', 'abc', '%', '2%%', '1:0', '1:', '2:50', '1:abc', '--2%', '5 deg x']) {
      assert.equal(parseRotationInput(s).ok, false, s);
    }
  });
});

describe('parseRotationInput, counter-clockwise tools', () => {
  it('keeps plain numbers and turns grades into signed counter-clockwise degrees', () => {
    const ccw = (s: string) => {
      const r = parseRotationInput(s, 'ccw');
      if (!r.ok) throw new Error(r.error);
      return r.degrees;
    };
    assert.equal(ccw('90'), 90);
    assert.equal(ccw('-30'), -30);
    near(ccw('2%'), 1.1458);
    near(ccw('-2%'), -1.1458);
    near(ccw('-1:50'), -Math.atan(1 / 50) * RAD);
  });
});
