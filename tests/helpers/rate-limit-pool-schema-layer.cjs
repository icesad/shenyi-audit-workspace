'use strict';
const assert=require('node:assert/strict');

const TABLES=Object.freeze(['team_auth_limit_pools','team_auth_limit_pool_buckets']);
const INDEX='team_auth_limit_pool_expiry';
const PREFIXES=Object.freeze([
  'recovery-request:ip:',
  'sms:source:',
  'onboarding:preview:ip:',
  'onboarding:challenges:ip:',
  'onboarding:activate:ip:',
  'first-administrator:preview:ip:',
  'first-administrator:challenges:ip:',
  'first-administrator:activate:ip:',
].sort());
const NAMES=Object.freeze([...TABLES,INDEX]);
function definitions(db){
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name IN (?,?,?) ORDER BY type,name`).all(...NAMES).map(row=>({...row}));
}
function rateLimitPoolSchemaLayer(db){
  const rows=definitions(db);
  if(rows.length===0)return {tables:0,objects:0,definitions:[],names:[],tableNames:[]};
  assert.deepEqual(rows.map(({type,name,tbl_name})=>({type,name,tbl_name})),[
    {type:'index',name:INDEX,tbl_name:'team_auth_limit_pool_buckets'},
    {type:'table',name:'team_auth_limit_pool_buckets',tbl_name:'team_auth_limit_pool_buckets'},
    {type:'table',name:'team_auth_limit_pools',tbl_name:'team_auth_limit_pools'},
  ]);
  assert.deepEqual(db.prepare('PRAGMA table_info(team_auth_limit_pools)').all().map(row=>row.name),['prefix','active_count']);
  assert.deepEqual(db.prepare('PRAGMA table_info(team_auth_limit_pool_buckets)').all().map(row=>row.name),['prefix','bucket','window_start']);
  assert.deepEqual(db.prepare('PRAGMA index_info(team_auth_limit_pool_expiry)').all().map(row=>row.name),['prefix','window_start','bucket']);
  const pools=db.prepare('SELECT prefix,active_count FROM team_auth_limit_pools ORDER BY prefix').all();
  assert.deepEqual(pools.map(row=>row.prefix),PREFIXES);
  for(const row of pools){
    assert.ok(Number.isSafeInteger(row.active_count)&&row.active_count>=0);
    const members=db.prepare('SELECT COUNT(*) AS count FROM team_auth_limit_pool_buckets WHERE prefix=?').get(row.prefix).count;
    assert.equal(members,row.active_count,'bounded source-pool counter must match indexed membership');
    const stale=db.prepare(`SELECT COUNT(*) AS count FROM team_auth_limit_pool_buckets AS pool
      LEFT JOIN team_auth_limits AS limits ON limits.bucket=pool.bucket
      WHERE pool.prefix=? AND (limits.bucket IS NULL OR limits.window_start<>pool.window_start)`).get(row.prefix).count;
    assert.equal(stale,0,'every indexed source bucket must match its authoritative limiter row');
  }
  return {tables:2,objects:3,definitions:rows,names:NAMES,tableNames:TABLES};
}
function peelRateLimitPoolSchema(db){
  const layer=rateLimitPoolSchemaLayer(db);
  if(layer.definitions.length===0)return layer;
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_auth_limit_pool_buckets').get().count,0,
    'Historical schema projection must not delete active source buckets');
  assert.ok(layer.definitions.every(row=>row.type==='table'||row.type==='index'));
  db.exec('DROP INDEX '+INDEX);
  for(const name of TABLES)db.exec('DROP TABLE '+name);
  assert.deepEqual(definitions(db),[]);
  return layer;
}
function assertRateLimitPoolSchemaRestored(db,layer){
  assert.deepEqual(definitions(db),layer.definitions);
  if(layer.definitions.length)rateLimitPoolSchemaLayer(db);
}
module.exports={rateLimitPoolSchemaLayer,peelRateLimitPoolSchema,assertRateLimitPoolSchemaRestored,NAMES,TABLES};
