'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {solid, paint} = require('./fixtures.cjs');
const UVMask = require('../uv-mask.js');

test('transparent UV keeps alpha64 island fill and excludes lower alpha', () => {
  const pixels = new Uint8Array([
    203,203,203,64, 255,255,255,255, 255,255,255,63, 255,255,255,0
  ]);
  const result = UVMask.extract(pixels, 2, 2);
  assert.equal(result.mode, 'alpha');
  assert.equal(result.coverage, 0.5);
  assert.deepEqual(Array.from(result.mask), [1,1,0,0]);
  assert.equal(UVMask.extract(solid(20,20,[255,255,255,255]),20,20,{mode:'alpha'}).coverage, 0);
});

test('dark and light backdrops do not become UV coverage', () => {
  for (const item of [
    {background:0, foreground:51, mode:'dark'},
    {background:255, foreground:242, mode:'light'}
  ]) {
    const pixels = solid(100,100,[item.background,item.background,item.background,255]);
    assert.equal(UVMask.extract(pixels,100,100).coverage, 0);
    paint(pixels,100,20,20,80,80,[item.foreground,item.foreground,item.foreground,255]);
    const result = UVMask.extract(pixels,100,100);
    assert.equal(result.mode,item.mode);
    assert.equal(result.coverage,0.36);
    assert.equal(result.mask[0],0);
    assert.equal(result.mask[50*100+50],1);
  }
});

test('wireframes are not filled, and obvious screenshot frames are rejected', () => {
  const wire = solid(100,100,[255,255,255,255]);
  paint(wire,100,20,20,80,21,[0,0,0,255]);
  paint(wire,100,20,79,80,80,[0,0,0,255]);
  paint(wire,100,20,20,21,80,[0,0,0,255]);
  paint(wire,100,79,20,80,80,[0,0,0,255]);
  const result = UVMask.extract(wire,100,100);
  assert.equal(result.mask[50*100+50],0);
  assert.equal(result.mask[20*100+30],1);
  const framed = solid(100,100,[0,0,0,255]);
  paint(framed,100,3,3,97,97,[255,255,255,255]);
  paint(framed,100,30,30,70,70,[0,0,0,255]);
  assert.equal(UVMask.extract(framed,100,100).coverage,0);
});
