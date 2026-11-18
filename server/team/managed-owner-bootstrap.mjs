import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {backup, DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {initializeTeamDatabase} from './database.mjs';
import {deviceServerId} from './device-policy.mjs';
import {transaction} from './http-utils.mjs';
import {assertManagedDatabaseReady} from './managed-service.mjs';
import {hashPassword, validPassword} from './passwords.mjs';
import {normalizePhone} from './phone-api.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const provenance = 'managed-owner-bootstrap';
const verification = 'manual-phone-verification-v1';
const reviewers = [
  ['team_platform_reviewers', 'team.provision'],
  ['team_recovery_reviewers', 'account.recover'],
  ['team_access_reviewers', 'member.disable'],
  ['team_device_replacement_reviewers', 'device.replace'],
  ['team_administrator_business_role_reviewers', 'administrator.business-role'],
  ['team_project_migration_reviewers', 'project.migrate'],
  ['team_billing_refund_intake_reviewers', 'billing.refund-intake'],
];
const reviewPermissions = Object.freeze(reviewers.map(([, permission])=>permission));
const messages = {
  BOOTSTRAP_INPUT_INVALID: '首位产品负责人的初始化资料无效。',
  BOOTSTRAP_TARGET_INVALID: '请选择仓库外未创建的本机输出目录及已存在的父目录。',
  BOOTSTRAP_FAILED: '首位产品负责人的离线初始化未完成。',
};

function fail(code) { throw Object.assign(new Error(messages[code]), {code}); }

function ownerInput(input) {
  if (!input || Object.getPrototypeOf(input)!==Object.prototype) fail('BOOTSTRAP_INPUT_INVALID');
  const fields=['outputDirectory','displayName','phone','password','verifiedOutOfBand'];
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length!==fields.length || fields.some(name=>!Object.hasOwn(descriptors[name]??{}, 'value'))) fail('BOOTSTRAP_INPUT_INVALID');
  const {outputDirectory, displayName, phone, password, verifiedOutOfBand}=input;
  if (verifiedOutOfBand!==true || typeof displayName!=='string' || displayName.length>512 || !displayName.isWellFormed() ||
      typeof password!=='string' || password.length>256 || !password.isWellFormed() || !validPassword(password)) fail('BOOTSTRAP_INPUT_INVALID');
  const name=displayName.normalize('NFKC').trim();
  if (!name || [...name].length>80 || /[\p{Cc}\p{Cf}]/u.test(name)) fail('BOOTSTRAP_INPUT_INVALID');
  let normalizedPhone;
  try { normalizedPhone=normalizePhone(phone); }
  catch { fail('BOOTSTRAP_INPUT_INVALID'); }
  return {outputDirectory, name, phone:normalizedPhone, password};
}

function localPath(value) {
  if (typeof value!=='string' || !value.isWellFormed() || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value)) fail('BOOTSTRAP_TARGET_INVALID');
  const root=path.parse(value).root;
  const windows=process.platform==='win32';
  if (windows && !/^[A-Za-z]:[\\/]$/.test(root)) fail('BOOTSTRAP_TARGET_INVALID');
  const parts=value.slice(root.length).split(windows ? /[\\/]/ : '/');
  if (parts.some(part=>part==='.' || part==='..' || (windows && /[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)))) fail('BOOTSTRAP_TARGET_INVALID');
  const directory=path.resolve(value);
  if (directory===path.parse(directory).root) fail('BOOTSTRAP_TARGET_INVALID');
  return directory;
}

const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
const sameInode=(left,right)=>left.dev===right.dev && left.ino===right.ino;
const sameContentStat=(left,right)=>sameInode(left,right) && left.size===right.size && left.mtimeNs===right.mtimeNs;

function inside(parent,candidate) {
  const relative=path.relative(parent,candidate);
  return !path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep);
}

async function canonicalDirectory(directory) {
  const info=await fs.lstat(directory,{bigint:true});
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(directory,await fs.realpath(directory))) throw new Error();
  return info;
}

async function directoryChain(directory) {
  const chain=[];
  let current=path.parse(directory).root;
  for (const segment of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    chain.push({directory:current,identity:await canonicalDirectory(current)});
  }
  return chain;
}

async function assertDirectoryChain(chain) {
  for (const {directory,identity} of chain) {
    if (!sameInode(identity,await canonicalDirectory(directory))) throw new Error();
  }
}

async function prepareTarget(value) {
  try {
    const directory=localPath(value), repository=await fs.realpath(checkout);
    if (inside(repository,directory) || inside(directory,repository)) fail('BOOTSTRAP_TARGET_INVALID');
    const parents=await directoryChain(path.dirname(directory));
    try { await fs.lstat(directory); }
    catch (error) { if (error.code==='ENOENT') return {directory,parents}; throw error; }
    fail('BOOTSTRAP_TARGET_INVALID');
  } catch { fail('BOOTSTRAP_TARGET_INVALID'); }
}

function initializeOwner(db,owner) {
  initializeTeamDatabase(db);
  transaction(db,()=>{
    db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(owner.id);
    db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)')
      .run(owner.id,owner.username,owner.name,owner.passwordHash);
    db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(owner.id,owner.phone,owner.verifiedAt);
    for (const [table,permission] of reviewers) {
      db.prepare(`INSERT INTO ${table}(user_id,permission,status) VALUES (?,?,'active')`).run(owner.id,permission);
    }
    db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(provenance,verification);
  });
  return deviceServerId(db);
}

