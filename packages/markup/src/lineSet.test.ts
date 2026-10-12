import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlx } from './lineSet.ts';

// Styles from Bluebeam's Advanced set, and the specs it writes to a PDF's /LineStyle for them (the
// same ones lineStyle.test.ts draws).
const SET = `﻿<?xml version="1.0" encoding="utf-8"?>
<BluebeamRevuLineStyleSet Version="1">
  <Title>789c734c294bcc4b4e4d01000d840317</Title>
  <LineStyle Name="Gas" ScaleWithLineWidth="True">
    <Line Offset="0">
      <Component Type="Dash" Index="0" Width="18" />
      <Component Type="Space" Index="1" Width="2" />
      <Component Type="Text" Index="2" Text="GAS">
        <Font>Helvetica</Font>
        <Bold>False</Bold>
        <Italic>False</Italic>
        <Size>6</Size>
        <Upright>True</Upright>
      </Component>
      <Component Type="Space" Index="3" Width="2" />
    </Line>
  </LineStyle>
  <LineStyle Name="Zig Zag" ScaleWithLineWidth="True">
    <Line Offset="0">
      <Component Type="Vector" Index="0" Left="7" Right="7" Scale="1" Fill="False">
        <Point Type="Start" Index="0" X="-7" Y="0" />
        <Point Type="Line" Index="1" X="-3" Y="-4" />
        <Point Type="Line" Index="2" X="4" Y="3" />
        <Point Type="Line" Index="3" X="7" Y="0" />
      </Component>
    </Line>
  </LineStyle>
  <LineStyle Name="Double" ScaleWithLineWidth="True">
    <Line Offset="-3" />
    <Line Offset="3" />
    <Description />
  </LineStyle>
  <LineStyle Name="Road" ScaleWithLineWidth="True">
    <Line Offset="-3" />
    <Line Offset="0">
      <Component Type="Dash" Index="0" Width="3" />
      <Component Type="Space" Index="1" Width="3" />
    </Line>
    <Line Offset="3" />
  </LineStyle>
  <LineStyle Name="Fenceline Circle" ScaleWithLineWidth="True">
    <Line Offset="0">
      <Component Type="Dash" Index="0" Width="22" />
      <Component Type="Vector" Index="1" Left="2" Right="2" Scale="1" Fill="False">
        <Point Type="Start" Index="0" X="0" Y="-2" />
        <Point Type="Curve" Index="1" X="1.10457" Y="-2" />
        <Point Type="Curve" Index="2" X="2" Y="-1.10457" />
        <Point Type="Curve" Index="3" X="2" Y="0" />
        <Point Type="Curve" Index="4" X="2" Y="1.10457" />
        <Point Type="Curve" Index="5" X="1.10457" Y="2" />
        <Point Type="Curve" Index="6" X="0" Y="2" />
        <Point Type="Curve" Index="7" X="-1.10457" Y="2" />
        <Point Type="Curve" Index="8" X="-2" Y="1.10457" />
        <Point Type="Curve" Index="9" X="-2" Y="0" />
        <Point Type="Curve" Index="10" X="-2" Y="-1.10457" />
        <Point Type="Curve" Index="11" X="-1.10457" Y="-2" />
        <Point Type="Curve" Index="12" X="0" Y="-2" />
      </Component>
    </Line>
  </LineStyle>
</BluebeamRevuLineStyleSet>`;

test('a .blx set reads as the specs Bluebeam writes to a PDF', async () => {
  const set = await parseBlx(SET);
  assert.equal(set.title, 'Advanced');
  const byName = Object.fromEntries(set.styles.map((s) => [s.name, s.spec]));
  assert.deepEqual(byName['Gas'], [true, [0, 18, -2, ['GAS', 'Helvetica', 6, false, false, true], -2]]);
  assert.deepEqual(byName['Zig Zag'], [true, [0, [7, 7, 1, false, 0, -7, 0, 1, -3, -4, 1, 4, 3, 1, 7, 0]]]);
  assert.deepEqual(byName['Double'], [true, [-3], [3]]);
  assert.deepEqual(byName['Road'], [true, [-3], [0, 3, -3], [3]]);
  assert.deepEqual(byName['Fenceline Circle'], [
    true,
    [0, 22, [2, 2, 1, false, 0, 0, -2, 2, 1.10457, -2, 2, 2, -1.10457, 2, 2, 0, 2, 2, 1.10457, 2, 1.10457, 2, 2, 0, 2, 2, -1.10457, 2, 2, -2, 1.10457, 2, -2, 0, 2, -2, -1.10457, 2, -1.10457, -2, 2, 0, -2]],
  ]);
  assert.deepEqual(
    set.styles.map((s) => s.name),
    ['Gas', 'Zig Zag', 'Double', 'Road', 'Fenceline Circle'],
  );
});

test('a plain title is kept, and a set without one is named for the file', async () => {
  const plain = await parseBlx('<BluebeamRevuLineStyleSet Version="1"><Title>Site lines</Title></BluebeamRevuLineStyleSet>');
  assert.equal(plain.title, 'Site lines');
  const none = await parseBlx('<BluebeamRevuLineStyleSet Version="1" />', 'Mine');
  assert.equal(none.title, 'Mine');
  assert.deepEqual(none.styles, []);
});

test('a style that is not scaled by line width says so', async () => {
  const set = await parseBlx('<BluebeamRevuLineStyleSet><LineStyle Name="Fixed" ScaleWithLineWidth="False"><Line Offset="0"><Component Type="Dash" Width="4" /></Line></LineStyle></BluebeamRevuLineStyleSet>');
  assert.deepEqual(set.styles[0]!.spec, [false, [0, 4]]);
});

test('other XML, and broken XML, are refused', async () => {
  await assert.rejects(parseBlx('<BluebeamRevuHatchSet />'), /line style set/);
  await assert.rejects(parseBlx('<BluebeamRevuLineStyleSet><LineStyle>'), /line style set/);
  await assert.rejects(parseBlx('not xml'), /line style set/);
});

test('components with no usable size are dropped rather than breaking the line', async () => {
  const set = await parseBlx('<BluebeamRevuLineStyleSet><LineStyle Name="Odd"><Line Offset="1"><Component Type="Dash" Width="0" /><Component Type="Space" Width="2" /><Component Type="Mystery" /><Component Type="Vector" Left="1" Right="1" Scale="1" Fill="False" /></Line></LineStyle></BluebeamRevuLineStyleSet>');
  assert.deepEqual(set.styles[0]!.spec, [true, [1, -2]]);
});
