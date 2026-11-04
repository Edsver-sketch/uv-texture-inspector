// UI event/state integration test in a DOM/canvas fixture. This is not a browser rendering test.
const test=require('node:test');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const app=path.resolve(__dirname,'..');
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this._text='';this.value='';this.selectedIndex=0;this.disabled=false;this.hidden=false;this.attrs={};}
  set textContent(v){this._text=v;this.children=[];}get textContent(){return this._text;}
  appendChild(v){this.children.push(v);return v;}addEventListener(k,fn){this.events[k]=fn;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this[k];}
  click(){if(!this.disabled&&this.events.click)return this.events.click();}
}
class Canvas extends Element {
  constructor(){super('canvas');this.width=64;this.height=64;this.data=new Uint8ClampedArray(64*64*4);}
  getContext(){const c=this;return {drawImage(src,...args){if(args.length===2){c.data=new Uint8ClampedArray(src.data);}else if(args.length===4&&src.width===args[2]&&src.height===args[3]){c.data=new Uint8ClampedArray(src.data);}},getImageData(){return {data:new Uint8ClampedArray(c.data)};},putImageData(p){c.data=new Uint8ClampedArray(p.data);},beginPath(){},arc(){},stroke(){},fillRect(){},fillText(){}};}
  toDataURL(){return 'data:image/png;base64,dGVzdA==';}
}
const ids=['texture-file','uv-file','texture-info','uv-info','mask-mode','sensitivity','detect','progress','status','view-marked','view-original','view-mask','result-count','empty-preview','save-overview','detail-page','save-details','restore','candidate-list','candidate-prev','candidate-page','candidate-next','export-view','export-image','close-export'];
class FileReader {readAsDataURL(file){const finish=()=>{this.result=file.fixture;this.onload();};if(file.waitFor)file.waitFor.then(finish);else setTimeout(finish,0);}}
class ImageFixture {set src(v){this.naturalWidth=this.width=v.width;this.naturalHeight=this.height=v.height;this.data=v.data;setTimeout(()=>this.onload(),0);}}
function createHarness(){
 const elements={};ids.forEach(id=>elements[id]=new Element());elements.preview=new Canvas();elements['mask-mode'].value='auto';elements.sensitivity.value='1';
 const document={getElementById:id=>elements[id],createElement:tag=>tag==='canvas'?new Canvas():new Element(tag),createTextNode:text=>({textContent:text})};
 let saved=0,detectCalls=0;const detector=require('../detector.js');
 const context={document,FileReader,Image:ImageFixture,window:{xhs:{miniTool:{async writeTempFile(){return {filePath:'test-local-image'};},async saveImageToPhotosAlbum(arg){assert.equal(arg.filePath,'test-local-image');saved++;}}}},UVMask:require('../uv-mask.js'),UVDetector:{detect(...args){detectCalls++;return detector.detect(...args);}},Uint8Array,Uint8ClampedArray,Promise,Math,Number,String,Error,setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(app,'app.js'),'utf8'),context);
 return {elements,get saved(){return saved;},get detectCalls(){return detectCalls;}};
}
function fixture(type,size=64){const data=new Uint8ClampedArray(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){let i=(y*size+x)*4;const inside=x>=8&&x<size-8&&y>=8&&y<size-8;if(type==='uv'){data[i]=data[i+1]=data[i+2]=203;data[i+3]=inside?64:0;}else{data[i]=220;data[i+1]=170;data[i+2]=120;data[i+3]=255;const single=type==='texture'&&x>=31&&x<=32&&y>=31&&y<=32;const grid=type==='grid'&&x>=16&&x<78&&y>=16&&y<78&&x%20>=16&&x%20<=17&&y%20>=16&&y%20<=17;if(single||grid){data[i]=130;data[i+1]=80;data[i+2]=50;}}}return {width:size,height:size,data};}
function candidateCheckbox(elements,index=0){return elements['candidate-list'].children[index].children[1].children[0].children[0];}
test('image loading, candidate selection, save adapter and stale results', async()=>{
 const harness=createHarness(),elements=harness.elements;
 elements['texture-file'].events.change({target:{files:[{name:'texture.png',fixture:fixture('texture')}]}});
 elements['uv-file'].events.change({target:{files:[{name:'uv.png',fixture:fixture('uv')}]}});
 await new Promise(r=>setTimeout(r,50));assert.equal(elements.detect.disabled,false,'rapid two-image selection should retain both files');
 await elements.detect.events.click();assert.ok(elements['result-count'].textContent.includes('1 / 1'),'detect synthetic dot');
 const checkbox=elements['candidate-list'].children[0].children[1].children[0].children[0];checkbox.checked=false;checkbox.events.change();assert.equal(elements['save-details'].disabled,true);
 elements.restore.events.click();assert.equal(elements['save-details'].disabled,false);assert.ok(elements['result-count'].textContent.includes('1 / 1'));
 elements['save-overview'].events.click();await new Promise(r=>setTimeout(r,10));assert.equal(harness.saved,1,'platform save adapter invoked');
 elements['mask-mode'].value='alpha';elements['mask-mode'].events.change();assert.equal(elements['save-overview'].disabled,true,'mask changes invalidate old results');
 console.log('PASS: rapid image loading, UV mask, detection, deselect, restore, output save adapter, stale-result invalidation.');
});

