'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const [executablePath, mode, expectedVersion, expectedData, isolatedRoot] = process.argv.slice(2);
const firm = '合成验收事务所';

async function run() {
  assert.ok(['seed', 'read'].includes(mode));
  const args = isolatedRoot ? ['--user-data-dir=' + path.resolve(isolatedRoot)] : [];
  const app = await electron.launch({executablePath, args, timeout: 45000});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const identity = await app.evaluate(({app}) => ({
      version:app.getVersion(), profile:app.getPath('userData'), executable:process.execPath,
    }));
    assert.equal(identity.version, expectedVersion);
    assert.equal(path.relative(executablePath, identity.executable), '');
    assert.equal(path.relative(expectedData, identity.profile), '');
    await page.locator('#view-home').waitFor({state:'visible'});
    assert.equal(page.url(), 'shenyi-workbench://local/index.html');
    await page.locator('[data-home-view="basics"]').click();
    await page.locator('#view-basics button[data-view="bidders"]').click();
    if (mode === 'seed') {
      await page.locator('#bidder-edit-name').fill(firm);
      await page.locator('#bidder-save').click();
      await page.waitForFunction(() => document.querySelector('#bidder-editor-status')?.innerText.includes('已保存'));
    }
    const record = page.locator('#bidder-library-editor .bidder-row strong').filter({hasText:firm});
    await record.waitFor();
    assert.equal(await record.innerText(), firm);
    console.log('Verified installed workbench', expectedVersion, mode);
  } finally {
    await app.close();
  }
}

run().catch(error => {console.error(error); process.exitCode=1;});
