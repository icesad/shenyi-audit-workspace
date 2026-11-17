const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../server/team/workpaper-data-budget.mjs');
test('work permits bound users, concurrent bodies and process-wide large work and release idempotently',async()=>{
 const {acquireWorkpaperDataPermit:a}=await load(),db={},other={},release=a(db,'owner',{large:true});assert.throws(()=>a(db,'owner'),e=>e.status===429);assert.throws(()=>a(other,'someone',{large:true}),e=>e.status===429);release();release();const list=[a({},'a'),a({},'b'),a({},'c'),a({},'d')];assert.throws(()=>a({},'e'),e=>e.status===429);for(const done of list)done();const final=a(db,'owner',{large:true});final();
});
