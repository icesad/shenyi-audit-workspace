import {ApiError} from './http-utils.mjs';
const active=new WeakMap();
// The caller has already checked the signed device and current owner/read
// authority. Hold the permit through dispatch/KDF, not merely the body read.
export function acquireLedgerImportPermit(db,userId){
 let state=active.get(db);if(!state){state={total:0,users:new Set()};active.set(db,state);}
 if(state.total>=2||state.users.has(userId))throw new ApiError(429,'LEDGER_IMPORT_BUSY','账表快照导入仍在处理中，请先查询原操作结果。');
 state.total++;state.users.add(userId);let released=false;
 return ()=>{if(released)return;released=true;state.total--;state.users.delete(userId);if(state.total===0)active.delete(db);};
}