test('replacing an image immediately disables detection and export without using old pixels', async()=>{
 const harness=createHarness(),elements=harness.elements;
 elements['texture-file'].events.change({target:{files:[{name:'texture.png',fixture:fixture('texture')}]}});
 elements['uv-file'].events.change({target:{files:[{name:'uv.png',fixture:fixture('uv')}]}});
 await new Promise(r=>setTimeout(r,50));
 await elements.detect.click();
 assert.equal(harness.detectCalls,1);
 assert.equal(elements['save-overview'].disabled,false);
 let release;const waitFor=new Promise(resolve=>{release=resolve;});
 elements['texture-file'].events.change({target:{files:[{name:'replacement.png',fixture:fixture('plain'),waitFor}]}});
 assert.equal(elements.detect.disabled,true,'replacement is still loading');
 assert.equal(elements['save-overview'].disabled,true,'old overview must be invalidated immediately');
 assert.equal(elements['save-details'].disabled,true,'old details must be invalidated immediately');
 await elements.detect.events.click(); // Also exercise the handler's pending-load guard.
 elements['save-overview'].click();elements['save-details'].click();
 assert.equal(harness.detectCalls,1,'the pending replacement must not run detection on the previous image');
 assert.equal(harness.saved,0,'disabled export buttons must not save the previous result');
 release();await new Promise(r=>setTimeout(r,20));
 assert.equal(elements.detect.disabled,false);
 assert.equal(elements['save-overview'].disabled,true,'loaded replacement still requires new detection');
 await elements.detect.click();
 assert.equal(harness.detectCalls,2);
 assert.ok(elements.status.textContent.includes('0 处'),'new plain texture, rather than the old specked texture, was checked');
});

test('candidate selections survive page changes and restore includes hidden candidates', async()=>{
 const {elements}=createHarness();
 elements['texture-file'].events.change({target:{files:[{name:'dots.png',fixture:fixture('grid',96)}]}});
 elements['uv-file'].events.change({target:{files:[{name:'uv.png',fixture:fixture('uv',96)}]}});
 await new Promise(r=>setTimeout(r,50));await elements.detect.click();
 assert.ok(elements['result-count'].textContent.includes('16 / 16'),'detect sixteen separate synthetic dots');
 assert.equal(elements['candidate-list'].children.length,12,'only the first page is rendered');
 assert.equal(elements['candidate-page'].textContent,'1 / 2');
 assert.equal(elements['candidate-prev'].disabled,true);
 let checkbox=candidateCheckbox(elements);checkbox.checked=false;checkbox.events.change();
 elements['candidate-next'].click();
 assert.equal(elements['candidate-page'].textContent,'2 / 2');
 assert.equal(elements['candidate-list'].children.length,4);
 assert.equal(elements['candidate-next'].disabled,true);
 checkbox=candidateCheckbox(elements);assert.equal(checkbox.checked,true);checkbox.checked=false;checkbox.events.change();
 assert.ok(elements['result-count'].textContent.includes('14 / 16'));
 elements['candidate-prev'].click();
 assert.equal(candidateCheckbox(elements).checked,false,'first-page deselection survives leaving the page');
 assert.equal(candidateCheckbox(elements,1).checked,true,'other candidates retain their selection');
 elements['candidate-next'].click();
 assert.equal(candidateCheckbox(elements).checked,false,'second-page deselection also survives returning');
 elements.restore.click();
 assert.equal(candidateCheckbox(elements).checked,true);
 assert.ok(elements['result-count'].textContent.includes('16 / 16'));
 elements['candidate-prev'].click();
 assert.equal(candidateCheckbox(elements).checked,true,'restore also restores an off-page candidate');
});
