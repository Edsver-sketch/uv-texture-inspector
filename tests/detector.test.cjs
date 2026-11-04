'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {solid, paint} = require('./fixtures.cjs');
const detector = require('../detector.js');

test('flat texture stays clear and a known compact dark spot is localized', async () => {
  const width=40, height=40;
  const pixels=solid(width,height);
  const mask=new Uint8Array(width*height).fill(1);
  assert.equal((await detector.detect(pixels,width,height,mask)).spots.length,0);
  paint(pixels,width,19,19,22,22,[100,100,100,255]);
  let previous=-1;
  const result=await detector.detect(pixels,width,height,mask,{
    onProgress(update) {
      assert.ok(update.progress>=previous && update.progress<=1);
      previous=update.progress;
    }
  });
  assert.equal(previous,1);
  assert.equal(result.spots.length,1);
  assert.equal(result.spots[0].area,9);
  assert.deepEqual(result.spots[0].bbox,[19,19,22,22]);
  assert.equal(result.spots[0].tier,'clear');
  assert.equal(result.coreMask.reduce((sum,pixel)=>sum+pixel,0),9);
});

test('transparent texture pixels and uncovered UV regions cannot produce candidates', async () => {
  const width=40,height=40;
  const pixels=solid(width,height);
  const mask=new Uint8Array(width*height).fill(1);
  paint(pixels,width,19,19,22,22,[100,100,100,0]);
  assert.equal((await detector.detect(pixels,width,height,mask)).spots.length,0);
  paint(pixels,width,19,19,22,22,[100,100,100,128]);
  assert.equal((await detector.detect(pixels,width,height,mask)).spots.length,1);
  for(let y=17;y<=23;y++)for(let x=17;x<=23;x++)mask[y*width+x]=0;
  assert.equal((await detector.detect(pixels,width,height,mask)).spots.length,0);
  await assert.rejects(detector.detect(pixels,width+1,height,mask),/dimensions must match/);
});

test('a narrow wire mask reports no analyzable interior, distinct from a clean covered texture', async () => {
  const width=40,height=40;
  const pixels=solid(width,height);
  const wire=new Uint8Array(width*height);
  for(let y=5;y<35;y++)wire[y*width+20]=1;
  const noInterior=await detector.detect(pixels,width,height,wire);
  assert.equal(noInterior.analyzedPixels,0);
  assert.equal(noInterior.spots.length,0);
  assert.equal(noInterior.coreMask.reduce((sum,pixel)=>sum+pixel,0),0);
  const covered=await detector.detect(pixels,width,height,new Uint8Array(width*height).fill(1));
  assert.ok(covered.analyzedPixels>0,'a clean texture still has pixels that were actually checked');
  assert.equal(covered.spots.length,0);
});
