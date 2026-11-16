/* Local material review gate. Receipt is not review; a closed record is not an audit opinion. */
(function(root){
  'use strict';
  const DB='hengdu.audit.materials.v1',TRIAL_DB='hengdu.audit.materials.trial.v1',TRIAL_ID='00000000-0000-4000-8000-000000000033',STORE='checklists',MAX=500,STATES=['pending','received','confirmed','na','problem'];
  const fail=s=>{throw Error(s);},copy=x=>JSON.parse(JSON.stringify(x));
  function str(x,n,req=false){if(typeof x!=='string'||!x.isWellFormed()||x.length>n||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x)||req&&!x.trim())fail('字段为空、过长或含不支持的字符。');return x.trim();}
  function exact(o,keys){
    if(!o||typeof o!=='object'||Array.isArray(o)||Object.getPrototypeOf(o)!==Object.prototype)fail('本机资料清单结构不兼容，未覆盖。');
    const fields=Object.getOwnPropertyDescriptors(o),names=Reflect.ownKeys(fields);
    if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!fields[k].enumerable||!Object.hasOwn(fields[k],'value')))
      fail('本机资料清单字段不兼容，未覆盖。');
  }
  function iso(v){
    if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)
      fail('资料留痕时间无效，未覆盖。');
    return v;
  }
  function project(p){
    if(!p||typeof p!=='object'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(p.quoteId||''))fail('请先选择已保存的立项。');
    exact(p,['quoteId','projectName','firmName']);
    return {quoteId:p.quoteId,projectName:str(p.projectName,300,true),firmName:str(p.firmName,200)};
  }
  function parse(text){
    if(typeof text!=='string')fail('清单文字无效。');text=text.replace(/\u000b/gu,'\n');str(text,150000,true);
    const out=[];let section='资料清单';
    for(const raw of text.replace(/^\ufeff/u,'').split(/\r\n|[\r\n\u000b]/u)){
      const line=raw.trim();if(!line)continue;
      if(/^(?:审计资料上传|资料清单(?:20\d{2})?)$/u.test(line))continue;
      if(/^[一二三四五六七八九十]+[、.．]\s*[^\d]{1,80}$/u.test(line)){section=line;continue;}
      const content=line.replace(/^[①-⑳][、.．:：\s　]*/u,'').replace(/^\s*(?:[（(]?\d{1,3}[）)]?\s*[、.．:：)）]|\d{1,3}\s+)[\s　]*/u,'').trim();
      if(!content)fail('清单有仅含序号的空行。请补内容或删除空行后重试。');
      if(out.length>=MAX)fail('单份清单最多 500 项。');
      out.push({id:'i'+(out.length+1),number:out.length+1,section,text:str(content,2000,true)});
    }
    if(!out.length)fail('没有识别到资料项。');return out;
  }
  function items(xs){
    if(!Array.isArray(xs)||!xs.length||xs.length>MAX)fail('资料清单结构无效。');
    return xs.map((x,i)=>{exact(x,['id','number','section','text']);if(x.id!=='i'+(i+1)||x.number!==i+1)fail('资料序号结构不一致。');return {id:x.id,number:x.number,section:str(x.section,100,true),text:str(x.text,2000,true)};});
  }
  function state(s){
    if(!s||!STATES.includes(s.status))fail('资料确认状态无效。');
    exact(s,['status','evidence','reason','reviewer','at']);
    const x={status:s.status,evidence:str(s.evidence,1000),reason:str(s.reason,1000),reviewer:str(s.reviewer,100),at:str(s.at,40)};
    if(x.at){iso(x.at);if(!x.reviewer)fail('资料留痕缺少核对人，未覆盖。');}
    else if(x.status!=='pending'||x.evidence||x.reason||x.reviewer)fail('资料状态缺少留痕时间，未覆盖。');
    if(Object.keys(x).some(k=>x[k]!==s[k]))fail('资料状态字段不一致，未覆盖。');
    if(x.status==='confirmed'&&(!x.evidence||!x.reviewer))fail('核对通过须填写证据索引和核对人。');
    if(x.status==='na'&&(!x.reason||!x.reviewer))fail('不适用须填写理由和核对人。');
    if(x.status==='problem'&&!x.reason)fail('存在问题须说明待解决事项。');
    return x;
  }
  const blank=()=>({status:'pending',evidence:'',reason:'',reviewer:'',at:''});
  function validateV1(r){
    exact(r,['schema','project','revision','items','states','closed','events']);
    if(r.schema!==1||!Number.isSafeInteger(r.revision)||r.revision<1||!Array.isArray(r.events)||!r.events.length||r.events.length>5000||r.revision!==r.events.length)
      fail('本机资料清单结构不兼容，未覆盖。');
    const p=project(r.project),xs=items(r.items);
    if(Object.keys(p).some(k=>p[k]!==r.project[k]))fail('资料项目归属不一致，未覆盖。');
    function states(value,rows){
      exact(value,rows.map(x=>x.id));
      return Object.fromEntries(rows.map(x=>[x.id,state(value[x.id])]));
    }
    function close(value){
      exact(value,['at','reviewer','revision']);iso(value.at);str(value.reviewer,100,true);
      if(!Number.isSafeInteger(value.revision)||value.revision<2)fail('关门记录无效。');
      return {at:value.at,reviewer:value.reviewer,revision:value.revision};
    }
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),current=states(r.states,xs);
    let priorItems,priorStates,priorClose=null;
    for(const [index,e] of r.events.entries()){
      if(!e||typeof e!=='object')fail('资料留痕结构无效，未覆盖。');
      const fields={
        import:['type','at','reviewer','items'],item:['type','id','at','reviewer','before','after'],
        replace:['type','at','reviewer','reason','oldItems','oldStates','items'],
        close:['type','at','reviewer','revision'],reopen:['type','at','reviewer','reason','priorClose']
      }[e.type];
      if(!fields)fail('资料留痕操作类型无效，未覆盖。');
      exact(e,fields);iso(e.at);str(e.reviewer,100,true);
      if(index===0){
        if(e.type!=='import')fail('资料留痕缺少初始导入，未覆盖。');
        priorItems=items(e.items);priorStates=Object.fromEntries(priorItems.map(x=>[x.id,blank()]));continue;
      }
      if(e.type==='import')fail('资料留痕重复导入，未覆盖。');
      if(e.type==='reopen'){
        str(e.reason,1000,true);
        if(!priorClose||!same(close(e.priorClose),priorClose))fail('重新开门留痕与原关门记录不一致，未覆盖。');
        priorClose=null;
      }else{
        if(priorClose)fail('关门后存在未先开门的修改，未覆盖。');
        if(e.type==='item'){
          if(!priorItems.some(x=>x.id===e.id)||!same(state(e.before),priorStates[e.id]))fail('资料修改留痕前后不一致，未覆盖。');
          const after=state(e.after);
          if(after.at!==e.at||after.reviewer!==e.reviewer)fail('资料修改留痕时间或核对人不一致，未覆盖。');
          priorStates[e.id]=after;
        }else if(e.type==='replace'){
          str(e.reason,1000,true);
          const oldItems=items(e.oldItems),oldStates=states(e.oldStates,oldItems);
          if(!same(oldItems,priorItems)||!same(oldStates,priorStates))fail('清单替换留痕与原资料不一致，未覆盖。');
          priorItems=items(e.items);priorStates=Object.fromEntries(priorItems.map(x=>[x.id,blank()]));
        }else if(e.type==='close'){
          if(e.revision!==index+1||priorItems.some(x=>!['confirmed','na'].includes(priorStates[x.id].status)))fail('关门记录与资料核对结果不一致，未覆盖。');
          priorClose={at:e.at,reviewer:e.reviewer,revision:e.revision};
        }
      }
    }
    if(!same(xs,priorItems)||!same(current,priorStates))fail('资料当前状态与留痕不一致，未覆盖。');
    const closed=r.closed===null?null:close(r.closed);
    if(!same(closed,priorClose)||closed&&closed.revision!==r.revision)fail('关门记录与留痕不一致，未覆盖。');
    if(JSON.stringify(r).length>4*1024*1024)fail('本机清单记录过大，请先导出归档。');
    return r;
  }
  function gateV1(r){
    validateV1(r);const blockers=r.items.filter(x=>!['confirmed','na'].includes(r.states[x.id].status));
    return {ready:!blockers.length,total:r.items.length,confirmed:r.items.filter(x=>r.states[x.id].status==='confirmed').length,
      excluded:r.items.filter(x=>r.states[x.id].status==='na').length,blockers:blockers.map(x=>x.number),closed:!!r.closed};
  }
  function create(p,xs,reviewer){
    const rows=items(xs),actor=str(reviewer,100,true),at=new Date().toISOString();
    return validateV1({schema:1,project:project(p),revision:1,items:rows,states:Object.fromEntries(rows.map(x=>[x.id,blank()])),closed:null,
      events:[{type:'import',at,reviewer:actor,items:copy(rows)}]});
  }
  function applyV1(input,cmd){
    validateV1(input);if(!cmd||typeof cmd!=='object')fail('操作无效。');const r=copy(input),at=new Date().toISOString(),actor=str(cmd.reviewer,100,true);
    if(r.events.length>=5000)fail('留痕已达上限，请导出归档后联系维护人员。');
    if(cmd.type==='reopen'){
      if(!r.closed)fail('当前尚未关门。');
      const reason=str(cmd.reason,1000,true);
      r.events.push({type:'reopen',at,reviewer:actor,reason,priorClose:copy(r.closed)});r.closed=null;
    }else{
      if(r.closed)fail('已关门。请先说明理由并重新开门，不能直接改资料。');
      if(cmd.type==='item'){
        if(!r.items.some(x=>x.id===cmd.id))fail('资料项不存在。');
        const next=state({status:cmd.status,evidence:cmd.evidence||'',reason:cmd.reason||'',reviewer:actor,at});
        r.events.push({type:'item',id:cmd.id,at,reviewer:actor,before:copy(r.states[cmd.id]),after:copy(next)});r.states[cmd.id]=next;
      }else if(cmd.type==='close'){
        const g=gateV1(r);if(!g.ready)fail('仍有 '+g.blockers.length+' 项未核对通过或未说明不适用，不能关门。');
        r.closed={at,reviewer:actor,revision:r.revision+1};
        r.events.push({type:'close',at,reviewer:actor,revision:r.revision+1});
      }else if(cmd.type==='replace'){
        const rows=items(cmd.items),reason=str(cmd.reason,1000,true);
        r.events.push({type:'replace',at,reviewer:actor,reason,oldItems:copy(r.items),oldStates:copy(r.states),items:copy(rows)});
        r.items=rows;r.states=Object.fromEntries(rows.map(x=>[x.id,blank()]));
      }else fail('操作类型无效。');
    }
    r.revision++;return validateV1(r);
  }

  // Schema 1 is deliberately not migrated on read. Schema 2 adds an immutable
  // outline generation and file versions; legacy is the exact pre-conversion record.
  const FILE_STORE='materialFiles',FILE_MAX=12*1024*1024,PROJECT_MAX=150*1024*1024,TREE_RECORD_MAX=8*1024*1024;
  const uuid=()=>root.crypto.randomUUID(),isUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(x);
  function treeNodes(input){
    if(!Array.isArray(input)||!input.length||input.length>MAX)fail('标题树须有 1–500 个节点。');
    const seen=new Map();
    return input.map((n,i)=>{
      const hasKind=!!n&&typeof n==='object'&&Object.hasOwn(n,'kind');
      exact(n,hasKind?['id','parentId','level','title','description','kind']:['id','parentId','level','title','description']);
      if(hasKind&&!['group','material'].includes(n.kind))fail('标题类型须为分组或资料项。');
      if(n.id!=='n'+(i+1)||typeof n.parentId!=='string'||!Number.isSafeInteger(n.level)||n.level<1||n.level>9)fail('标题编号或层级无效。');
      const parent=n.parentId?seen.get(n.parentId):null;
      if(n.parentId&&(!parent||parent.level>=n.level))fail('标题父级须先出现，且层级小于子标题。');
      if(parent?.kind==='material')fail('资料项不能含子标题，请将父级明确设为分组。');
      const next={id:n.id,parentId:n.parentId,level:n.level,title:str(n.title,1000,true),description:str(n.description,20000)};
      if(hasKind)next.kind=n.kind;
      seen.set(next.id,next);return next;
    });
  }
  const leafNodesOf=nodes=>{const parents=new Set(nodes.map(n=>n.parentId).filter(Boolean));return nodes.filter(n=>n.kind!=='group'&&!parents.has(n.id));};
  const mapBlank=nodes=>Object.fromEntries(leafNodesOf(nodes).map(n=>[n.id,blank()]));
  const mapFiles=nodes=>Object.fromEntries(leafNodesOf(nodes).map(n=>[n.id,[]]));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function fileMeta(x){
    exact(x,['id','nodeId','generationId','name','size','type','sha256','at','reviewer']);
    if(!isUuid(x.id)||!isUuid(x.generationId)||!/^n[1-9]\d{0,2}$/u.test(x.nodeId)||!Number.isSafeInteger(x.size)||x.size<1||x.size>FILE_MAX||typeof x.sha256!=='string'||!/^\b[0-9a-f]{64}$/u.test(x.sha256))fail('资料文件元数据无效。');
    const name=str(x.name,180,true),type=str(x.type,100,true),reviewer=str(x.reviewer,100,true);iso(x.at);
    if(name!==x.name||type!==x.type||reviewer!==x.reviewer||/[\\/:*?"<>|\r\n\t]/u.test(name)||/^[. ]|[. ]$/u.test(name)||!Object.hasOwn(FILE_TYPES,name.split('.').at(-1).toLowerCase())||FILE_TYPES[name.split('.').at(-1).toLowerCase()]!==type)fail('资料文件名称或类型无效。');
    return x;
  }
  function receipt(files,reviewer,at){return {status:files.length?'received':'pending',evidence:files.length?'附件：'+files.map(x=>x.id).join('、'):'',reason:'',reviewer,at};}
  const FILE_TYPES=Object.freeze({pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',rtf:'application/rtf',odt:'application/vnd.oasis.opendocument.text',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',tsv:'text/tab-separated-values',ods:'application/vnd.oasis.opendocument.spreadsheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odp:'application/vnd.oasis.opendocument.presentation',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml',avif:'image/avif',txt:'text/plain',json:'application/json',md:'text/markdown',html:'text/html',xml:'application/xml',zip:'application/zip',rar:'application/vnd.rar'});
  function validateV2(r){
    exact(r,['schema','project','revision','generationId','nodes','states','attachments','closed','events','legacy']);
    if(r.schema!==2||!Number.isSafeInteger(r.revision)||!Array.isArray(r.events)||!r.events.length||r.events.length>5000||!isUuid(r.generationId))fail('层级资料记录结构无效。');
    const p=project(r.project);if(!same(p,r.project))fail('资料项目归属不一致。');
    if(r.legacy!==null){validateV1(r.legacy);if(r.legacy.closed||!same(r.legacy.project,r.project))fail('旧记录未开门或项目归属不一致。');}
    const base=r.legacy?.revision||0;
    if(r.revision!==base+r.events.length)fail('层级资料修订号与留痕不一致。');
    const normalized=treeNodes(r.nodes);if(!same(normalized,r.nodes))fail('标题内容不规范，未覆盖。');
    let nodes=null,states=null,attachments=null,closed=null,generation='',totalBytes=0;
    const files=new Map(),generations=new Set();
    function checkStateMap(value,xs){exact(value,leafNodesOf(xs).map(n=>n.id));for(const x of Object.values(value))state(x);return value;}
    function closeRecord(v){exact(v,['at','reviewer','revision']);iso(v.at);str(v.reviewer,100,true);if(!Number.isSafeInteger(v.revision)||v.revision<2)fail('关门记录无效。');return v;}
    function reset(ns,gen){nodes=treeNodes(ns);if(!same(ns,nodes))fail('历史标题内容不规范。');if(!isUuid(gen)||generations.has(gen))fail('标题树版本无效。');generations.add(gen);generation=gen;states=mapBlank(nodes);attachments=mapFiles(nodes);}
    for(const [i,e]of r.events.entries()){
      const keys={
        'tree-import':['type','at','reviewer','reason','generationId','nodes'],
        'tree-replace':['type','at','reviewer','reason','generationId','nodes','oldNodes','oldStates','oldAttachments'],
        item:['type','id','at','reviewer','before','after'],
        'attachment-add':['type','nodeId','at','reviewer','file','before','after'],
        'attachment-remove':['type','nodeId','at','reviewer','fileId','reason','before','after'],
        close:['type','at','reviewer','revision'],reopen:['type','at','reviewer','reason','priorClose']
      }[e?.type];
      if(!keys)fail('层级资料留痕类型无效。');exact(e,keys);iso(e.at);str(e.reviewer,100,true);
      if(i===0){
        if(e.type!=='tree-import')fail('层级资料缺少初始导入。');str(e.reason,1000,!!r.legacy);reset(e.nodes,e.generationId);continue;
      }
      if(e.type==='tree-import')fail('层级资料重复初始导入。');
      if(e.type==='reopen'){
        str(e.reason,1000,true);if(!closed||!same(closeRecord(e.priorClose),closed))fail('重新开门留痕不一致。');closed=null;continue;
      }
      if(closed)fail('关门后不能修改标题或资料文件。');
      if(e.type==='tree-replace'){str(e.reason,1000,true);if(!same(e.oldNodes,nodes)||!same(e.oldStates,states)||!same(e.oldAttachments,attachments))fail('标题替换历史与原状态不一致。');reset(e.nodes,e.generationId);continue;}
      if(e.type==='close'){
        if(e.revision!==base+i+1||!Object.keys(states).length||Object.values(states).some(s=>!['confirmed','na'].includes(s.status)))fail('叶资料尚未核对通过，不能关门。');
        closed={at:e.at,reviewer:e.reviewer,revision:e.revision};continue;
      }
      const id=e.type==='item'?e.id:e.nodeId;
      if(!Object.hasOwn(states,id))fail('只有当前叶标题可以上传或核对。');
      if(!same(state(e.before),states[id]))fail('资料修改留痕前后不一致。');
      const after=state(e.after);if(after.at!==e.at||after.reviewer!==e.reviewer)fail('资料核对人与留痕不一致。');
      if(e.type==='attachment-add'){
        const f=fileMeta(e.file);
        if(f.nodeId!==id||f.generationId!==generation||f.at!==e.at||f.reviewer!==e.reviewer||files.has(f.id)||attachments[id].length>=10)fail('资料文件归属或版本无效。');
        totalBytes+=f.size;if(totalBytes>PROJECT_MAX)fail('本项目资料文件历史总量超过 150 MiB。');
        files.set(f.id,f);attachments[id].push(f);
        if(!same(after,receipt(attachments[id],e.reviewer,e.at)))fail('新文件上传后必须重新核对。');
      }else if(e.type==='attachment-remove'){
        str(e.reason,1000,true);const at=attachments[id].findIndex(f=>f.id===e.fileId);if(at<0)fail('当前资料文件不存在。');
        attachments[id].splice(at,1);if(!same(after,receipt(attachments[id],e.reviewer,e.at)))fail('移除文件后须重新核对。');
      }
      states[id]=after;
    }
    checkStateMap(r.states,normalized);exact(r.attachments,leafNodesOf(normalized).map(n=>n.id));
    for(const xs of Object.values(r.attachments)){if(!Array.isArray(xs)||xs.length>10)fail('单项最多 10 个附件。');xs.forEach(fileMeta);}
    if(!same(r.nodes,nodes)||r.generationId!==generation||!same(r.states,states)||!same(r.attachments,attachments))fail('标题或资料当前状态与留痕不一致。');
    if(r.closed!==null)closeRecord(r.closed);
    if(!same(r.closed,closed)||closed&&closed.revision!==r.revision)fail('关门记录与留痕不一致。');
    if(JSON.stringify(r).length>TREE_RECORD_MAX)fail('层级资料留痕过大，请导出归档后联系维护。');
    return r;
  }
  function validate(r){return r?.schema===2?validateV2(r):validateV1(r);}
  function gate(r){
    if(r?.schema!==2)return gateV1(r);validateV2(r);
    const leaves=leafNodesOf(r.nodes),blockers=leaves.filter(n=>!['confirmed','na'].includes(r.states[n.id].status));
    return {ready:leaves.length>0&&!blockers.length,total:leaves.length,confirmed:leaves.filter(n=>r.states[n.id].status==='confirmed').length,
      excluded:leaves.filter(n=>r.states[n.id].status==='na').length,blockers:blockers.map(n=>n.id),closed:!!r.closed};
  }
  function createTree(p,nodes,reviewer,reason='',legacy=null){
    const ns=treeNodes(nodes),actor=str(reviewer,100,true),at=new Date().toISOString(),generationId=uuid(),old=legacy===null?null:copy(validateV1(legacy));
    if(old?.closed)fail('已关门。请先说明理由并重新开门。');
    const why=str(reason,1000,!!old),pr=project(p);if(old&&!same(old.project,pr))fail('导入项目与原清单不一致，请刷新后重试。');
    return validateV2({schema:2,project:pr,revision:(old?.revision||0)+1,generationId,nodes:ns,states:mapBlank(ns),attachments:mapFiles(ns),closed:null,
      events:[{type:'tree-import',at,reviewer:actor,reason:why,generationId,nodes:copy(ns)}],legacy:old});
  }
  function applyTree(input,cmd){
    validateV2(input);if(!cmd||typeof cmd!=='object')fail('操作无效。');const r=copy(input),at=new Date().toISOString(),actor=str(cmd.reviewer,100,true);
    if(r.events.length>=5000)fail('资料留痕已达上限，请归档后联系维护。');
    if(cmd.type==='reopen'){
      if(!r.closed)fail('当前尚未关门。');const why=str(cmd.reason,1000,true);
      r.events.push({type:'reopen',at,reviewer:actor,reason:why,priorClose:copy(r.closed)});r.closed=null;
    }else{
      if(r.closed)fail('已关门。请先说明理由并重新开门，不能直接改资料。');
      if(cmd.type==='close'){
        if(!gate(r).ready)fail('仍有叶资料未核对通过或未说明不适用，不能关门。');
        r.closed={at,reviewer:actor,revision:r.revision+1};r.events.push({type:'close',at,reviewer:actor,revision:r.revision+1});
      }else if(cmd.type==='tree-replace'){
        const ns=treeNodes(cmd.nodes),reason=str(cmd.reason,1000,true),generationId=uuid();
        r.events.push({type:'tree-replace',at,reviewer:actor,reason,generationId,nodes:copy(ns),oldNodes:copy(r.nodes),oldStates:copy(r.states),oldAttachments:copy(r.attachments)});r.nodes=ns;r.generationId=generationId;r.states=mapBlank(ns);r.attachments=mapFiles(ns);
      }else{
        const id=cmd.type==='item'?cmd.id:cmd.nodeId;if(!Object.hasOwn(r.states,id))fail('只有当前叶标题可以上传或核对。');
        const before=copy(r.states[id]);let after;
        if(cmd.type==='item'){
          after=state({status:cmd.status,evidence:cmd.evidence||'',reason:cmd.reason||'',reviewer:actor,at});
          r.events.push({type:'item',id,at,reviewer:actor,before,after});
        }else if(cmd.type==='attachment-add'){
          if(r.attachments[id].length>=10)fail('每个叶标题最多 10 个附件。');
          const f={...cmd.file,at,reviewer:actor};fileMeta(f);if(f.nodeId!==id||f.generationId!==r.generationId)fail('文件不属于当前标题版本。');
          r.attachments[id].push(f);after=receipt(r.attachments[id],actor,at);r.events.push({type:'attachment-add',nodeId:id,at,reviewer:actor,file:copy(f),before,after});
        }else if(cmd.type==='attachment-remove'){
          const reason=str(cmd.reason,1000,true),index=r.attachments[id].findIndex(f=>f.id===cmd.fileId);if(index<0)fail('当前附件不存在。');
          r.attachments[id].splice(index,1);after=receipt(r.attachments[id],actor,at);r.events.push({type:'attachment-remove',nodeId:id,at,reviewer:actor,fileId:cmd.fileId,reason,before,after});
        }else fail('操作类型无效。');
        r.states[id]=after;
      }
    }
    r.revision++;return validateV2(r);
  }
  function apply(r,cmd){return r?.schema===2?applyTree(r,cmd):applyV1(r,cmd);}
  function safeName(input){
    let name=str(input,260,true).replace(/[\\/:*?"<>|\r\n\t]/gu,'_').replace(/^[. ]+|[. ]+$/gu,'');
    if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name))name='_'+name;
    if(name.length>180){const dot=name.lastIndexOf('.');name=name.slice(0,150)+(dot>=0?name.slice(dot):'');}
    if(!name||name.length>180)fail('资料文件名无效或过长。');return name;
  }
  function utf8(bytes){let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('文本资料须为有效UTF-8编码，请另存UTF-8后上传，原文件未保存。');}if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))fail('文本资料含不支持的控制字符。');return value;}
  function xmlDocument(bytes,DOMParser=root.DOMParser){const value=utf8(bytes);if(/<!DOCTYPE|<!ENTITY/iu.test(value))fail('XML/SVG/Office资料含DOCTYPE或实体声明，当前不接收外部实体，未保存。');const doc=new DOMParser().parseFromString(value,'application/xml');if(doc.querySelector('parsererror')||!doc.documentElement)fail('XML资料结构无效，文件内容与扩展名不符。');return doc;}
  function matchingMime(ext,mime){
    if(typeof mime!=='string'||!mime.trim())return;const m=mime.toLowerCase().split(';')[0].trim();if(['application/octet-stream','binary/octet-stream','application/x-download'].includes(m)||m===FILE_TYPES[ext])return;
    const aliases={doc:['application/vnd.ms-word'],rtf:['text/rtf'],xls:['application/msexcel','application/x-msexcel'],ppt:['application/mspowerpoint'],csv:['application/csv','application/vnd.ms-excel','text/plain'],tsv:['text/plain'],md:['text/plain','text/x-markdown'],json:['text/json','text/plain'],html:['application/xhtml+xml'],xml:['text/xml'],rar:['application/x-rar-compressed'],zip:['application/x-zip-compressed']};
    if(aliases[ext]?.includes(m)||['docx','xlsx','pptx','odt','ods','odp'].includes(ext)&&['application/zip','application/x-zip-compressed'].includes(m))return;fail('所选文件MIME类型与扩展名不符，未保存。');
  }
  // Read only bounded ZIP metadata for Office identity. No entry is executed or extracted to disk.
  async function officePackage(bytes,ext,DOMParser=root.DOMParser){
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>d.getUint16(i,true),u32=i=>d.getUint32(i,true),bad=()=>fail('Office压缩容器损坏、加密或格式不受支持，未保存。');
    if(bytes.length<22)bad();const minimum=Math.max(0,bytes.length-65557);let end=bytes.length-22;for(;end>=minimum;end--)if(u32(end)===0x06054b50&&end+22+u16(end+20)===bytes.length)break;
    if(end<minimum||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))bad();const count=u16(end+10),start=u32(end+16),length=u32(end+12);if(!count||count>2048||start+length!==end)bad();
    const parts=new Map(),ranges=[];let p=start,total=0;for(let i=0;i<count;i++){
      if(p+46>end||u32(p)!==0x02014b50)bad();const flags=u16(p+8),method=u16(p+10),packed=u32(p+20),size=u32(p+24),n=u16(p+28),extra=u16(p+30),comment=u16(p+32),local=u32(p+42);if(flags&0x2041||!n||![0,8].includes(method)||p+46+n+extra+comment>end||local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==n)bad();
      const name=utf8(bytes.subarray(p+46,p+46+n)),key=name.toLowerCase();if(name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>x==='..'||x==='.')||parts.has(key))bad();for(let j=0;j<n;j++)if(bytes[local+30+j]!==bytes[p+46+j])bad();const from=local+30+n+u16(local+28),stop=from+packed;if(stop>start||method===0&&packed!==size||(total+=size)>64*1024*1024)bad();parts.set(key,{name,method,from,stop,size,crc:u32(p+16)});ranges.push([local,stop]);p+=46+n+extra+comment;
    }if(p!==end)bad();ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])bad();
    if([...parts.keys()].some(n=>/(?:^|\/)vbaproject\.bin$|vbadata\.xml$|^macros\//i.test(n)))fail('Office资料含宏项目，当前不接收宏文件；请另存无宏格式后上传。');
    async function part(name){const e=parts.get(name.toLowerCase());if(!e||e.size<1)bad();if(e.size>FILE_MAX)fail('Office XML部件超过12MiB安全核验上限，请拆分或另存后上传，原件未保存。');let out;if(e.method===0)out=bytes.slice(e.from,e.stop);else{if(typeof root.DecompressionStream!=='function')fail('当前浏览器无法核验压缩Office元数据，请使用新版Chrome或Edge。');const reader=new Blob([bytes.subarray(e.from,e.stop)]).stream().pipeThrough(new root.DecompressionStream('deflate-raw')).getReader(),chunks=[];let n=0,timer;try{await Promise.race([(async()=>{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>e.size||n>FILE_MAX)bad();chunks.push(r.value);}})(),new Promise((_,no)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});no(Error('Office元数据核验超时，未保存。'));},5000);})]);}finally{clearTimeout(timer);try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}out=new Uint8Array(n);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}}
      if(out.length!==e.size)bad();let crc=0xffffffff;for(const b of out){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==e.crc)bad();return out;
    }
    if(['docx','xlsx','pptx'].includes(ext)){
      const main={docx:['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml','document'],xlsx:['xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml','workbook'],pptx:['ppt/presentation.xml','application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml','presentation']}[ext],types=xmlDocument(await part('[Content_Types].xml'),DOMParser);
      if([...types.getElementsByTagName('*')].some(n=>/macroEnabled|vbaProject/iu.test(n.getAttribute('ContentType')||'')&&(n.localName==='Override'&&parts.has((n.getAttribute('PartName')||'').replace(/^\//,'').toLowerCase())||n.localName==='Default'&&[...parts.keys()].some(p=>p.endsWith('.'+(n.getAttribute('Extension')||'').toLowerCase())))))fail('Office内容声明含宏类型，当前不接收。');
      if(![...types.getElementsByTagName('*')].some(n=>n.localName==='Override'&&n.getAttribute('PartName')==='/'+main[0]&&n.getAttribute('ContentType')===main[1]))bad();const document=xmlDocument(await part(main[0]),DOMParser),kind={docx:'wordprocessingml',xlsx:'spreadsheetml',pptx:'presentationml'}[ext],namespaces=['http://schemas.openxmlformats.org/'+kind+'/2006/main','http://purl.oclc.org/ooxml/'+kind+'/main'];if(types.documentElement.localName!=='Types'||types.documentElement.namespaceURI!=='http://schemas.openxmlformats.org/package/2006/content-types'||document.documentElement.localName!==main[2]||!namespaces.includes(document.documentElement.namespaceURI))bad();
    }else{
      if(utf8(await part('mimetype'))!==FILE_TYPES[ext])bad();const content=xmlDocument(await part('content.xml'),DOMParser),manifest=xmlDocument(await part('META-INF/manifest.xml'),DOMParser),ns='urn:oasis:names:tc:opendocument:xmlns:office:1.0',body=content.getElementsByTagNameNS(ns,'body')[0],kind={odt:'text',ods:'spreadsheet',odp:'presentation'}[ext];if(content.documentElement.localName!=='document-content'||content.documentElement.namespaceURI!==ns||manifest.documentElement.localName!=='manifest'||manifest.documentElement.namespaceURI!=='urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'||!body||![...body.children].some(n=>n.namespaceURI===ns&&n.localName===kind))bad();if([...manifest.getElementsByTagName('*')].some(n=>n.localName==='encryption-data'))fail('不接收加密ODF资料，请另存未加密副本后上传。');
    }
  }
  function compoundOffice(bytes,ext){
    const bad=()=>fail('旧Office容器或主文档类型与扩展名不符，未保存。');if(bytes.length<512)bad();const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>d.getUint16(i,true),u32=i=>d.getUint32(i,true),major=u16(26),shift=u16(30);if(u16(28)!==0xfffe||!(major===3&&shift===9||major===4&&shift===12)||u16(32)!==6)bad();const sector=2**shift,count=bytes.length/sector-1;if(!Number.isInteger(count)||count<1)bad();const offset=id=>{if(!Number.isInteger(id)||id<0||id>=count)bad();return(id+1)*sector;},fatCount=u32(44),difatCount=u32(72),fatIds=[],seen=new Set();if(!fatCount||fatCount>count||difatCount>count)bad();const add=id=>{if(id===0xffffffff)return;offset(id);if(seen.has(id)||fatIds.length>=fatCount)bad();seen.add(id);fatIds.push(id);};for(let i=0;i<109;i++)add(u32(76+i*4));let next=u32(68);const difat=new Set();for(let i=0;i<difatCount;i++){if(difat.has(next))bad();difat.add(next);const p=offset(next);for(let j=0;j<sector/4-1;j++)add(u32(p+j*4));next=u32(p+sector-4);}if(fatIds.length!==fatCount)bad();const fat=new Uint32Array(fatCount*sector/4);for(let i=0;i<fatIds.length;i++){const p=offset(fatIds[i]);for(let j=0;j<sector/4;j++)fat[i*sector/4+j]=u32(p+j*4);}
    const names=[],dirs=new Set();next=u32(48);while(next!==0xfffffffe){if(dirs.has(next)||dirs.size>count)bad();dirs.add(next);const p=offset(next);for(let j=0;j<sector;j+=128){const len=u16(p+j+64),kind=bytes[p+j+66];if(!kind)continue;if(len<2||len>64||len%2)bad();if(kind===2)names.push(new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(p+j,p+j+len-2)));}next=fat[next];if(next===undefined)bad();}
    if(names.some(n=>/^(?:EncryptedPackage|EncryptionInfo)$/i.test(n)))fail('旧Office资料已加密，当前无法核验；请另存未加密文件。');const expected={doc:/^WordDocument$/i,xls:/^(?:Workbook|Book)$/i,ppt:/^PowerPoint Document$/i}[ext];if(!names.some(n=>expected.test(n)))bad();
  }
  async function preparedFile(file,{DOMParser=root.DOMParser}={}){
    if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>FILE_MAX)fail('每份资料文件须为 1 字节至 12 MiB。');
    const name=safeName(file.name),ext=name.split('.').at(-1).toLowerCase(),type=FILE_TYPES[ext];if(!type){if(['tif','tiff','heic','heif'].includes(ext))fail('当前离线版没有TIFF/HEIC解码能力，暂不接收；请提供PNG、JPEG或PDF副本。');if(['docm','xlsm','pptm','dotm','xlam','ppam'].includes(ext))fail('当前不接收宏类型Office资料，请另存DOCX、XLSX或PPTX无宏副本。');fail('不支持的资料文件类型。');}matchingMime(ext,file.type);
    const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)fail('文件读取不完整，未保存。');const start=xs=>xs.every((v,i)=>bytes[i]===v),ascii=(a,b)=>new TextDecoder('ascii').decode(bytes.subarray(a,b)),d=new DataView(bytes.buffer),zip=()=>start([0x50,0x4b])&&[[3,4],[5,6],[7,8]].some(p=>bytes[2]===p[0]&&bytes[3]===p[1]),mismatch=()=>fail('文件内容与扩展名不符，未保存。');
    if(ext==='pdf'){if(!start([37,80,68,70,45]))mismatch();}
    else if(['doc','xls','ppt'].includes(ext)){if(!start([208,207,17,224,161,177,26,225]))mismatch();compoundOffice(bytes,ext);}
    else if(['docx','xlsx','pptx','odt','ods','odp'].includes(ext)){if(!zip())mismatch();await officePackage(bytes,ext,DOMParser);}
    else if(ext==='zip'){if(!zip())mismatch();}
    else if(ext==='rar'){if(!(start([82,97,114,33,26,7,0])||start([82,97,114,33,26,7,1,0])))mismatch();}
    else if(ext==='png'){if(bytes.length<45||!start([137,80,78,71,13,10,26,10])||ascii(12,16)!=='IHDR'||d.getUint32(8)!==13||!d.getUint32(16)||!d.getUint32(20)||ascii(bytes.length-8,bytes.length-4)!=='IEND')mismatch();}
    else if(['jpg','jpeg'].includes(ext)){if(bytes.length<4||!start([255,216,255])||bytes.at(-2)!==255||bytes.at(-1)!==217)mismatch();}
    else if(ext==='gif'){if(bytes.length<14||!['GIF87a','GIF89a'].includes(ascii(0,6))||!d.getUint16(6,true)||!d.getUint16(8,true)||bytes.at(-1)!==0x3b)mismatch();}
    else if(ext==='webp'){if(bytes.length<20||ascii(0,4)!=='RIFF'||ascii(8,12)!=='WEBP'||d.getUint32(4,true)+8!==bytes.length||!['VP8 ','VP8L','VP8X'].includes(ascii(12,16)))mismatch();}
    else if(ext==='bmp'){if(bytes.length<26||ascii(0,2)!=='BM'||d.getUint32(2,true)!==bytes.length||d.getUint32(10,true)<26||d.getUint32(10,true)>=bytes.length||![12,40,52,56,108,124].includes(d.getUint32(14,true)))mismatch();}
    else if(ext==='avif'){if(bytes.length<24||ascii(4,8)!=='ftyp'||d.getUint32(0)<16||d.getUint32(0)>bytes.length)mismatch();const end=d.getUint32(0),brands=[ascii(8,12)];for(let i=16;i+4<=end;i+=4)brands.push(ascii(i,i+4));if(!brands.some(x=>x==='avif'||x==='avis'))mismatch();}
    else if(ext==='rtf'){if(!/^\s*\{\\rtf[1-9]/u.test(ascii(0,96)))mismatch();}
    else {const text=utf8(bytes);if(ext==='json'){try{JSON.parse(text);}catch{fail('JSON语法无效，未保存。');}}else if(ext==='html'){if(!/<(?:!doctype\s+html|html|head|body|div|p|table|script|h[1-6]|span|meta|section|article)(?:\s|>)/iu.test(text))mismatch();}else if(['xml','svg'].includes(ext)){const doc=xmlDocument(bytes,DOMParser);if(ext==='svg'&&(doc.documentElement.localName!=='svg'||doc.documentElement.namespaceURI!=='http://www.w3.org/2000/svg'))mismatch();}}
    const digest=await root.crypto.subtle.digest('SHA-256',bytes),sha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');return {name,size:bytes.length,type,sha256,blob:new Blob([bytes],{type})};
  }
  function metadataIn(r,nodeId,fileId){
    validate(r);if(r.schema!==2)fail('旧版逐行记录没有标题附件。');
    const e=r.events.find(e=>e.type==='attachment-add'&&e.file.id===fileId&&e.nodeId===nodeId);if(!e)fail('本项目找不到该资料文件版本。');return e.file;
  }
  function storedMaterialFile(x,key,meta){exact(x,['id','quoteId','generationId','nodeId','metadata','blob']);if(x.id!==meta.id||x.quoteId!==key||x.nodeId!==meta.nodeId||x.generationId!==meta.generationId||!same(x.metadata,meta)||!(x.blob instanceof Blob)||x.blob.size!==meta.size||x.blob.type!==meta.type)fail('资料文件归属或内容损坏。');return {blob:x.blob,metadata:copy(meta)};}
  function preservationCodec(){const api=typeof module==='object'&&module.exports?require('./material-preservation.js'):root.MaterialPreservation;if(!api||typeof api.create!=='function'||typeof api.inspect!=='function')fail('资料保全组件未载入，原数据未改变。');return api;}
  function preservationOptions(value,restore=false){
    if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail('资料保全参数无效。');
    const fields=Object.getOwnPropertyDescriptors(value),allowed=restore?['expectedSha256','assertContext']:['assertContext'];
    if(Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!allowed.includes(key)||!fields[key].enumerable||!Object.hasOwn(fields[key],'value')))fail('资料保全参数无效。');
    const guard=fields.assertContext?.value,sha=fields.expectedSha256?.value;
    if(guard!==undefined&&typeof guard!=='function'||restore&&(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha)))fail('请先完成保全包预检并核对摘要。');
    return {sha,check:()=>{if(guard)guard();}};
  }
  function openDatabase(name,trialOnly=false){
    return new Promise((resolve,reject)=>{
      const req=root.indexedDB.open(name,2);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'quoteId'});if(!db.objectStoreNames.contains(FILE_STORE))db.createObjectStore(FILE_STORE,{keyPath:'id'});};
      req.onerror=()=>reject(Error('无法打开本机审计资料库，请使用新版并保留原记录。'));req.onblocked=()=>reject(Error('请关闭旧版审计资料窗口后重试；未清除原记录。'));
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();
        if(db.objectStoreNames.length!==2||![STORE,FILE_STORE].every(n=>db.objectStoreNames.contains(n))){db.close();reject(Error('审计资料库结构不兼容，未清除。'));return;}
        function transact(key,expected,make,blobFile=null){
          return new Promise((ok,no)=>{
            const t=db.transaction(make?[STORE,FILE_STORE]:[STORE],make?'readwrite':'readonly'),s=t.objectStore(STORE);let result,reason;
            const abort=e=>{reason=e;try{t.abort();}catch{}};t.oncomplete=()=>ok(result);t.onabort=()=>no(reason||Error('本机操作失败，原记录与文件保留。'));
            const q=s.get(key);q.onsuccess=()=>{try{
              if(trialOnly&&key!==TRIAL_ID||!trialOnly&&make&&key===TRIAL_ID)fail('独立试用与正式项目资料库不能混用。');
              const old=q.result;if(old){if(old.quoteId!==key||old.record?.project.quoteId!==key)fail('资料归属不一致。');validate(old.record);}
              if(!make){result=old?.record||null;return;}
              if((old?.record.revision||0)!==expected)fail('此清单已在其他窗口更新，请重新载入后核对；未覆盖。');
              const next=validate(make(old?.record||null));if(next.project.quoteId!==key||next.revision!==expected+1)fail('资料修订或项目归属不一致。');
              if(blobFile){const meta=metadataIn(next,blobFile.nodeId,blobFile.id);t.objectStore(FILE_STORE).add({id:meta.id,quoteId:key,generationId:meta.generationId,nodeId:meta.nodeId,metadata:copy(meta),blob:blobFile.blob});}
              result=next;s.put({quoteId:key,record:next});
            }catch(e){abort(e);}};
          });
        }
        function preservationSnapshot(key,codec,check){return new Promise((ok,no)=>{
          const t=db.transaction([STORE,FILE_STORE],'readonly'),s=t.objectStore(STORE),f=t.objectStore(FILE_STORE),files=new Map();let record,metas=[],reason;
          const abort=e=>{reason=e;try{t.abort();}catch{}};
          t.onabort=()=>no(reason||Error('无法读取完整资料快照，未生成保全包。'));t.onerror=()=>abort(reason||Error('读取资料快照失败，原数据未变。'));
          t.oncomplete=()=>{try{check();if(!record||files.size!==metas.length)fail('资料原件不完整，未生成保全包。');ok({record,files});}catch(e){no(e);}};
          const request=s.get(key);request.onsuccess=()=>{try{
            check();const row=request.result;if(!row||row.quoteId!==key||row.record?.project.quoteId!==key)fail('当前项目尚无有效资料清单，未生成保全包。');record=copy(validate(row.record));metas=codec.filesFor(record);const expected=new Set(metas.map(meta=>meta.id));
            for(const meta of metas){const q=f.get(meta.id);q.onsuccess=()=>{try{check();files.set(meta.id,storedMaterialFile(q.result,key,meta));}catch(e){abort(e);}};}
            const cursor=f.openCursor();cursor.onsuccess=()=>{try{check();const row=cursor.result;if(row){if(row.value?.quoteId===key&&!expected.has(row.value.id))fail('本项目存在未关联的资料原件，请先核对；未生成不完整保全包。');row.continue();}}catch(e){abort(e);}};
          }catch(e){abort(e);}};
        });}
        const api={get:key=>transact(key),create:(p,xs,who)=>transact(p.quoteId,0,()=>create(p,xs,who)),
          change:(key,expected,cmd)=>transact(key,expected,old=>{if(!old)fail('资料清单尚未创建。');if(['attachment-add','attachment-remove'].includes(cmd?.type))fail('文件变更须通过原子附件接口。');return apply(old,cmd);}),
          importTree:(p,nodes,who,reason='',expected=0)=>transact(p.quoteId,expected,old=>{
            const pr=project(p);if(old&&!same(old.project,pr))fail('项目资料已变化，请刷新后重试。');
            return old?.schema===2?applyTree(old,{type:'tree-replace',nodes,reviewer:who,reason}):createTree(pr,nodes,who,reason,old);
          }),
          attach:async(key,expected,nodeId,file,who)=>{
            const f=await preparedFile(file),id=uuid();
            return transact(key,expected,old=>{if(old?.schema!==2)fail('请先导入标题层级清单。');return applyTree(old,{type:'attachment-add',nodeId,reviewer:who,file:{id,nodeId,generationId:old.generationId,name:f.name,size:f.size,type:f.type,sha256:f.sha256}});},{id,nodeId,blob:f.blob});
          },
          removeAttachment:(key,expected,nodeId,fileId,who,reason)=>transact(key,expected,old=>{if(old?.schema!==2)fail('请先导入标题层级清单。');return applyTree(old,{type:'attachment-remove',nodeId,fileId,reviewer:who,reason});}),
          exportPreservation:async(key,options={})=>{
            const {check}=preservationOptions(options);check();if(!isUuid(key)||trialOnly!==(key===TRIAL_ID))fail('保全来源须为当前正式项目或独立试用，不能混用。');
            const codec=preservationCodec(),snapshot=await preservationSnapshot(key,codec,check);check();
            const result=await codec.create({record:snapshot.record,readFile:async meta=>{check();const file=snapshot.files.get(meta.id);if(!file)fail('资料原件不完整，未生成保全包。');return file;},readCurrent:async()=>{check();const current=await api.get(key);check();return current;}});check();return result;
          },
          restorePreservation:async(key,blob,options={})=>{
            const {sha,check}=preservationOptions(options,true);check();if(!isUuid(key)||trialOnly!==(key===TRIAL_ID))fail('恢复目标须为当前正式项目或独立试用，不能混用。');
            const existing=await api.get(key);check();if(existing)fail('目标已有资料清单，未覆盖。请先核对当前记录。');
            const parsed=await preservationCodec().inspect(blob);check();
            if(parsed.sha256!==sha||parsed.summary.packageSha256!==sha)fail('保全包与已确认的摘要不一致，未恢复。');
            if(parsed.manifest.projectId!==key||parsed.manifest.sourceNamespace!==name||parsed.record.project.quoteId!==key)fail('保全包与所选项目或正式／试用范围不一致，未恢复。');
            const record=copy(validate(parsed.record)),files=[];
            for(const file of parsed.files){
              check();const meta=copy(file.metadata),source=file.blob;
              const prepared=await preparedFile({name:meta.name,type:meta.type,size:source.size,arrayBuffer:()=>source.arrayBuffer()});check();
              if(prepared.name!==meta.name||prepared.type!==meta.type||prepared.size!==meta.size||prepared.sha256!==meta.sha256)fail('资料原件不符合原上传校验或保全元数据，未恢复。');
              files.push({metadata:meta,blob:prepared.blob});
            }
            return new Promise((ok,no)=>{
              const t=db.transaction([STORE,FILE_STORE],'readwrite'),s=t.objectStore(STORE),f=t.objectStore(FILE_STORE);let result,reason;
              const abort=e=>{reason=e;try{t.abort();}catch{}};
              t.onabort=()=>no(reason||Error('恢复事务未完成，原有资料未覆盖；请刷新核对。'));t.oncomplete=()=>ok(result);t.onerror=()=>abort(reason||Error('恢复写入失败，事务已取消，原有资料未覆盖。'));
              const write=()=>{try{check();s.add({quoteId:key,record});for(const file of files){const meta=file.metadata;f.add({id:meta.id,quoteId:key,generationId:meta.generationId,nodeId:meta.nodeId,metadata:meta,blob:file.blob});}result={record:copy(record),summary:copy(parsed.summary),sha256:parsed.sha256};}catch(e){abort(e);}};
              const collisions=()=>{if(!files.length){write();return;}let remaining=files.length;for(const file of files){const request=f.get(file.metadata.id);request.onsuccess=()=>{try{check();if(request.result!==undefined)fail('保全包文件ID已存在，未覆盖任何项目资料。');if(--remaining===0)write();}catch(e){abort(e);}};}};
              const request=s.get(key);request.onsuccess=()=>{try{
                check();if(request.result!==undefined)fail('目标已有资料记录，未覆盖；请重新载入核对。');
                const cursor=f.openCursor();cursor.onsuccess=()=>{try{check();const row=cursor.result;if(row){if(row.value?.quoteId===key)fail('目标存在未关联的资料原件，未覆盖；请先核对资料库。');row.continue();}else collisions();}catch(e){abort(e);}};
              }catch(e){abort(e);}};
            });
          },
          downloadAttachment:(key,nodeId,fileId)=>new Promise((ok,no)=>{
            const t=db.transaction([STORE,FILE_STORE],'readonly');let result,reason;const abort=e=>{reason=e;try{t.abort();}catch{}};
            t.onabort=()=>no(reason||Error('无法读取资料文件，未改动原记录。'));t.oncomplete=async()=>{try{if(!result)fail('资料文件不存在。');const d=await root.crypto.subtle.digest('SHA-256',await result.blob.arrayBuffer());if(Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,'0')).join('')!==result.metadata.sha256)fail('资料文件完整性校验失败。');ok(result);}catch(e){no(e);}};
            const q=t.objectStore(STORE).get(key);q.onsuccess=()=>{try{
              if(trialOnly&&key!==TRIAL_ID)fail('试用与正式项目不能混用。');const row=q.result;if(!row||row.quoteId!==key||row.record?.project.quoteId!==key)fail('资料项目不存在。');const meta=metadataIn(row.record,nodeId,fileId);
              const f=t.objectStore(FILE_STORE).get(fileId);f.onsuccess=()=>{try{result=storedMaterialFile(f.result,key,meta);}catch(e){abort(e);}};
            }catch(e){abort(e);}};
          }),close:()=>db.close()};resolve(Object.freeze(api));
      };
    });
  }
  const open=()=>openDatabase(DB),openTrial=()=>openDatabase(TRIAL_DB,true);
  const api=Object.freeze({parse,create,createTree,apply,gate,validate,open,openTrial,TRIAL_ID,STATES,FILE_TYPES,prepareFile:preparedFile,leafNodes:r=>r?.schema===2?copy(leafNodesOf(validateV2(r).nodes)):copy(validateV1(r).items)});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AuditChecklist=api;
})(globalThis);
