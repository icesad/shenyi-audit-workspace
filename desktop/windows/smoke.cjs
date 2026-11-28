'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const [executablePath, evidence] = process.argv.slice(2);
const firm = '合成走查会计师事务所';
const nav = key => '.workspace-navigation [data-view="' + key + '"]';

async function visit(page, key) {
  const control = page.locator(nav(key)).first();
  const group = control.locator('xpath=ancestor::details[1]');
  if (await group.count() && !await group.evaluate(e => e.open)) await group.locator('summary').first().click();
  if (['quote', 'project'].includes(key) && !await control.isVisible()) await page.locator('#quote-nav-toggle').click();
  await control.click();
  await page.locator('#view-' + key).waitFor({state:'visible'});
  const title = (await page.locator('#page-title').innerText()).trim();
  assert.ok(title);
  return title;
}

async function open(root, callback) {
  const profile = path.join(evidence, root);
  const app = await electron.launch({executablePath, args:['--user-data-dir=' + profile], timeout:30000});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    await page.waitForLoadState('load');
    await page.locator('#view-home').waitFor({state:'visible'});
    assert.equal(page.url(),'shenyi-workbench://local/index.html');
    const actual = await app.evaluate(({app}) => app.getPath('userData'));
    assert.equal(path.resolve(actual), path.join(profile, 'Shenyi-Workbench-LocalReview'));
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await callback(page, app);
  } finally { await app.close(); }
}

(async () => {
  if (!executablePath || !evidence || !path.isAbsolute(evidence)) throw Error('请传入已解包程序路径和新的绝对证据目录。');
  await fs.mkdir(evidence);
  const views = {};
  await open('profile-a', async page => {
    await page.screenshot({path:path.join(evidence,'home.png')});
    for (const key of ['quote','project','audit','report','costs','basics']) {
      await page.locator('#brand-home').click();
      await page.locator('[data-home-view="' + key + '"]').click();
      await page.locator('#view-' + key).waitFor({state:'visible'});
      views[key] = (await page.locator('#page-title').innerText()).trim();
      assert.ok(views[key]);
    }
    await visit(page, 'bidders');
    await page.locator('#bidder-edit-name').fill(firm);
    await page.locator('#bidder-save').click();
    await page.waitForFunction(() => document.querySelector('#bidder-editor-status')?.innerText.includes('已保存'));
  });
  await open('profile-a', async page => {
    await visit(page,'bidders');
    const record = page.locator('#bidder-library-editor .bidder-row strong').filter({hasText:firm});
    await record.waitFor();
    assert.equal(await record.innerText(), firm);
  });
  await open('profile-b', async page => {
    await visit(page,'bidders');
    await page.getByText('暂无已有资料。',{exact:true}).waitFor();
    assert.equal(await page.getByText(firm,{exact:true}).count(),0);
  });
  const result = {views, savedFirmReopened:true, separateProfileEmpty:true, isolatedRenderer:true};
  await fs.writeFile(path.join(evidence,'smoke.json'), JSON.stringify(result,null,2));
  console.log(result);
})().catch(error => {console.error(error);process.exitCode=1;});
