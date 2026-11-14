/* A single active subject drives the existing calculator. Other rows are inputs, not a consolidated quote. */
(function(root){
  'use strict';
  const LIMIT=50,limits={clientName:100,location:64,year:16,assets:48,revenue:48,profit:48,dataPeriod:100};
  const keys=Object.keys(limits),owns=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  function validRow(row){
    return row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===keys.length&&keys.every(k=>
      owns(row,k)&&typeof row[k]==='string'&&row[k].length<=limits[k]&&!/[\u0000-\u001f\u007f]/.test(row[k]));
  }
  function valid(v){
    return !!(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===2&&owns(v,'rows')&&owns(v,'active')&&
      Array.isArray(v.rows)&&v.rows.length>0&&v.rows.length<=LIMIT&&Number.isInteger(v.active)&&v.active>=0&&v.active<v.rows.length&&
      Array.from(v.rows).every(validRow));
  }
  function checked(rows,active){if(!valid({rows,active}))throw Error('被审计方列表格式无效（1–50 行），请核对字段和当前主体。');}
  const empty=()=>Object.fromEntries(keys.map(k=>[k,'']));
  function mount({getClient,onSelect,onEdit}){
    const host=root.document.getElementById('auditee-list');if(!host)throw Error('缺少被审计方列表容器');
    const doc=host.ownerDocument;
    let rows=[empty()],active=0;
    const make=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
    const btn=(text,attribute,value,cls)=>{const b=make('button',text,cls||'btn');b.type='button';b.setAttribute('data-auditee-'+attribute,value);return b;};
    const scroll=make('div',undefined,'table-scroll');const table=make('table',undefined,'auditee-table'), cap=make('caption','被审计方清单 · 金额单位：万元');
    cap.style.cssText='text-align:left;font-weight:600;padding:.7rem 0;color:inherit';table.append(cap);
    const tr=make('tr'),head=make('thead');for(const name of ['被审计方名称','客户所在地','审计年度','资产总额','营业收入','净利润','财务数据期间','操作']){const th=make('th',name);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
    const tbody=make('tbody');table.append(tbody);scroll.append(table);
    const periodLabel=make('label','当前主体的财务数据期间　');const period=make('input');
    period.type='text';period.maxLength=limits.dataPeriod;period.placeholder='如：2025 年度，待核也可留空';period.setAttribute('data-auditee-period','');periodLabel.append(period);
    const footer=make('div',undefined,'form-foot');const add=btn('＋ 添加被审计方','add','');const message=make('span',undefined,'muted');
    message.setAttribute('aria-live','polite');footer.append(add,message);
    host.replaceChildren(scroll,periodLabel,footer);
    function render(){
      tbody.replaceChildren();rows.forEach((r,i)=>{
        const tr=make('tr');const current=i===active;tr.setAttribute('data-auditee-row',String(i));if(current){tr.setAttribute('aria-current','true');tr.style.background='#eff7f3';}
        for(const [key] of Object.entries(limits)){const cell=make('td',r[key]||'—');if(key==='clientName'&&current)cell.style.fontWeight='700';tr.append(cell);}
        const td=make('td');td.style.whiteSpace='nowrap';const choose=btn(current?'测算中':'用于测算','select',String(i),'text-button');
        choose.disabled=current;choose.setAttribute('aria-label',(current?'正在测算':'选用')+'第'+(i+1)+'行');const del=btn('删除','remove',String(i),'text-button');del.disabled=rows.length===1;del.setAttribute('aria-label','删除第'+(i+1)+'个被审计方');
        td.append(choose,doc.createTextNode('　'),del);tr.append(td);tbody.append(tr);
      });
      if(period.value!==rows[active].dataPeriod)period.value=rows[active].dataPeriod;
      add.disabled=rows.length>=LIMIT;
      message.textContent='共 '+rows.length+' / '+LIMIT+' 个主体，当前测算第 '+(active+1)+' 行。编辑本行数据请使用被审计方信息表单；汇总报价请到「报价单」填写逐户价格。';
    }
    function syncClient(c){
      if(!c||typeof c!=='object')throw Error('缺少被审计方字段');
      const next={...rows[active]};
      // dataPeriod belongs to this table. A client-only form cannot erase it.
      for(const k of keys)if(k!=='dataPeriod'&&owns(c,k))next[k]=c[k];
      if(!validRow(next))throw Error('被审计方字段类型无效或过长。');
      if(keys.some(k=>next[k]!==rows[active][k])){rows[active]=next;render();}
    }
    function notify(selected){
      render();if(selected)onSelect({...rows[active]});onEdit();
    }
    host.addEventListener('click',event=>{
      const button=event.target.closest?.('button');if(!button||!host.contains(button)||button.disabled)return;
      if(button.hasAttribute('data-auditee-add')){
        if(rows.length>=LIMIT)return;
        rows.push(empty());active=rows.length-1;notify(true);return;
      }
      const select=button.hasAttribute('data-auditee-select'),remove=button.hasAttribute('data-auditee-remove');
      if(!select&&!remove)return;
      const i=Number(button.getAttribute(select?'data-auditee-select':'data-auditee-remove'));
      if(!Number.isInteger(i)||i<0||i>=rows.length)return;
      if(select&&i!==active){active=i;notify(true);return;}
      if(remove&&rows.length>1&&root.confirm('删除第 '+(i+1)+' 行被审计方？其他主体的资料不变。')){
        const removedActive=i===active;
        rows.splice(i,1);if(i<active)active--;else if(removedActive)active=Math.min(active,rows.length-1);
        notify(removedActive);
      }
    });
    period.addEventListener('input',()=>{
      const text=period.value;if(text.length>limits.dataPeriod||/[\u0000-\u001f\u007f]/.test(text)){period.value=rows[active].dataPeriod;return;}
      if(text===rows[active].dataPeriod)return;
      rows[active].dataPeriod=text;tbody.rows[active].cells[6].textContent=text||'—';onEdit();
    });
    syncClient(getClient());render();
    return {load(next,index=0){checked(next,index);rows=next.map(r=>({...r}));active=index;render();},
      snapshot(){return {rows:rows.map(r=>({...r})),active};},syncClient};
  }
  root.AuditeeRows=Object.freeze({mount,valid});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.AuditeeRows;
})(globalThis);
