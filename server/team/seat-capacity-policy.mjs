import {ApiError} from './http-utils.mjs';
import {readSeatCapacity} from './seat-capacity-store.mjs';

export function seatCapacityMode(value='disabled',{subscriptionEnforcement,identityProviders}={}) {
  if (value==='disabled') return value;
  if (value!=='invitation-reservations-v1') throw new TypeError('Invalid seat capacity enforcement mode');
  if (subscriptionEnforcement!=='team-management-v1'||identityProviders?.deviceProofRequired!==true) {
    throw new TypeError('Seat capacity enforcement requires strict device proof and management subscription enforcement');
  }
  return value;
}

function insufficient() {
  throw new ApiError(409,'SEAT_CAPACITY_EXHAUSTED','团队当前可用席位不足，请核对席位或待激活邀请。');
}

// Capture and finish within the same synchronous write transaction.
// A new invite adds one commitment. Activation converts its existing hold.
export function captureSeatAdmission(db,teamId,{now=Date.now,seatCapacityEnforcement='disabled'}={},delta=1) {
  if (seatCapacityEnforcement==='disabled') return null;
  if (seatCapacityEnforcement!=='invitation-reservations-v1'||db.isTransaction!==true||![0,1].includes(delta)) {
    throw new Error('Seat admission requires the configured mode and a write transaction');
  }
  const admittedAt=now();
  const before=readSeatCapacity(db,teamId,admittedAt);
  if (before.usedSeats>before.purchasedSeats-delta) insufficient();

  return Object.freeze({
    assertPublished(publishedAt) {
      if (db.isTransaction!==true) throw new Error('Seat publication requires an open transaction');
      if (publishedAt<admittedAt) throw new ApiError(409,'SEAT_CAPACITY_CHANGED','席位核对时间已改变，请重试。');
      const after=readSeatCapacity(db,teamId,publishedAt);
      if (after.usedSeats>after.purchasedSeats) insufficient();
      return publishedAt;
    },
  });
}
