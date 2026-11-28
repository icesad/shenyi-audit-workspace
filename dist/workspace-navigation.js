/* Presentation/navigation only. No storage keys, business writes or account requests. */
(function(root){'use strict';
 function mount({document:D,setView,getView,notify=()=>{},onReportSection=null,onAuditStep=null}){
  if(!D||typeof setView!=='function'||typeof getView!=='function')throw Error('Navigation not ready');
  let selected=null;
  const nav=D.querySelector('.workspace-navigation');
  const groups={quote:'quote',proposal:'quote',bid:'quote',ledger:'quote',project:'quote',audit:'audit',report:'report',archive:'report',templates:'basics','general-templates':'basics',standards:'basics',travel:'accounting',costs:'accounting',basics:'basics',bidders:'basics',rules:'basics'};
  function sync(name,choice=null){
   selected=choice;
   for(const group of D.querySelectorAll('.nav-group')){
    const active=group.dataset.navGroup===groups[name];group.classList.toggle('is-current',active);
    if(active&&group.tagName==='DETAILS')group.open=true;
   }
   const native=D.querySelector('.pw-steps [data-audit-step][aria-pressed="true"]');
   const overview=D.querySelector('#audit-flow:not([hidden])');
   for(const b of nav?.querySelectorAll('[data-view]')||[]){
    let active=b.dataset.view===name;
    if(active&&b.hasAttribute('data-nav-audit-step'))active=!overview&&b.dataset.navAuditStep===(native?.dataset.auditStep||'1');
    else if(active&&b.hasAttribute('data-audit-overview'))active=!!overview;
    else if(active&&choice)active=b===choice;
    else if(active&&(b.hasAttribute('data-nav-section')||b.hasAttribute('data-report-section')))active=false;
    b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
   }
   if(name==='audit')onAuditStep?.();
  }
  function click(event){
   const b=event.target.closest?.('[data-nav-audit-step],[data-nav-section],[data-report-section]');if(!b||!nav?.contains(b))return;
   if(b.disabled)return;
   if(b.hasAttribute('data-report-section')){
    if(setView('report')===false)return;if(onReportSection&&onReportSection(b.dataset.reportSection)===false)return;sync('report',b);
    D.getElementById('report-'+b.dataset.reportSection)?.scrollIntoView?.({block:'start'});
    return;
   }
   if(b.hasAttribute('data-nav-audit-step')){
    const step=b.dataset.navAuditStep;if(!/^[1-9]$/.test(step))return;
    const target=D.querySelector('.pw-steps [data-audit-step="'+step+'"]');
    if(!target||target.disabled){notify('工作底稿组件正忙或尚未就绪，请稍候重试。');return;}
    // The native button owns the unsaved-work confirmation. Never change stage
    // or clear edits here; a cancelled native click leaves navigation unchanged.
    target.click();
    if(target.getAttribute('aria-pressed')!=='true')return;
    setView('audit',{auditStepSelected:step!=='1',auditDetail:true});sync('audit',b);
    D.querySelector('.pw-steps')?.scrollIntoView?.({block:'start'});
    return;
   }
   const id=b.dataset.navSection,target=D.getElementById(id);
   if(!target||!target.closest('#view-'+b.dataset.view))return;
   setView(b.dataset.view);sync(b.dataset.view,b);target.scrollIntoView?.({block:'start'});
  }
  nav?.addEventListener('click',click);
  const steps=D.querySelector('.pw-steps');
  const observer=steps&&typeof root.MutationObserver==='function'?new root.MutationObserver(()=>sync(getView(),selected)):null;
  observer?.observe(steps,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
  sync(getView());
  return Object.freeze({sync,destroy(){nav?.removeEventListener('click',click);observer?.disconnect();}});
 }
 root.WorkspaceNavigation=Object.freeze({mount});
})(globalThis);
