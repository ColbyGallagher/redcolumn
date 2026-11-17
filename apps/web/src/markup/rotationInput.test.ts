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

describe('parseRotationInput, edge cases', () => {
  it('accepts a unicode minus, a leading plus and exponent degrees', () => {
    near(deg('−2%'), deg('-2%'));
    assert.equal(deg('+2%'), deg('2%'));
    assert.equal(deg('+30'), 30);
    assert.equal(deg('1e2'), 100);
    assert.equal(deg('1E1'), 10);
  });
  it('treats -0% and zero ratios properly', () => {
    assert.equal(deg('-0%'), 0);
    const z = parseRotationInput('-0%', 'ccw');
    assert.ok(z.ok && z.degrees === 0 && !Object.is(z.degrees, -0));
    assert.equal(parseRotationInput('1:00').ok, false);
    assert.equal(parseRotationInput('1:0.0').ok, false);
  });
  it('rejects a signed denominator and explains a decimal comma', () => {
    assert.equal(parseRotationInput('1:-50').ok, false);
    assert.equal(parseRotationInput('-1:-50').ok, false);
    const r = parseRotationInput('2,5%');
    assert.ok(!r.ok && r.error.includes('decimal point'));
    assert.equal(parseRotationInput('2,5').ok, false);
  });
  it('rejects numbers too large to be finite', () => {
    assert.equal(parseRotationInput('1e999').ok, false);
    assert.equal(parseRotationInput('-1e999').ok, false);
    assert.equal(parseRotationInput('1e999', 'ccw').ok, false);
  });
  it('warns on a ratio steeper than 1:1', () => {
    assert.ok(parse('1:0.5').warning);
    assert.equal(parse('1:1').warning, undefined);
  });
  it('reads out the grade for a plain counter-clockwise angle', () => {
    const r = parseRotationInput('1.1458', 'ccw');
    assert.ok(r.ok && r.readout === '≈ 2%');
  });
});
