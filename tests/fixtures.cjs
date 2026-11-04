'use strict';

function solid(width, height, color = [160, 160, 160, 255]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(color, i * 4);
  return pixels;
}

function paint(pixels, width, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) pixels.set(color, (y * width + x) * 4);
  }
}

module.exports = {solid, paint};
