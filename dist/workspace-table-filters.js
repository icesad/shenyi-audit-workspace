(function(root){
  'use strict';
  function create(scroll,selected,onChange){
    const doc=scroll.ownerDocument,view=doc.defaultView;
    const element=(tag,cls)=>{const node=doc.createElement(tag);if(cls)node.className=cls;return node;};
    const menu=element('section','estimate-filter-menu workspace-table-filter-menu');
    const title=element('h3'),options=element('div','estimate-filter-options'),search=element('input');
    menu.setAttribute('popover','auto');menu.setAttribute('role','dialog');
    search.type='search';search.placeholder='搜索选项';search.setAttribute('aria-label','搜索筛选选项');
    menu.append(title,search,options);
    const triggers=new Map();
    let anchor;
    function close(){if(menu.matches(':popover-open'))menu.hidePopover();}
    function sync(){for(const [key,trigger] of triggers)trigger.toggleAttribute('data-filter-active',selected.has(key));}
    menu.addEventListener('beforetoggle',event=>{
      if(event.newState==='closed')anchor?.setAttribute('aria-expanded','false');
    });
    scroll.addEventListener('scroll',close);
    function add(name,key,values,searchable=false){
      const trigger=element('button','estimate-filter-trigger'),label='筛选'+name;
      trigger.type='button';trigger.setAttribute('aria-label',label);
      trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
      trigger.onclick=()=>{
        if(anchor===trigger&&menu.matches(':popover-open')){close();trigger.focus();return;}
        anchor?.setAttribute('aria-expanded','false');anchor=trigger;
        title.textContent=name;menu.setAttribute('aria-label',label);
        search.value='';search.hidden=!searchable;
        const entries=typeof values==='function'?values():values;
        const normalize=value=>value.normalize('NFKC').trim().toLowerCase();
        const renderOptions=()=>{
          const keyword=normalize(search.value);
          options.replaceChildren(...[[undefined,'全部'],...entries.filter(([,value])=>normalize(value).includes(keyword))].map(([value,option])=>{
            const choice=element('button');choice.type='button';choice.textContent=option;
            choice.setAttribute('aria-pressed',String(selected.get(key)===value));
            choice.onclick=()=>{
              if(value===undefined)selected.delete(key);else selected.set(key,value);
              close();trigger.focus({preventScroll:true});sync();onChange();
            };
            return choice;
          }));
        };
        search.oninput=renderOptions;renderOptions();
        trigger.setAttribute('aria-expanded','true');menu.showPopover({source:trigger});
        const {left,top,bottom}=trigger.getBoundingClientRect(),{width,height}=menu.getBoundingClientRect();
        menu.style.left=Math.max(8,Math.min(left,view.innerWidth-width-8))+'px';
        menu.style.top=(bottom+height+5<=view.innerHeight-8?bottom+5:Math.max(8,top-height-5))+'px';
        (searchable?search:options.querySelector('[aria-pressed=true]'))?.focus({preventScroll:true});
      };
      triggers.set(key,trigger);
      return trigger;
    }
    return {menu,add,close,sync};
  }
  root.WorkspaceTableFilters=Object.freeze({create});
})(globalThis);
