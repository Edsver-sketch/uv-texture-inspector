(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { texture: null, uv: null, mask: null, spots: [], candidatePage: 0, view: 'marked', busy: false, revisions: {texture:0, uv:0}, loading: {texture:false, uv:false}, generation: 0, resultReady: false };
  var red = '#d9294f', amber = '#b36a00';
  function status(text) { $('status').textContent = text; }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('图片读取失败，请重新选择。')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('这张图片无法打开，请选择 PNG 或 JPG。')); };
        img.onload = function () { var c = makeCanvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0); resolve({ canvas: c, name: file.name }); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function clearResult() { state.spots = []; state.candidatePage = 0; state.resultReady = false; $('result-count').textContent = ''; renderCandidates(); updateButtons(); }
  function updateButtons() {
    var pending = state.loading.texture || state.loading.uv;
    $('detect').disabled = !state.texture || !state.uv || !state.mask || state.mask.coverage === 0 || state.busy || pending;
    ['texture-file','uv-file','mask-mode','sensitivity'].forEach(function (id) { $(id).disabled = state.busy; });
    $('save-overview').disabled = !state.resultReady || state.busy || pending;
    $('save-details').disabled = !state.spots.some(function (s) { return s.enabled; }) || state.busy || pending;
    $('restore').disabled = !state.spots.length || state.busy;
    $('detail-page').disabled = $('save-details').disabled;
  }
  function rebuildMask() {
    state.mask = null;
    if (!state.uv || !state.texture) { updateButtons(); return; }
    var w = state.texture.canvas.width, h = state.texture.canvas.height, uc = state.uv.canvas;
    if (Math.abs(w / h - uc.width / uc.height) > .005) { status('UV 图与纹理图的长宽比例不同，请选择对应的 UV 图片。'); updateButtons(); return; }
    var canvas = makeCanvas(w, h), ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(uc, 0, 0, w, h);
    try {
      state.mask = UVMask.extract(ctx.getImageData(0, 0, w, h).data, w, h, { mode: $('mask-mode').value });
      var names = { alpha: '透明背景', dark: '深色背景', light: '浅色背景' };
      var resized = w !== uc.width || h !== uc.height ? '；UV 尺寸已匹配纹理' : '';
      status(state.mask.coverage === 0 ? '没有识别到 UV 范围，请手动选择背景颜色。' : '已识别' + (names[state.mask.mode] || state.mask.mode) + '，检测覆盖 ' + (state.mask.coverage * 100).toFixed(1) + '%' + resized + '。可切换到“UV 范围”查看。');
    } catch (error) { status(error.message); }
    updateButtons(); renderPreview();
  }
  function choose(kind, event) {
    var file = event.target.files[0]; if (!file) return;
    var revision = ++state.revisions[kind];
    state.generation++; state.loading[kind] = true; state.mask = null; clearResult(); status('正在读取图片…');
    readImage(file).then(function (entry) {
      if (revision !== state.revisions[kind]) return;
      state.loading[kind] = false;
      state[kind] = entry;
      $(kind + '-info').textContent = entry.name + '  ' + entry.canvas.width + ' × ' + entry.canvas.height;
      clearResult(); rebuildMask(); renderPreview();
    }).catch(function (error) { if (revision !== state.revisions[kind]) return; state.loading[kind] = false; state[kind] = null; state.mask = null; updateButtons(); renderPreview(); status(error.message); });
  }
  function enabledSpots() { return state.spots.filter(function (s) { return s.enabled; }); }
  function circle(ctx, s, x, y, radius, width) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = width + 2; ctx.stroke();
    ctx.strokeStyle = s.tier === 'clear' ? red : amber; ctx.lineWidth = width; ctx.stroke();
  }
  function overview() {
    var src = state.texture.canvas, c = makeCanvas(src.width, src.height), ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0);
    var scale = Math.max(1, src.width / 2048);
    enabledSpots().forEach(function (s) {
      var r = Math.max(13 * scale, (s.bbox[2] - s.bbox[0]) / 2 + 5, (s.bbox[3] - s.bbox[1]) / 2 + 5);
      circle(ctx, s, s.x + .5, s.y + .5, r, 2 * scale);
      var lx = Math.max(0, Math.min(src.width - 36 * scale, s.x + r + 3)), ly = Math.max(0, Math.min(src.height - 25 * scale, s.y - r - 12));
      ctx.fillStyle = '#24334a'; ctx.fillRect(lx, ly, 34 * scale, 24 * scale); ctx.fillStyle = '#fff'; ctx.font = 'bold ' + 18 * scale + 'px sans-serif'; ctx.fillText(String(s.id).padStart(2, '0'), lx + 5 * scale, ly + 19 * scale);
    });
    return c;
  }
  function renderPreview() {
    if (!state.texture) { $('preview').width = 640; $('preview').height = 640; $('empty-preview').hidden = false; return; }
    $('empty-preview').hidden = true;
    var c = $('preview'), src = state.texture.canvas; c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d'); ctx.drawImage(state.view === 'marked' ? overview() : src, 0, 0);
    if (state.view === 'mask' && state.mask) {
      var pixels = ctx.getImageData(0, 0, c.width, c.height);
      for (var i = 0; i < state.mask.mask.length; i++) if (!state.mask.mask[i]) { pixels.data[i*4] *= .2; pixels.data[i*4+1] *= .2; pixels.data[i*4+2] *= .2; }
      ctx.putImageData(pixels, 0, 0);
    }
  }
  function crop(ctx, s, dx, dy, size, marked) {
    var src = state.texture.canvas, side = Math.min(64, src.width, src.height), sx = Math.max(0, Math.min(src.width-side, Math.round(s.x)-Math.floor(side/2))), sy = Math.max(0, Math.min(src.height-side, Math.round(s.y)-Math.floor(side/2)));
    ctx.imageSmoothingEnabled = false; ctx.drawImage(src, sx, sy, side, side, dx, dy, size, size);
    if (marked) { var radius = Math.max(6, (s.bbox[2]-s.bbox[0])/2+3, (s.bbox[3]-s.bbox[1])/2+3) * size/side; circle(ctx,s,dx+(s.x-sx+.5)*size/side,dy+(s.y-sy+.5)*size/side,radius,1.5); }
  }
  function refreshCount() {
    $('result-count').textContent = state.resultReady ? '保留 ' + enabledSpots().length + ' / ' + state.spots.length + ' 处' : '';
    var oldPage = $('detail-page').selectedIndex;
    $('detail-page').textContent = '';
    var pages = Math.ceil(enabledSpots().length/12);
    for (var i=0;i<pages;i++) { var o=document.createElement('option');o.value=i;o.textContent='第 '+(i+1)+' / '+pages+' 页';$('detail-page').appendChild(o); }
    if (pages) $('detail-page').selectedIndex = Math.max(0,Math.min(oldPage,pages-1));
    updateButtons();
  }
  function renderCandidates() {
    var list=$('candidate-list'); list.textContent='';
    var pageCount=Math.ceil(state.spots.length/12);state.candidatePage=Math.max(0,Math.min(state.candidatePage,pageCount-1));
    $('candidate-page').textContent=(pageCount?state.candidatePage+1:0)+' / '+pageCount;
    $('candidate-prev').disabled=state.candidatePage===0;$('candidate-next').disabled=state.candidatePage+1>=pageCount;
    if (!state.spots.length) { var p=document.createElement('p');p.className='no-results';p.textContent=state.resultReady?'当前范围内没有检出符合条件的小杂点。':'完成检查后查看局部放大。';list.appendChild(p);refreshCount();return; }
    state.spots.slice(state.candidatePage*12,(state.candidatePage+1)*12).forEach(function(s){
      var row=document.createElement('div');row.className='candidate'+(s.enabled?'':' removed');
      var c=makeCanvas(224,224);crop(c.getContext('2d'),s,0,0,224,true);row.appendChild(c);
      var info=document.createElement('div');info.className='candidate-info';var label=document.createElement('label');var input=document.createElement('input');input.type='checkbox';input.checked=s.enabled;label.appendChild(input);label.appendChild(document.createTextNode(String(s.id).padStart(2,'0')));info.appendChild(label);
      var tier=document.createElement('span');tier.className='tier-'+s.tier;tier.textContent=s.tier==='clear'?'较明显候选':'需要复核';info.appendChild(tier);
      var p=document.createElement('p');p.textContent='x '+Math.round(s.x)+' / y '+Math.round(s.y);info.appendChild(p);row.appendChild(info);list.appendChild(row);
      input.addEventListener('change',function(){s.enabled=input.checked;row.className='candidate'+(s.enabled?'':' removed');refreshCount();renderPreview();});
    });refreshCount();
  }
  function details(page) {
    var spots=enabledSpots().slice(page*12,(page+1)*12),rows=Math.ceil(spots.length/3),c=makeCanvas(960,110+rows*310),ctx=c.getContext('2d');
    ctx.fillStyle='#f5f7fa';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#24334a';ctx.font='bold 26px sans-serif';ctx.fillText('UV 岛内疑似杂点 · 局部放大',24,37);ctx.font='16px sans-serif';ctx.fillStyle='#64758a';ctx.fillText('编号对应总图 · 原图像素直接放大 · 仅标记',24,69);
    spots.forEach(function(s,i){var x=24+(i%3)*312,y=110+Math.floor(i/3)*310;ctx.fillStyle=s.tier==='clear'?red:amber;ctx.font='bold 18px sans-serif';ctx.fillText(String(s.id).padStart(2,'0')+'  '+(s.tier==='clear'?'较明显候选':'需要复核'),x,y);crop(ctx,s,x,y+14,272,true);});return c;
  }
  async function save(canvas) {
    var data=canvas.toDataURL('image/png'),mini=window.xhs&&window.xhs.miniTool;
    if (mini&&typeof mini.saveImageToPhotosAlbum==='function') {
      try { var path=data;if(typeof mini.writeTempFile==='function'){var r=await mini.writeTempFile({data:data});path=r.filePath;}await mini.saveImageToPhotosAlbum({filePath:path});status('图片已保存到相册。'); }catch(error){status('未能保存到相册，请重试。');}
    } else if(window.xhs) { status('当前小红书环境暂不支持保存到相册。'); }
    else { $('export-image').src=data;$('export-view').hidden=false; }
  }
  $('texture-file').addEventListener('change',function(e){choose('texture',e);});$('uv-file').addEventListener('change',function(e){choose('uv',e);});
  $('mask-mode').addEventListener('change',function(){state.generation++;clearResult();rebuildMask();});
  $('sensitivity').addEventListener('change',function(){state.generation++;clearResult();renderPreview();status('检测范围已调整，点击“检查杂点”重新计算。');});
  ['marked','original','mask'].forEach(function(view){$('view-'+view).addEventListener('click',function(){state.view=view;['marked','original','mask'].forEach(function(v){$('view-'+v).setAttribute('aria-pressed',String(v===view));});renderPreview();});});
  $('detect').addEventListener('click',async function(){
    if(state.busy||state.loading.texture||state.loading.uv||!state.mask||state.mask.coverage===0)return;var generation=state.generation;state.busy=true;updateButtons();$('progress').hidden=false;$('progress').value=0;status('正在检查岛内像素…');
    try {var c=state.texture.canvas;var r=await UVDetector.detect(c.getContext('2d').getImageData(0,0,c.width,c.height).data,c.width,c.height,state.mask.mask,{sensitivity:Number($('sensitivity').value),onProgress:function(p){$('progress').value=p.progress;}});if(generation!==state.generation)return;if(r.analyzedPixels===0){clearResult();renderPreview();status('UV 图没有可检查的岛内区域，请选择带岛面填充的 UV 图。');return;}state.spots=r.spots.map(function(s){s.enabled=true;return s;});state.resultReady=true;renderCandidates();renderPreview();status('检查完成，找到 '+state.spots.length+' 处疑似位置。可在右侧取消不需要的标记。');}
    catch(error){status('检查未完成：'+error.message);}finally{state.busy=false;$('progress').hidden=true;updateButtons();}
  });
  $('restore').addEventListener('click',function(){state.spots.forEach(function(s){s.enabled=true;});renderCandidates();renderPreview();});
  $('candidate-prev').addEventListener('click',function(){state.candidatePage--;renderCandidates();});
  $('candidate-next').addEventListener('click',function(){state.candidatePage++;renderCandidates();});
  $('save-overview').addEventListener('click',function(){save(overview());});$('save-details').addEventListener('click',function(){save(details(Number($('detail-page').value)||0));});
  $('close-export').addEventListener('click',function(){$('export-view').hidden=true;$('export-image').removeAttribute('src');});
}());
