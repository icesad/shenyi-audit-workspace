/* Archive paths are identifiers: never trim, rename, or normalize their components. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorkpaperFileTree=api;
})(globalThis,function(){
  'use strict';
  const names=new Intl.Collator('zh-CN',{usage:'sort',numeric:true,sensitivity:'variant',ignorePunctuation:false});
  const unsafe=/[\\:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/u;
  function components(path){
    if(typeof path!=='string'||!path||unsafe.test(path))throw Error('底稿文件路径无效。');
    const parts=path.split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'))throw Error('底稿文件路径包含无效目录名。');
    return parts;
  }
  function compare(a,b){
    // Numeric/Unicode equivalents still need a deterministic, exact-name tie break.
    return names.compare(a.name,b.name)||(a.name<b.name?-1:a.name>b.name?1:0);
  }
  /**
   * Build fresh root nodes from paths, or archive index entries with a `name` path.
   * Folders: {type,name,path,key,children}; files: {type,name,path,key,file}.
   * `file` is the original entry (or path string); input arrays/entries are untouched.
   * Paths must be relative, slash-separated file paths, not explicit directory entries.
   */
  function build(files){
    if(!Array.isArray(files))throw Error('底稿文件清单无效。');
    const roots=[],nodes=new Map();
    // Array.from also exposes sparse/undefined entries to validation.
    for(const file of Array.from(files)){
      const path=typeof file==='string'?file:file&&typeof file==='object'?file.name:undefined;
      const parts=components(path);
      let children=roots,prefix='';
      for(let i=0;i<parts.length;i++){
        prefix+=(i?'/':'')+parts[i];
        const last=i===parts.length-1,previous=nodes.get(prefix);
        if(previous){
          if(last||previous.type!=='folder'){
            throw Error(last&&previous.type==='file'?'底稿清单包含重复文件路径。':'底稿清单的文件与文件夹路径冲突。');
          }
          children=previous.children;
          continue;
        }
        const node=last?{type:'file',name:parts[i],path,key:path,file}:
          {type:'folder',name:parts[i],path:prefix,key:prefix,children:[]};
        nodes.set(prefix,node);
        children.push(node);
        if(!last)children=node.children;
      }
    }
    // Sort mixed files/folders together by their original visible names, not type.
    const pending=[roots];
    while(pending.length){
      const children=pending.pop();
      children.sort(compare);
      for(const node of children)if(node.type==='folder')pending.push(node.children);
    }
    return roots;
  }
  return Object.freeze({build});
});
