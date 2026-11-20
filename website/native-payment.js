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
  const paths = {
    order: '/api/website-pay/order',
    code: '/api/website-pay/code',
    check: '/api/website-pay/check',
  };
  const productNames = {
    'team-annual-renewal': '团队年订阅',
    'team-seat-addition': '员工席位增购',
  };
  const states = {
    pending: ['待付款', '扫码付款后，可在此查询服务端确认结果。'],
    pending_fulfilment: ['付款已核实，等待到账', '收款已经核实，订阅或席位尚在处理。可稍后再次查询。'],
    fulfilled: ['权益已到账', '服务端已确认订阅或席位生效，可返回审易客户端查看。'],
    needs_review: ['订单待复核', '请保留订单编号并联系团队管理员核对。'],
    closed: ['订单已关闭', '需要继续购买时，请返回审易客户端处理。'],
    expired: ['已过付款截止', '若您已扫码付款，仍可查询这笔订单。'],
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
  let activeController = null;
  let closed = false;
  let handoffDeadline = null;
  let handoffTimer;
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

  function validOrder(value) {
    return value && Object.keys(value).length === 8 &&
      typeof value.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id) &&
      Object.hasOwn(productNames, value.product) && typeof value.teamName === 'string' &&
      value.teamName.isWellFormed() && value.teamName.trim().length > 0 && [...value.teamName].length <= 80 &&
      !/[\p{Cc}\p{Cf}]/u.test(value.teamName) && value.currency === 'CNY' &&
      Number.isInteger(value.amountMinor) && value.amountMinor >= 1 && value.amountMinor <= 2_147_483_647 &&
      Number.isInteger(value.seats) && value.seats >= 0 && value.seats <= 1000 &&
      Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0 && value.expiresAt <= 253_402_300_799_000 &&
      Object.hasOwn(states, value.status);
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

  function reset(title, detail) {
    handoff = '';
    handoffDeadline = null;
    clearTimeout(handoffTimer);
    order = null;
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
    reset('订单页授权已失效', '请返回已绑定的审易客户端，重新打开这笔订单。');
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

  function controls() {
    const busy = activeController !== null;
    const pending = order?.status === 'pending';
    status.setAttribute('aria-busy', String(busy));
    retry.hidden = !handoff || order !== null || busy;
    generate.hidden = !pending;
    generate.disabled = busy || !handoff || !barcode.hidden;
    check.hidden = !order || order.status === 'fulfilled';
    check.disabled = busy || !handoff;
  }

  function showOrder(value) {
    const yuan = Math.floor(value.amountMinor / 100);
    const fen = String(value.amountMinor % 100).padStart(2, '0');
    byId('order-title').textContent = productNames[value.product];
    byId('team-name').textContent = value.teamName;
    byId('order-amount').textContent = `¥${numberFormat.format(yuan)}.${fen}`;
    byId('order-id').textContent = value.id;
    byId('order-seats').textContent = `${numberFormat.format(value.seats)} 席`;
    byId('order-expires').textContent = timeFormat.format(value.expiresAt);
    byId('scan-instructions').textContent = value.status === 'pending'
      ? '请先核对订单，再获取本单付款码。' : states[value.status][1];
    content.hidden = false;
    notice(...states[value.status], value.status === 'needs_review' ? 'review' : 'normal');
  }

  function sameLockedOrder(next) {
    return !order || (['id', 'product', 'currency', 'amountMinor', 'seats', 'expiresAt'].every(key => order[key] === next[key]) &&
      (!['pending_fulfilment', 'fulfilled', 'needs_review', 'closed'].includes(order.status) || next.status !== 'pending'));
  }

  async function request(action) {
    if (!handoff || expireHandoff() || activeController || closed) return;
    const requestStartedAt = performance.now();
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    controls();
    try {
      const response = await fetch(paths[action], {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({handoff}),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (closed || activeController !== controller) return;
      if (response.status === 401 || response.status === 403) {
        reset('订单页授权已失效', '请返回已绑定的审易客户端，重新打开这笔订单。');
        return;
      }
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (closed || activeController !== controller) return;
      const {order: next, qr, handoffExpiresInMs} = result ?? {};
      if (!validOrder(next) || !sameLockedOrder(next) || !Number.isInteger(handoffExpiresInMs) ||
        handoffExpiresInMs < 1 || handoffExpiresInMs > 120_000) {
        reset('无法核对原订单', '请返回审易客户端，重新打开原订单后再试。');
        return;
      }
      if (!setHandoffDeadline(requestStartedAt, handoffExpiresInMs)) return;
      order = next;
      showOrder(next);
      if (next.status !== 'pending') {
        clearQr();
      } else if (action === 'code') {
        clearQr();
        if (!validGif(qr)) throw new Error();
        image.src = qr;
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
        check.disabled = false;
        check.focus();
      }
    } catch {
      if (closed || activeController !== controller) return;
      clearQr();
      if (order) {
        notice('暂时无法确认付款结果', '请先查询同一订单，再决定是否扫码。', 'review');
      } else {
        notice('暂时无法读取订单', '可重新核对原订单，或回审易客户端重新打开。', 'review');
      }
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) {
        activeController = null;
        controls();
      }
    }
  }

  retry.addEventListener('click', () => request('order'));
  generate.addEventListener('click', () => request('code'));
  check.addEventListener('click', () => request('check'));
  document.addEventListener('visibilitychange', expireHandoff);
  window.addEventListener('focus', expireHandoff);
  window.addEventListener('hashchange', () => {
    if (!window.location.hash.startsWith('#handoff=')) return;
    const replacement = takeHandoff();
    activeController?.abort();
    activeController = null;
    reset('请从审易客户端打开订单', '使用已绑定的审易客户端打开要支付的原订单。');
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
    reset('请从审易客户端打开订单', '订单页授权随页面关闭而清除。');
  });

  if (handoff) request('order');
  else reset('请从审易客户端打开订单', '使用已绑定的审易客户端打开要支付的原订单。');
})();
