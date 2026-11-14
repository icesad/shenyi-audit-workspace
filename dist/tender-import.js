/* Local-only invitation import: read the visible main Word body, never execute content or follow relationships. */
(function (root) {
  'use strict';
  const MiB = 1024 * 1024, MAX_FILE = 12 * MiB, MAX_XML = 4 * MiB;
  const WORD = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
  const invalid = () => { throw new Error('无法读取 Word 正文：文件损坏、加密或格式不受支持，请另存为 .docx。'); };
  const tooLarge = () => { throw new Error('发标文件过大或结构过于复杂，请仅保留主函另存为 .docx。'); };
  const decoder = () => new TextDecoder('utf-8', { fatal: true });
  const crcTable = Uint32Array.from({length:256}, (_,i) => {
    for(let j=0;j<8;j++) i=(i>>>1) ^ (i&1 ? 0xedb88320 : 0); return i>>>0;
  });
  function crc32(bytes){let crc=0xffffffff; for (const b of bytes) crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

  // Inflate only one explicitly named OOXML part at a time; never extract to disk.
  async function mainPart(bytes,wanted='word/document.xml',optional=false,maxXml=MAX_XML) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true),n=bytes.length;
    let end=n-22;
    for (;end>=Math.max(0,n-65557);end--) if(u32(end)===0x06054b50 && end+22+u16(end+20)===n) break;
    if(end<Math.max(0,n-65557)||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))invalid();
    const count=u16(end+10),start=u32(end+16);
    if(count>4096)tooLarge();
    if(start+u32(end+12)!==end)invalid();
    let p=start, entry, hasTypes=false;
    for(let i=0;i<count;i++){
      if(p+46>end||u32(p)!==0x02014b50)invalid();
      const len=u16(p+28),next=p+46+len+u16(p+30)+u16(p+32);
      if(next>end)invalid();
      const a=bytes.subarray(p+46,p+46+len);
      const eq=name=>a.length===name.length&&a.every((b,j)=>b===name.charCodeAt(j));
      if(eq('[Content_Types].xml'))hasTypes=true;
      if(eq(wanted)){
        if(entry)invalid();
        entry={flags:u16(p+8),method:u16(p+10),crc:u32(p+16),compressed:u32(p+20),raw:u32(p+24),local:u32(p+42),len,name:a};
      }
      p=next;
    }
    if(p!==end||!hasTypes)invalid();if(!entry){if(optional)return null;invalid();}
    const {flags,method,crc,compressed,raw,local,len,name}=entry;
    if(raw>maxXml)tooLarge();
    if(!raw||!compressed||(flags&0x2041)||![0,8].includes(method)||local+30+len>start||
       u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==len||
       !bytes.subarray(local+30,local+30+len).every((b,j)=>b===name[j]))invalid();
    const pos=local+30+len+u16(local+28);
    if(pos+compressed>start)invalid();
    let out=bytes.subarray(pos,pos+compressed);
    if(method===8){
      let ds;
      try {ds=new DecompressionStream('deflate-raw');}
      catch {throw new Error('当前浏览器不支持本机 Word 解压，请升级浏览器或手工录入。');}
      const reader=new Blob([out]).stream().pipeThrough(ds).getReader();
      out=new Uint8Array(raw); let written=0;
      try {
        for(;;){const {done,value}=await reader.read();if(done)break;
          if(written+value.byteLength>raw){await reader.cancel();invalid();}
          out.set(value,written);written+=value.byteLength;}
      }catch{invalid();} finally{reader.releaseLock();}
      if(written!==raw)invalid();
    }
    if(out.length!==raw||crc32(out)!==crc)invalid();
    try{return decoder().decode(out);}catch{invalid();}
  }

  function paragraphs(xml) {
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))invalid();
    if((xml.match(/</g)||[]).length>120000)tooLarge();
    const doc=new DOMParser().parseFromString(xml,'application/xml'), top=doc.documentElement;
    if(!top||!WORD.includes(top.namespaceURI)||top.localName!=='document'||doc.getElementsByTagName('parsererror').length)invalid();
    const ns=top.namespaceURI, body=Array.from(top.children).find(n=>n.namespaceURI===ns&&n.localName==='body');
    if(!body)invalid();
    const lines=[], tables=[];
    let table=null,afterResponse=false;
    let nodes=0;
    function walk(el,depth,sink,insideP){
      if(depth>90||++nodes>80000)tooLarge();
      if(el.namespaceURI!==ns)return;
      const tag=el.localName;
      if(['del','moveFrom','pPr','rPr','instrText','drawing','pict','txbxContent','object'].includes(tag))return;
      if(tag==='r'&&Array.from(el.children).some(c=>c.localName==='rPr'&&Array.from(c.children).some(p=>p.localName==='vanish')))return;
      if(tag==='t'){if(insideP)sink.push(el.textContent);return;}
      if(tag==='br'||tag==='cr'||tag==='tab'){if(insideP)sink.push(tag==='tab'?' ':'\n');return;}
      if(tag==='tbl'){
        if(table)return;
        table={rows:[],before:lines.slice(-4),afterResponse};
        tables.push(table); for(const c of el.children)walk(c,depth+1,sink,false);
        table=null;return;
      }
      if(tag==='tr'){
        const cells=Array.from(el.children).filter(c=>c.namespaceURI===ns&&c.localName==='tc').map(c=>{
          const parts=[];for(const child of c.children)walk(child,depth+1,parts,false);return parts.join(' ').trim();
        });
        if(cells.length){if(table)table.rows.push(cells);sink.push(cells.join('\t'));}return;
      }
      if(tag==='p'&&!insideP){
        const parts=[];for(const c of el.children)walk(c,depth+1,parts,true);
        const text=parts.join('').trim();if(!table&&lines.length&&responseHeading.test(normal(text)))afterResponse=true;
        if(text)sink.push(text);return;
      }
      for(const c of el.children)walk(c,depth+1,sink,insideP);
    }
    walk(body,0,lines,false);
    return {lines:lines.flatMap(line=>line.split('\n')).map(s=>s.trim()).filter(Boolean),tables};
  }

  const labels={
    issuer:['发标单位','发标方','招标单位','招标人名称','招标人','采购单位名称','采购单位','采购人名称','采购人','采购方','选商单位','邀请单位','征集人','比选人','询价单位','询价人'],
    projectName:['项目名称','采购项目名称','招标项目名称','标的名称','项目全称'],
    contactName:['项目联系人','联系人员','联络人','联系人'],
    phone:['联系电话','联系人电话','办公电话','固定电话','移动电话','手机号码','手机号','手机','电话','联系方式'],
    email:['电子邮箱','电子邮件','联系邮箱','邮箱','E-mail','Email']
  };
  const prefix='(?:(?:发标方|采购方|采购人|招标方|招标人|发标单位|采购单位)(?:的)?)?';
  const atoms=Object.values(labels).flat().sort((a,b)=>b.length-a.length);
  const fieldPattern=prefix+'(?:'+atoms.join('|')+')';
  const fieldRE=()=>new RegExp('('+fieldPattern+')\\s*[:：]\\s*','gi');
  const soleRE=new RegExp('^('+fieldPattern+')\\s*[:：]?$','i');
  function keyFor(label){return Object.keys(labels).find(k=>labels[k].some(t=>label.toLowerCase().endsWith(t.toLowerCase())));}
  function normal(s){return s.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g,'$1').trim();}
  const firmEnd=/(?:公司|事务所(?:[（(].+[）)])?|采购中心|服务中心|交易中心|委员会|研究院|研究所|学校|大学|学院|医院|政府|管理局|财政局|管理处|合作社|集团|银行|分行)$/;
  function plausibleFirm(s){return s.length>=4 && s.length<=100 && firmEnd.test(s)&&!/[：:，,。；;<>《》]/.test(s)&&!/^(?:各|致|关于)|(?:你方|我方|本公司|贵公司|受邀单位)/.test(s);}
  function cleanedProject(s){return s.replace(/^关于/,'').replace(/的$/,'').replace(/^《(.*)》$/,'$1').trim();}
  function extract(lines) {
    const hits=Object.fromEntries(Object.keys(labels).map(k=>[k,[]]));
    const evidence=(k,v,priority)=>{
      v=v.trim().replace(/^[：: \t]+|[，,。；;\s]+$/g,'');
      if(!k||!v||v.length>200||/[_<>×]{2,}|请填写|待填写|^待定$|^[xX×某*]+$/.test(v))return;
      if(k==='phone'){
        const nums=v.match(/(?:\+?86[- ]?)?(?:1[3-9]\d{9}|(?:0\d{2,3}[-– ]?)?\d{7,8}(?:[-转]\d{1,6})?)/g)||[];
        if(!nums.length||/[A-Za-z0-9@]/.test(nums.reduce((s,num)=>s.replace(num,''),v)))return;
        nums.forEach(num=>hits[k].push([priority,num]));return;
      }
      if(k==='email'){
        const emails=v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[];
        emails.forEach(mail=>hits[k].push([priority,mail]));return;
      }
      if(k==='contactName'){
        if(!/^(?:[\u3400-\u9fff·]{2,10}|[A-Za-z][A-Za-z .'-]{1,40})$/.test(v)||/联系人|待填|联系我方|详见|电话|邮箱|发标人/.test(v))return;
      }
      if(k==='issuer'&&(v.length>100||/[：:，,。<>]|联系人|电话|邮箱/.test(v)))return;
      if(k==='projectName'&&(v.length>160||/[<>]|详见附件/.test(v)))return;
      hits[k].push([priority,v]);
    };
    lines=lines.map(normal);
    const scope=l=>l.replace(/^(?:[（(]?[一二三四五六七八九十\d]+[）).、．]\s*)+/,'');
    let other=false;
    for(let i=0;i<lines.length;i++){
      const line=lines[i], heading=scope(line);
      if(i>0 && /^(?:附件[一二三四五六七八九十\d]*[:：、.]?\s*)?(?:竞争性谈判选商回函|投标函|投标文件格式|报价函(?:格式)?|回执(?:单)?|承诺书|承诺函)$/.test(heading))break;
      if(i>0 && /^(?:20\d{2}年\d{1,2}月\d{1,2}日)$/.test(line)&&plausibleFirm(lines[i-1])&&!other){
        evidence('issuer',lines[i-1],1);break;
      }
      if(/^(?:采购代理机构|招标代理机构|代理机构|受邀方|受邀单位|供应商|投标单位|投标人|投标方|响应单位|响应人|报价单位|报价人)(?:信息|资料|名称|联系方式|联系人|[:：]|$)/.test(heading)){other=true;continue;}
      if(/^(?:发标方|发标单位|招标方|招标人|采购方|采购人|采购单位)(?:信息|名称|联系方式|联系人|[:：]|$)/.test(heading))other=false;
      if(other)continue;
      if(i<10){
        const suffix=/(?:谈判选商函|询价邀请函|竞争性谈判邀请函|谈判邀请函|采购邀请函|询价函|招标公告|采购公告|比选公告)$/;
        if(suffix.test(heading)){
          const title=cleanedProject(heading.replace(suffix,'')||(i?lines[i-1]:''));
          if(title.length>=4&&title.length<=160&&!/[：:，,。]/.test(title)&&!/^附件/.test(title))evidence('projectName',title,1);
        }
      }
      if(line.length>1200)continue;
      const cells=heading.split('\t').map(normal);
      // A horizontal table may list all field names in one row, followed by values on the next.
      if(cells.length>1&&cells.every(c=>soleRE.test(c))&&lines[i+1]){
        const values=lines[i+1].split('\t');
        if(values.length===cells.length){cells.forEach((c,j)=>evidence(keyFor(c.match(soleRE)[1]),values[j],3));i++;continue;}
      }
      for(let j=0;j<cells.length;j++){
        const cell=cells[j], alone=cell.match(soleRE);
        if(alone){
          if(cells[j+1]&&!soleRE.test(cells[j+1])){evidence(keyFor(alone[1]),cells[++j],3);continue;}
          if(cells.length===1&&lines[i+1]&&!/[:：\t]/.test(lines[i+1]))evidence(keyFor(alone[1]),lines[i+1],2);
          continue;
        }
        const ms=[...cell.matchAll(fieldRE())];
        for(let q=0;q<ms.length;q++){
          const m=ms[q], before=cell.slice(0,m.index);
          if(q===0&&before.trim()&&!/^[\s（(一二三四五六七八九十\d)）、.．]+$/.test(before))continue;
          const key=keyFor(m[1]),value=cell.slice(m.index+m[0].length,ms[q+1]?.index).replace(/[\s,，;；|/]+$/,'');
          evidence(key,value,3);
        }
      }
    }
    const out={};
    for(const k of Object.keys(labels)){
      const max=Math.max(0,...hits[k].map(([p])=>p));
      const values=[...new Set(hits[k].filter(([p])=>p===max).map(([,v])=>v))];
      out[k]=values.length===1?values[0]:'';
    }
    return out;
  }
  // Keep audit year (engagement) separate from the financial statement date.
  const provinces='北京市 天津市 上海市 重庆市 河北省 山西省 辽宁省 吉林省 黑龙江省 江苏省 浙江省 安徽省 福建省 江西省 山东省 河南省 湖北省 湖南省 广东省 海南省 四川省 贵州省 云南省 陕西省 甘肃省 青海省 台湾省 内蒙古自治区 广西壮族自治区 西藏自治区 宁夏回族自治区 新疆维吾尔自治区 香港特别行政区 澳门特别行政区'.split(' ');
  const shortProvince=p=>p.replace(/(?:壮族自治区|维吾尔自治区|回族自治区|自治区|特别行政区|省|市)$/,'');
  const provinceNames=provinces.flatMap(p=>[p,shortProvince(p)].map(name=>[name,p]))
    .sort(([a],[b])=>b.length-a.length);
  // Conservative city aliases, not a fuzzy address resolver. Do not match ambiguous
  // district/city names such as 朝阳 or 通州.
  const cityRegions=Object.entries({
    广西壮族自治区:'南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左',
    河北省:'石家庄 唐山 秦皇岛 邯郸 张家口 承德 沧州 廊坊 衡水',
    辽宁省:'沈阳 大连', 黑龙江省:'哈尔滨 齐齐哈尔', 江苏省:'南京 苏州 无锡',
    浙江省:'杭州 宁波 绍兴', 安徽省:'合肥 芜湖', 福建省:'福州 厦门 泉州', 江西省:'南昌 九江',
    山东省:'济南 青岛', 河南省:'郑州 洛阳', 湖北省:'武汉 宜昌', 湖南省:'长沙 株洲',
    广东省:'广州 深圳 珠海 佛山 东莞', 海南省:'海口 三亚', 四川省:'成都 绵阳', 贵州省:'贵阳 遵义',
    云南省:'昆明 曲靖', 陕西省:'西安 宝鸡', 甘肃省:'兰州', 青海省:'西宁', 山西省:'太原 大同',
    吉林省:'长春', 内蒙古自治区:'呼和浩特 鄂尔多斯', 西藏自治区:'拉萨', 宁夏回族自治区:'银川', 新疆维吾尔自治区:'乌鲁木齐'
  }).flatMap(([region,names])=>names.split(' ').map(name=>[name,region]))
    .sort(([a],[b])=>b.length-a.length);
  function leadingRegion(text,names){
    return names.find(([name])=>text.startsWith(name));
  }
  const regionJoin=/^(?:省|市|自治区|区)?\s*(?:和|及|以及|与|或|、|[,，/／])/;
  const locationMissing=value=>/^(?:[-—–_/]+|待填(?:写)?|待确认|未知|暂无|无)?$/.test(value);
  function province(value){
    value=normal(value);
    if(locationMissing(value))return '';
    const [name,region]=leadingRegion(value,provinceNames)||leadingRegion(value,cityRegions)||[];
    if(!region)return '';
    const rest=value.slice(name.length);
    if(regionJoin.test(rest))return '';
    const adjacent=leadingRegion(rest,provinceNames)||leadingRegion(rest,cityRegions);
    if(adjacent&&adjacent[1]!==region)return '';
    if(provinceNames.some(([n])=>n===name)) {
      // A short province name alone, followed by a local city or a full address.
      if(name===region||!rest||/^(?:地区|境内|区内|省内|市内)$/.test(rest)||adjacent)return region;
      return '';
    }
    return !rest||rest.startsWith('市')?region:'';
  }
  function regionFromName(name){
    const [prefix,region]=leadingRegion(name,provinceNames)||leadingRegion(name,cityRegions)||[];
    if(!region)return '';
    const rest=name.slice(prefix.length).replace(/^市/,'');
    const adjacent=leadingRegion(rest,provinceNames)||leadingRegion(rest,cityRegions);
    if(adjacent&&adjacent[1]!==region)return '';
    // A parent-company prefix is not proof of the province of an explicitly
    // named branch located elsewhere.
    const branch=rest.match(/^(.+?)(?=分公司|分行|分所|分院|分中心)/);
    if(branch&&[...provinceNames,...cityRegions].some(([n,p])=>p!==region&&branch[1].includes(n)))return '';
    return region;
  }
  function sharedAuditRegion(main,projectName){
    const mentions=[];
    const subject='(?:被审计(?:单位|方|主体)|所属项目公司|项目公司)';
    const all=new RegExp('^(?:(?:本项目|本次审计)(?:的)?\\s*)?(?:(?:全部|所有|各)\\s*)?'+subject+
      '\\s*(?:所在地|注册地|注册地址)?\\s*(?:均(?:位于|在|为)|全部(?:位于|在)|同为)\\s*[:：]?\\s*(.+)$');
    const labeled=new RegExp('^(?:(?:全部|所有|各)\\s*)?'+subject+'\\s*(?:所在地|注册地|注册地址)\\s*[:：]\\s*(.+)$');
    const range=/^(?:本项目|本次)?(?:审计|项目|服务)范围\s*[:：]\s*(.+)$/;
    const regionOf=(text,asRange)=>{
      const [prefix,p]=leadingRegion(text,provinceNames)||[];
      if(!p)return '';
      const rest=text.slice(prefix.length);
      if(!rest)return p;
      const inRegion=rest.match(/^\s*(?:全区|全省|全市|省内|市内|区内|境内|范围内)/);
      if(inRegion){
        const more=rest.slice(inRegion[0].length);
        if(regionJoin.test(more)||provinceNames.some(([n,r])=>r!==p&&more.includes(n)))return '';
        return p;
      }
      return asRange?'':province(text);
    };
    for(const line of main){
      const heading=line.replace(/^(?:[（(]?[一二三四五六七八九十\d]+[）).、．]\s*)+/,'');
      if(heading.length>300)continue;
      const cells=heading.split('\t').map(c=>c.trim());
      const clauses=cells.length===2?[cells[0].replace(/[:：]$/,'')+':'+cells[1]]:cells;
      for(const clause of clauses.flatMap(c=>c.split(/[。；;]/))){
        const text=clause.trim();
        const explicit=text.match(all)||text.match(labeled);
        const scope=text.match(range);
        if(explicit)mentions.push(regionOf(explicit[1],false));
        else if(scope)mentions.push(regionOf(scope[1],true));
      }
    }
    // Titles saying merely “某单位广西分公司所属项目” are not a
    // geographic scope statement; a literal province + 境内/区内 is.
    const titleRegion=regionOf(projectName,true);
    if(titleRegion)mentions.push(titleRegion);
    return mentions.length&&mentions[0]&&mentions.every(p=>p===mentions[0])?mentions[0]:'';
  }
  function uniqueMatch(re,s){const v=[...new Set([...s.matchAll(re)].map(m=>m[1]))];return v.length===1?v[0]:'';}
  function statementPeriod(s){
    const text=normal(s);
    return uniqueMatch(/((?:19|20)\d\d年(?:\d{1,2}月(?:\d{1,2}日)?)?)(?!\d)/g,text)||
      uniqueMatch(/((?:19|20)\d\d[-/.]\d{1,2}[-/.]\d{1,2})/g,text);
  }
  function scale(s){return uniqueMatch(/(亿元|万元|千元|(?<![亿万千美欧日港澳])元)/g,s);}
  function money(input,unit){
    let s=normal(input).replace(/\s/g,'').replace(/^人民币/,'');
    const u=/(亿元|万元|千元|元)$/.exec(s);
    if(u){unit=u[1];s=s.slice(0,-u[1].length);}
    if(!unit)return '';
    if(/^\(.+\)$/.test(s))s='-'+s.slice(1,-1);
    if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)||s.length>35)return '';
    const neg=s.startsWith('-'),[whole,frac='']=s.replace(/^[+-]|,/g,'').split('.');
    const shift=({亿元:4,万元:0,千元:-1,元:-4})[unit],dec=frac.length-shift;
    let digits=(whole+frac).padStart(dec+1,'0');
    let value=dec>0?digits.slice(0,-dec)+'.'+digits.slice(-dec):digits+'0'.repeat(-dec);
    value=value.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
    return neg&&/[1-9]/.test(value)?'-'+value:value;
  }
  const columns={
    clientName:/^(?:被审计(?:单位|方|主体)(?:全称|名称)?|单位(?:全称|名称)|(?:项目)?公司(?:全称|名称)|企业(?:全称|名称)|主体名称|委托审计单位名称)$/,
    location:/^(?:客户所在地|被审计(?:单位|方|主体)所在地|所在地(?:区)?|所在省(?:份|市)?|注册地(?:址)?|省份|省级地区)$/,
    year:/^(?:审计年度|审计年份)$/,
    assets:/^(?:期末)?(?:资产总额|总资产|资产合计)$/,
    revenue:/^(?:本年|本期|年度)?(?:营业收入|累计收入|营业总收入|累计营业收入)(?:合计)?$/,
    profit:/^(?:本年|本期|年度)?(?:累计)?净利润(?:合计)?$/,
    dataPeriod:/^(?:数据基期|数据日期|基准日|审计基准日|财务数据日期|经营数据日期|数据截止日|数据期间)$/
  };
  function colKey(cell){
    const k=normal(cell).replace(/\s/g,'').replace(/[（(][^()（）]*[）)]/g,'').replace(/[：:](?:亿元|万元|千元|元)$/,'').trim();
    return Object.keys(columns).find(c=>columns[c].test(k));
  }
  const responseHeading=/^(?:附件[一二三四五六七八九十\d]*[:：、.]?\s*)?(?:竞争性谈判选商回函|投标函|投标文件格式|报价函(?:格式)?|回执(?:单)?|承诺书|承诺函)$/;
  function readAuditees({lines,tables},projectName){
    const subjects=new Map(), conflicts=new Map(), unresolvedLocations=new Set();
    let overflow=false;
    const main=[];
    for(const s of lines){if(main.length&&responseHeading.test(normal(s)))break;main.push(normal(s));}
    const year=uniqueMatch(/((?:19|20)\d\d)年度?(?:财务|决算|报表|年报|专项|内部|经济责任)?[^。，；：:]{0,12}审计/g,projectName)||
      uniqueMatch(/审计年度\s*[:：]\s*((?:19|20)\d\d)/g,main.slice(0,60).join('\n'));
    for(const t of tables){
      if(t.afterResponse)continue;
      let idx={},units={},defaultUnit='',period='';
      const context=t.before.slice(-4).map(normal);
      for(const s of context){
        if(s.length>250)continue;
        if(/(?:金额单位|单位)\s*[:：]\s*(亿元|万元|千元|元)/.test(s))defaultUnit=RegExp.$1;
        if(/经营数据|财务数据|数据基期|截至|基准日|数据日期|主要指标/.test(s))period=statementPeriod(s);
      }
      for(const cells of t.rows){
        const header=cells.map(colKey);
        if(header.includes('clientName')){
          idx={};units={};const j=header.indexOf('clientName');
          if(header.some(k=>['assets','revenue','profit'].includes(k)) || /被审计/.test(cells[j]) && header.some(k=>k&&k!=='clientName')){
            header.forEach((k,i)=>{if(k){idx[k]=i;units[k]=scale(normal(cells[i]));}});
          }
          continue;
        }
        if(!Object.hasOwn(idx,'clientName'))continue;
        if(cells.some(c=>/^(?:总计|合计|小计|总合计|汇总)(?:\s*[:：(（]|$)/.test(normal(c))))continue;
        const val=k=>normal(cells[idx[k]]||''), name=val('clientName');
        if(!name||name.length>110||!/[a-zA-Z\u3400-\u9fff]/.test(name)||/^[-_/xX×某\s]+$|[×_]{2,}|^待填|请填写|单位名称|^合计|^备注|[<>]/.test(name))continue;
        const givenLocation=val('location');
        const row={clientName:name,location:province(givenLocation),year:'',assets:'',revenue:'',profit:'',dataPeriod:''};
        const given=val('year');
        row.year=given?uniqueMatch(/^((?:19|20)\d\d)(?:年度?)?$/g,given):year;
        row.dataPeriod=val('dataPeriod')?statementPeriod(val('dataPeriod')):period;
        for(const k of ['assets','revenue','profit'])row[k]=money(val(k),units[k]||defaultUnit);
        if(!subjects.has(name)){
          if(subjects.size===50){overflow=true;continue;}
          subjects.set(name,row);conflicts.set(name,new Set());
        }else{
          const old=subjects.get(name),bad=conflicts.get(name);
          for(const k of Object.keys(row)){if(!row[k]||bad.has(k))continue;
            if(old[k]&&old[k]!==row[k]){bad.add(k);old[k]='';}else old[k]=row[k];}
        }
        if(!row.location&&!locationMissing(givenLocation))unresolvedLocations.add(name);
      }
    }
    const auditees=Array.from(subjects.values());
    const mayInfer=row=>!conflicts.get(row.clientName).has('location')&&!unresolvedLocations.has(row.clientName);
    for(const row of auditees)if(!row.location&&mayInfer(row))row.location=regionFromName(row.clientName);
    const shared=sharedAuditRegion(main,projectName);
    if(shared&&!overflow&&auditees.every(row=>mayInfer(row)&&(!row.location||row.location===shared))){
      for(const row of auditees)if(!row.location)row.location=shared;
    }
    return {auditees,auditeeOverflow:overflow};
  }
  async function readDocxBytes(file){
    if(!file||!(/\.docx$/i.test(file.name))||!Number.isSafeInteger(file.size)||file.size<22)
      throw new Error('请选择有效的 .docx 发标文件；不支持 .doc、扫描件或图片。');
    if(file.size>MAX_FILE)tooLarge();
    let bytes;
    try {bytes=new Uint8Array(await file.arrayBuffer());}catch{invalid();}
    if(bytes.length!==file.size)invalid();
    return bytes;
  }
  async function readVisibleText(file){
    return paragraphs(await mainPart(await readDocxBytes(file)));
  }
  async function openBidTemplate(file){
    const bytes=await readDocxBytes(file);
    return Object.freeze({read(path){
      if(!/^word\/(?:document\.xml|styles\.xml|numbering\.xml|_rels\/document\.xml\.rels|(?:header|footer)\d{1,3}\.xml)$/u.test(path))throw Error('原件部件不受支持。');
      return mainPart(bytes,path,path!=='word/document.xml',path==='word/document.xml'?MAX_XML:512*1024);
    }});
  }
  async function read(file){
    const body=await readVisibleText(file),fields=extract(body.lines);
    return Object.assign(fields, readAuditees(body,fields.projectName));
  }
  const api=Object.freeze({read,readVisibleText,openBidTemplate});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TenderImport=api;
})(globalThis);
