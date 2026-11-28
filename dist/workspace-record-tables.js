/* Presentation only. Keep every record row mounted for editing and persistence. */
(function(root){
  'use strict';
  const money='money', decimal='decimal', integer='integer';
  const tables=[
    ['.pi-summary-table','项目汇总表',{6:money}],
    ['.quote-estimates-table','招投标记录',{},true],
    ['.estimate-detail-table','含税报价明细',{1:money,2:money}],
    ['.ledger-table','报价历史',{5:money}],
    ['.auditee-table','被审计方清单',{3:decimal,4:decimal,5:decimal}],
    ['#quote-batch table','多单位报价',{2:money}],
    ['#rules-form table','收费标准分档'],
    ['.af-summary table','底稿进度统计'],
    ['.aa-table-wrap table','归档附件关联'],
    ['#audit-templates table','底稿模板目录',{4:integer}],
    ['.at-root table','模板目录'],
    ['.swp-directory table','补充底稿目录'],
    ['.swp-root table','补充底稿原件'],
    ['.rw-table','报表数据衔接'],
    ['.pw-directory','底稿目录'],
    ['.pr-table','项目登记与附件',{7:money,8:money}],
    ['.pc-table','项目成本核算',{4:money,5:money,6:money,7:money,8:money,9:money}],
    ['.te-table-wrap table','费用报销',{5:money}]
  ];
  const selector=tables.map(([value])=>value).join(',');
  const wrappers='.table-scroll,.aa-table-wrap,.at-table-wrap,.swp-table-wrap,.rw-table-wrap,.pw-table-wrap,.pr-scroll,.pc-scroll,.te-table-wrap';
  const controllers=new WeakMap();
  function readNumber(cell,kind){
    if(!cell)return null;
    const input=cell.querySelector('input:is([type=text],[type=number]):not([hidden])');
    const value=(input?.dataset.recordAmount??input?.value??cell.textContent).trim().normalize('NFKC').replace(/^[¥￥]\s*/u,'').replace(/,/gu,'');
    const match=/^(-?)(\d{1,24})(?:\.(\d{1,6}))?$/u.exec(value);
    if(!match||kind===money&&match[3]?.length>2||kind===integer&&match[3])return null;
    return BigInt(match[1]+match[2]+(match[3]||'').padEnd(6,'0'));
  }
  function format(value,kind){
    const magnitude=value<0n?-value:value;
    const whole=(magnitude/1000000n).toLocaleString('en-US');
    const digits=String(magnitude%1000000n).padStart(6,'0');
    const fraction=kind===money?digits.slice(0,2):kind===decimal?digits.replace(/0+$/u,''):'';
    return (value<0n?'−':'')+(kind===money?'¥ ':'')+whole+(fraction?'.'+fraction:'');
  }
  function pageNumbers(page,count){
    if(count<=7)return Array.from({length:count},(_,i)=>i+1);
    const start=Math.max(2,Math.min(page-2,count-5));
    const end=Math.min(start+4,count-1);
    const middle=Array.from({length:end-start+1},(_,i)=>start+i);
    return [1,...(start>2?[null]:[]),...middle,...(end<count-1?[null]:[]),count];
  }
  function create(table,spec,sizes){
    const [,label,columns={},native]=spec;
    const doc=table.ownerDocument,make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
    let scroll=table.parentElement;
    if(!scroll.matches(wrappers)){
      const wrap=make('div');table.before(wrap);wrap.append(table);scroll=wrap;
    }
    scroll.classList.add('record-table-scroll');
    scroll.setAttribute('tabindex','0');
    if(!scroll.hasAttribute('role'))scroll.setAttribute('role','region');
    if(!scroll.hasAttribute('aria-label')&&!scroll.hasAttribute('aria-labelledby'))scroll.setAttribute('aria-label',label+'表格区');
    if(native)return {refresh(){}};
    const footer=table.tFoot||table.createTFoot(),summary=make('tr'),pager=make('nav');
    footer.classList.add('record-table-total');
    footer.replaceChildren(summary);
    pager.className='record-table-pagination';pager.setAttribute('aria-label',label+'分页');
    pager.append(doc.getElementById('record-page-size-control').content.cloneNode(true));
    const sizeSelect=pager.querySelector('select'),buttons=make('span');
    sizeSelect.value=sizes.get(label)||sizeSelect.value;
    sizeSelect.onchange=()=>{
      sizes.set(label,sizeSelect.value);
      go(1,false);
    };
    buttons.className='record-page-buttons';
    pager.append(buttons);
    scroll.after(pager);
    const numeric=Object.entries(columns).map(([index,kind])=>[Number(index),kind]);
    let current=1,count=1,records=[];
    function go(page,focus){
      current=Math.max(1,Math.min(page,count));scroll.scrollTop=0;refresh();
      if(focus)pager.querySelector('[aria-current=page]')?.focus({preventScroll:true});
    }
    function drawPager(){
      const button=(title,page,disabled=false)=>{
        const item=make('button',title);item.type='button';item.className='btn';
        item.disabled=disabled;item.onclick=()=>go(page,true);return item;
      };
      const pages=pageNumbers(current,count).map(page=>{
        if(page===null){const ellipsis=make('span','…');ellipsis.setAttribute('aria-hidden','true');return ellipsis;}
        const item=button(String(page),page);
        item.setAttribute('aria-label','第 '+page+' 页');
        if(page===current)item.setAttribute('aria-current','page');
        return item;
      });
      buttons.replaceChildren(button('上一页',current-1,current===1),...pages,button('下一页',current+1,current===count));
    }
    function refresh(focusedRow){
      const head=table.tHead?.rows[0]||table.rows[0];
      if(!head)return;
      const width=[...head.cells].reduce((total,cell)=>total+cell.colSpan,0);
      if(!width)return;
      records=[...table.rows].filter(row=>row!==head&&row.parentElement!==table.tHead&&row.parentElement!==footer&&
        !row.hidden&&row.cells.length>1&&[...row.cells].some(cell=>cell.tagName==='TD'));
      const pageSize=Number(sizeSelect.value);
      const totalPages=Math.max(1,Math.ceil(records.length/pageSize));
      const focused=records.indexOf(focusedRow);
      const next=focused>=0?Math.floor(focused/pageSize)+1:Math.min(current,totalPages);
      const redraw=count!==totalPages||current!==next||!buttons.firstChild||pager.querySelector('[aria-current=page]')?.textContent!==String(next);
      current=next;count=totalPages;
      const first=(current-1)*pageSize;
      for(const [i,row] of records.entries())row.toggleAttribute('data-record-page-away',i<first||i>=first+pageSize);
      for(const row of table.querySelectorAll('tr[hidden][data-record-page-away]'))row.removeAttribute('data-record-page-away');
      if(redraw)drawPager();
      const valid=numeric.filter(([index])=>index<width);
      const labelCell=make('th');labelCell.scope='row';labelCell.append(doc.createTextNode('合计 '),make('small','（'+records.length+' 条）'));
      labelCell.colSpan=valid[0]?.[0]||width;
      const cells=[labelCell];
      for(let i=labelCell.colSpan;i<width;i++){
        const cell=make('td'),kind=columns[i];
        if(kind){
          let total=0n,known=0;
          for(const row of records){
            const amount=readNumber(row.cells[i],kind);
            if(amount!==null){total+=amount;known++;}
          }
          cell.textContent=known?format(total,kind):'—';
          cell.className='record-table-number';
          if(known<records.length)cell.title='包含 '+known+' 条已填数值，另有 '+(records.length-known)+' 条未计入';
        }
        cells.push(cell);
      }
      summary.replaceChildren(...cells);
    }
    return {refresh,reveal:row=>{refresh(row);row.scrollIntoView?.({block:'nearest'});}};
  }
  function mount(host){
    const pending=new Set(),sizes=new Map();
    const scan=node=>{
      if(node.matches?.(selector))pending.add(node);
      for(const table of node.querySelectorAll?.(selector)||[])pending.add(table);
    };
    function update(){
      for(const table of pending){
        if(!host.contains(table))continue;
        let controller=controllers.get(table);
        if(!controller){
          const spec=tables.find(([key])=>table.matches(key));
          if(!spec||!table.rows.length)continue;
          controller=create(table,spec,sizes);controllers.set(table,controller);
        }
        const active=host.ownerDocument.activeElement;
        controller.refresh(table.contains(active)?active.closest('tbody tr'):null);
      }
      pending.clear();
    }
    scan(host);update();
    const observer=new root.MutationObserver(changes=>{
      for(const change of changes){
        const element=change.target.nodeType===1?change.target:change.target.parentElement;
        if(!element||element.closest('.record-table-total,.record-table-pagination'))continue;
        const table=element.closest(selector);
        if(table)pending.add(table);
        for(const node of change.addedNodes)if(node.nodeType===1)scan(node);
      }
      update();
    });
    observer.observe(host,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
    const sync=event=>controllers.get(event.target.closest?.('table'))?.refresh();
    host.addEventListener('input',sync);host.addEventListener('change',sync);
    host.addEventListener('invalid',event=>controllers.get(event.target.closest?.('table'))?.reveal?.(event.target.closest('tr')),true);
  }
  root.WorkspaceRecordTables=Object.freeze({mount,reveal(row){if(row)controllers.get(row.closest('table'))?.reveal?.(row);}});
})(globalThis);
