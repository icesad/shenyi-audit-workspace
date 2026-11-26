'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const [executablePath, mode, expectedVersion, expectedData, isolatedRoot] = process.argv.slice(2);
const firm = '合成验收事务所';

function progress(message) {
  const line = new Date().toISOString() + ' ' + message;
  if (process.env.SHENYI_INSTALL_ACCEPTANCE_LOG) {
    fs.appendFileSync(process.env.SHENYI_INSTALL_ACCEPTANCE_LOG, line + '\n');
  } else {
    console.log(line);
  }
}

async function run() {
  assert.ok(['seed', 'read'].includes(mode));
  const args = isolatedRoot ? ['--user-data-dir=' + path.resolve(isolatedRoot)] : [];
  progress('Launching ' + executablePath);
  const app = await electron.launch({executablePath, args, timeout: 45000});
  try {
    progress('Native process started, pid ' + app.process().pid);
    const page = await app.firstWindow({timeout: 20000});
    page.setDefaultTimeout(15000);
    const identity = await app.evaluate(({app}) => ({
      version:app.getVersion(), profile:app.getPath('userData'), executable:process.execPath,
    }));
    assert.equal(identity.version, expectedVersion);
    assert.equal(path.relative(executablePath, identity.executable), '');
    assert.equal(path.relative(expectedData, identity.profile), '');
    await page.locator('#view-home').waitFor({state:'visible'});
    assert.equal(page.url(), 'shenyi-workbench://local/index.html');
    progress('Workbench home rendered. Checking saved business data.');
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
    progress('Verified installed workbench ' + expectedVersion + ' ' + mode);
  } finally {
    progress('Closing native process.');
    await app.close();
  }
}

// Electron shutdown and main-process evaluate have no per-call timeout. The Windows
// worker also owns the entire probe process tree and bounds it to 105 seconds.
const deadline = setTimeout(() => {
  progress('Timed out after 90 seconds waiting for the native client.');
  // The CI parent terminates the complete tree if this probe cannot close Electron.
  if (!process.env.SHENYI_INSTALL_ACCEPTANCE_LOG) process.exit(1);
}, 90000);
run().catch(error => {
  progress(error.stack || String(error));
  process.exitCode = 1;
}).finally(() => clearTimeout(deadline));
