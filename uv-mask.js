/* UVMask: conservative image coverage extraction, ES2017, no dependencies.
 * dark/light name the BACKGROUND. threshold is luminance in [0, 255].
 * Alpha coverage always uses alpha >= 64, including Blender's translucent fill.
 * A raster wireframe cannot reveal complete UV islands or 3D adjacency.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UVMask = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function luminance(data, pixel) {
    var k = pixel * 4;
    return (54 * data[k] + 183 * data[k + 1] + 19 * data[k + 2]) / 256;
  }

  function ring(data, width, height, inset) {
    var values = [];
    var left = inset;
    var right = width - 1 - inset;
    var top = inset;
    var bottom = height - 1 - inset;
    var stride = Math.max(1, Math.floor(Math.max(width, height) / 256));
    var x;
    var y;
    for (x = left; x <= right; x += stride) {
      values.push(luminance(data, top * width + x));
      if (bottom !== top) values.push(luminance(data, bottom * width + x));
    }
    for (y = top + stride; y < bottom; y += stride) {
      values.push(luminance(data, y * width + left));
      if (left !== right) values.push(luminance(data, y * width + right));
    }
    values.sort(function (a, b) { return a - b; });
    return values;
  }

  function quantile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  }

  function extract(rgba, width, height, options) {
    options = options || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError('UVMask: width/height must be positive integers');
    }
    var size = width * height;
    if (!Number.isSafeInteger(size) || !rgba || rgba.length < size * 4) {
      throw new RangeError('UVMask: insufficient RGBA data');
    }
    var requested = options.mode || 'auto';
    if (['auto', 'alpha', 'dark', 'light'].indexOf(requested) < 0) {
      throw new RangeError('UVMask: unknown mode');
    }
    var suppliedThreshold = options.threshold;
    if (suppliedThreshold !== undefined &&
        (typeof suppliedThreshold !== 'number' || !Number.isFinite(suppliedThreshold) ||
         suppliedThreshold < 0 || suppliedThreshold > 255)) {
      throw new RangeError('UVMask: threshold must be between 0 and 255');
    }
    var mask = new Uint8Array(size);
    var alphaCovered = 0;
    var belowAlpha = 0;
    var i;
    for (i = 0; i < size; i += 1) {
      if (rgba[i * 4 + 3] >= 64) alphaCovered += 1;
      else belowAlpha += 1;
    }
    function result(mode, count, note) {
      return { mask: mask, width: width, height: height, mode: mode,
        coverage: count / size, note: note };
    }
    if (alphaCovered === 0) {
      return result('alpha', 0, '没有 alpha≥64 的有效像素；未把透明背景计入覆盖。');
    }
    // A few stray transparent pixels do not turn an opaque screenshot into a UV mask.
    var usableAlpha = belowAlpha >= Math.max(1, Math.ceil(size * 0.001));
    if (requested === 'alpha' || (requested === 'auto' && usableAlpha)) {
      if (!usableAlpha) {
        return result('alpha', 0, '图片没有足够的透明背景，无法用 alpha 区分覆盖；请选择自动、暗底或亮底。');
      }
      for (i = 0; i < size; i += 1) mask[i] = rgba[i * 4 + 3] >= 64 ? 1 : 0;
      return result('alpha', alphaCovered,
        '按 alpha≥64 保留岛面填充与线条，排除透明背景。若输入只有透明线框，本结果也仅包含线条，不会推断完整 UV 岛。');
    }

    var outer = ring(rgba, width, height, 0);
    var median = quantile(outer, 0.5);
    var mode = requested === 'auto' ? (median < 128 ? 'dark' : 'light') : requested;
    var dark = mode === 'dark';
    var background = quantile(outer, dark ? 0.1 : 0.9);
    // Inspect a thin interior ring only to warn about screenshot frames, never to crop/align.
    var inset = Math.min(Math.floor((Math.min(width, height) - 1) / 2),
      Math.max(1, Math.round(Math.min(width, height) * 0.04)));
    var interior = ring(rgba, width, height, inset);
    var insideBackground = quantile(interior, dark ? 0.1 : 0.9);
    if (requested === 'auto' && Math.abs(insideBackground - background) > 32) {
      return result('auto', 0,
        '外框与内侧背景差异较大，可能是带边框的截图。请先裁掉界面边框并与纹理对齐，或手动选择暗底/亮底与阈值；本工具不会自动对齐。');
    }
    var threshold = suppliedThreshold === undefined ?
      (dark ? Math.min(254, Math.max(12, background + 12)) :
        Math.max(1, Math.min(247, background - 8))) : suppliedThreshold;
    var count = 0;
    for (i = 0; i < size; i += 1) {
      if (rgba[i * 4 + 3] < 64) continue;
      var value = luminance(rgba, i);
      if (dark ? value > threshold : value < threshold) {
        mask[i] = 1;
        count += 1;
      }
    }
    if (count / size > 0.98) {
      mask.fill(0);
      return result(mode, 0,
        '阈值选中了几乎整张图片，无法可靠区分背景；已停止使用该覆盖，请检查底色、阈值或裁掉截图边框。');
    }
    var note = (dark ? '暗底' : '亮底') + '亮度分割，阈值 ' + threshold.toFixed(1) +
      '；仅保留可辨认的非背景像素，不从线框推断完整 UV 岛或三维连接。与底色同色的线/面无法恢复，优先使用原始透明 UV 图。';
    if (count === 0) note += ' 未找到有效覆盖，请检查模式和阈值。';
    if (count > 0 && count / size < 0.03) note += ' 覆盖很稀疏，可能只有线条。';
    if (mask[0] || mask[width - 1] || mask[size - width] || mask[size - 1]) {
      note += ' 图像角落存在前景，请检查是否带界面边框；不会自动对齐。';
    }
    return result(mode, count, note);
  }

  return { extract: extract };
}));
