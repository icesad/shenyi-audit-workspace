'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{JSDOM}=require('jsdom');
const dist=path.resolve(__dirname,'../dist');
const changes={"dist/index.html": {"before": "db35acf85570a1cf9435028244c769b83d9c21b632af9edcf56138b5802f3821", "after": "27a036acea433d5e95e422bbe3898fb468fc5be730729845dc3a9a6d54d64f61", "replacements": [["data-nav-section=\"scope-accounting-cost\">人员与项目成本</button>", "data-nav-section=\"scope-accounting-cost\">项目成本核算</button>"], ["data-view=\"travel\">差旅费报销填报表</button>", "data-view=\"travel\">费用报销填报</button>"], ["<section id=\"scope-accounting-cost\"><h3>成本核算</h3>", "<section id=\"scope-accounting-cost\"><h3>项目成本核算</h3>"], ["data-view=\"costs\">进入成本核算</button>", "data-view=\"costs\">进入项目成本核算</button>"], ["<section id=\"scope-accounting-travel\"><h3>差旅费报销填报表</h3>", "<section id=\"scope-accounting-travel\"><h3>费用报销填报</h3>"]]}, "dist/app.js": {"before": "7e94c54acc2ef40a202872f540a1e306c0564f156c1d5c0c67dd8fac94b20cb2", "after": "9f5547769b219c75c53911cf0d82a296582b8b421aa408ab6f9b51f584434c6a", "replacements": [["travel:['核算 / 差旅费报销','差旅费报销填报表'", "travel:['核算 / 费用报销填报','费用报销填报'"], ["costs:['核算 / 成本核算','成本核算'", "costs:['核算 / 项目成本核算','项目成本核算'"]]}, "dist/project-costs.js": {"before": "7bbaa3b57aaac444e65fff2ce62211b11f5b9f7ad64d3b25344567848f0b768d", "after": "103fb9e7b551e80afdf98f5fcc7053227e1ec1f2662a301b0b0aab105cf72c5e", "replacements": [["head.append(el('h2','成本核算'),refreshButton)", "head.append(el('h2','项目成本核算'),refreshButton)"]]}};
test('accounting rename changes display strings only; no layout, field, event, persistence or calculation change',()=>{
 for(const [file,spec]of Object.entries(changes)){
  let source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n'); // Canonical EOL across devices; exact content guard retained.
  // Explicit v61 request: only rename the shared page button, leaving save behavior unchanged.
  if(file==='dist/index.html')source=source.replace('id="page-save">保存</button>', 'id="page-save">暂存</button>');
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
  assert.equal(d.querySelector('[data-nav-section="scope-accounting-cost"]').textContent,'项目成本核算');
  assert.equal(d.querySelector('.workspace-navigation [data-view="travel"]').textContent,'费用报销填报');
  assert.equal(d.querySelector('#scope-accounting-cost h3').textContent,'项目成本核算');
  assert.equal(d.querySelector('#scope-accounting-travel h3').textContent,'费用报销填报');
  assert.equal(d.querySelectorAll('.nav-group').length,6);
  assert.equal(d.querySelector('#scope-accounting-cost button').dataset.view,'costs');
  assert.equal(d.querySelector('#scope-accounting-travel button').dataset.view,'travel');
 }finally{dom.window.close();}
});
