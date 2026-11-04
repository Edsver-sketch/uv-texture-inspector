/* UV island speck candidates. Pure ES2017; no network or external runtime.
 * Luminance uses 1/256 fixed-point values: median quantization error <= 1/512.
 * This finds dark, compact outliers, not confirmed texture defects.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UVDetector = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCALE = 256;
  var GROUP_BITS = 6;
  var GROUP_SIZE = 1 << GROUP_BITS;
  var GROUP_COUNT = 65536 / GROUP_SIZE;

  function round2(value) { return Math.round(value * 100) / 100; }
  function yieldTask() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
  function reflect(index, length) {
    if (length === 1) return 0;
    while (index < 0 || index >= length) {
      if (index < 0) index = -index - 1;
      if (index >= length) index = 2 * length - index - 1;
    }
    return index;
  }

  // Exact 2D median of the fixed-point input, with SciPy-style reflect padding.
  // A sliding two-level histogram avoids sorting every 5x5/11x11 neighborhood.
  async function medianFilter(input, width, height, radius, report) {
    var output = new Uint16Array(input.length);
    var bins = new Uint16Array(65536);
    var groups = new Uint16Array(GROUP_COUNT);
    var side = radius * 2 + 1;
    var half = (side * side) >> 1;
    var xMap = new Int32Array(width + 2 * radius);
    var yMap = new Int32Array(height + 2 * radius);
    var i, y, x, k, row, value, group;
    for (i = 0; i < xMap.length; i++) xMap[i] = reflect(i - radius, width);
    for (i = 0; i < yMap.length; i++) yMap[i] = reflect(i - radius, height) * width;
    for (y = 0; y < height; y++) {
      bins.fill(0);
      groups.fill(0);
      for (k = 0; k < side; k++) {
        row = yMap[y + k];
        for (i = 0; i < side; i++) {
          value = input[row + xMap[i]];
          bins[value]++;
          groups[value >> GROUP_BITS]++;
        }
      }
      var medianGroup = 0;
      var belowGroup = 0;
      for (x = 0; x < width; x++) {
        while (belowGroup > half) {
          medianGroup--;
          belowGroup -= groups[medianGroup];
        }
        while (belowGroup + groups[medianGroup] <= half) {
          belowGroup += groups[medianGroup];
          medianGroup++;
        }
        var count = belowGroup;
        value = medianGroup * GROUP_SIZE;
        while (count + bins[value] <= half) count += bins[value++];
        output[y * width + x] = value;
        if (x + 1 < width) {
          var removeX = xMap[x];
          var addX = xMap[x + side];
          for (k = 0; k < side; k++) {
            row = yMap[y + k];
            value = input[row + removeX];
            group = value >> GROUP_BITS;
            bins[value]--;
            groups[group]--;
            if (group < medianGroup) belowGroup--;
            value = input[row + addX];
            group = value >> GROUP_BITS;
            bins[value]++;
            groups[group]++;
            if (group < medianGroup) belowGroup++;
          }
        }
      }
      if ((y & 15) === 15 || y === height - 1) {
        report((y + 1) / height);
        await yieldTask();
      }
    }
    return output;
  }

  // For sampled mask pixels, distance to a zero pixel >=3 is exactly a 5x5
  // all-covered neighborhood: every offset in that square has distance <3.
  // Outside the image is conservatively treated as uncovered.
  async function safeInterior(mask, width, height, report) {
    var horizontal = new Uint8Array(mask.length);
    var safe = new Uint8Array(mask.length);
    var y, x, i, count;
    for (y = 0; y < height; y++) {
      var row = y * width;
      count = 0;
      for (x = 0; x < width; x++) {
        count += mask[row + x] ? 1 : 0;
        if (x >= 5) count -= mask[row + x - 5] ? 1 : 0;
        if (x >= 4 && count === 5) horizontal[row + x - 2] = 1;
      }
    }
    for (x = 0; x < width; x++) {
      count = 0;
      for (y = 0; y < height; y++) {
        i = y * width + x;
        count += horizontal[i];
        if (y >= 5) count -= horizontal[i - 5 * width];
        if (y >= 4 && count === 5) safe[i - 2 * width] = 1;
      }
      if ((x & 127) === 127 || x === width - 1) {
        report((x + 1) / width);
        await yieldTask();
      }
    }
    return safe;
  }

  function mergeComponents(components) {
    var used = new Uint8Array(components.length);
    var spots = [];
    for (var i = 0; i < components.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      var members = [i];
      for (var head = 0; head < members.length; head++) {
        var current = components[members[head]];
        for (var j = i + 1; j < components.length; j++) {
          if (used[j]) continue;
          var dx = current.x - components[j].x;
          var dy = current.y - components[j].y;
          if (dx * dx + dy * dy <= 144) {
            used[j] = 1;
            members.push(j);
          }
        }
      }
      var area = 0, sumX = 0, sumY = 0, clear = true;
      var bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (var m = 0; m < members.length; m++) {
        var c = components[members[m]];
        area += c.area;
        sumX += c.x * c.area;
        sumY += c.y * c.area;
        bbox[0] = Math.min(bbox[0], c.bbox[0]);
        bbox[1] = Math.min(bbox[1], c.bbox[1]);
        bbox[2] = Math.max(bbox[2], c.bbox[2]);
        bbox[3] = Math.max(bbox[3], c.bbox[3]);
        if (c.mean < 24 || c.ratio < 0.85) clear = false;
      }
      spots.push({id: spots.length + 1, x: round2(sumX / area),
        y: round2(sumY / area), bbox: bbox, area: area,
        tier: clear ? 'clear' : 'review'});
    }
    return spots;
  }

  /**
   * @param {Uint8Array|Uint8ClampedArray} rgba RGBA pixels, width*height*4.
   * @param {number} width
   * @param {number} height
   * @param {Uint8Array} mask Nonzero means UV-covered; must match the texture.
   *   Texture pixels with alpha<16 are excluded; normal semitransparency remains.
   * @param {object} [options] sensitivity: 0.5..2 (default 1; higher detects
   *   weaker dots). onProgress({stage,progress}) receives progress in 0..1.
   * @returns {Promise<{spots:Array,coreMask:Uint8Array}>} bbox right/bottom are
   *   exclusive. coreMask contains accepted component pixels, not repair masks.
   */
  async function detect(rgba, width, height, mask, options) {
    options = options || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Invalid image dimensions.');
    }
    var n = width * height;
    if (!rgba || rgba.length !== n * 4 || !mask || mask.length !== n) {
      throw new Error('Texture and UV mask dimensions must match.');
    }
    var sensitivity = options.sensitivity === undefined ? 1 : Number(options.sensitivity);
    if (!Number.isFinite(sensitivity)) throw new Error('Invalid sensitivity.');
    sensitivity = Math.max(0.5, Math.min(2, sensitivity));
    function progress(stage, value) {
      if (typeof options.onProgress === 'function') options.onProgress({stage: stage, progress: value});
    }
    progress('prepare', 0);
    await yieldTask();
    var luminance = new Uint16Array(n);
    var effectiveMask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * 4;
      luminance[i] = Math.round((2126 * rgba[p] + 7152 * rgba[p + 1] + 722 * rgba[p + 2]) * SCALE / 10000);
      effectiveMask[i] = mask[i] && rgba[p + 3] >= 16 ? 1 : 0;
      if (i > 0 && (i & 262143) === 0) await yieldTask();
    }
    var safe = await safeInterior(effectiveMask, width, height, function (v) { progress('uv-interior', 0.02 + v * 0.06); });
    var analyzedPixels = 0;
    for (var safeIndex = 0; safeIndex < safe.length; safeIndex++) analyzedPixels += safe[safeIndex];
    if (analyzedPixels === 0) return {spots: [], coreMask: new Uint8Array(mask.length), analyzedPixels: 0};
    effectiveMask = null;
    var med5 = await medianFilter(luminance, width, height, 2, function (v) { progress('median-5', 0.08 + v * 0.23); });
    var med11 = await medianFilter(luminance, width, height, 5, function (v) { progress('median-11', 0.31 + v * 0.27); });
    var deviation = new Uint16Array(n);
    for (i = 0; i < n; i++) deviation[i] = Math.abs(luminance[i] - med5[i]);
    var noise = await medianFilter(deviation, width, height, 5, function (v) { progress('local-noise', 0.58 + v * 0.27); });
    deviation = null;
    var raw = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      raw[i] = safe[i] && med11[i] - luminance[i] > Math.max(5 * SCALE, 5 * noise[i]) / sensitivity ? 1 : 0;
    }
    noise = null;
    var coreMask = new Uint8Array(n);
    var queue = new Uint32Array(n);
    var components = [];
    var order = 0;
    var processed = 0;
    for (var seed = 0; seed < n; seed++) {
      if (!raw[seed]) continue;
      raw[seed] = 0;
      var head = 0, tail = 1;
      queue[0] = seed;
      var minX = width, minY = height, maxX = -1, maxY = -1;
      var sumX = 0, sumY = 0, sum11 = 0, sum5 = 0;
      while (head < tail) {
        var index = queue[head++];
        var cy = Math.floor(index / width), cx = index - cy * width;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        sumX += cx; sumY += cy;
        sum11 += med11[index] - luminance[index];
        sum5 += med5[index] - luminance[index];
        for (var dy = -1; dy <= 1; dy++) {
          var ny = cy + dy;
          if (ny < 0 || ny >= height) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var nx = cx + dx;
            if (nx < 0 || nx >= width || (!dx && !dy)) continue;
            var neighbor = ny * width + nx;
            if (raw[neighbor]) { raw[neighbor] = 0; queue[tail++] = neighbor; }
          }
        }
        if ((++processed & 65535) === 0) {
          progress('components', 0.85 + 0.13 * seed / n);
          await yieldTask();
        }
      }
      order++;
      var bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (tail < 2 || tail > 36 || Math.max(bw, bh) > 10 || Math.max(bw, bh) / Math.min(bw, bh) > 4.5) continue;
      var mean = round2(sum11 / tail / SCALE);
      if (mean < 20 / sensitivity) continue;
      var ratio = round2((sum5 / tail / SCALE) / mean);
      if (ratio < 0.70) continue;
      var score = round2((sum11 / tail / SCALE) * Math.sqrt(tail) * Math.min(1, tail / (bw * bh) * 2));
      components.push({x: round2(sumX / tail), y: round2(sumY / tail),
        bbox: [minX, minY, maxX + 1, maxY + 1], area: tail,
        mean: mean, ratio: ratio, score: score, order: order});
      for (var q = 0; q < tail; q++) coreMask[queue[q]] = 1;
    }
    components.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    progress('merge', 0.98);
    await yieldTask();
    var spots = mergeComponents(components);
    progress('done', 1);
    return {spots: spots, coreMask: coreMask, analyzedPixels: analyzedPixels};
  }

  return {detect: detect, version: '1.0.0'};
}));
