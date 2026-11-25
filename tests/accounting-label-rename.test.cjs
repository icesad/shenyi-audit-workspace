'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{JSDOM}=require('jsdom');
const dist=path.resolve(__dirname,'../dist');
const {withoutWorkpaperPackageLoaders}=require('./helpers/workpaper-package-loaders.cjs');
const changes={"dist/index.html":{"before":"cda75fc86a4eef2e69f1b08aa916f18d4414bfda82af47c8ac4e8e8a0c242210","after":"1a17297dfeaf143fc49cf4458af50f87f423f9a143230046c5c692de1d9dcafa","replacements":[["data-view=\"costs\">成本核算</button>","data-view=\"costs\">项目成本核算</button>"],["data-view=\"travel\">差旅费报销填报表</button>","data-view=\"travel\">费用报销填报</button>"]]},"dist/app.js":{"before":"40ae0266e1359bd65969e2201f3e97d5c61842575da91a098b1f7a20ff05d5ff","after":"4f38b896e0a42db414238eeae912c42f702f393688aed276d7a1a17f3e469e44","replacements":[["travel:['成本核算 / 差旅费报销','差旅费报销填报表'","travel:['成本核算 / 费用报销填报','费用报销填报'"],["costs:['成本核算 / 成本核算','成本核算'","costs:['成本核算 / 项目成本核算','项目成本核算'"]]},"dist/project-costs.js":{"before":"2abcc6dc4f1b50c2ebac14aecca2ec4547e52ffb583bd19cbcbf38f9beeb812e","after":"1429ecf2f664f44663667f7d9a2f65ff38699187b6d21ac0544bf637b751e532","replacements":[["head.append(el('h2','成本核算'),refreshButton)","head.append(el('h2','项目成本核算'),refreshButton)"]]}};
test('accounting rename changes display strings only; no layout, field, event, persistence or calculation change',()=>{
 for(const [file,spec]of Object.entries(changes)){
  let source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n'); // Canonical EOL across devices; exact content guard retained.
  // Explicit v61 request: only rename the shared page button, leaving save behavior unchanged.
  if(file==='dist/index.html'){
   source=withoutWorkpaperPackageLoaders(source);
   // M4D adds exactly this material loader after its dependency; all other bytes remain pinned below.
   const loader='<script src="material-preservation.js"></script>',dependency='<script src="audit-checklist.js"></script>';
   assert.equal(source.split(loader).length-1,1,'approved material loader must occur exactly once');
   assert.equal(source.split(dependency+loader).length-1,1,'approved material loader must immediately follow its dependency');
   assert.equal(source.split('material-preservation.js').length-1,1,'no extra or alternate material loader reference');
   const migrationLoaders='<script src="legacy-project-source.js"></script><script src="legacy-project-source-export.js"></script>',initiationLoader='<script src="project-initiation.js"></script>';
   assert.equal(source.split(migrationLoaders).length-1,1,'approved migration loaders must occur once in order');
   assert.equal(source.split(initiationLoader+migrationLoaders).length-1,1,'migration loaders must immediately follow initiation dependency');
   for(const name of ['legacy-project-source.js','legacy-project-source-export.js'])assert.equal(source.split(name).length-1,1,'no alternate migration loader reference');
   const ledgerLoaders='<script src="ledger-check-snapshot.js"></script><script src="ledger-check-snapshot-export.js"></script>',ledgerDependency='<script src="legacy-project-source-export.js"></script>';
   assert.equal(source.split(ledgerLoaders).length-1,1,'approved saved-ledger loaders must occur once in order');
   assert.equal(source.split(ledgerDependency+ledgerLoaders).length-1,1,'saved-ledger loaders must immediately follow existing source export');
   for(const name of ['ledger-check-snapshot.js','ledger-check-snapshot-export.js'])assert.equal(source.split(name).length-1,1,'no extra or alternate saved-ledger loader reference');
   source=source.replace(ledgerLoaders,'').replace(migrationLoaders,'').replace(loader,'').replace('id="page-save">保存</button>', 'id="page-save">暂存</button>');
  }
  for(const [oldLabel,newLabel]of [...spec.replacements].reverse()){
   assert.equal(source.split(newLabel).length-1,1,file+' new label must be unique');
   source=source.replace(newLabel,oldLabel);
  }
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),spec.before,file+' must match approved source except named labels');
 }
});
test('sidebar and accounting entry display only requested new module names; all routing identities unchanged',()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(dist,'index.html'),'utf8')),d=dom.window.document;
 try{
  assert.equal(d.querySelector('.workspace-navigation [data-view="costs"]').textContent,'项目成本核算');
  assert.equal(d.querySelector('.workspace-navigation [data-view="travel"]').textContent,'费用报销填报');
  assert.equal(d.querySelectorAll('.nav-group').length,5);
  assert.equal(d.querySelector('[data-home-view=costs] .home-stage-go').textContent.trim(),'进入项目成本核算 ↗');
  assert.equal(d.querySelector('#view-accounting'),null);
 }finally{dom.window.close();}
});
