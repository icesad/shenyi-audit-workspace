(function(root){
  'use strict';
  const MAX=BigInt(Number.MAX_SAFE_INTEGER);
  function integer(v){if(v<0n||v>MAX)throw Error('金额超过安全范围');return Number(v);}
  function scaled(value,decimals,label){if(typeof value!=='string'&&typeof value!=='number')throw Error(label+'无效');const s=String(value).trim();const re=new RegExp('^\\d+(?:\\.\\d{1,'+decimals+'})?$');if(!re.test(s))throw Error(label+'须为非负数，最多 '+decimals+' 位小数');const [a,b='']=s.split('.');const n=BigInt(a)*10n**BigInt(decimals)+BigInt(b.padEnd(decimals,'0'));if(n>MAX)throw Error(label+'超过支持范围');return n;}
  function cents(value){return scaled(value,2,'金额');}
  function round(n,d){return (n+d/2n)/d;}
  function money(value){return integer(cents(value));}
  function formatMoney(value){if(!Number.isSafeInteger(value)||value<0)throw Error('分值无效');const n=BigInt(value);return (n/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(n%100n).toString().padStart(2,'0');}
  function calculateScale({baseYuan,mode,minimumYuan=0,fixedYuan,tiers=[]}){
    const base=cents(baseYuan),minimum=cents(minimumYuan);let total=0n;const lines=[];
    if(mode==='fixed'){total=cents(fixedYuan);lines.push({label:'自定义固定金额',amountCents:integer(total)});}
    else if(mode==='flat'||mode==='progressive'){
      if(!Array.isArray(tiers)||!tiers.length)throw Error('未配置收费档位');let previous=0n;
      const parsed=tiers.map((t,i)=>{const upper=t.upToYuan===null?null:cents(t.upToYuan);if(upper===null&&i!==tiers.length-1)throw Error('无上限只能出现在末档');if(upper!==null&&upper<=previous)throw Error('档位上限必须严格递增');const lower=previous;if(upper!==null)previous=upper;const fee=t.feeYuan===undefined||t.feeYuan===null?null:cents(t.feeYuan);const rate=fee!==null?null:scaled(t.ratePerMille,4,'千分率');return {upper,lower,fee,rate};});
      const last=parsed.at(-1);if(last.upper!==null&&base>last.upper)throw Error('超出已录入规则范围，请人工报价');
      if(mode==='flat'){
        const t=parsed.find(t=>t.upper===null||base<=t.upper);total=t.fee!==null?t.fee:round(base*t.rate,10000000n);
        lines.push({label:'命中档位：'+(Number(t.lower)/10000/100)+'—'+(t.upper===null?'不限':Number(t.upper)/10000/100)+' 万元（一次计费）',amountCents:integer(total)});
      }else{
        for(const [i,t] of parsed.entries()){if(base<=t.lower && !(base===0n&&i===0))break;const part=(t.upper===null||base<t.upper?base:t.upper)-t.lower;const fee=t.fee!==null?t.fee:round(part*t.rate,10000000n);total+=fee;lines.push({label:t.fee!==null?'首档 / 固定段收费':'第 '+(i+1)+' 段：'+formatMoney(integer(part))+' 元 × '+String(Number(t.rate)/10000)+'‰',amountCents:integer(fee)});}
      }
    }else throw Error('未知计算方法');
    if(total<minimum){lines.push({label:'补足最低收费',amountCents:integer(minimum-total)});total=minimum;}
    return {totalCents:integer(total),baseCents:integer(base),lines};
  }
  function calculateHours(rows){if(!Array.isArray(rows)||!rows.length)throw Error('请至少添加一个人员级别');let total=0n;const lines=rows.map(row=>{const hours=scaled(row.hours,2,'工时'),rate=cents(row.rateYuan);const fee=round(hours*rate,100n);total+=fee;return {label:String(row.role||'未命名人员')+'：'+row.hours+' 小时 × '+formatMoney(integer(rate))+' 元',amountCents:integer(fee)};});return {totalCents:integer(total),lines};}
  function percent(v,label){const n=scaled(v,2,label);if(n>10000n)throw Error(label+'应在 0—100 之间');return n;}
  function applyAdjustment({baseCents,discountPercent,extraYuan,taxPercent}){if(!Number.isSafeInteger(baseCents)||baseCents<0)throw Error('基准金额无效');const base=BigInt(baseCents),discount=round(base*percent(discountPercent,'优惠幅度'),10000n),subtotal=base-discount+cents(extraYuan),tax=round(subtotal*percent(taxPercent,'税率'),10000n);return {discountCents:integer(discount),subtotalCents:integer(subtotal),taxCents:integer(tax),totalCents:integer(subtotal+tax)};}
  const api={money,formatMoney,calculateScale,calculateHours,applyAdjustment};root.QuoteCalc=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
