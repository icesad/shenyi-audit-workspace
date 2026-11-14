'use strict';
// node tests/browser/bidder-archive-ui-smoke.cjs <packaged demo directory> [workspace or offline HTML]
// Only accepts the immutable synthetic sample from the official offline trial package.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const demo=process.argv[2];
const source=path.resolve(process.argv[3]||path.join(__dirname,'../../dist/index.html'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const slots={
  business_license:'营业执照（演示）.png',practice_certificate:'会计师事务所执业证书（演示）.png',
  company_seal:'公司公章（演示）.png',legal_representative_seal:'法人章（演示）.png',bidder_signature:'投标人签字（演示）.png'
};
async function main(){
  assert.ok(demo,'Pass path to the extracted official synthetic 演示材料 folder');
  const manifest=JSON.parse(fs.readFileSync(path.join(demo,'../版本与校验.json'),'utf8'));
  assert.equal(manifest.noRealCustomerOrSealDataPackaged,true);
  const intake=path.join(demo,'04-虚构投标方基础资料.zip');
  assert.equal(sha(fs.readFileSync(intake)),manifest.demoFiles['04-虚构投标方基础资料.zip'].sha256);
  assert.equal(manifest.syntheticFixturesReusedFromV13Sha256,'a18d4542abc4675ff33ad3f734dbc4c55115cfb16f6d18b60a5e74c45111557c');
  const reports=[],network=[],errors=[],confirmations=[];
  let allowConfirm=false;
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});
    ctx.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))network.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(9000);
    p.on('pageerror',e=>errors.push(e.message));
    p.on('dialog',d=>{confirmations.push(d.message());return allowConfirm?d.accept():d.dismiss();});
    const q=x=>p.locator(x);
    const waitText=(selector,value)=>p.waitForFunction(([s,v])=>document.querySelector(s)?.textContent.includes(v),[selector,value]);
    const waitReady=()=>p.waitForFunction(()=>!document.querySelector('#bidder-archive-file')?.disabled);
    const lib=async()=>p.evaluate(async()=>{
      const db=await BidderLibrary.open();
      try{
        return await Promise.all((await db.list()).map(async summary=>{
          const r=await db.get(summary.id);
          return {id:r.id,version:r.version,name:r.name,contactName:r.contactName,signingKinds:r.signingKinds,
            files:[...r.attachments,...(r.signingAssets||[])].map(a=>({kind:a.kind,name:a.name,sha256:a.sha256}))};
        }));
      }finally{db.close();}
    });
    const waitApplied=()=>waitText('#bidder-editor-status','已填入待核对资料');
    const readRoster=async expected=>{
      for(const [kind,name] of Object.entries(expected)){
        await waitText('#bidder-import-rows [data-import-kind="'+kind+'"]',name);
      }
    };
    const readEditor=async()=>{
      for(const [kind,name] of Object.entries(slots)){
        const selector='#bidder-file-'+kind;
        await waitText(selector,name);
        assert.match(await q(selector).textContent(),/从压缩包读入/);
        assert.equal(await q('#bidder-edit-'+kind).evaluate(e=>e.files.length),0,'Native file picker remains for manual replacement');
        assert.equal(await q('#bidder-clear-'+kind).isEnabled(),true,'Imported file is actually present in the draft');
      }
    };
    await p.goto(pathToFileURL(source).href);
    await q('[data-view=bidders]').click();await waitReady();
    await q('#bidder-archive-file').setInputFiles(intake);
    await waitApplied();await readRoster(slots);await readEditor();
    assert.match(await q('#bidder-edit-name').inputValue(),/^虚构样本会计师事务所/);
    assert.deepEqual(await lib(),[],'Recognizing five files is not a save');
    reports.push('five recognized roles and filenames shown in result and draft; new clean draft auto-filled without saving; file picker remains empty');
    await q('#bidder-edit-kind').selectOption('own');
    await q('#bidder-save').click();await waitText('#bidder-editor-status','已保存');
    const [first]=await lib();
    assert.ok(first.id&&first.version===1);
    assert.deepEqual(first.files.map(f=>f.kind).sort(),Object.keys(slots).sort());
    for(const f of first.files){assert.equal(f.name,slots[f.kind]);assert.equal(f.sha256,manifest.syntheticArchiveFiles[f.name].sha256);}
    reports.push('explicit save persists exact five synthetic originals with separate roles and verified hashes');
    await q('#bidder-new').click();
    await q('#bidder-archive-file').setInputFiles(intake);
    await waitApplied();await readRoster(slots);await readEditor();
    assert.deepEqual(await lib(),[first],'Clean same-name draft did not update persistent data');
    await q('#bidder-save').click();await waitText('#bidder-editor-status','已保存');
    const [second,...duplicates]=await lib();
    assert.equal(duplicates.length,0);assert.equal(second.id,first.id);assert.equal(second.version,2);
    assert.deepEqual(second.files,first.files);
    reports.push('clean unique same-name import fills existing editor then updates that same saved record only after save');
    await q('#bidder-new').click();
    const manual='手填待核对合成字段';
    await q('#bidder-edit-contactName').fill(manual);
    await q('#bidder-archive-file').setInputFiles(intake);
    await readRoster(slots);await waitReady();
    assert.equal(await q('#bidder-edit-contactName').inputValue(),manual,'Dirty input is not overwritten by import');
    await q('#bidder-import-rows [data-bidder-intake]').click();
    await p.waitForFunction(()=>!document.querySelector('#bidder-archive-file').disabled);
    assert.ok(confirmations.length>=1,'Applying with pending edits requires explicit confirmation');
    assert.equal(await q('#bidder-edit-contactName').inputValue(),manual,'Cancel preserves manual draft');
    allowConfirm=true;
    await q('#bidder-import-rows [data-bidder-intake]').click();
    await waitApplied();await readEditor();
    assert.notEqual(await q('#bidder-edit-contactName').inputValue(),manual);
    assert.deepEqual(await lib(),[second],'Applying chosen candidate still does not save automatically');
    reports.push('dirty import lists roles without touching the draft; cancellation preserves inputs; accepting fills the draft only');
    await q('[data-view=quote]').click();
    await q('#bidder-picker-select').selectOption(first.id);
    await waitText('#bidder-picker-status','已带入');
    await q('#preview').click();
    const company=q('[data-quote-page-sign-kind=company_seal]');
    if(await company.count()){
      await waitText('#quote-seal-source-status','本次可选');
      assert.match(await q('#quote-seal-source-status').textContent(),/公司公章/);
      assert.equal(await company.isEnabled(),true);
      assert.equal(await company.isChecked(),false);
    }else{
      await waitText('#quote-seal-source-status','已读取公司公章');
      assert.match(await q('#quote-seal-source-status').textContent(),/公司公章（演示）\.png/);
    }
    assert.equal(await q('#quote-page-seal').isChecked(),false);
    reports.push('quote reuse reads the original company seal from the sole saved firm, without signing or selecting a substitute');
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,source,browser:browser.version(),reports,network,errors}));
  }catch(e){console.error(JSON.stringify({passed:false,reports,network,errors}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
