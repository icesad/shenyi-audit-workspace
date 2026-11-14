const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/calc.js');
require('../dist/regions.js');

// These assert faithful implementation of the bundled *unverified historical
// demo parameters*, not that any of them are current or legally applicable.
const yuan = cents => `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
const round = (n, d) => (n + d / 2n) / d;

test('GX demo: each flat-tier upper boundary and adjacent cent', () => {
  const gx = globalThis.REGION_REFERENCE.find(r => r.id === 'gx');
  gx.tiers.forEach((tier, i) => {
    const n = BigInt(tier.upToYuan) * 100n;
    assert.equal(C.calculateScale({...gx, baseYuan:yuan(n-1n)}).totalCents, tier.feeYuan*100);
    assert.equal(C.calculateScale({...gx, baseYuan:yuan(n)}).totalCents, tier.feeYuan*100);
    if (i+1 < gx.tiers.length) assert.equal(C.calculateScale({...gx, baseYuan:yuan(n+1n)}).totalCents, gx.tiers[i+1].feeYuan*100);
    else assert.throws(() => C.calculateScale({...gx, baseYuan:yuan(n+1n)}), /超出/);
  });
});

test('HB demo: independently calculated marginal tiers and cent boundaries', () => {
  const hb = globalThis.REGION_REFERENCE.find(r => r.id === 'hb');
  // Rates are expressed in 1/10000 per-mille units to avoid binary floats.
  const upper = [500000n,1000000n,5000000n,10000000n,50000000n,100000000n,500000000n,1000000000n].map(v=>v*100n);
  const rates = [20000n,9000n,7000n,5000n,3000n,1500n,1000n,800n];
  function reference(base){
    let total=200000n;
    for(let i=1;i<=upper.length && base>upper[i-1];i++){
      const end=i<upper.length?upper[i]:base;
      total+=round(((base<end?base:end)-upper[i-1])*rates[i-1],10000000n);
    }
    return Number(total);
  }
  for(const edge of upper){for(const delta of [-1n,0n,1n]){
    const value=edge+delta;
    assert.equal(C.calculateScale({...hb,baseYuan:yuan(value)}).totalCents,reference(value),`base ${value} cents`);
  }}
  let seed=5731n;
  for(let i=0;i<200;i++){seed=(seed*48271n)%2147483647n;const base=seed*100n+37n;assert.equal(C.calculateScale({...hb,baseYuan:yuan(base)}).totalCents,reference(base));}
});

test('adjustments independently preserve cent arithmetic across rounding boundaries', () => {
  for(const base of [0,1,2,3,99,100,101,9999,10000001]) for(const pct of ['0','0.01','0.5','33.33','50','99.99','100']){
    const [a,b='']=pct.split('.');const bp=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
    const discount=round(BigInt(base)*bp,10000n);
    const result=C.applyAdjustment({baseCents:base,discountPercent:pct,extraYuan:'1.23',taxPercent:pct});
    const subtotal=BigInt(base)-discount+123n,tax=round(subtotal*bp,10000n);
    assert.deepEqual(result,{discountCents:Number(discount),subtotalCents:Number(subtotal),taxCents:Number(tax),totalCents:Number(subtotal+tax)});
  }
});
