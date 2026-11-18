(function () {
  'use strict';

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  const reasons = {
    intake: {
      'duplicate-payment': '重复付款反馈', 'purchase-change': '购买事项变化',
      'service-issue': '服务问题反馈', other: '其他事项'
    },
    'follow-up': {
      'payment-checked': '已核对付款记录', 'details-requested': '已请对方补充资料',
      'customer-contacted': '已沟通反馈', other: '其他跟进'
    }
  };
  const orderTypes = { annual: '团队年费', seat: '增购席位' };
  const orderStates = { pending: '未确认收款', 'payment-verified': '已核验，待到账', paid: '已到账' };
  const deviceErrors = new Set(['DEVICE_PROOF_REQUIRED', 'DEVICE_NOT_READY', 'DEVICE_STATE_CHANGED', 'DEVICE_VAULT_UNAVAILABLE',
    'DEVICE_CAPABILITY_REQUIRED', 'DEVICE_SERVER_CHANGED']);
  const denyErrors = new Set(['HTTP_403', 'HTTP_404', 'FORBIDDEN', 'NOT_FOUND', 'BILLING_UNAVAILABLE', 'REFUND_INTAKE_UNAVAILABLE']);
  const methods = ['getRefundIntakeAccess', 'getRefundIntake', 'recordRefundIntake'];
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function amount(minor) {
    const cents = BigInt(minor);
    const fraction = String(cents % 100n).padStart(2, '0');
    return money.formatToParts(cents / 100n).map(part => part.type === 'fraction' ? fraction : part.value).join('');
  }

  function matches(pattern, value) { return pattern.exec(value)?.[0] === value; }

  window.createRefundIntakeView = function ({ api, getContext, onUnauthorized, onDeviceUnavailable }) {
    const by = name => document.getElementById('refund-intake-' + name);
    const panel = by('panel');
    if (!panel || !methods.every(name => typeof api?.[name] === 'function')) return null;
    let scope = '', identity = '', granted = false, access = null, action = null, nextAccessCheck = 0;
    let review = null, rows = [], intent = null;

    function scopeKey(context) {
      return context.ready && context.identity && document.visibilityState !== 'hidden'
        ? JSON.stringify([context.identity, context.actor, context.device, context.teamId]) : '';
    }

    function sameScope(key) { return !!key && scope === key && key === scopeKey(getContext()); }

    function message(text = '', error = false) {
      by('message').textContent = text;
      by('message').classList.toggle('error', error);
    }

    function canOpen() { return granted && sameScope(scope) && panel.open && !panel.hidden; }

    function controls() {
      const locked = !canOpen() || !!access || !!action || getContext().busy;
      const orderId = by('order-id').value.trim();
      const canRecord = review?.order.confirmedAt != null;
      by('kind').disabled = by('order-id').disabled = locked;
      by('lookup').disabled = locked || !matches(uuid, orderId);
      by('older').hidden = review?.nextBeforeRevision == null;
      by('older').disabled = locked;
      by('entry').hidden = !canRecord;
      for (const field of ['reason', 'reference', 'password']) by(field).disabled = locked || !canRecord;
      by('record').disabled = locked || !canRecord || !by('reason').value || !by('password').value;
    }

    function clearCase() {
      action = null;
      review = null;
      rows = [];
      for (const name of ['reference', 'password']) by(name).value = '';
      for (const name of ['reason', 'order', 'history']) by(name).replaceChildren();
      by('details').hidden = true;
      message();
    }

    function conceal() {
      access = null;
      granted = false;
      clearCase();
      panel.hidden = true;
      panel.open = false;
      observer.takeRecords();
      by('kind').value = 'annual';
      by('order-id').value = '';
      controls();
    }

    function reset() {
      scope = identity = '';
      intent = null;
      conceal();
    }

    function handleSessionError(error) {
      if (error?.code === 'SIGN_IN_REQUIRED' || error?.code === 'HTTP_401') {
        reset();
        onUnauthorized();
        return true;
      }
      if (deviceErrors.has(error?.code)) {
        scope = '';
        conceal();
        onDeviceUnavailable();
        return true;
      }
      return false;
    }

    async function invoke(method, input) {
      const result = input ? await api[method](input) : await api[method]();
      if (result?.ok) return result.value;
      throw result?.error ?? { code: 'INVALID_RESPONSE' };
    }

    async function checkAccess() {
      if (!sameScope(scope) || access) return;
      const pending = { scope };
      access = pending;
      // The workspace already polls device state. Refresh owner authorization on
      // that cadence while the panel is open, without extra background timers.
      nextAccessCheck = Date.now() + 15000;
      controls();
      try {
        const data = await invoke('getRefundIntakeAccess');
        if (access !== pending || !sameScope(pending.scope)) return;
        if (data?.canReview !== true) { conceal(); return; }
        granted = true;
        panel.hidden = false;
      } catch (error) {
        if (access === pending && sameScope(pending.scope) && !handleSessionError(error)) conceal();
      } finally {
        if (access === pending) access = null;
        controls();
      }
    }

    function update() {
      const context = getContext(), currentIdentity = context.identity || '';
      if (identity !== currentIdentity) { intent = null; identity = currentIdentity; }
      const key = scopeKey(context);
      if (key !== scope) {
        scope = key;
        conceal();
        if (key) void checkAccess();
      } else if (key && panel.open && !action && Date.now() >= nextAccessCheck) void checkAccess();
      controls();
    }

    function panelChanged() {
      clearCase();
      by('kind').value = 'annual';
      by('order-id').value = '';
      if (canOpen()) void checkAccess();
      controls();
    }

    function selected() { return { kind: by('kind').value, orderId: by('order-id').value.trim() }; }

    function current(pending) {
      if (observer.takeRecords().length) panelChanged();
      const selection = selected();
      return action === pending && sameScope(pending.scope) && canOpen() &&
        pending.kind === selection.kind && pending.orderId === selection.orderId;
    }

    function renderOrder() {
      const { order } = review;
      const facts = [
        ['团队', order.teamName],
        ['原订单编号', order.id],
        ['订单类型', orderTypes[order.kind]],
        ['原订单金额', amount(order.amountMinor)],
        ['收款状态', orderStates[order.status] + (order.paymentException ? ' · 支付异常待复核' : '')],
        ['收款确认时间（北京时间）', order.confirmedAt === null ? '未确认' : dateFormat.format(order.confirmedAt)],
      ];
      by('order').replaceChildren(...facts.map(([name, value]) => {
        const row = element('div');
        row.append(element('dt', name), element('dd', value));
        return row;
      }));
    }

    function render() {
      renderOrder();
      const { revision } = review;
      const title = revision ? '登记跟进' : '登记受理';
      by('entry-heading').textContent = by('record').textContent = title;
      const choices = reasons[revision ? 'follow-up' : 'intake'];
      by('reason').replaceChildren(new Option('选择记录事项', ''), ...Object.entries(choices).map(([key, label]) => new Option(label, key)));
      by('reference').value = by('password').value = '';
      by('details').hidden = false;
      renderHistory();
    }

    function renderHistory() {
      by('empty').hidden = rows.length > 0;
      by('history').replaceChildren(...rows.map(entry => {
        const row = element('li');
        row.className = 'billing-order';
        row.dataset.revision = String(entry.revision);
        row.append(
          element('strong', (entry.kind === 'intake' ? '受理' : '跟进') + ' · ' + reasons[entry.kind][entry.reason]),
          element('p', dateFormat.format(entry.recordedAt) + '（北京时间） · 负责人 ' + entry.recordedBy),
        );
        if (entry.reference) row.append(element('p', '关联编号 ' + entry.reference));
        return row;
      }));
    }

    async function lookup() {
      if (by('lookup').disabled || !canOpen()) return;
      const selection = selected();
      clearCase();
      const pending = { ...selection, scope };
      action = pending;
      controls();
      message('正在核对原订单…');
      try {
        const data = await invoke('getRefundIntake', selection);
        if (!current(pending)) return;
        review = data;
        rows = data.entries;
        render();
        message(data.order.confirmedAt === null ? '原订单尚未确认收款。收款确认后可登记受理。' : '');
      } catch (error) {
        if (!current(pending) || handleSessionError(error)) return;
        if (denyErrors.has(error?.code)) void checkAccess();
        message('无法读取原订单，请核对订单类型和编号后重试。', true);
      } finally {
        if (action === pending) action = null;
        controls();
      }
    }

    async function older() {
      if (by('older').disabled || by('older').hidden || !canOpen()) return;
      const selection = selected(), pending = { ...selection, scope };
      action = pending;
      controls();
      try {
        const data = await invoke('getRefundIntake', { ...selection, beforeRevision: review.nextBeforeRevision });
        if (!current(pending)) return;
        if (data.revision !== review.revision) {
          clearCase();
          message('受理记录已更新，请重新核对原订单。', true);
          return;
        }
        review = data;
        rows = [...rows, ...data.entries];
        renderOrder();
        renderHistory();
        message();
      } catch (error) {
        if (!current(pending) || handleSessionError(error)) return;
        if (denyErrors.has(error?.code)) {
          clearCase();
          void checkAccess();
        }
        message('无法读取更早的受理记录，请重新核对原订单。', true);
      } finally {
        if (action === pending) action = null;
        controls();
      }
    }

    async function record() {
      if (by('record').disabled || !canOpen() || review?.order.confirmedAt == null) return;
      const selection = selected(), reason = by('reason').value, reference = by('reference').value.trim();
      const currentPassword = by('password').value;
      by('password').value = '';
      controls();
      if (review.order.id !== selection.orderId || review.order.kind !== selection.kind) return;
      if (!Object.hasOwn(reasons[review.revision ? 'follow-up' : 'intake'], reason) ||
          reference && !matches(referencePattern, reference)) {
        message('请核对记录事项和关联编号。', true);
        return;
      }
      if (new TextEncoder().encode(currentPassword).length > 512) {
        message('当前密码不得超过 512 字节，请重新输入。', true);
        return;
      }
      const request = { ...selection, expectedRevision: review.revision, reason, ...(reference ? { reference } : {}) };
      const intentKey = JSON.stringify(request);
      if (intent?.key !== intentKey) intent = { key: intentKey, requestId: crypto.randomUUID() };
      const pending = { ...selection, scope };
      action = pending;
      controls();
      message('正在核验密码并登记…');
      try {
        const data = await invoke('recordRefundIntake', { ...request, requestId: intent.requestId, currentPassword });
        if (!current(pending)) return;
        review = data;
        rows = data.entries;
        intent = null;
        render();
        message(request.expectedRevision === 0 ? '已登记受理。' : '已登记跟进。');
      } catch (error) {
        if (!current(pending) || handleSessionError(error)) return;
        if (error?.code === 'VERIFICATION_FAILED') {
          message('当前密码未通过核验，请重新输入。', true);
        } else if (denyErrors.has(error?.code)) {
          clearCase();
          void checkAccess();
          message('当前订单无法继续登记，请重新核对。', true);
        } else if (['HTTP_409', 'BILLING_REFUND_INTAKE_CONFLICT', 'BILLING_REFUND_INTAKE_PAYMENT_REQUIRED'].includes(error?.code)) {
          clearCase();
          message('记录或收款状态已更新，请重新核对原订单。', true);
        } else {
          message('登记结果暂未确认。可核对原订单，或保留原信息重试。', true);
        }
      } finally {
        if (action === pending) action = null;
        controls();
      }
    }

    const observer = new MutationObserver(panelChanged);
    observer.observe(panel, { attributes: true, attributeFilter: ['open'] });
    document.addEventListener('visibilitychange', update);
    for (const field of ['kind', 'order-id']) {
      by(field).addEventListener(field === 'kind' ? 'change' : 'input', () => { clearCase(); controls(); });
    }
    for (const field of ['reason', 'reference', 'password']) by(field).addEventListener('input', controls);
    by('lookup').addEventListener('click', () => void lookup());
    by('older').addEventListener('click', () => void older());
    by('record').addEventListener('click', () => void record());
    for (const [field, run] of [['order-id', lookup], ['password', record]]) {
      by(field).addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          void run();
        }
      });
    }
    return {
      update, reset,
      destroy() { observer.disconnect(); document.removeEventListener('visibilitychange', update); reset(); }
    };
  };
})();
