const CELL=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
export function cellPosition(value){if(typeof value!=='string')return null;const m=CELL.exec(value);if(!m||m[0]!==value)return null;const c=[...m[1]].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1,r=Number(m[2])-1;return r<=1048575&&c<=16383?{r,c}:null;}
const inside=(p,range)=>p.r>=range.s.r&&p.r<=range.e.r&&p.c>=range.s.c&&p.c<=range.e.c;
export function sheetCellWritable(sheet,address){
 const p=cellPosition(address);if(!p||sheet.visibility||sheet.readOnly)return false;
 if(!sheet.nativeAnchors&&(!inside(p,sheet.range)||sheet.hiddenRows.includes(p.r)||sheet.hiddenCols.includes(p.c)))return false;
 const cell=sheet.cells[address];if(cell&&(cell.f||cell.l||cell.array))return false;
 if(sheet.arrayRanges.some(range=>inside(p,range)))return false;
 if(sheet.nativeAnchors){if(!Object.hasOwn(sheet.nativeAnchors,address))return false;}
 else if(sheet.merges.some(m=>inside(p,m)&&(p.r!==m.s.r||p.c!==m.s.c)))return false;
 return true;
}
export function assertFormChanges(form,changes){
 if(form.readOnly)throw Error('Original form is readonly');
 if(!Array.isArray(changes)||!changes.length||changes.length>500)throw Error('Invalid entry batch');const seen=new Set();
 for(const change of changes){if(!change||typeof change!=='object'||Array.isArray(change)||Object.keys(change).sort().join(',')!=='field,sheet,value'||typeof change.sheet!=='string'||typeof change.field!=='string'||typeof change.value!=='string'||change.value.length>150000||!change.value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(change.value))throw Error('Invalid entry');const key=JSON.stringify([change.sheet,change.field]);if(seen.has(key))throw Error('Duplicate entry');seen.add(key);
  if(form.kind==='excel'){const sheet=form.sheets.find(x=>x.name===change.sheet);if(!sheet||!sheetCellWritable(sheet,change.field))throw Error('Original cell is readonly or absent');}
  else if(form.kind==='word'){if(change.sheet!=='$document'||!form.editable.includes(change.field))throw Error('Original Word field is readonly or absent');}
  else throw Error('Unknown original form');
 }
 return true;
}