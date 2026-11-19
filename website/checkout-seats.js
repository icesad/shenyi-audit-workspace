(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const form = byId('seat-order-form');
  const fields = byId('checkout-fields');
  const quantityInput = byId('seat-quantity');
  const requestQuoteButton = byId('request-quote');
  const confirmButton = byId('confirm-seat-order');
  const recover = byId('recover-context');
  const statusPanel = byId('status-panel');
  const integer = (value, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
  const timestamp = (value) => integer(value, 1) && value <= 8_640_000_000_000_000;
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  const seatCount = (value) => integer(value, 1) && value <= 1000;
  let handoff = '';
  let context = null;
  let quote = null;
  let quoteTimer = null;
  let busy = false;
  let confirming = false;
  let uncertain = false;
  let receipt = false;
  let closed = false;
  let activeController = null;

  // Remove the fragment before any request. The handoff remains in this closure
  // only: no DOM, storage, logging, query parameters, or subsequent URL copies.
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

  function validOrder(order) {
    return exact(order, ['id', 'amountMinor', 'seats', 'createdAt', 'status', 'currency', 'termEndsAt', 'quoteExpiresAt']) &&
      identifier(order.id) && integer(order.amountMinor, 1) && seatCount(order.seats) && timestamp(order.createdAt) &&
      order.status === 'pending' && order.currency === 'CNY' && timestamp(order.termEndsAt) && timestamp(order.quoteExpiresAt);
  }

  function validContext(value) {
    return exact(value, ['simulation', 'teamName', 'offer', 'termEndsAt', 'order']) && value.simulation === true &&
      typeof value.teamName === 'string' && value.teamName.length > 0 && [...value.teamName].length <= 80 &&
      value.teamName === value.teamName.toWellFormed() && !/[\p{Cc}\p{Cf}]/u.test(value.teamName) &&
      exact(value.offer, ['id', 'revision', 'product', 'annualUnitAmountMinor', 'currency']) &&
      identifier(value.offer.id) && integer(value.offer.revision, 1) && value.offer.product === 'team-seat-addition' &&
      integer(value.offer.annualUnitAmountMinor, 1) && value.offer.currency === 'CNY' &&
      (value.termEndsAt === null || timestamp(value.termEndsAt)) && (value.order === null || validOrder(value.order));
  }

  function validQuote(value, quantity) {
    return exact(value, ['simulation', 'quote']) && value.simulation === true &&
      exact(value.quote, ['id', 'seats', 'amountMinor', 'termEndsAt', 'expiresAt']) &&
      identifier(value.quote.id) && seatCount(value.quote.seats) && value.quote.seats === quantity &&
      integer(value.quote.amountMinor, 1) && timestamp(value.quote.termEndsAt) &&
      value.quote.termEndsAt === context.termEndsAt && timestamp(value.quote.expiresAt);
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
  const date = (value) => dateFormat.format(value) + '（北京时间）';

  function status(title, message, allowRecovery = false) {
    byId('checkout-status-title').textContent = title;
    byId('checkout-status').textContent = message;
    recover.hidden = !allowRecovery || !handoff || receipt || closed;
    statusPanel.setAttribute('aria-busy', String(busy));
  }

  function selectedQuantity() {
    if (!/^[1-9][0-9]{0,3}$/.test(quantityInput.value)) return null;
    const value = Number(quantityInput.value);
    return seatCount(value) ? value : null;
  }

  function currentQuote() {
    return quote && quote.seats === selectedQuantity() && quote.expiresAt > Date.now() && quote.termEndsAt > Date.now();
  }

  function controls() {
    fields.disabled = busy || uncertain || receipt || !context || !handoff || context.termEndsAt === null || closed;
    requestQuoteButton.disabled = selectedQuantity() === null;
    recover.disabled = busy;
    confirmButton.disabled = busy || uncertain || receipt || !handoff || closed || !currentQuote();
    confirmButton.textContent = confirming ? '正在确认订单…' : '确认报价并创建模拟订单';
    requestQuoteButton.textContent = busy && !confirming ? '正在核对…' : '查看服务端报价';
    statusPanel.setAttribute('aria-busy', String(busy));
  }

  function clearQuote() {
    if (quoteTimer !== null) clearTimeout(quoteTimer);
    quoteTimer = null;
    quote = null;
    byId('quote-panel').hidden = true;
    byId('quote-seats').textContent = '';
    byId('quote-amount').textContent = '';
    byId('quote-ends-at').textContent = '';
    byId('quote-expires-at').textContent = '';
    if (!receipt) byId('order-total').textContent = '—';
  }

  function watchQuoteExpiry() {
    if (!quote || closed || receipt) return;
    const remaining = Math.min(quote.expiresAt, quote.termEndsAt) - Date.now();
    if (remaining <= 0) {
      clearQuote();
      if (!busy && !uncertain) status('报价已失效', '请重新核对数量并获取服务端报价，再明确确认订单。');
      controls();
      return;
    }
    quoteTimer = setTimeout(watchQuoteExpiry, Math.min(remaining, 2_147_483_647));
  }

  function updateQuantity() {
    const quantity = selectedQuantity();
    const invalid = quantity === null;
    byId('seat-error').textContent = invalid ? '请输入 1–1000 之间的完整整数席位数。' : '';
    quantityInput.setAttribute('aria-invalid', String(invalid));
    byId('summary-seats').textContent = invalid ? '—' : numberFormat.format(quantity) + ' 席';
    controls();
    return quantity;
  }

  function renderQuote(value) {
    clearQuote();
    quote = value;
    byId('quote-seats').textContent = numberFormat.format(value.seats) + ' 席';
    byId('quote-amount').textContent = amount(value.amountMinor);
    byId('quote-ends-at').textContent = date(value.termEndsAt);
    byId('quote-expires-at').textContent = date(value.expiresAt);
    byId('quote-panel').hidden = false;
    byId('order-total').textContent = amount(value.amountMinor);
    byId('summary-seats').textContent = numberFormat.format(value.seats) + ' 席';
    status('服务端报价已就绪', '请核对数量、金额、席位期限和报价确认截止时间，再点击确认创建模拟订单。');
    watchQuoteExpiry();
    controls();
  }

  function renderOrder(order) {
    clearQuote();
    receipt = true;
    uncertain = false;
    form.hidden = true;
    byId('subscription-unavailable').hidden = true;
    byId('receipt-panel').hidden = false;
    byId('receipt-id').textContent = order.id;
    byId('receipt-seats').textContent = numberFormat.format(order.seats) + ' 席';
    byId('receipt-created').textContent = date(order.createdAt);
    byId('receipt-amount').textContent = amount(order.amountMinor);
    byId('receipt-ends-at').textContent = date(order.termEndsAt);
    byId('receipt-quote-expires-at').textContent = date(order.quoteExpiresAt);
    byId('order-total').textContent = amount(order.amountMinor);
    byId('summary-seats').textContent = numberFormat.format(order.seats) + ' 席';
    byId('summary-note').textContent = '金额、数量与期限来自已保存的原订单回执，不随当前目录或订阅变化。';
    status('原订单已确认', '本次模拟增购订单已保存。请保留订单编号；本页不会发起收款或重复提交。');
    controls();
  }

  function renderContext(value, recovered) {
    context = value;
    byId('team-title').textContent = value.teamName;
    byId('checkout-content').hidden = false;
    if (value.order) { renderOrder(value.order); return; }
    uncertain = false;
    clearQuote();
    const unavailable = value.termEndsAt === null;
    form.hidden = unavailable;
    byId('subscription-unavailable').hidden = !unavailable;
    byId('seat-unit-amount').textContent = amount(value.offer.annualUnitAmountMinor) + ' / 席 / 年';
    byId('current-term-ends-at').textContent = unavailable ? '当前不可增购' : date(value.termEndsAt);
    updateQuantity();
    if (unavailable) {
      byId('summary-seats').textContent = '—';
      status('当前订阅不可增购', '请返回桌面核对订阅并先续费，再重新打开官网增购页。');
    } else status(recovered ? '已核对：本次入口尚无订单' : '桌面授权已核对',
      recovered ? '请重新获取服务端报价并明确确认。页面不会自动重新提交。' : '请选择新增席位数量，再获取服务端报价。');
    controls();
  }

  function unavailable(kind, operation) {
    if (closed) return;
    clearQuote();
    if (kind === 'expired') {
      handoff = '';
      status('增购页授权已失效', operation === 'order' ?
        '请先回桌面核对订单记录，再从“订阅与席位”重新打开官网增购页。' :
        '请返回审易桌面客户端，从“订阅与席位”重新打开官网增购页。');
    } else if (operation === 'order') {
      status('订单结果尚未确认', '请先只读核对原订单。若期限或报价已变化，需要重新核对；页面不会自动重新提交。', true);
    } else if (kind === 'term') {
      status('当前期限不可增购', '请先只读核对原订单，再返回桌面核对订阅并续费。', true);
    } else if (kind === 'conflict') {
      status('报价或订单状态已变化', '请先只读核对原订单。确认尚无订单后，再重新获取报价。', true);
    } else status('暂时无法核对增购', '请检查连接后只读核对原订单；页面不会自动获取报价或创建订单。', true);
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
        body: JSON.stringify(body), signal: controller.signal, credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        controller.abort();
        throw new Error(response.status === 403 ? 'expired' : response.status === 402 ? 'term' : response.status === 409 ? 'conflict' : 'unavailable');
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
    clearQuote();
    controls();
    status('正在只读核对订单', '正在确认团队授权、订阅期限与本次入口的原订单。');
    try {
      const value = await request('/api/website-checkout/seat-context', {handoff});
      if (closed) return;
      if (!validContext(value)) throw new Error('invalid');
      renderContext(value, recovered);
    } catch (error) {
      unavailable(error.message, uncertain ? 'order' : 'context');
    } finally {
      busy = false;
      controls();
    }
  }

  quantityInput.addEventListener('input', () => {
    if (context && !busy && !uncertain && !receipt && !closed) {
      const hadQuote = Boolean(quote);
      clearQuote();
      updateQuantity();
      if (hadQuote) status('数量已修改，原报价失效', '请重新获取服务端报价，再核对并确认订单。');
    }
  });
  recover.addEventListener('click', () => loadContext(true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || uncertain || receipt || !context || context.termEndsAt === null || !handoff || closed) return;
    const quantity = updateQuantity();
    if (quantity === null) { quantityInput.focus(); return; }
    busy = true;
    clearQuote();
    controls();
    status('正在获取服务端报价', '本次仅核对报价，不创建订单。');
    try {
      const value = await request('/api/website-checkout/seat-quote', {
        handoff, offerId: context.offer.id, offerRevision: context.offer.revision, quantity,
      });
      if (closed) return;
      if (!validQuote(value, quantity)) throw new Error('invalid');
      if (value.quote.expiresAt <= Date.now() || value.quote.termEndsAt <= Date.now()) throw new Error('conflict');
      renderQuote(value.quote);
    } catch (error) {
      uncertain = true;
      unavailable(error.message, 'quote');
    } finally {
      busy = false;
      controls();
    }
  });

  confirmButton.addEventListener('click', async () => {
    if (busy || uncertain || receipt || !context || !handoff || closed) return;
    if (!currentQuote()) {
      clearQuote();
      status('报价已失效', '请重新核对数量并获取服务端报价，再明确确认订单。');
      controls();
      return;
    }
    const confirmedQuote = quote;
    busy = true;
    confirming = true;
    uncertain = true;
    controls();
    status('正在确认模拟订单', '请稍候，不要重复提交。');
    try {
      const value = await request('/api/website-checkout/seat-orders', {handoff, quoteId: confirmedQuote.id});
      if (closed) return;
      if (!exact(value, ['simulation', 'order']) || value.simulation !== true || !validOrder(value.order) ||
          value.order.seats !== confirmedQuote.seats || value.order.amountMinor !== confirmedQuote.amountMinor ||
          value.order.termEndsAt !== confirmedQuote.termEndsAt) throw new Error('invalid');
      renderOrder(value.order);
    } catch (error) {
      unavailable(error.message, 'order');
    } finally {
      busy = false;
      confirming = false;
      controls();
    }
  });

  window.addEventListener('pagehide', () => {
    closed = true;
    handoff = '';
    context = null;
    clearQuote();
    if (activeController) activeController.abort();
    controls();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && closed) status('请从桌面重新打开', '本页授权已在离开页面时清除。请从审易桌面客户端重新打开官网增购页。');
  });

  if (handoff) loadContext();
  else {
    status('请从桌面打开增购页', '请在审易桌面客户端的“订阅与席位”中打开官网增购页，以核对当前团队授权。');
    controls();
  }
})();
