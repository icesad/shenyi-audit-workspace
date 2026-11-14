/* Stage-local archive selection; legacy complete archives remain read-only fallbacks. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkpaperStages=api;})(globalThis,function(){'use strict';
 const initial=name=>/^1[、.\s]/.test(name),risk=name=>/^2[、.\s]/.test(name);
 const CONFIG=Object.freeze({5:Object.freeze({stage:5,name:'结论和报告阶段工作底稿',canonicalName:'4、结论和报告阶段工作底稿.zip',component:'4、结论和报告阶段工作底稿',sha256:'51c101a9bffa724c79f633bea77eb2bf109febd04cbfdb9db0b9894b8f01aae7'}),6:Object.freeze({stage:6,name:'执行一般审计程序',canonicalName:'二、执行一般审计程序.zip',component:'二、执行一般审计程序',sha256:'b87650a0b85d6103e9a83434eb9a3dee0c104e6245419a40bd05b5490b00ff16'}),7:Object.freeze({stage:7,name:'执行实质性程序',canonicalName:'一、执行实质性程序.zip',component:'一、执行实质性程序',sha256:'efa8c1ebd044ea98d618bd79d137984940640fa7b8c586415ca9e2af55bd2853'})});
 const KNOWN=new Set(['58cab105fb15a3309c371f595bbe4d9a2a3db06e28c878b6ac3adf61c8911f99','aa98b5969896875ff04fca9b983a80342c907598ae416a04b23a15145c28e3a1','51c101a9bffa724c79f633bea77eb2bf109febd04cbfdb9db0b9894b8f01aae7','40ebe3e9810c187b47718e1b20a5153a991bd478f27b7dccde1d9a251b6ef743','7efb1960d8f960d5a4310c133208e1fc88ca6fa9b4233434030e115e52192b26',CONFIG[6].sha256,CONFIG[7].sha256]);
 const config=stage=>CONFIG[stage]||null,treeStages=()=>[3,4,5,6,7];
 const valid=f=>typeof f?.name==='string'&&!!f.name&&!f.name.endsWith('/')&&!f.name.split(/[\\/]/u).some(x=>x==='__MACOSX'||x==='..'||x.startsWith('._')||x==='.DS_Store'||/^~\$|^\.~|^~lock\./iu.test(x));
 const component=(name,part)=>typeof name==='string'&&name.split(/[\\/]/u).includes(part);
 const execution=name=>Object.values(CONFIG).some(c=>component(name,c.component));
 function executionArchive(record,stage){const c=config(stage),empty={archive:null,index:[],separate:false};if(!record)return empty;
  const exact=Object.values(record.workpaperSources||{}).find(s=>s?.archive?.hash===c.sha256&&(s.canonicalName===undefined||s.canonicalName===c.canonicalName));
  if(exact){if(!Array.isArray(exact.index))throw Error('本项目阶段文件目录无效，请先备份，未覆盖旧数据。');return {archive:exact.archive,index:exact.index.filter(valid),separate:true};}
  if(!record.archive)return empty;if(!Array.isArray(record.index))throw Error('本项目原总归档目录无效，请先备份，未覆盖旧数据。');
  if(KNOWN.has(record.archive.hash)&&record.archive.hash!==c.sha256)return empty;
  const selected=record.index.filter(f=>valid(f)&&component(f.name,c.component));return selected.length?{archive:record.archive,index:selected,separate:false}:empty;
 }
 function archiveFor(record,stage){if(config(stage))return executionArchive(record,stage);if(!record)return {archive:null,index:[]};const library=Object.values(record.workpaperSources||{}).find(s=>s.phase===stage);if((stage===3||stage===4)&&library?.archive)return{archive:library.archive,index:library.index||[],separate:true};if(stage===4&&record.riskArchive){if(!Array.isArray(record.riskIndex))throw Error('本项目风险阶段文件目录无效，请先备份，未覆盖旧数据。');return {archive:record.riskArchive,index:record.riskIndex,separate:true};}return {archive:record.archive||null,index:record.index||[],separate:false};}
 function files(record,stage){const selected=archiveFor(record,stage).index.filter(valid);return config(stage)?selected:selected.filter(f=>stage===3?initial(f.name):stage===4?risk(f.name):!initial(f.name)&&!risk(f.name)&&!execution(f.name));}
 function patchFor(stage,archive,index){if(config(stage))throw Error('本阶段须用importStage核验准确原包，未替换其他阶段。');if(stage===4){const selected=index.filter(f=>risk(f.name));if(!selected.length)throw Error('此ZIP没有“2、计划及风险识别阶段工作底稿”目录，未替换当前阶段。');return {riskArchive:archive,riskIndex:selected};}return {archive,index};}
 return Object.freeze({archiveFor,files,patchFor,config,treeStages});
});
