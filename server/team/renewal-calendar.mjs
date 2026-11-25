import {isProxy} from 'node:util/types';
import {invalid} from './http-utils.mjs';

const BEIJING_OFFSET=8*60*60*1000,DATE_MAX=8640000000000000;
function instantValue(value){
 if(typeof value!=='number'||!Number.isSafeInteger(value)||Object.is(value,-0)||value<0||value>DATE_MAX)invalid();
 return value;
}
function termValue(value){
 if(value===null)return null;
 if(typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.length!==2||keys.some(key=>!['startsAt','endsAt'].includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))invalid();
 const startsAt=instantValue(descriptors.startsAt.value),endsAt=instantValue(descriptors.endsAt.value);
 if(endsAt<=startsAt)invalid();return{startsAt,endsAt};
}
const leap=year=>year%4===0&&(year%100!==0||year%400===0);

// Fixed UTC+08 calendar arithmetic, independent of host timezone and DST.
export function addBeijingCalendarYear(instant){
 instantValue(instant);const local=new Date(instant+BEIJING_OFFSET);
 if(!Number.isFinite(local.getTime()))invalid();
 const year=local.getUTCFullYear()+1,month=local.getUTCMonth(),day=month===1&&local.getUTCDate()===29&&!leap(year)?28:local.getUTCDate();
 // Build midnight separately: the final UTC instant can be valid even when
 // its +08 civil clock, represented as a pseudo-UTC Date, exceeds Date's max.
 const midnight=Date.UTC(year,month,day),clock=((local.getUTCHours()*60+local.getUTCMinutes())*60+local.getUTCSeconds())*1000+local.getUTCMilliseconds();
 const end=midnight+clock-BEIJING_OFFSET;instantValue(end);return end;
}

export function annualRenewalWindow(currentTermOrNull,confirmedAt){
 confirmedAt=instantValue(confirmedAt);const term=termValue(currentTermOrNull),unexpired=term!==null&&term.endsAt>confirmedAt;
 const startsAt=unexpired?term.startsAt:confirmedAt,renewalStartsAt=unexpired?term.endsAt:confirmedAt,endsAt=addBeijingCalendarYear(renewalStartsAt);
 return Object.freeze({startsAt,endsAt,renewalStartsAt});
}
