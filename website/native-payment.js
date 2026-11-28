(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const content = byId('payment-content');
  const status = byId('payment-status');
  const retry = byId('retry-order');
  const barcode = byId('payment-qr');
  const image = byId('payment-qr-image');
  const generate = byId('show-qr');
  const check = byId('check-payment');
  const closeOrder = byId('close-order');
  const checkoutContent = byId('checkout-content');
  const seatsInput = byId('selected-seats');
  const seatError = byId('seat-error');
  const getQuote = byId('get-quote');
  const confirmQuote = byId('confirm-quote');
  const paths = {
    order: '/api/website-pay/order',
    quote: '/api/website-pay/quote',
    confirm: '/api/website-pay/confirm',
    code: '/api/website-pay/code',
    check: '/api/website-pay/check',
    close: '/api/website-pay/close',
  };
  const productNames = {
    'team-annual-renewal': '团队年订阅',
    'team-seat-addition': '员工席位增购',
  };
  const states = {
    pending: ['待付款', '扫码付款后，可在此查询服务端确认结果。'],
    pending_fulfilment: ['付款已核实，等待到账', '收款已经核实，订阅或席位尚在处理。可稍后再次查询。'],
    fulfilled: ['权益已到账', '服务端已确认订阅或席位生效，可返回审迹客户端查看。'],
    needs_review: ['订单待复核', '请保留订单编号并联系团队管理员核对。'],
    closed: ['订单已关闭', '需要继续购买时，请返回审迹客户端处理。'],
    expired: ['已过付款截止', '请核对这笔订单的最终状态。'],
  };
  const numberFormat = new Intl.NumberFormat('zh-CN');
  const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  let handoff = takeHandoff();
  let order = null;
  let checkout = null;
  let quote = null;
  let uncertain = null;
  let closeUncertain = false;
  let activeController = null;
  let closed = false;
  let handoffDeadline = null;
  let handoffTimer;
  let quoteDeadline;
  let quoteTimer;
  let qrTimer;

  function takeHandoff() {
    const {origin, href, pathname, hash, search} = window.location;
    try {
      history.replaceState(null, '', pathname);
      if (pathname !== '/api/website-pay/' || search || href.split('#', 1)[0] !== origin + pathname) return '';
      const match = /^#handoff=([A-Za-z0-9_-]{43})$/.exec(hash);
      if (!match) return '';
      const value = atob(match[1].replace(/-/g, '+').replace(/_/g, '/') + '=');
      return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').slice(0, -1) === match[1] ? match[1] : '';
    } catch {
      return '';
    }
  }

  const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const boundedInteger = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
  const identifier = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  const deadline = value => boundedInteger(value, 1, 253_402_300_799_000);
  const yuanValue = value => value.currency === 'CNY' && boundedInteger(value.amountMinor, 1, 2_147_483_647);
  const namedProduct = value => typeof value.product === 'string' && Object.hasOwn(productNames, value.product) &&
    typeof value.teamName === 'string' && value.teamName.isWellFormed() && value.teamName.trim().length > 0 &&
    [...value.teamName].length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value.teamName);

  function validOrder(value) {
    return exact(value, ['id', 'product', 'teamName', 'currency', 'amountMinor', 'seats', 'expiresAt', 'status']) &&
      identifier(value.id) && namedProduct(value) && yuanValue(value) && boundedInteger(value.seats, 0, 1000) &&
      deadline(value.expiresAt) && typeof value.status === 'string' && Object.hasOwn(states, value.status);
  }

  function validCheckout(value) {
    return exact(value, ['product', 'teamName', 'defaultSeats', 'minimumSeats', 'maximumSeats']) && namedProduct(value) &&
      boundedInteger(value.minimumSeats, value.product === 'team-annual-renewal' ? 0 : 1, 1000) &&
      boundedInteger(value.maximumSeats, value.minimumSeats, 1000) &&
      boundedInteger(value.defaultSeats, value.minimumSeats, value.maximumSeats);
  }

  function validQuote(value, context, seats, handoffExpiresInMs) {
    return exact(value, ['id', 'seats', 'amountMinor', 'currency', 'quoteExpiresAt', 'quoteExpiresInMs', 'termEndsAt']) &&
      identifier(value.id) && yuanValue(value) && value.seats === seats &&
      boundedInteger(seats, context.minimumSeats, context.maximumSeats) && deadline(value.quoteExpiresAt) &&
      boundedInteger(value.quoteExpiresInMs, 1, handoffExpiresInMs) &&
      (context.product === 'team-annual-renewal' ? value.termEndsAt === null : deadline(value.termEndsAt));
  }

  function validGif(value) {
    if (typeof value !== 'string' || value.length > 24_000) return false;
    const match = /^data:image\/gif;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) return false;
    try {
      const bytes = atob(match[1]);
      const width = bytes.charCodeAt(6) + 256 * bytes.charCodeAt(7);
      const height = bytes.charCodeAt(8) + 256 * bytes.charCodeAt(9);
      return btoa(bytes) === match[1] && /^(GIF87a|GIF89a)/.test(bytes) && width > 0 && width <= 768 && width === height;
    } catch {
      return false;
    }
  }

  function clearQr() {
    clearTimeout(qrTimer);
    image.removeAttribute('src');
    barcode.hidden = true;
  }

  function clearQuote() {
    clearTimeout(quoteTimer);
    quote = null;
    quoteDeadline = undefined;
    byId('quote-placeholder').hidden = false;
    byId('quote-preview').hidden = true;
    byId('quote-term-row').hidden = true;
    for (const id of ['quote-amount', 'quote-seats', 'quote-term', 'quote-expires']) byId(id).textContent = '';
  }

  function clearCheckout() {
    checkout = null;
    clearQuote();
    checkoutContent.hidden = true;
    for (const id of ['checkout-title', 'checkout-team', 'seat-label', 'seat-range', 'seat-error']) byId(id).textContent = '';
    seatsInput.value = '';
    seatsInput.removeAttribute('min');
    seatsInput.removeAttribute('max');
    seatsInput.removeAttribute('aria-invalid');
    seatError.hidden = true;
    byId('page-title').textContent = '订单付款';
    byId('page-lead').textContent = '核对原订单金额后，使用微信扫一扫付款。';
  }

  function reset(title, detail) {
    handoff = '';
    handoffDeadline = null;
    clearTimeout(handoffTimer);
    order = null;
    uncertain = null;
    closeUncertain = false;
    clearCheckout();
    clearQr();
    content.hidden = true;
    for (const id of ['order-title', 'team-name', 'order-amount', 'order-id', 'order-seats', 'order-expires']) {
      byId(id).textContent = '';
    }
    notice(title, detail, 'review');
    controls();
  }

  function expireHandoff() {
    if (handoffDeadline === null || performance.now() < handoffDeadline) return false;
    activeController?.abort();
    activeController = null;
    reset('订单页授权已失效', '请返回已绑定的审迹客户端，重新打开这笔订单。');
    return true;
  }

  function setHandoffDeadline(requestStartedAt, expiresInMs) {
    const proposedDeadline = requestStartedAt + expiresInMs;
    handoffDeadline = Math.min(handoffDeadline ?? proposedDeadline, proposedDeadline);
    clearTimeout(handoffTimer);
    if (expireHandoff()) return false;
    scheduleHandoffExpiry();
    return true;
  }

  function scheduleHandoffExpiry() {
    handoffTimer = setTimeout(() => {
      if (!expireHandoff()) scheduleHandoffExpiry();
    }, Math.ceil(handoffDeadline - performance.now()));
  }

  function notice(title, detail, mode = 'normal') {
    byId('status-title').textContent = title;
    byId('status-detail').textContent = detail;
    status.dataset.state = mode;
  }

  function reportUnconfirmedClose() {
    closeUncertain = true;
    byId('scan-instructions').textContent = '请先查询这笔原订单的付款结果。';
    notice('尚未确认订单已关闭', '页面不会自动再次关闭订单。', 'review');
  }

  function controls() {
    const busy = activeController !== null;
    const pending = order?.status === 'pending';
    status.setAttribute('aria-busy', String(busy));
    retry.hidden = !handoff || order !== null || (checkout !== null && !uncertain) || busy;
    seatsInput.disabled = busy || !checkout || Boolean(uncertain);
    getQuote.disabled = seatsInput.disabled || selectedSeats() === null;
    confirmQuote.disabled = busy || !quote || Boolean(uncertain);
    generate.hidden = !pending;
    generate.disabled = busy || !handoff || !barcode.hidden;
    check.hidden = !order || order.status === 'fulfilled';
    check.disabled = busy || !handoff;
    closeOrder.hidden = order?.status !== 'expired';
    closeOrder.disabled = busy || !handoff || closeOrder.hidden || closeUncertain;
  }

  function amountText(minor) {
    const yuan = Math.floor(minor / 100);
    const fen = String(minor % 100).padStart(2, '0');
    return `¥${numberFormat.format(yuan)}.${fen}`;
  }

  function showOrder(value) {
    byId('order-title').textContent = productNames[value.product];
    byId('team-name').textContent = value.teamName;
    byId('order-amount').textContent = amountText(value.amountMinor);
    byId('order-id').textContent = value.id;
    byId('order-seats').textContent = `${numberFormat.format(value.seats)} 席`;
    byId('order-expires').textContent = timeFormat.format(value.expiresAt);
    byId('scan-instructions').textContent = value.status === 'pending' ? '请先核对订单，再获取本单付款码。' :
      value.status === 'expired' ? '如已扫码付款，请先查询付款结果。尚未付款时，可关闭这笔订单。' : states[value.status][1];
    content.hidden = false;
    notice(...states[value.status], value.status === 'needs_review' ? 'review' : 'normal');
  }

  function selectedSeats() {
    const raw = seatsInput.value;
    if (!checkout || !/^(0|[1-9][0-9]{0,3})$/.test(raw)) return null;
    const seats = Number(raw);
    return boundedInteger(seats, checkout.minimumSeats, checkout.maximumSeats) ? seats : null;
  }

  function seatValidation() {
    const invalid = Boolean(checkout) && selectedSeats() === null;
    seatsInput.setAttribute('aria-invalid', String(invalid));
    seatError.hidden = !invalid;
    seatError.textContent = invalid ? '请输入范围内的整数席位数。' : '';
  }

  function showCheckout(value, seats = value.defaultSeats) {
    checkout = value;
    byId('page-title').textContent = '确认订阅与席位';
    byId('page-lead').textContent = '选择席位数，核对报价后确认订单。';
    byId('checkout-title').textContent = productNames[value.product];
    byId('checkout-team').textContent = value.teamName;
    byId('seat-label').textContent = value.product === 'team-annual-renewal' ? '下一年度席位数' : '本次增购席位数';
    byId('seat-range').textContent = `可选 ${numberFormat.format(value.minimumSeats)} 至 ${numberFormat.format(value.maximumSeats)} 席`;
    seatsInput.min = String(value.minimumSeats);
    seatsInput.max = String(value.maximumSeats);
    seatsInput.value = String(seats);
    seatValidation();
    checkoutContent.hidden = false;
  }

  function expireQuote() {
    if (!quote || performance.now() < quoteDeadline) return false;
    clearQuote();
    if (!activeController && !uncertain) notice('报价已到期', '请重新获取报价后再确认订单。', 'review');
    controls();
    return true;
  }

  function scheduleQuoteExpiry() {
    quoteTimer = setTimeout(() => {
      if (quote && !expireQuote()) scheduleQuoteExpiry();
    }, Math.ceil(quoteDeadline - performance.now()));
  }

  function showQuote(value, requestStartedAt) {
    clearQuote();
    quote = value;
    quoteDeadline = requestStartedAt + value.quoteExpiresInMs;
    if (expireQuote()) {
      notice('报价已到期', '请重新获取报价后再确认订单。', 'review');
      return false;
    }
    byId('quote-amount').textContent = amountText(value.amountMinor);
    byId('quote-seats').textContent = `${numberFormat.format(value.seats)} 席`;
    byId('quote-term-row').hidden = value.termEndsAt === null;
    byId('quote-term').textContent = value.termEndsAt === null ? '' : timeFormat.format(value.termEndsAt);
    byId('quote-expires').textContent = timeFormat.format(value.quoteExpiresAt);
    byId('quote-placeholder').hidden = true;
    byId('quote-preview').hidden = false;
    notice('请核对报价', '确认后可在同一页获取订单付款码。');
    scheduleQuoteExpiry();
    return true;
  }

  function sameLockedOrder(next) {
    return !order || (['id', 'product', 'currency', 'amountMinor', 'seats', 'expiresAt'].every(key => order[key] === next[key]) &&
      (!['pending_fulfilment', 'fulfilled', 'needs_review', 'closed'].includes(order.status) || next.status !== 'pending'));
  }

  function matchesAttempt(value, attempt) {
    return value.product === attempt.product && value.seats === attempt.quote.seats &&
      value.amountMinor === attempt.quote.amountMinor && value.currency === attempt.quote.currency;
  }

  function readCheckoutResult(action, result, fields, requestStartedAt) {
    const next = result.checkout;
    if (!validCheckout(next) || (checkout && next.product !== checkout.product)) throw new Error();
    if (action === 'quote') {
      if (!exact(result, ['checkout', 'quote', 'handoffExpiresInMs']) || selectedSeats() !== fields.seats ||
        !validQuote(result.quote, next, fields.seats, result.handoffExpiresInMs)) throw new Error();
      showCheckout(next, fields.seats);
      return showQuote(result.quote, requestStartedAt) ? confirmQuote : null;
    }
    if (action !== 'order' || order || !exact(result, ['checkout', 'handoffExpiresInMs'])) throw new Error();
    const recovered = Boolean(uncertain);
    uncertain = null;
    showCheckout(next);
    notice(recovered ? '本次开通尚无订单' : '请选择席位', '获取报价后核对本次应付金额。');
    return recovered ? seatsInput : null;
  }

  function readOrderResult(action, result, confirmation) {
    const next = result.order;
    const keys = action === 'code' && Object.hasOwn(result, 'qr') ? ['order', 'handoffExpiresInMs', 'qr'] : ['order', 'handoffExpiresInMs'];
    const attempt = confirmation ?? uncertain;
    if (!exact(result, keys) || !validOrder(next) || !sameLockedOrder(next) ||
      (checkout && next.product !== checkout.product) || (action === 'close' && next.status === 'pending')) {
      if (attempt || action === 'close') throw new Error();
      reset('无法核对原订单', '请返回审迹客户端，重新打开原订单后再试。');
      return null;
    }
    const quoteDiffers = attempt?.quote && !matchesAttempt(next, attempt);
    if (confirmation && quoteDiffers) throw new Error();
    const showReceipt = Boolean(attempt);
    uncertain = null;
    if (checkout) clearCheckout();
    order = next;
    showOrder(next);
    if (action === 'check') closeUncertain = false;
    if (quoteDiffers) notice('已找到本次保存的订单', '订单与刚才的报价有差异，请查看已保存的金额、席位数及付款状态。', 'review');
    if (next.status !== 'pending') clearQr();
    else if (action === 'code') {
      clearQr();
      if (!validGif(result.qr)) throw new Error();
      image.src = result.qr;
      barcode.hidden = false;
      notice('等待微信付款', '请扫描本页二维码。完成后点击查询付款结果。');
      const remaining = next.expiresAt - Date.now();
      if (remaining > 0) {
        qrTimer = setTimeout(() => {
          clearQr();
          notice('请核对本单付款状态', '二维码已收起，若您已付款，请查询本单。');
          controls();
        }, Math.min(remaining, 7 * 86_400_000));
      }
      return check;
    }
    if (action === 'close') {
      if (next.status === 'expired') {
        reportUnconfirmedClose();
        return check;
      }
      return byId('status-title');
    }
    return showReceipt ? byId('order-title') : null;
  }

  async function request(action, fields = {}) {
    if (!handoff || expireHandoff() || activeController || closed) return;
    if (action === 'confirm' && (expireQuote() || !quote || selectedSeats() !== quote.seats)) return;
    if (action === 'close' && (order?.status !== 'expired' || closeUncertain)) return;
    const confirmation = action === 'confirm' ? {product:checkout.product, quote} : null;
    const requestStartedAt = performance.now();
    const controller = new AbortController();
    activeController = controller;
    let focusAfter;
    const timeout = setTimeout(() => controller.abort(), action === 'close' ? 18_000 : 8_000);
    controls();
    if (action === 'close') notice('正在请求关闭订单', '正在核对这笔订单的付款状态。');
    try {
      const response = await fetch(paths[action], {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({handoff, ...fields}),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (closed || activeController !== controller) return;
      if (response.status === 401 || response.status === 403) {
        reset('订单页授权已失效', '请返回已绑定的审迹客户端，重新打开这笔订单。');
        return;
      }
      if (response.status === 409 && (action === 'code' || action === 'quote' || action === 'order')) {
        const detail = await response.json().catch(() => null);
        if (closed || activeController !== controller) return;
        if (detail?.error?.code === 'WECHAT_NATIVE_PAYMENT_WINDOW') {
          clearQr();
          clearQuote();
          notice('剩余付款时间不足', order ? '如已付款，请查询这笔原订单。' : '本次暂时无法创建可扫码的订单。', 'review');
          focusAfter = order ? check : retry;
          return;
        }
        if (detail?.error?.code === 'WECHAT_NATIVE_SEAT_LIMIT') {
          clearQuote();
          notice('已有席位超出当前报价范围', '请联系产品负责人核对续费方案。', 'review');
          return;
        }
      }
      if (response.status === 409 && (action === 'quote' || action === 'confirm')) {
        clearQuote();
        uncertain = confirmation ?? {product:checkout.product, quote:null};
        notice('报价需要更新', '请先核对本次是否已保存订单，再重新获取报价。', 'review');
        focusAfter = retry;
        return;
      }
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (closed || activeController !== controller) return;
      const {handoffExpiresInMs} = result ?? {};
      if (!boundedInteger(handoffExpiresInMs, 1, 120_000)) {
        if (confirmation || uncertain || action === 'quote' || action === 'close') throw new Error();
        reset('无法核对原订单', '请返回审迹客户端，重新打开原订单后再试。');
        return;
      }
      if (!setHandoffDeadline(requestStartedAt, handoffExpiresInMs)) return;
      if (action === 'quote' || (action === 'order' && result.checkout)) focusAfter = readCheckoutResult(action, result, fields, requestStartedAt);
      else focusAfter = readOrderResult(action, result, confirmation);
    } catch {
      if (closed || activeController !== controller) return;
      clearQr();
      if (action === 'close') {
        reportUnconfirmedClose();
        focusAfter = check;
      } else if (confirmation || uncertain) {
        uncertain ??= confirmation;
        clearQuote();
        notice('订单结果尚未确认', '请先核对本次订单是否已保存。页面不会自动再次提交。', 'review');
        focusAfter = retry;
      } else if (action === 'quote') {
        clearQuote();
        notice('暂时无法核对报价', '请检查席位后重新获取报价。', 'review');
      } else if (order && closeUncertain) {
        reportUnconfirmedClose();
      } else if (order) {
        notice('暂时无法确认付款结果', '请先查询同一订单，再决定是否扫码。', 'review');
      } else {
        notice('暂时无法读取订单', '可重新核对原订单，或回审迹客户端重新打开。', 'review');
      }
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) {
        activeController = null;
        controls();
        focusAfter?.focus();
      }
    }
  }

  retry.addEventListener('click', () => request('order'));
  seatsInput.addEventListener('input', () => {
    if (quote) {
      clearQuote();
      notice('席位数已调整', '请按当前席位数重新获取报价。');
    }
    seatValidation();
    controls();
  });
  byId('seat-quote-form').addEventListener('submit', event => {
    event.preventDefault();
    const seats = selectedSeats();
    if (seats === null || activeController || uncertain) return;
    clearQuote();
    request('quote', {seats});
  });
  confirmQuote.addEventListener('click', () => {
    if (quote && !uncertain) request('confirm', {quoteId: quote.id});
  });
  generate.addEventListener('click', () => request('code'));
  check.addEventListener('click', () => request('check'));
  closeOrder.addEventListener('click', () => request('close'));
  function checkExpiry() {
    if (!expireHandoff()) expireQuote();
  }
  document.addEventListener('visibilitychange', checkExpiry);
  window.addEventListener('focus', checkExpiry);
  window.addEventListener('hashchange', () => {
    if (!window.location.hash.startsWith('#handoff=')) return;
    const replacement = takeHandoff();
    activeController?.abort();
    activeController = null;
    reset('请从审迹客户端打开订单', '使用已绑定的审迹客户端打开要支付的原订单。');
    if (replacement && !closed) {
      handoff = replacement;
      notice('正在核对订单页授权', '请稍候。');
      request('order');
    }
  });
  window.addEventListener('pagehide', () => {
    closed = true;
    activeController?.abort();
    activeController = null;
    reset('请从审迹客户端打开订单', '订单页授权随页面关闭而清除。');
  });

  if (handoff) request('order');
  else reset('请从审迹客户端打开订单', '使用已绑定的审迹客户端打开要支付的原订单。');
})();
