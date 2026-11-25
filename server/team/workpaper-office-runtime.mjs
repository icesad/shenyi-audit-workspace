import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
const DIST=new URL('../../dist/',import.meta.url);
const primitives={ArrayBuffer,DataView,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,TextDecoder,TextEncoder,Blob,File,ReadableStream,DecompressionStream,CompressionStream,DOMException,setTimeout,clearTimeout};
export async function officeRuntime(){
 const scripts=new Map();let next=0,lastWorkbook=null;const workers=new Set();
 const sourceURL={createObjectURL(blob){const id='office-worker:'+ ++next;scripts.set(id,blob);return id;},revokeObjectURL(id){scripts.delete(id);}};
 class BrowserWorker{
  constructor(url){const blob=scripts.get(url);if(!blob)throw Error('Unknown worker source');workers.add(this);this.closed=false;this.ready=blob.text().then(code=>{if(this.closed)return;this.context=vm.createContext({...primitives,onmessage:null,postMessage:data=>{if(!this.closed)queueMicrotask(()=>this.onmessage?.({data}));}},{codeGeneration:{strings:false,wasm:false}});this.context.self=this.context;vm.runInContext(code,this.context,{timeout:30000});if(this.context.XLSX?.read){const read=this.context.XLSX.read;this.context.XLSX.read=(bytes,options)=>{lastWorkbook=read(bytes,{...options,cellStyles:true});return lastWorkbook;};}}).catch(error=>{if(!this.closed)this.onerror?.({message:error?.message||'Worker failed',preventDefault(){}});throw error;});this.ready.catch(()=>{});}
  postMessage(data){void this.ready.then(()=>{if(!this.closed){const result=this.context.onmessage({data});if(result?.catch)result.catch(error=>this.onerror?.({message:error?.message||'Worker failed',preventDefault(){}}));}}).catch(error=>{if(!this.closed)this.onerror?.({message:error?.message||'Worker failed',preventDefault(){}});});}
  terminate(){this.closed=true;this.context=null;workers.delete(this);}
 }
 const dom=new JSDOM('<!doctype html><main></main>'),context=vm.createContext({...primitives,Worker:BrowserWorker,URL:sourceURL,document:dom.window.document,DOMParser:dom.window.DOMParser,XMLSerializer:dom.window.XMLSerializer},{codeGeneration:{strings:false,wasm:false}});
 async function load(name){if(!/^(?:[a-z][a-z0-9-]*\.js|workpaper-(?:word-)?layouts\/[a-f0-9]{64}\.js)$/.test(name))throw Error('Invalid bundled resource');vm.runInContext(await readFile(new URL(name,DIST),'utf8'),context,{filename:name,timeout:30000});}
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const xml=raw=>{const text=typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML entities are forbidden');const doc=new dom.window.DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid Office XML');return doc;};
 try{
  await load('bidder-archive-vendor.js');await load('bidder-archive.js');await load('workpaper-xlsx-source.js');await load('workpaper-sheets.js');await load('workpaper-original-sheet.js');await load('workpaper-original-word.js');await load('vendor-legacy-doc.js');await load('legacy-doc.js');await load('workpaper-docs.js');
  context.ProjectWorkspaceStore={hash:async file=>hash(new Uint8Array(await file.arrayBuffer())),xml};
  await load('tender-import.js');
  return{root:context,document:dom.window.document,load,hash,workbook:()=>lastWorkbook,close(){for(const w of [...workers])w.terminate();scripts.clear();lastWorkbook=null;dom.window.close();}};
 }catch(error){for(const w of [...workers])w.terminate();dom.window.close();throw error;}
}