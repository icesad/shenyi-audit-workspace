/* Project quote detail: independent estimates per auditee with explicit row overrides. */
(function(root){
  'use strict';
  const K=['assets','revenue','profit'];
  const names={assets:'资产总额',revenue:'累计收入',profit:'净利润'};
  function cents(n){
    if(!/^\d{1,14}(?:\.\d{1,2})?$/.test(n))throw Error('请输入非负金额，最多两位小数');
    const [a,b='']=n.split('.'),v=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
    if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error('金额超出可处理范围');
    return Number(v);
  }
  function money(c){return (BigInt(c)/100n).toString()+'.'+String(BigInt(c)%100n).padStart(2,'0');}
  const id=r=>JSON.stringify([r.clientName.normalize('NFKC').trim(),r.year.trim()]);
  const basis=r=>JSON.stringify([r.assets,r.revenue,r.profit,r.dataPeriod,r.location]);
  function taxBasis(rate){
    rate=String(rate).trim();
    if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(rate))throw Error('另计税率须为 0 至 100、最多两位小数');
    const [a,b='']=rate.split('.'),v=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
    if(v>10000n)throw Error('另计税率须为 0 至 100');
    return 10000n+v;
  }
  function hasBreakdown(v){
    return Number.isSafeInteger(v?.totalCents)&&Number.isSafeInteger(v.subtotalCents)&&v.subtotalCents>=0&&
      Number.isSafeInteger(v.taxCents)&&v.taxCents>=0&&v.taxCents===v.totalCents-v.subtotalCents;
  }
  function capture(rows,amounts,rate,estimates=[]){
    if(rows.length<2||rows.length>50)throw Error('汇总报价需要 2 至 50 家单位');
    const denom=taxBasis(rate),seen=new Set(),years=new Set();let subtotal=0n,total=0n;
    const quoteRows=rows.map((row,i)=>{
      const name=row.clientName.trim(),key=id(row),label='第 '+(i+1)+' 家'+(name?'（'+name+'）':'');
      if(!name)throw Error(label+'缺少单位名称');
      if(!/^\d{4}$/.test(row.year)||Number(row.year)<2000||Number(row.year)>2100)throw Error(label+'缺少有效审计年度');
      years.add(row.year);if(seen.has(key))throw Error(label+'与清单内的名称及年度重复');seen.add(key);
      const metrics=Object.fromEntries(K.map(k=>{
        const v=row[k].trim();
        if(v&&(!(k==='profit'?/^-?\d{1,9}(?:\.\d{1,6})?$/:/^\d{1,9}(?:\.\d{1,6})?$/).test(v)||Math.abs(Number(v))>900000000))throw Error(label+names[k]+'无效');
        return [k,v];
      }));
      const value=amounts.get(key);
      const override=value?.basis===basis(row)?value:null,estimate=estimates[i];
      let price;
      if(override){
        if(!override.raw.trim())throw Error('请填写'+label+'的含税报价，或恢复自动测算');
        try{price=cents(override.raw.trim());}catch(e){throw Error(label+'：'+e.message);}
      }else if(Number.isSafeInteger(estimate?.totalCents)&&estimate.totalCents>=0){
        price=estimate.totalCents;
      }else if(estimate?.error)throw Error(label+'未能自动报价：'+estimate.error+'，可手工填写含税报价');
      else throw Error('请填写'+label+'的含税报价');
      total+=BigInt(price);
      subtotal+=!override&&hasBreakdown(estimate)?BigInt(estimate.subtotalCents):(BigInt(price)*10000n+denom/2n)/denom;
      return {name,...metrics,period:row.dataPeriod.trim(),totalCents:price};
    });
    if(years.size!==1)throw Error('同一张汇总报价单须使用同一审计年度；请分开登记不同年度');
    if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error('报价合计超出可处理范围');
    return {quoteRows,auditYear:Number([...years][0]),subtotalCents:Number(subtotal),taxCents:Number(total-subtotal),totalCents:Number(total)};
  }
  function mount(host,{getRegister,getFinal,getTax,onChange,format,estimateRow,getEstimateKey}){
    const doc=host.ownerDocument,el=(tag,text)=>{const x=doc.createElement(tag);if(text!==undefined)x.textContent=text;return x;};
    const scope=el('select'),scopeLabel=el('label','报价单范围 '),hint=el('p'),status=el('p'),group=el('div'),wrap=el('div'),table=el('table'),head=el('thead'),hr=el('tr'),body=el('tbody'),use=el('button','带入当前单位的测算价');
    const amounts=new Map();let previous='',policyKey='',single=false,reg={rows:[],active:0},estimates=[],controls=[];
    scope.id='quote-scope';scopeLabel.htmlFor=scope.id;scopeLabel.append(scope);
    for(const [v,n] of [['batch','全部被审计方（逐家报价并汇总）'],['single','仅当前被审计方']]){const o=el('option',n);o.value=v;scope.append(o);}
    hint.className='muted';hint.textContent=estimateRow
      ?'系统按各家数据分别测算含税报价，可逐家修改。缺少可用规则的单位不会按零元或复制他家报价。附加费用不自动摊入各户。修改测算设置或本行资料后会重新计算；登记报价会保存明细。'
      :'填写每家最终含税报价，或逐家带入当前测算价。空白不作零元，系统不复制其他单位金额。登记报价会保存明细；计算草稿不保存此处输入。';
    status.id='quote-batch-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    use.id='quote-use-active-price';use.className='btn';use.type='button';
    wrap.className='table-scroll';for(const h of ['序号','被审计方','含税报价（元）']){const th=el('th',h);th.scope='col';hr.append(th);}
    head.append(hr);table.append(head,body);wrap.append(table);group.append(hint,wrap,use,status);host.append(scopeLabel,group);
    function active(){return reg.rows.length>1&&!single;}
    function report(){
      if(!active())return;
      let next;
      try{const result=capture(reg.rows,amounts,getTax(),estimates);next='已填齐 '+result.quoteRows.length+' 家，合计 '+format(result.totalCents)+'。';}
      catch(e){next=e.message+'。';}
      if(status.textContent!==next)status.textContent=next;
      use.disabled=!getFinal()||!reg.rows[reg.active]?.clientName.trim();
    }
    function estimate(row,i){
      if(!estimateRow)return null;
      if(!row.clientName.trim())return {error:'缺少单位名称'};
      try{
        const v=estimateRow(row,i);
        if(Number.isSafeInteger(v?.totalCents)&&v.totalCents>=0&&!Object.is(v.totalCents,-0)){
          return {totalCents:v.totalCents,...(hasBreakdown(v)?{subtotalCents:v.subtotalCents,taxCents:v.taxCents}:{}),
            source:typeof v.source==='string'?v.source.trim().slice(0,180):''};
        }
        return {error:typeof v?.error==='string'&&v.error.trim()?v.error.trim().slice(0,180):'没有可用的测算口径'};
      }catch(e){return {error:typeof e?.message==='string'&&e.message?e.message.slice(0,180):'测算未完成'};}
    }
    function display(i){
      const r=reg.rows[i],c=controls[i],v=estimates[i],manual=amounts.get(id(r));
      if(!c)return;
      const raw=manual?manual.raw:v?.totalCents!==undefined?money(v.totalCents):'';
      if(c.input.value!==raw)c.input.value=raw;
      c.input.dataset.batchPriceOrigin=manual?'manual':v?.totalCents!==undefined?'auto':'missing';
      const line=manual?(manual.raw.trim()?'手工调整':'已清空，请重新填写或恢复自动测算')
        :v?.totalCents!==undefined?'自动测算'+(v.source?' · '+v.source:'')
        :v?.error?'未自动测算 · '+v.error:'';
      if(c.note.textContent!==line)c.note.textContent=line;
      c.revert.hidden=!manual||v?.totalCents===undefined;
    }
    function refresh(){
      reg=getRegister()||{rows:[],active:0};host.hidden=reg.rows.length<2;group.hidden=!active();scope.value=single?'single':'batch';
      const key=String(getEstimateKey?.()??'');
      if(key!==policyKey){policyKey=key;amounts.clear();}
      const alive=new Map(reg.rows.map(r=>[id(r),basis(r)]));
      for(const [k,v] of amounts)if(alive.get(k)!==v.basis)amounts.delete(k);
      estimates=active()?reg.rows.map(estimate):[];
      const signature=JSON.stringify(reg.rows);
      if(previous!==signature){
        previous=signature;body.replaceChildren();controls=[];
        reg.rows.forEach((r,i)=>{
          const tr=el('tr'),td=el('td'),input=el('input'),note=el('div'),revert=el('button','恢复自动报价');
          tr.dataset.batchRow=String(i);input.dataset.batchAmount=String(i);note.dataset.batchSource=String(i);
          input.type='text';input.inputMode='decimal';input.maxLength=17;input.placeholder='待填写';
          input.setAttribute('aria-label','第 '+(i+1)+' 家 '+(r.clientName||'未命名')+' 含税报价（元）');
          note.id='quote-batch-source-'+i;note.className='tiny';input.setAttribute('aria-describedby',note.id);
          revert.type='button';revert.className='text-button';revert.dataset.batchAuto=String(i);
          controls[i]={input,note,revert};
          input.addEventListener('input',()=>{amounts.set(id(r),{basis:basis(r),raw:input.value});display(i);report();onChange();});
          revert.addEventListener('click',()=>{amounts.delete(id(r));display(i);report();onChange();});
          td.append(input,note,revert);tr.append(el('td',String(i+1)),el('td',r.clientName||'待填写单位名称'),td);body.append(tr);
        });
      }
      reg.rows.forEach((_,i)=>display(i));report();
    }
    scope.addEventListener('change',()=>{single=scope.value==='single';refresh();onChange();});
    use.addEventListener('click',()=>{
      const row=reg.rows[reg.active],result=getFinal();if(!result||!row?.clientName.trim())return;
      amounts.set(id(row),{basis:basis(row),raw:money(result.totalCents)});
      display(reg.active);report();onChange();
    });
    return Object.freeze({refresh,active,capture:()=>capture(reg.rows,amounts,getTax(),estimates),reset(){amounts.clear();estimates=[];previous='';single=false;}});
  }
  const api=Object.freeze({mount,capture});
  root.BatchQuote=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
