const {test}=require('node:test');const assert=require('node:assert/strict');const C=require('../dist/calc.js');require('../dist/regions.js');
test('money exact decimal and formatting',()=>{assert.equal(C.money('0.29'),29);assert.equal(C.money('1234567.89'),123456789);assert.equal(C.formatMoney(123456789),'1,234,567.89');});
for(const value of ['',-1,'1.001','NaN','Infinity','1e10',null,undefined])test('invalid money '+String(value),()=>assert.throws(()=>C.money(value)));
test('Guangxi flat boundaries and cap',()=>{const r=REGION_REFERENCE[0];assert.equal(C.calculateScale({...r,baseYuan:500000}).totalCents,150000);assert.equal(C.calculateScale({...r,baseYuan:'500000.01'}).totalCents,300000);assert.equal(C.calculateScale({...r,baseYuan:30000000}).totalCents,1500000);assert.throws(()=>C.calculateScale({...r,baseYuan:200000001}));});
test('Hebei fixed first band plus marginal rates',()=>{const r=REGION_REFERENCE[1];assert.equal(C.calculateScale({...r,baseYuan:0}).totalCents,200000);assert.equal(C.calculateScale({...r,baseYuan:500000}).totalCents,200000);assert.equal(C.calculateScale({...r,baseYuan:1000000}).totalCents,300000);assert.equal(C.calculateScale({...r,baseYuan:30000000}).totalCents,2010000);});
test('invalid tiers and rates rejected',()=>{for(const tiers of [[],[{upToYuan:100,ratePerMille:1},{upToYuan:50,ratePerMille:1}],[{upToYuan:null,ratePerMille:1},{upToYuan:100,ratePerMille:1}],[{upToYuan:null,ratePerMille:-1}],[{upToYuan:null,ratePerMille:''}]])assert.throws(()=>C.calculateScale({baseYuan:1,mode:'progressive',tiers}));});
test('minimum applied and unknown mode rejected',()=>{assert.equal(C.calculateScale({baseYuan:0,mode:'fixed',fixedYuan:5,minimumYuan:8}).totalCents,800);assert.throws(()=>C.calculateScale({baseYuan:0,mode:'???'}));});
test('hour budget demo and fractional precision',()=>{assert.equal(C.calculateHours([{role:'A',hours:24,rateYuan:600},{role:'B',hours:48,rateYuan:300},{role:'C',hours:4,rateYuan:1200}]).totalCents,3360000);assert.equal(C.calculateHours([{role:'A',hours:0.5,rateYuan:0.01}]).totalCents,1);assert.throws(()=>C.calculateHours([]));});
test('discount and tax exact order',()=>{const v=C.applyAdjustment({baseCents:3360000,discountPercent:10,extraYuan:0,taxPercent:6});assert.equal(v.subtotalCents,3024000);assert.equal(v.taxCents,181440);assert.equal(v.totalCents,3205440);assert.equal(C.applyAdjustment({baseCents:1,discountPercent:50,extraYuan:0,taxPercent:0}).totalCents,0);});
test('discount limits',()=>{assert.equal(C.applyAdjustment({baseCents:100,discountPercent:100,extraYuan:0,taxPercent:0}).totalCents,0);for(const p of [-1,101,''])assert.throws(()=>C.applyAdjustment({baseCents:100,discountPercent:p,extraYuan:0,taxPercent:0}));});

test('price factor uses half-up on the selling amount, supports markups and preserves legacy cents',()=>{
 const price=(pricePercent,baseCents=10000)=>C.applyAdjustment({baseCents,pricePercent,extraYuan:0,taxPercent:0});
 assert.deepEqual([price(100).totalCents,price(70).totalCents,price(120).totalCents],[10000,7000,12000]);
 assert.equal(price(120).discountCents,-2000);assert.equal(price(50,1).totalCents,1);
 for(const v of [-1,10001,'70.001',''])assert.throws(()=>price(v));
});
