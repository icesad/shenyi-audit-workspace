(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const form = byId('annual-order-form');
  const fields = byId('checkout-fields');
  const seatsInput = byId('selected-seats');
  const submit = byId('create-order');
  const recover = byId('recover-context');
  const statusPanel = byId('status-panel');
  const content = byId('checkout-content');
  const maxInteger = BigInt(Number.MAX_SAFE_INTEGER);
  const moneyInteger = (value, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
  const orderStates = {
    pending: '待处理（模拟）',
    paid: '已到账（模拟）',
    'payment-verified': '已核验，待到账（模拟）',
    closed: '已关闭（模拟）',
    'payment-review': '待复核（模拟）',
  };
  let handoff = '';
  let context = null;
  let busy = false;
  let uncertain = false;
  let receipt = false;
  let closed = false;
  let activeController = null;

  // The fragment is removed before any request. The handoff lives only in this
  // closure; it is never copied to the DOM, a URL, browser storage, or logs.
  try {
    const fragment = window.location.hash;
    const query = window.location.search;
    window.history.replaceState(null, '', window.location.pathname);
    const match = /^#handoff=([A-Za-z0-9_-]{43})$/.exec(fragment);
    if (!query && match) {
      const decoded = atob(match[1].replace(/-/g, '+').replace(/_/g, '/') + '=');
      if (decoded.length === 32 && btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === match[1]) handoff = match[1];
    }
  } catch {
    handoff = '';
  }

  function exact(value, keys) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  }

  function text(value, limit) {
    return typeof value === 'string' && value.length > 0 && [...value].length <= limit &&
      value === value.toWellFormed() && !/[\p{Cc}\p{Cf}]/u.test(value);
  }

  function validOrder(order) {
    return exact(order, ['id', 'amountMinor', 'seats', 'createdAt', 'status', 'currency']) &&
      typeof order.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(order.id) &&
      moneyInteger(order.amountMinor, 1) && moneyInteger(order.seats) && moneyInteger(order.createdAt, 1) &&
      order.createdAt <= 8_640_000_000_000_000 && typeof order.status === 'string' &&
      Object.hasOwn(orderStates, order.status) && order.currency === 'CNY';
  }

  function validContext(value) {
    if (!exact(value, ['simulation', 'teamName', 'offer', 'pricing', 'order']) || value.simulation !== true || !text(value.teamName, 80)) return false;
    const {offer, pricing, order} = value;
    return exact(offer, ['id', 'revision', 'product', 'amountMinor', 'currency']) &&
      typeof offer.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(offer.id) &&
      moneyInteger(offer.revision, 1) && offer.product === 'team-annual-renewal' &&
      moneyInteger(offer.amountMinor, 1) && offer.currency === 'CNY' &&
      exact(pricing, ['defaultSeats', 'committedSeats', 'unitAmountMinor']) &&
      moneyInteger(pricing.defaultSeats) && moneyInteger(pricing.committedSeats) &&
      moneyInteger(pricing.unitAmountMinor, 1) && (order === null || validOrder(order));
  }

  const numberFormat = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0});
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  function amount(minor) {
    const value = BigInt(minor);
    return '¥' + numberFormat.format(value / 100n) + '.' + String(value % 100n).padStart(2, '0');
  }

  function status(title, message, allowRecovery = false) {
    byId('checkout-status-title').textContent = title;
    byId('checkout-status').textContent = message;
    recover.hidden = !allowRecovery || !handoff || receipt || closed;
    statusPanel.setAttribute('aria-busy', String(busy));
  }

  function controls() {
    fields.disabled = busy || uncertain || receipt || !context || !handoff || closed;
    recover.disabled = busy;
    submit.textContent = busy && uncertain ? '正在确认订单…' : '创建模拟订单';
    statusPanel.setAttribute('aria-busy', String(busy));
  }

  function selection() {
    const raw = seatsInput.value;
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) return {error: '请输入完整的非负整数席位数。'};
    const seats = Number(raw);
    if (!moneyInteger(seats) || seats < context.pricing.committedSeats) {
      return {error: '席位数不得少于已承诺的 ' + numberFormat.format(context.pricing.committedSeats) + ' 席。'};
    }
    const total = BigInt(context.offer.amountMinor) + BigInt(context.pricing.unitAmountMinor) * BigInt(seats);
    if (total > maxInteger) return {error: '席位数超出本次目录可计算的范围，请减少后重试。'};
    return {seats, total: Number(total)};
  }

  function updateQuote() {
    if (!context || receipt) return null;
    const quote = selection();
    byId('seat-error').textContent = quote.error || '';
    seatsInput.setAttribute('aria-invalid', String(Boolean(quote.error)));
    byId('order-total').textContent = quote.error ? '—' : amount(quote.total);
    byId('summary-seats').textContent = quote.error ? '—' : numberFormat.format(quote.seats) + ' 席';
    submit.disabled = Boolean(quote.error);
    return quote;
  }

  function renderOrder(order) {
    receipt = true;
    uncertain = false;
    handoff = '';
    const orderState = orderStates[order.status];
    form.hidden = true;
    byId('receipt-panel').hidden = false;
    byId('receipt-id').textContent = order.id;
    byId('receipt-status').textContent = orderState;
    byId('receipt-seats').textContent = numberFormat.format(order.seats) + ' 席';
    byId('receipt-created').textContent = dateFormat.format(order.createdAt) + '（北京时间）';
    byId('receipt-amount').textContent = amount(order.amountMinor);
    byId('order-total').textContent = amount(order.amountMinor);
    byId('summary-seats').textContent = numberFormat.format(order.seats) + ' 席';
    byId('summary-note').textContent = '金额与席位来自已保存的原订单回执，不随当前目录变化。';
    status('原订单已确认', order.status === 'pending' ? '本次模拟订单已保存。请保留订单编号；本页不会发起收款或重复提交。' :
      '原订单当前状态为' + orderState + '。可返回桌面核对团队账务。');
    controls();
  }

  function renderContext(value, recovered) {
    context = value;
    byId('team-title').textContent = value.teamName;
    content.hidden = false;
    if (value.order) {
      renderOrder(value.order);
      return;
    }
    uncertain = false;
    seatsInput.min = String(value.pricing.committedSeats);
    seatsInput.max = String((maxInteger - BigInt(value.offer.amountMinor)) / BigInt(value.pricing.unitAmountMinor));
    seatsInput.value = String(Math.max(value.pricing.defaultSeats, value.pricing.committedSeats));
    byId('seat-guidance').textContent = '默认 ' + numberFormat.format(value.pricing.defaultSeats) + ' 席；已承诺 ' +
      numberFormat.format(value.pricing.committedSeats) + ' 席，本次不得低于此数量。';
    byId('base-amount').textContent = amount(value.offer.amountMinor) + ' / 年';
    byId('seat-unit-amount').textContent = amount(value.pricing.unitAmountMinor) + ' / 席 / 年';
    updateQuote();
    status(recovered ? '已核对：本次入口尚无订单' : '桌面授权已核对',
      recovered ? '可重新核对席位并点击创建模拟订单；页面不会自动重新提交。' : '请确认席位和合计金额，再创建模拟订单。');
    controls();
  }

  function unavailable(kind, mutation) {
    if (closed) return;
    if (kind === 'expired') {
      handoff = '';
      status('订单页授权已失效', '请返回审易桌面客户端，从“订阅与席位”重新打开官网订单页。');
    } else if (mutation) {
      status('订单结果尚未确认', '请求可能已被保存。请先只读核对原订单，页面不会自动重新提交。', true);
    } else {
      status('暂时无法核对订单', '请检查连接后只读核对；若授权已过期，请从桌面客户端重新打开。', true);
    }
    controls();
  }

  async function request(path, body) {
    const controller = new AbortController();
    activeController = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    let reader;
    try {
      const response = await fetch(path, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit',
        redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        controller.abort();
        throw new Error([401, 403, 404, 410].includes(response.status) ? 'expired' : 'unavailable');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '') || !response.body) throw new Error('invalid');
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65_536) throw new Error('invalid');
        chunks.push(value);
      }
      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(combined));
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) reader.releaseLock();
      if (activeController === controller) activeController = null;
    }
  }

  async function loadContext(recovered = false) {
    if (busy || !handoff || closed || receipt) return;
    busy = true;
    controls();
    status('正在只读核对订单', '正在确认团队授权与本次入口的原订单。');
    try {
      const value = await request('/api/website-checkout/context', {handoff});
      if (closed) return;
      if (!validContext(value)) throw new Error('invalid');
      renderContext(value, recovered);
    } catch (error) {
      unavailable(error.message, uncertain);
    } finally {
      busy = false;
      controls();
    }
  }

  seatsInput.addEventListener('input', () => { if (context && !busy && !uncertain && !receipt && !closed) updateQuote(); });
  recover.addEventListener('click', () => loadContext(true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || uncertain || receipt || !context || !handoff || closed) return;
    const quote = updateQuote();
    if (quote.error) { seatsInput.focus(); return; }
    // Lock mutations before dispatch. Only a successful read-only context can
    // unlock a failed/unknown attempt; no retry or background polling occurs.
    busy = true;
    uncertain = true;
    controls();
    status('正在确认模拟订单', '请稍候，不要重复提交。');
    try {
      const value = await request('/api/website-checkout/orders', {
        handoff, offerId: context.offer.id, offerRevision: context.offer.revision, selectedSeats: quote.seats,
      });
      if (closed) return;
      if (!exact(value, ['simulation', 'order']) || value.simulation !== true || !validOrder(value.order) ||
          value.order.seats !== quote.seats || value.order.amountMinor !== quote.total) throw new Error('invalid');
      renderOrder(value.order);
    } catch (error) {
      unavailable(error.message, true);
    } finally {
      busy = false;
      controls();
    }
  });

  window.addEventListener('pagehide', () => {
    if (closed) return;
    closed = true;
    handoff = '';
    context = null;
    if (activeController) activeController.abort();
    busy = false;
    controls();
    content.hidden = true;
    content.replaceChildren();
    status('请从桌面重新打开', '本页授权已在离开页面时清除。请从审易桌面客户端重新打开订单页。');
  });

  if (handoff) loadContext();
  else {
    busy = false;
    status('请从桌面打开订单页', '请在审易桌面客户端的“订阅与席位”中打开官网订单页，以核对当前团队授权。');
    controls();
  }
})();
