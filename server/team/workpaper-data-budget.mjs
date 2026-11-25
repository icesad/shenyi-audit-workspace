import {ApiError} from './http-utils.mjs';
const active=new WeakMap();let bodyCount=0,largeCount=0;
// Process-local limits for this single-process candidate. Staged DB reservation
// separately bounds persistent temporary bytes; this is not a cluster quota.
export function acquireWorkpaperDataPermit(db,userId,{large=false}={}){
 let users=active.get(db);if(!users){users=new Set();active.set(db,users);}
 if(bodyCount>=4||users.has(userId)||large&&largeCount>=1)throw new ApiError(429,'WORKPAPER_DATA_BUSY','底稿数据操作仍在处理中，请先查询原操作结果。');
 users.add(userId);bodyCount++;if(large)largeCount++;let released=false;
 return()=>{if(released)return;released=true;users.delete(userId);bodyCount--;if(large)largeCount--;if(!users.size)active.delete(db);};
}
