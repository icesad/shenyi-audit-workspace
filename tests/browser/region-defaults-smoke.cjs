'use strict';
// Local, synthetic browser regression. Optional [offline.html] argument.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const store='hengdu.audit.quote.records.v2';
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const remote=[],errors=[];
  try{
    const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))remote.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto(pathToFileURL(entry).href);
    const q=s=>p.locator(s),slot=i=>q('[data-comparison-slot="'+i+'"]');
    const initial=()=>q('[data-comparison-slot]').evaluateAll(els=>els.map(x=>x.value));
    const cards=q('#comparison .region-card');
    await q('[data-view=quote]').click();
    assert.deepEqual(await initial(),['gx','hb','110000']);
    assert.match(await cards.nth(0).locator('.region-price').textContent(),/15,000\.00/);
    assert.match(await cards.nth(1).locator('.region-price').textContent(),/20,100\.00/);
    await slot(2).selectOption('210000');
    assert.match(await cards.nth(2).locator('.region-price').textContent(),/20,100\.00/);
    assert.match(await cards.nth(2).textContent(),/借用河北/);
    await cards.nth(2).locator('[data-choose]').click();
    assert.equal(await q('#quote-form [name=basis]').inputValue(),'210000');
    assert.match(await q('#basis-description').textContent(),/河北/);
    await q('#save').click();
    const original=await p.evaluate(k=>localStorage.getItem(k),store);
    assert.ok(original);
    await q('[data-view=rules]').click();
    const select=q('#rules-region-select');
    const codes=await select.locator('option').evaluateAll(els=>els.map(e=>e.value).filter(Boolean));
    assert.equal(codes.length,34);assert.equal(new Set(codes).size,34);
    let borrowed=0,readOnly=0;
    for(const id of codes){
      await select.selectOption(id);
      const rule=await p.evaluate(x=>RuleCatalog.defaultRule(x),id);
      assert.ok(rule.document&&rule.version, id);
      assert.equal(await q('#rules-form [name=mode]').inputValue(),rule.mode,id);
      assert.equal(await q('#rules-form [name=basis]').inputValue(),rule.basis,id);
      assert.equal(await q('#rules-form [data-field=upToYuan]').count(),rule.tiers.length,id);
      if(rule.status==='fallback_historical')borrowed++;
      if(rule.status==='scope_reference'){
        readOnly++;
        assert.ok(await q('#rules-form [name=mode]').isDisabled(),id+' read-only');
      }
    }
    assert.equal(readOnly,3);
    assert.ok(borrowed>0);
    assert.deepEqual(await initial(),['gx','hb','210000']);
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),store),original,'browse-only editor action preserves history bytes');
    await q('[data-view=quote]').click();
    for(const id of ['710000','810000','820000']){
      await slot(2).selectOption(id);
      assert.equal((await cards.nth(2).locator('.region-price').textContent()).trim(),'—');
      assert.equal(await cards.nth(2).locator('[data-choose]').isDisabled(),true);
    }
    assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry,provinceCount:codes.length,borrowed,readOnly,remote,errors}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