function verifyStagedDatabase(filename, serverId, owner) {
  const db=new DatabaseSync(filename,{readOnly:true,enableForeignKeyConstraints:true});
  try {
    assertManagedDatabaseReady(db,serverId);
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete' ||
        db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok' || db.prepare('PRAGMA foreign_key_check').get()) throw new Error();
    const identity=db.prepare(`SELECT status, username, display_name, password_hash, phone, verified_at
      FROM team_users JOIN team_credentials USING(user_id) JOIN team_phone_credentials USING(user_id) WHERE user_id=?`).get(owner.id);
    if (identity?.status!=='active' || identity.username!==owner.username || identity.display_name!==owner.name ||
        identity.password_hash!==owner.passwordHash || identity.phone!==owner.phone || identity.verified_at!==owner.verifiedAt ||
        db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(provenance)?.value!==verification) throw new Error();
    for (const [table,permission] of reviewers) {
      const [grant,...extra]=db.prepare(`SELECT user_id,permission,status FROM ${table} LIMIT 2`).all();
      if (extra.length || grant?.user_id!==owner.id || grant.permission!==permission || grant.status!=='active') throw new Error();
    }
    for (const table of ['team_users','team_credentials','team_phone_credentials']) {
      if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count!==1) throw new Error();
    }
    for (const table of ['teams','team_memberships','team_operators','team_device_bindings','team_sessions']) {
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new Error();
    }
  } finally { db.close(); }
}

async function ownedFile(filename, identity, links) {
  const info=await fs.lstat(filename,{bigint:true});
  if (!info.isFile() || info.isSymbolicLink() || !sameInode(identity,info) || info.nlink!==links || !samePath(filename,await fs.realpath(filename))) throw new Error();
  return info;
}

async function exactDirectoryFile(directory, filename) {
  const names=await fs.readdir(directory);
  return names.length===1 && names[0]===path.basename(filename);
}

async function syncStagedFile(filename, identity) {
  const listed=await ownedFile(filename,identity,1n);
  if (listed.size<1n) throw new Error();
  const handle=await fs.open(filename,constants.O_RDWR|(constants.O_NOFOLLOW||0));
  try {
    if (!sameContentStat(listed,await handle.stat({bigint:true}))) throw new Error();
    await handle.sync();
    if (!sameContentStat(listed,await handle.stat({bigint:true}))) throw new Error();
  } finally { await handle.close(); }
  return listed;
}

async function discardOwnedFile(filename, identity, chain) {
  if (!identity) return;
  try {
    await assertDirectoryChain(chain);
    const info=await fs.lstat(filename,{bigint:true});
    if (info.isFile() && !info.isSymbolicLink() && sameInode(identity,info)) await fs.unlink(filename);
  } catch { /* Preserve any path whose ownership cannot be confirmed. */ }
}

/** Initialize a brand-new database after the operator has independently verified the owner's phone. */
export async function bootstrapManagedOwner(input) {
  const {outputDirectory,name,phone,password}=ownerInput(input);
  const {directory,parents}=await prepareTarget(outputDirectory);
  let db;
  let chain, fileIdentity, linked=false;
  const staged=path.join(directory,'.team.sqlite.pending-'+randomUUID());
  const databasePath=path.join(directory,'team.sqlite');
  try {
    const id=randomUUID(), owner={id,username:'owner-'+randomUUID(),name,phone,passwordHash:await hashPassword(password),verifiedAt:Date.now()};
    db=new DatabaseSync(':memory:');
    const serverId=initializeOwner(db,owner);
    try {
      await assertDirectoryChain(parents);
      await fs.mkdir(directory,{mode:0o700});
      chain=[...parents,{directory,identity:await canonicalDirectory(directory)}];
    } catch { fail('BOOTSTRAP_TARGET_INVALID'); }
    await assertDirectoryChain(chain);
    const reservation=await fs.open(staged,'wx',0o600);
    try { fileIdentity=await reservation.stat({bigint:true}); }
    finally { await reservation.close(); }
    await ownedFile(staged,fileIdentity,1n);
    await backup(db,staged);
    await assertDirectoryChain(chain);
    const initial=await ownedFile(staged,fileIdentity,1n);
    verifyStagedDatabase(staged,serverId,owner);
    const synced=await syncStagedFile(staged,fileIdentity);
    if (!sameContentStat(initial,synced) || !await exactDirectoryFile(directory,staged)) throw new Error();
    await assertDirectoryChain(chain);
    if (!sameContentStat(synced,await ownedFile(staged,fileIdentity,1n))) throw new Error();
    // Same-directory link publishes exclusively and leaves a competing filename intact.
    await fs.link(staged,databasePath);
    linked=true;
    await assertDirectoryChain(chain);
    if (!sameContentStat(synced,await ownedFile(staged,fileIdentity,2n)) || !sameContentStat(synced,await ownedFile(databasePath,fileIdentity,2n))) throw new Error();
    await fs.unlink(staged);
    if (!sameContentStat(synced,await ownedFile(databasePath,fileIdentity,1n)) || !await exactDirectoryFile(directory,databasePath)) throw new Error();
    await assertDirectoryChain(chain);
    return Object.freeze({databasePath,serverId,ownerUserId:id,reviewPermissions});
  } catch (error) {
    if (chain) {
      if (linked) await discardOwnedFile(databasePath,fileIdentity,chain);
      await discardOwnedFile(staged,fileIdentity,chain);
      try { await assertDirectoryChain(chain); await fs.rmdir(directory); } catch {}
    }
    if (error?.code==='BOOTSTRAP_TARGET_INVALID') fail('BOOTSTRAP_TARGET_INVALID');
    fail('BOOTSTRAP_FAILED');
  } finally { try { db?.close(); } catch {} }
}
