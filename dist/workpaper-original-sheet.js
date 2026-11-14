/* Native worksheet geometry: no synthetic row headers, grid borders or extra answer boxes. */
(function(root){'use strict';
 function plan(sheet,layout){
  if(!layout||!layout.range||!Array.isArray(layout.cols)||!Array.isArray(layout.rows))throw Error('原表版式数据不可用');
  const {s,e}=layout.range;if(!s||!e||s.r<0||s.c<0||e.r<s.r||e.c<s.c||(e.r-s.r+1)*(e.c-s.c+1)>200000)throw Error('原表版式范围无效');
  const hc=new Set(layout.hiddenCols||[]),hr=new Set(layout.hiddenRows||[]),cols=[],rows=[],covered=new Set(),anchors=new Map();
  for(let c=s.c;c<=e.c;c++)if(!hc.has(c))cols.push(c);
  for(const m of layout.merges||[]){const visibleCols=cols.filter(c=>c>=m.s.c&&c<=m.e.c),visibleRows=[];for(let r=Math.max(s.r,m.s.r);r<=Math.min(e.r,m.e.r);r++)if(!hr.has(r))visibleRows.push(r);if(!visibleCols.length||!visibleRows.length)continue;
   const anchor={r:visibleRows[0],c:visibleCols[0],ref:root.WorkpaperSheets.ref(m.s.r,m.s.c),colSpan:visibleCols.length,rowSpan:visibleRows.length};anchors.set(anchor.r+':'+anchor.c,anchor);
   for(const r of visibleRows)for(const c of visibleCols)if(r!==anchor.r||c!==anchor.c)covered.add(r+':'+c);
  }
  for(let r=s.r;r<=e.r;r++){if(hr.has(r))continue;const cells=[];for(const c of cols){if(covered.has(r+':'+c))continue;const m=anchors.get(r+':'+c),ref=m?.ref||root.WorkpaperSheets.ref(r,c);cells.push({r,c,ref,colSpan:m?.colSpan||1,rowSpan:m?.rowSpan||1,style:layout.styleTable[layout.styles[ref]]||{},cell:sheet.cells[ref]||{}});}rows.push({r,height:layout.rows[r]||17,cells});}
  return {cols:cols.map(c=>({c,width:layout.cols[c]||72})),rows,range:layout.range};
 }
 function render({container,sheet,layout,edits,onChange,readOnly=false,frozen=false}){
  const doc=container.ownerDocument,p=plan(sheet,layout),table=doc.createElement('table');table.className='pw-original-sheet';table.dataset.originalSheet=sheet.name;
  const width=p.cols.reduce((n,c)=>n+c.width,0);table.style.width=width+'px';table.style.minWidth=width+'px';const group=doc.createElement('colgroup');for(const c of p.cols){const col=doc.createElement('col');col.style.width=c.width+'px';col.dataset.originalColumn=c.c;group.append(col);}table.append(group);
  for(const row of p.rows){const tr=doc.createElement('tr');tr.style.height=row.height+'px';tr.dataset.originalRow=row.r;
   for(const x of row.cells){const td=doc.createElement('td'),v=x.style;td.colSpan=x.colSpan;td.rowSpan=x.rowSpan;td.dataset.originalCell=x.ref;
    Object.assign(td.style,{fontFamily:v.fontFamily?JSON.stringify(v.fontFamily)+', "Songti SC", serif':'"SimSun", "Songti SC", serif',fontSize:(v.fontSize||14)+'px',fontWeight:v.bold?'700':'400',fontStyle:v.italic?'italic':'normal',color:v.color||'#000',backgroundColor:v.background||'transparent',textAlign:v.align||'left',verticalAlign:v.vertical||'bottom',textDecoration:v.textDecoration||'none',paddingLeft:(2+(v.indent||0)*(v.fontSize||14))+'px'});
    for(const side of ['top','right','bottom','left'])td.style['border'+side[0].toUpperCase()+side.slice(1)]=v.borders?.[side]||'none';
    const cell=doc.createElement('div');cell.className='pw-original-value';cell.dataset.cell=x.ref;cell.setAttribute('aria-label',sheet.name+'!'+x.ref);cell.style.whiteSpace=v.wrap?'pre-wrap':'pre';if(Number.isFinite(v.rotation)&&v.rotation!==0&&Math.abs(v.rotation)<=90){const height=layout.rows.slice(x.r,x.r+x.rowSpan).reduce((n,v)=>n+v,0);Object.assign(cell.style,{position:'absolute',left:'50%',top:'50%',width:Math.max(1,height-4)+'px',transform:'translate(-50%,-50%) rotate('+(-v.rotation)+'deg)',textAlign:'center'});}
    const locked=readOnly||!!(x.cell.f||x.cell.l||x.cell.array),saved=(!readOnly||frozen)&&Object.hasOwn(edits[sheet.name]||{},x.ref);cell.textContent=saved?edits[sheet.name][x.ref]:String(x.cell.w??x.cell.v??'');
    if(locked){cell.dataset.locked='true';cell.title=readOnly?(frozen?'本机核对冻结版本：只读':'原隐藏工作表：只读，不执行公式或宏'):x.cell.f?'原公式（锁定）：='+x.cell.f:x.cell.l?'原链接（锁定）：'+x.cell.l:'原数组区域（锁定）';}
    else{cell.contentEditable='true';cell.setAttribute('role','textbox');cell.setAttribute('aria-multiline','true');cell.spellcheck=false;cell.addEventListener('input',()=>{const text=cell.innerText.replace(/\r\n/g,'\n');if(!edits[sheet.name])edits[sheet.name]={};edits[sheet.name][x.ref]=text;onChange?.(x.ref,text);});cell.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData?.getData('text/plain')||'';doc.execCommand('insertText',false,text);});}
    if(x.cell.comment)cell.title+=(cell.title?'\n':'')+'原批注：'+x.cell.comment;td.append(cell);tr.append(td);
   }table.append(tr);
  }
  const canvas=doc.createElement('div');canvas.className='pw-original-canvas';canvas.style.position='relative';canvas.style.width=width+'px';canvas.append(table);container.className='pw-original-wrap';container.replaceChildren(canvas);return p;
 }
 root.WorkpaperOriginalSheet=Object.freeze({plan,render});
})(globalThis);
