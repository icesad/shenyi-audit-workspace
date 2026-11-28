/* Editable, unsigned supplier response outline for the FWE008 access tender. */
(function(root){
  'use strict';
  const sections=Object.freeze(['一、投标函','二、法定代表人身份证明','三、授权委托书','四、投标保证金','五、资格审查资料','六、鉴证咨询方案','七、其他资料','八、偏差表','九、供应商准入承诺书']);
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006/relationships';
  const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'};
  const esc=v=>String(v).replace(/[&<>"']/gu,k=>map[k]);
  function field(v,label,max,required=false){
    if(v===undefined||v===null)v='';
    if(typeof v!=='string'||v.length>max||!v.isWellFormed()||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/u.test(v))throw Error(label+'过长或含不支持的字符。');
    const x=v.trim();if(required&&!x)throw Error('请填写'+label+'。');return x;
  }
  function normalize(v){
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('标书字段无效。');
    const f={};
    for(const [key,label,max,req] of [['issuer','招标人',500,true],['projectName','项目名称',500,true],['firmName','投标人',500,true],['number','招标编号',100],['packageName','标包',100],['date','日期',10],['contact','联系人',100],['phone','电话',80],['email','邮箱',150]])f[key]=field(v[key],label,max,req);
    if(f.date){const d=new Date(f.date+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/u.test(f.date)||Number.isNaN(+d)||d.toISOString().slice(0,10)!==f.date)throw Error('投标日期无效。');}
    if(v.formalOne!==undefined&&typeof v.formalOne!=='boolean')throw Error('形式报价选择无效。');
    f.formalOne=v.formalOne===true;return f;
  }
  const run=t=>'<w:r><w:t xml:space="preserve">'+esc(t)+'</w:t></w:r>';
  function p(t,style='',extra='',bookmark=0){
    return '<w:p><w:pPr>'+(style?'<w:pStyle w:val="'+style+'"/>':'')+extra+'</w:pPr>'+
      (bookmark?'<w:bookmarkStart w:id="'+bookmark+'" w:name="chapter'+bookmark+'"/>':'')+
      run(t)+(bookmark?'<w:bookmarkEnd w:id="'+bookmark+'"/>':'')+'</w:p>';
  }
  const align=s=>'<w:jc w:val="'+s+'"/>';
  const page='<w:p><w:pPr><w:spacing w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  const heading=t=>p(t,'Heading2');
  const note=t=>p(t,'Guide');
  const gap='<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>';
  const blank='____________________';
  function table(rows,widths,{header=true}={}){
    const borders=['top','left','bottom','right','insideH','insideV'].map(k=>'<w:'+k+' w:val="single" w:sz="6" w:color="222222"/>').join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="9072" w:type="dxa"/><w:tblBorders>'+borders+'</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="105" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="105" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+
      widths.map(x=>'<w:gridCol w:w="'+x+'"/>').join('')+'</w:tblGrid>'+
      rows.map((row,i)=>'<w:tr><w:trPr><w:cantSplit/>'+(header&&i===0?'<w:tblHeader/>':'')+'</w:trPr>'+
        row.map((v,j)=>'<w:tc><w:tcPr><w:tcW w:w="'+widths[j]+'" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>'+p(v,header&&i===0?'CellHead':'Cell')+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
  }
  const fields=rows=>table(rows,[2300,6772],{header:false});
  const day=f=>f.date?f.date.replace(/^(\d{4})-(\d\d)-(\d\d)$/u,'$1 年 $2 月 $3 日'):'____ 年 ____ 月 ____ 日';
  const sig=(f,labels)=>gap+labels.map(label=>p(label+blank,'Right')).join('')+p('日　期：'+day(f),'Right');
  function style(id,name,props,rp=''){
    return '<w:style w:type="paragraph" w:styleId="'+id+'"><w:name w:val="'+name+'"/>'+ (id==='Normal'?'':'<w:basedOn w:val="Normal"/>')+
      (props?'<w:pPr>'+props+'</w:pPr>':'')+(rp?'<w:rPr>'+rp+'</w:rPr>':'')+'</w:style>';
  }
  const spacing=(after,before=0,line=360)=>'<w:spacing w:before="'+before+'" w:after="'+after+'" w:line="'+line+'" w:lineRule="auto"/>';
  const font=(size,face='宋体',bold=false,color='000000')=>'<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="'+face+'" w:cs="Times New Roman"/>'+
    (bold?'<w:b/>':'')+'<w:color w:val="'+color+'"/><w:sz w:val="'+2*size+'"/><w:szCs w:val="'+2*size+'"/>';
  const styles=XML+'<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr>'+font(12)+'<w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults>'+
    style('Normal','Normal',spacing(125),font(12))+style('Title','Title','<w:keepNext/>'+spacing(520,2600,430)+align('center'),font(20,'宋体',true))+
    style('TitleCompact','Long Project Title','<w:keepNext/>'+spacing(420,2200,395)+align('center'),font(17,'宋体',true))+style('CoverTitle','Cover Title','<w:keepNext/>'+spacing(1280,140,450)+align('center'),font(26,'黑体',true))+
    style('CoverField','Cover Field',spacing(330,0,370)+align('center'),font(12))+
    style('Heading1','heading 1','<w:keepNext/>'+spacing(300,200)+align('center')+'<w:outlineLvl w:val="0"/>',font(16,'黑体',true))+
    style('Heading2','heading 2','<w:keepNext/>'+spacing(160,180)+'<w:outlineLvl w:val="1"/>',font(14,'黑体',true))+
    style('Contents','Contents','<w:keepNext/>'+spacing(380,200)+align('center'),font(16,'黑体',true))+
    style('TocLine','TOC Item',spacing(215,0)+'<w:ind w:left="1260"/>',font(12))+
    style('Guide','Guide',spacing(150),font(10,'宋体',false,'555555'))+
    style('Cell','Table Cell',spacing(0,0,305),font(10.5))+
    style('CellHead','Table Header',spacing(0,0,305)+align('center'),font(10.5,'宋体',true))+
    style('Right','Closing',spacing(140)+align('right'),font(12))+'</w:styles>';
  function build(input){
    const f=normalize(input),Q=root.QuoteLayouts||(typeof module==='object'&&module.exports?require('./quote-layouts.js'):null);
    if(!Q?.packOfficeParts)throw Error('Word 生成组件未加载。');
    const pages=sections.map((name,i)=>p(name,'Heading1','',i+1));
    const info=[['项目名称',f.projectName],['招标编号',f.number||blank],...(f.packageName?[['标包',f.packageName]]:[])];
    const contact=[['联系人',f.contact||blank],['电话',f.phone||blank],['邮箱',f.email||blank]];
    const reply=p('致：'+f.issuer+'：')+p('我方拟就「'+f.projectName+'」编制投标响应。以下材料须根据本项目招标文件及最终响应逐项核对。')+
      fields([...info,['投标人',f.firmName],['授权代表／职务',blank],['通讯地址',blank],...contact])+sig(f,['投标人（盖章）：','法定代表人或其委托代理人（签字）：'])+
      page+heading('附：开标一览表')+p('项目名称：'+f.projectName)+p('招标编号：'+(f.number||blank))+
      table([['投标人名称','投标报价（元）','投标保证金金额','备注'],
        [f.firmName,f.formalOne?'1':'待按本项目文件填写',blank,f.formalOne?'形式报价，不作为实际服务报价':'待核对']],[3000,1850,2050,2172])+
      note(f.formalOne?'已按 FWE008 示例启用 1 元形式报价，仅用于明确采用该口径的项目；不取自审迹报价单。':'未带入审迹议价金额。按本项目正式招标文件核对并填写；投标保证金不是服务报价。');
    const identity=p('投标人：'+f.firmName)+fields([['法定代表人姓名',blank],['性别／年龄',blank],['职务',blank]])+
      note('待核验法定代表人身份与证明内容，按本项目要求插入证件复印件。')+sig(f,['投标人（盖章）：']);
    const delegation=p('委托单位：'+f.firmName)+p('授权事项：就「'+f.projectName+'」办理经正式授权的投标事宜。授权范围及期限以签署后的文件为准。')+
      fields([['法定代表人姓名',blank],['委托代理人姓名',blank],['授权范围及期限',blank],['双方证件信息','在 Word 中按要求补填']])+
      sig(f,['投标人（盖章）：','法定代表人（签字）：','委托代理人（签字）：'])+note('按招标文件要求附身份和授权证明；未经签署，本页不构成授权。');
    const deposit=fields([['要求金额（元）',blank],['提交方式',blank],['凭证编号／日期',blank]])+note('请按本项目要求插入实际缴款凭证及相关证明；本草稿不表示保证金已缴纳。');
    const qualification=heading('（一）投标人基本情况表')+
      fields([['投标人名称',f.firmName],['成立日期／企业性质',blank],['注册地址／注册资金',blank],['法定代表人',blank],['统一社会信用代码',blank],['经营范围',blank],...contact,['人员、职称及注册会计师统计',blank],['设备及办公条件',blank]])+
      note('待附营业执照、执业证书及本项目要求的其他资格证明；此处不自动嵌入投标方库资料。')+
      heading('（二）近三年财务状况')+note('按要求补充对应年度财务证明；核对期间、文件范围与原件。')+
      page+heading('（三）近年完成的类似项目情况表')+
      table([['序号','项目名称','项目业主','金额（万元）','起止日期','备注'],['1','','','','',''],['2','','','','','']],[650,2350,1800,1450,1700,1122])+
      note('仅填可核实的同类业绩，按要求附相应证明材料。')+
      heading('（四）从业人员结构与资历')+p('注册会计师简历（每人一表，可复制）：','Heading2')+
      fields([['姓名／拟任职务',blank],['专业／职称',blank],['执业资格／证书编号',blank]])+
      table([['项目名称','项目业主','规模／服务期','担任职务','完成情况'],['','','','','']],[1980,1750,1950,1460,1932])+
      p('其他执业人员情况表','Heading2')+
      table([['序号','姓名','专业／职称','证书编号','从业经历及业绩'],['1','','','','']],[620,1350,2090,1800,3212])+
      note('证照、个人身份及劳动／社保资料请按本项目要求在本地核对和补充。');
    const solution=['服务目标与范围','相关经验与业务能力','项目人员配置与职责','工作程序、时间安排及交付','人员、财务、质量控制与档案制度','风险控制、沟通机制与服务建议'].map(t=>heading(t)+p(blank)).join('');
    const other=p('请按本项目文件及响应情况补充其他资料，在此列示附件名称和页码。')+
      table([['序号','附件名称','页码','备注'],['1','','',''],['2','','','']],[820,4070,1100,3082]);
    const deviation=note('请核对实际响应后填写负偏离条目及对应页码；本草稿不自动声明「无偏离」。')+
      table([['招标条目／页码','招标条款','投标条款／页码','偏离内容','影响范围'],['','','','',''],['','','','','']],[1610,1860,1910,1850,1842]);
    const undertaking=p('投标人：'+f.firmName)+p('项目名称：'+f.projectName)+note('请以本项目正式招标文件所附准入承诺书为准，逐条核验后补入正文。此页不是已作出的承诺。')+
      p('承诺书正文：')+p(blank)+sig(f,['投标人（盖章）：','法定代表人或其委托代理人（签字）：']);
    const chapterContent=[reply,identity,delegation,deposit,qualification,solution,other,deviation,undertaking];
    const cover=p(f.projectName,f.projectName.length>43?'TitleCompact':'Title')+p('投 标 文 件','CoverTitle')+
      p('投标人：'+f.firmName+'（单位盖章处）','CoverField')+p('招标编号：'+(f.number||blank),'CoverField')+
      (f.packageName?p('标包：'+f.packageName,'CoverField'):'')+
      p('法定代表人或其委托代理人（签字）：'+blank,'CoverField')+p('投标日期：'+day(f),'CoverField')+
      p('无章草稿 · 待补材料与核对','Guide',align('center'));
    const contents=p('目　录','Contents')+sections.map((t,i)=>'<w:p><w:pPr><w:pStyle w:val="TocLine"/></w:pPr><w:hyperlink w:anchor="chapter'+(i+1)+'" w:history="1">'+run(t)+'</w:hyperlink></w:p>').join('')+
      note('目录可跳转。补充证据后请在最终 Word 中更新页码、检查招标要求、完成签署及复核。');
    const body=cover+page+contents+pages.map((h,i)=>page+h+chapterContent[i]).join('');
    const contentType='application/vnd.openxmlformats-officedocument.wordprocessingml.';
    const types=XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
      [['document','document.main'],['styles','styles'],['footer1','footer']].map(([file,type])=>'<Override PartName="/word/'+file+'.xml" ContentType="'+contentType+type+'+xml"/>').join('')+'</Types>';
    const rootRels=XML+'<Relationships xmlns="'+PKG+'"><Relationship Id="rId1" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels=XML+'<Relationships xmlns="'+PKG+'"><Relationship Id="rIdStyles" Type="'+R+'/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="'+R+'/footer" Target="footer1.xml"/></Relationships>';
    const doc=XML+'<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>'+
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const footer=XML+'<w:ftr xmlns:w="'+W+'"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr=" PAGE ">'+run('1')+'</w:fldSimple></w:p></w:ftr>';
    const bytes=Q.packOfficeParts({'[Content_Types].xml':types,'_rels/.rels':rootRels,'word/document.xml':doc,'word/styles.xml':styles,'word/footer1.xml':footer,'word/_rels/document.xml.rels':docRels});
    return Object.freeze({name:'投标文件-准入标书-无章草稿.docx',mime,bytes});
  }
  const api=Object.freeze({sections,build});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BidDraft=api;
})(globalThis);
