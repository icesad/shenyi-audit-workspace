(function () {
  'use strict';

  const orderNames = { annual: '团队年费', seat: '增购席位' };
  const orderStates = { pending: '待支付', closed: '超时关闭', 'payment-verified': '已核验，待到账', paid: '已到账' };
  const paymentExceptionStates = { refund: '退款待复核', chargeback: '拒付待复核' };
  const batchOutcomes = {
    matched: '已核实',
    closed: '超时关闭',
    'awaiting-review': '待复核',
    'no-evidence': '未返回可信凭据',
    'lookup-unavailable': '暂无法查询渠道',
    'evidence-rejected': '凭据未通过核验',
    'local-failure': '账本处理失败'
  };
  const subscriptionStates = { active: '有效', expired: '已到期', scheduled: '待生效', unconfigured: '尚未开通' };
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const amountFormat = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });
  const date = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()) ? dateFormat.format(value) : '—';
  function amount(minor) {
    const cents = BigInt(minor);
    const fraction = String(cents % 100n).padStart(2, '0');
    return amountFormat.formatToParts(cents / 100n).map(part => part.type === 'fraction' ? fraction : part.value).join('');
  }
  const whole = value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
  const methods = ['getBillingAccess', 'getBillingOverview', 'listBillingOrders', 'createBillingOrder', 'reconcileBillingOrder'];
  const permissionErrors = new Set(['FORBIDDEN', 'HTTP_403', 'HTTP_404', 'NOT_FOUND']);
  const deviceErrors = new Set(['DEVICE_PROOF_REQUIRED', 'DEVICE_NOT_READY', 'DEVICE_STATE_CHANGED', 'DEVICE_VAULT_UNAVAILABLE', 'DEVICE_CAPABILITY_REQUIRED', 'DEVICE_SERVER_CHANGED']);
  const knownErrors = {
    SUBSCRIPTION_REQUIRED: '需要有效的团队年订阅才能增购席位。',
    BILLING_OFFER_CHANGED: '账务选项已更新，请刷新订阅与席位后重新核对。',
    BILLING_CONFLICT: '团队账务状态已变化，请刷新后重新核对。',
    BILLING_RENEWAL_SEATS_RECONCILIATION_REQUIRED: '续费席位需要重新核对。请刷新订阅与席位，减少到已占用数量以下前先释放相应席位。',
    SEAT_CAPACITY_EXHAUSTED: '拟续费席位低于已启用成员与有效邀请的合计数量。请先释放相应席位。',
    SEAT_CAPACITY_CHANGED: '席位已变化，请刷新订阅与席位后重新核对。',
    SUBSCRIPTION_WRITE_UNAVAILABLE: '当前团队订阅不满足此操作的条件，请刷新订阅状态。',
    BILLING_UNAVAILABLE: '当前服务未开通模拟账务。',
    SEAT_ORDER_CONFLICT: '本次订单与当前席位报价不一致，请刷新订阅与席位后重新核对。',
    SEAT_ORDER_RECONCILIATION_REQUIRED: '订单状态需要核对，请刷新订单后再检查。'
  };

  function element(tag, value, className) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function option(value, label) {
    const node = element('option', label);
    node.value = value;
    return node;
  }

  function orderStateText(status, hasException, hasClosure) {
    if (hasClosure && status === 'payment-verified') return '迟到收款待复核';
    if (hasException && status === 'pending') return '未确认收款';
    if (hasException && status === 'payment-verified') return '已核验收款';
    return orderStates[status];
  }

  window.createBillingView = function ({ api, getContext, onUnauthorized, onDeviceUnavailable }) {
    const node = name => document.getElementById('billing-' + name);
    const panel = node('panel');
    const supported = methods.every(method => typeof api?.[method] === 'function');
    let scope = '', identity = '', revision = 0, accessRead = null, team = '', teams = [];
    let overview = null, overviewRead = null, ordersRead = null, orders = [], nextCursor = null, pageCursor = null, previousCursors = [];
    let kind = 'annual', confirmation = null, mutation = null;
    let batchReport = null, failedBatch = null;
    let intents = new Map();

    function keys(context) {
      const owner = context.identity || '';
      const view = context.ready ? JSON.stringify([owner, context.actor, context.device, context.teamId]) : '';
      return { owner, view };
    }

    function currentScope(key) {
      return key && key === scope && key === keys(getContext()).view;
    }

    function capture() {
      return { scope, revision, team, kind };
    }

    function currentView(at) {
      if (panelObserver.takeRecords().length) panelOpenChanged();
      return currentScope(at.scope) && panel.open && !panel.hidden && at.revision === revision && at.team === team && at.kind === kind;
    }

    function message(words = '', error = false) {
      const feedback = node('message');
      feedback.textContent = words;
      feedback.classList.toggle('error', error);
    }

    async function invoke(method, input) {
      const result = input ? await api[method](input) : await api[method]();
      if (result?.ok) return result.value;
      throw { code: result?.error?.code };
    }

    function errorMessage(error, fallback) {
      return Object.hasOwn(knownErrors, error?.code) ? knownErrors[error.code] : fallback;
    }

    function handleSessionError(error) {
      if (error?.code === 'SIGN_IN_REQUIRED') {
        reset();
        onUnauthorized();
        return true;
      }
      if (deviceErrors.has(error?.code)) {
        clearScope();
        onDeviceUnavailable();
        return true;
      }
      return false;
    }

    function canReconcileBatch() {
      return overview?.simulation === true && overview.canReconcile === true && overview.canReconcileBillingBatch === true &&
        typeof api?.reconcileBillingPage === 'function';
    }

    function controls() {
      const disabled = !currentScope(scope) || panel.hidden || !panel.open || !!getContext().busy || !!mutation;
      const annual = kind === 'annual';
      const simulation = overview?.simulation === true;
      const hasOffer = simulation && (annual ? overview.annualOffers.length > 0 : !!overview.seatOffer);
      const blocked = disabled || !!overviewRead;
      node('team').disabled = disabled || teams.length <= 1 || !!accessRead;
      node('refresh').disabled = blocked || !!accessRead;
      node('overview').hidden = !overview;
      node('checkout-section').hidden = node('orders-section').hidden = !simulation;
      node('order-kind').disabled = blocked || !simulation;
      node('annual-fields').hidden = !annual;
      node('renewal-fields').hidden = !annual || !overview?.renewalSeats;
      node('seat-fields').hidden = annual;
      node('annual-offer').disabled = blocked || !hasOffer;
      node('selected-seats').disabled = blocked || !hasOffer;
      node('seat-quantity').disabled = blocked || !hasOffer;
      node('review').disabled = blocked || !hasOffer || !!confirmation;
      node('confirmation').hidden = !confirmation;
      node('confirm').disabled = blocked || !!ordersRead || !confirmation;
      node('cancel').disabled = disabled;
      node('orders-refresh').disabled = disabled || !simulation || !!ordersRead;
      node('orders-more').hidden = !nextCursor;
      node('orders-previous').hidden = !previousCursors.length;
      node('orders-more').disabled = node('orders-previous').disabled = node('orders-refresh').disabled;
      for (const button of node('order-list').querySelectorAll('[data-billing-reconcile]')) button.disabled = disabled || !!ordersRead;
      const batchAvailable = canReconcileBatch();
      const batchBlocked = !batchAvailable || blocked || !!ordersRead || !!accessRead;
      node('batch-section').hidden = !batchAvailable;
      node('batch-start').hidden = !!failedBatch && failedBatch.after === null;
      node('batch-start').textContent = batchReport ? '从首批核对' : '批量核对订单';
      node('batch-retry').hidden = !batchReport && !failedBatch;
      node('batch-next').hidden = !batchReport?.nextCursor || !!failedBatch;
      node('batch-start').disabled = node('batch-retry').disabled = node('batch-next').disabled = batchBlocked;
    }

    function clearConfirmation() {
      confirmation = null;
      node('confirm-text').textContent = '';
    }

    function clearOrders() {
      ordersRead = null;
      orders = [];
      nextCursor = null;
      pageCursor = null;
      previousCursors = [];
      node('order-list').replaceChildren();
      node('orders-message').textContent = '';
    }

    function batchMessage(words = '', error = false) {
      const feedback = node('batch-message');
      feedback.textContent = words;
      feedback.classList.toggle('error', error);
    }

    function clearBatch() {
      batchReport = null;
      failedBatch = null;
      node('batch-results').replaceChildren();
      batchMessage();
    }

    function clearOverview() {
      revision++;
      overview = null;
      overviewRead = null;
      clearConfirmation();
      clearOrders();
      clearBatch();
      message();
      for (const name of ['notice', 'term', 'seats', 'annual-offer', 'order-hint']) node(name).replaceChildren();
      node('selected-seats').value = '';
      node('seat-quantity').value = '';
      controls();
    }

    function setTeams(allowed) {
      const preferred = getContext().teamId;
      teams = allowed;
      team = [team, preferred].find(id => teams.some(candidate => candidate.id === id)) || teams[0]?.id || '';
      node('team').replaceChildren(...teams.map(candidate => option(candidate.id, candidate.name)));
      node('team').value = team;
      panel.hidden = !team;
      if (!team) panel.open = false;
    }

    function clearScope() {
      scope = '';
      accessRead = null;
      team = '';
      setTeams([]);
      kind = node('order-kind').value = 'annual';
      clearOverview();
    }

    function reset() {
      identity = '';
      mutation = null;
      intents = new Map();
      clearScope();
    }

    function discardTeam() {
      setTeams(teams.filter(candidate => candidate.id !== team));
      clearOverview();
      if (panel.open && !panel.hidden) void loadOverview();
    }

    async function discover() {
      const read = { scope };
      accessRead = read;
      controls();
      try {
        const value = await invoke('getBillingAccess');
        if (accessRead !== read || !currentScope(read.scope)) return;
        const oldTeam = team;
        setTeams(value.teams);
        if (oldTeam !== team) clearOverview();
        if (panel.open && team) void loadOverview();
      } catch (error) {
        if (accessRead !== read || !currentScope(read.scope) || handleSessionError(error)) return;
        clearOverview();
        if (permissionErrors.has(error?.code)) setTeams([]);
        else if (team && panel.open) message('暂时无法核验账务权限，请重试。', true);
      } finally {
        if (accessRead === read) accessRead = null;
        controls();
      }
    }

    function update() {
      const next = supported ? keys(getContext()) : { owner: '', view: '' };
      if (next.owner !== identity) {
        reset();
        identity = next.owner;
      }
      if (next.view !== scope) {
        clearScope();
        scope = next.view;
        if (scope) void discover();
      }
      controls();
    }

    function drawCheckout() {
      const annual = kind === 'annual';
      node('orders-heading').textContent = orderNames[kind] + '订单';
      const renewal = overview.renewalSeats;
      let hint;
      if (!annual) {
        hint = overview.seatOffer ? '增购席位随当前年订阅到期，按剩余期限折算。' : '当前没有可用的增购选项。';
      } else if (overview.annualOffers.length === 0) {
        hint = '当前没有可用的团队年费选项。';
      } else if (renewal) {
        hint = '默认 ' + renewal.defaultSeats + ' 席，已启用成员和有效邀请合计 ' + renewal.committedSeats + ' 席。需要减少到这一数量以下时，请先释放席位。';
      } else {
        hint = '订单金额由服务端生成。';
      }
      node('order-hint').textContent = hint;
    }

    function drawOverview(keepDraft = false) {
      const { subscription, seats, annualOffers, renewalSeats } = overview;
      node('notice').textContent = overview.simulation
        ? '本机模拟账务。创建订单和核对状态均不收款。'
        : '当前仅可查阅订阅与席位。在线续费尚未开通。';
      const term = subscription.startsAt == null ? '' : '　' + date(subscription.startsAt) + ' 至 ' + date(subscription.endsAt) + '（北京时间）';
      node('term').textContent = '团队年订阅 · ' + (subscriptionStates[subscription.state] || '状态待核对') + term;
      node('seats').replaceChildren();
      const metrics = [
        ['已购', seats.purchasedSeats], ['已启用', seats.activeBusinessSeats], ['邀请预留', seats.reservedInvitationSeats],
        ['合计占用', seats.usedSeats], ['可用', seats.availableSeats]
      ];
      for (const [label, value] of metrics) {
        const metric = element('div');
        metric.append(element('dt', label), element('dd', value));
        node('seats').append(metric);
      }
      if (!overview.simulation) return;
      const selectedOffer = node('annual-offer').value;
      const chosen = annualOffers.map((offer, index) => option(offer.id, annualOffers.length === 1 ? '团队年费' : '团队年费 · 目录价 ' + amount(offer.amountMinor) + ' · 选项 ' + (index + 1)));
      node('annual-offer').replaceChildren(...chosen);
      if (keepDraft && annualOffers.some(offer => offer.id === selectedOffer)) node('annual-offer').value = selectedOffer;
      node('selected-seats').min = renewalSeats?.committedSeats ?? 0;
      if (!keepDraft || !renewalSeats) node('selected-seats').value = renewalSeats?.defaultSeats ?? '';
      if (!keepDraft || !overview.seatOffer) node('seat-quantity').value = overview.seatOffer ? '1' : '';
      drawCheckout();
    }

    async function loadOverview({ success = '', keepOrders = false, keepDraft = false } = {}) {
      if (!team || panel.hidden || !panel.open || !currentScope(scope)) return;
      if (!keepOrders) clearOverview();
      const read = capture();
      overviewRead = read;
      message('正在读取订阅与席位…');
      controls();
      try {
        const value = await invoke('getBillingOverview', { teamId: team });
        if (!currentView(read) || overviewRead !== read) return;
        if (value?.teamId !== team || typeof value.simulation !== 'boolean') throw new Error('Unexpected billing overview');
        overview = value;
        if (!canReconcileBatch()) clearBatch();
        drawOverview(keepDraft);
        message(success);
        if (!overview.simulation) {
          clearConfirmation();
          clearOrders();
        } else if (keepOrders) drawOrders();
        else void loadOrders();
      } catch (error) {
        if (!currentView(read) || overviewRead !== read || handleSessionError(error)) return;
        if (permissionErrors.has(error?.code)) discardTeam();
        else message(errorMessage(error, (success ? success : '') + '无法读取订阅与席位，请刷新重试。'), true);
      } finally {
        if (overviewRead === read) overviewRead = null;
        controls();
      }
    }

    function canReconcileOrder(order) {
      return overview?.simulation === true && overview.canReconcile === true && order && (order.status !== 'paid' ||
        overview.canReconcilePaymentExceptions === true && !order.paymentException);
    }

    function orderRow(order) {
      const row = element('li', undefined, 'billing-order');
      const header = element('div');
      const exception = order.paymentException;
      const state = element('strong', orderStateText(order.status, exception, order.closure), 'billing-order-state');
      row.dataset.orderId = order.id;
      state.dataset.state = order.status;
      if (order.closure && order.status === 'payment-verified') state.dataset.closureReview = 'true';
      header.append(state);
      if (exception) {
        const exceptionState = element('strong', paymentExceptionStates[exception.kind], 'billing-order-exception');
        exceptionState.dataset.paymentException = exception.kind;
        header.append(exceptionState);
      }
      header.append(element('span', amount(order.offer.amountMinor), 'billing-order-amount'));
      row.append(header, element('p', '订单 ' + order.id), element('p', '创建于 ' + date(order.createdAt) + '（北京时间）'));
      if (order.confirmedAt != null) row.append(element('p', '收款确认 ' + date(order.confirmedAt) + '（北京时间，模拟）'));
      if (exception) row.append(element('p', '异常发生于 ' + date(exception.occurredAt) + '（北京时间，模拟）'));
      if (order.closure) {
        const closed = element('p', '超时关闭于 ' + date(order.closure.closedAt) + '（北京时间，模拟）');
        closed.dataset.orderClosure = 'true';
        row.append(element('p', '支付期限至 ' + date(order.closure.deadlineAt) + '（北京时间）'), closed);
      } else if (kind === 'annual' && order.status === 'pending' && !exception && order.paymentDeadlineAt !== undefined) {
        row.append(element('p', '支付期限至 ' + date(order.paymentDeadlineAt) + '（北京时间）'));
      }
      if (kind === 'seat') {
        row.append(element('p', '增购 ' + order.quantity + ' 席，到期 ' + date(order.termEndsAt) + '（北京时间）'));
        if (order.status === 'pending' && !exception) row.append(element('p', '报价有效至 ' + date(order.quoteExpiresAt) + '（北京时间）'));
      }
      if (order.renewalSeats) row.append(element('p', '续费 ' + order.renewalSeats.selectedSeats + ' 席（默认 ' + order.renewalSeats.defaultSeats + ' 席）'));
      if (order.fulfilment) row.append(element('p', '续费期限 ' + date(order.fulfilment.renewalStartsAt) + ' 至 ' + date(order.fulfilment.endsAt) + '（北京时间）'));
      const grant = order.grant || order.renewalSeatGrant;
      if (grant) row.append(element('p', '席位 ' + grant.seats + ' 席适用期限 ' + date(grant.startsAt) + ' 至 ' + date(grant.endsAt) + '（北京时间）'));
      if (canReconcileOrder(order)) {
        const button = element('button', '核对订单状态', 'button');
        button.type = 'button';
        button.dataset.billingReconcile = order.id;
        row.append(button);
      }
      return row;
    }

    function drawOrders() {
      node('order-list').replaceChildren(...orders.map(orderRow));
      node('orders-message').textContent = orders.length === 0 ? '暂无' + orderNames[kind] + '订单。' : previousCursors.length || nextCursor ? '第 ' + (previousCursors.length + 1) + ' 页' : '';
    }

    function trackActionFocus(button) {
      if (document.activeElement !== button) return null;
      let moved = false;
      const track = event => {
        if (event.target !== button && event.target !== document.body) moved = true;
      };
      document.addEventListener('focusin', track, true);
      return target => {
        document.removeEventListener('focusin', track, true);
        if (!moved && (document.activeElement === document.body || document.activeElement === button)) target()?.focus();
      };
    }

    async function loadOrders(move = 'reload') {
      if (overview?.simulation !== true || ordersRead || move === 'next' && !nextCursor || move === 'previous' && !previousCursors.length) return;
      const read = capture();
      if (!currentView(read)) return;
      const input = { teamId: team, kind };
      const cursor = move === 'next' ? nextCursor : move === 'previous' ? previousCursors.at(-1) : pageCursor;
      if (cursor) input.after = cursor;
      ordersRead = read;
      node('orders-message').textContent = '正在读取订单…';
      controls();
      try {
        const value = await invoke('listBillingOrders', input);
        if (!currentView(read) || ordersRead !== read) return;
        if (move === 'next') previousCursors.push(pageCursor);
        else if (move === 'previous') previousCursors.pop();
        pageCursor = cursor;
        orders = value.orders.filter(order => order.teamId === team);
        nextCursor = value.hasMore && value.nextCursor !== input.after ? value.nextCursor : null;
        if (previousCursors.includes(nextCursor)) nextCursor = null;
        drawOrders();
      } catch (error) {
        if (!currentView(read) || ordersRead !== read || handleSessionError(error)) return;
        if (permissionErrors.has(error?.code)) discardTeam();
        else node('orders-message').textContent = errorMessage(error, '无法读取订单，请刷新重试。');
      } finally {
        if (ordersRead === read) ordersRead = null;
        controls();
      }
    }

    function review() {
      if (node('review').disabled || overview?.simulation !== true || !currentView(capture())) return;
      const annual = kind === 'annual';
      const offer = annual ? overview.annualOffers.find(record => record.id === node('annual-offer').value) : overview.seatOffer;
      if (!offer) return;
      const input = { teamId: team, kind, offerId: offer.id, offerRevision: offer.revision };
      let selection = '';
      if (annual && overview.renewalSeats) {
        const value = node('selected-seats').value;
        if (value !== '0' && !whole(value)) { message('请输入非负整数作为续费席位数。', true); return; }
        if (Number(value) < overview.renewalSeats.committedSeats) {
          message('续费至少需要 ' + overview.renewalSeats.committedSeats + ' 席。请先停用相应成员或撤销有效邀请。', true);
          return;
        }
        input.selectedSeats = Number(value);
        selection = '，续费 ' + value + ' 席';
      } else if (!annual) {
        const value = node('seat-quantity').value;
        if (!whole(value) || Number(value) > 1000) { message('单次可增购 1 至 1000 个席位，请输入整数。', true); return; }
        input.quantity = Number(value);
        selection = ' ' + value + ' 席';
      }
      const name = teams.find(candidate => candidate.id === team).name;
      confirmation = { input, key: JSON.stringify(input) };
      node('confirm-text').textContent = '为「' + name + '」创建' + orderNames[kind] + '模拟订单' + selection + '。金额由服务端生成，创建后可在下方核对。';
      message();
      controls();
      node('confirm').focus();
    }

    function upsertOrder(order) {
      const index = orders.findIndex(existing => existing.id === order.id);
      if (index >= 0) orders[index] = order;
      else orders.unshift(order);
      drawOrders();
    }

    async function createOrder() {
      if (node('confirm').disabled || overview?.simulation !== true || !confirmation || !currentView(capture())) return;
      const at = capture();
      const { input, key } = confirmation;
      const store = intents;
      let requestId = store.get(key);
      if (!requestId) {
        requestId = window.crypto.randomUUID();
        store.set(key, requestId);
      }
      const operation = {};
      mutation = operation;
      controls();
      message('正在创建模拟订单…');
      try {
        const result = await invoke('createBillingOrder', { ...input, requestId });
        if (!currentView(at)) return;
        if (result?.order?.teamId !== team) throw new Error('Unexpected billing order');
        store.delete(key);
        clearConfirmation();
        upsertOrder(result.order);
        message('已创建模拟订单，金额 ' + amount(result.order.offer.amountMinor) + '。');
      } catch (error) {
        if (!currentView(at) || handleSessionError(error)) return;
        if (permissionErrors.has(error?.code)) discardTeam();
        else message(errorMessage(error, '创建结果待确认。可重试本次订单，系统会沿用同一订单请求。'), true);
      } finally {
        if (mutation === operation) mutation = null;
        controls();
      }
    }

    async function reconcile(button) {
      const orderId = button.dataset.billingReconcile;
      const order = orders.find(item => item.id === orderId);
      if (mutation || ordersRead || !canReconcileOrder(order)) return;
      const at = capture();
      if (!currentView(at) || getContext().busy) return;
      const restoreFocus = trackActionFocus(button);
      const operation = {};
      mutation = operation;
      clearConfirmation();
      controls();
      message('正在核对订单状态…');
      try {
        const result = await invoke('reconcileBillingOrder', { teamId: team, kind, orderId });
        if (!currentView(at)) return;
        if (result?.order?.id !== orderId || result.order.teamId !== team) throw new Error('Unexpected billing order');
        upsertOrder(result.order);
        if (result.order.closure) message('模拟订单 · ' + orderStateText(result.order.status, result.order.paymentException, true) + '。');
        else if (result.order.paymentException) message('模拟订单 · ' + paymentExceptionStates[result.order.paymentException.kind] + '。');
        else if (order.status !== 'paid' && result.order.status === 'paid') await loadOverview({ success: '模拟订单已到账。', keepOrders: true });
        else message('模拟订单 · ' + orderStates[result.order.status] + '。');
      } catch (error) {
        if (!currentView(at) || handleSessionError(error)) return;
        message(errorMessage(error, '暂时无法核对订单结果，请刷新订单后重试。'), true);
      } finally {
        const owned = mutation === operation;
        if (owned) mutation = null;
        controls();
        restoreFocus?.(() => {
          if (!owned || !currentView(at) || !overview || getContext().busy) return null;
          const buttons = node('order-list').querySelectorAll('[data-billing-reconcile]');
          return Array.from(buttons).find(action => action.dataset.billingReconcile === orderId && !action.disabled) ?? node('orders-heading');
        });
      }
    }

    function drawBatch() {
      const rows = batchReport.results.map(result => {
        const row = element('li');
        row.dataset.batchOrderId = result.orderId;
        row.dataset.outcome = result.outcome;
        row.append(
          element('strong', batchOutcomes[result.outcome]),
          element('span', '订单 ' + result.orderId),
          element('span', '账本 · ' + orderStateText(result.status, result.paymentException) + (result.paymentException ? ' · 支付异常待复核' : ''))
        );
        return row;
      });
      node('batch-results').replaceChildren(...rows);
      if (!rows.length) {
        batchMessage('暂无订单可核对。');
        return;
      }
      const counts = new Map();
      for (const result of batchReport.results) counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
      const summary = Object.entries(batchOutcomes)
        .filter(([outcome]) => counts.has(outcome))
        .map(([outcome, label]) => label + ' ' + counts.get(outcome) + ' 笔');
      batchMessage('本批 ' + rows.length + ' 笔。' + summary.join(' · '));
    }

    async function reconcileBatch(move) {
      const button = node('batch-' + move);
      if (button.hidden || button.disabled || !canReconcileBatch() || mutation || ordersRead || overviewRead || accessRead) return;
      const at = capture();
      if (!currentView(at) || getContext().busy) return;
      const restoreFocus = trackActionFocus(button);
      const after = move === 'next' ? batchReport.nextCursor : move === 'retry' ? (failedBatch ?? batchReport).after : null;
      const operation = {};
      mutation = operation;
      clearConfirmation();
      batchMessage('正在批量核对' + orderNames[kind] + '订单…');
      controls();
      try {
        const value = await invoke('reconcileBillingPage', { teamId: team, kind, ...(after ? { after } : {}) });
        if (!currentView(at)) return;
        batchReport = { ...value, after };
        failedBatch = null;
        drawBatch();
        if (value.results.length) {
          await loadOrders();
          if (currentView(at)) await loadOverview({ keepOrders: true, keepDraft: true });
        }
      } catch (error) {
        if (!currentView(at) || handleSessionError(error)) return;
        if (permissionErrors.has(error?.code)) discardTeam();
        else {
          failedBatch = { after };
          batchMessage(errorMessage(error, '暂时无法完成本批核对，请重试本批。'), true);
        }
      } finally {
        const owned = mutation === operation;
        if (owned) mutation = null;
        controls();
        restoreFocus?.(() => {
          if (!owned || !currentView(at) || node('batch-section').hidden || getContext().busy) return null;
          const action = failedBatch ? node('batch-retry') : button;
          return !action.hidden && !action.disabled ? action : node('orders-heading');
        });
      }
    }

    function panelOpenChanged() {
      if (panel.open && !panel.hidden && currentScope(scope)) void loadOverview();
      else clearOverview();
    }

    const panelObserver = new MutationObserver(panelOpenChanged);
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['open'] });
    node('refresh').addEventListener('click', () => { if (!node('refresh').disabled) void discover(); });
    node('team').addEventListener('change', () => {
      const selected = node('team').value;
      if (!teams.some(candidate => candidate.id === selected)) return;
      team = selected;
      void loadOverview();
    });
    node('order-kind').addEventListener('change', () => {
      if (overview?.simulation !== true || !Object.hasOwn(orderNames, node('order-kind').value)) return;
      kind = node('order-kind').value;
      revision++;
      clearOrders();
      clearBatch();
      clearConfirmation();
      message();
      drawCheckout();
      void loadOrders();
      controls();
    });
    for (const name of ['annual-offer', 'selected-seats', 'seat-quantity']) node(name).addEventListener('input', () => { clearConfirmation(); message(); controls(); });
    node('review').addEventListener('click', review);
    node('confirm').addEventListener('click', () => void createOrder());
    node('cancel').addEventListener('click', () => { clearConfirmation(); message(); controls(); node('review').focus(); });
    node('orders-refresh').addEventListener('click', () => void loadOrders());
    node('orders-more').addEventListener('click', () => void loadOrders('next'));
    node('orders-previous').addEventListener('click', () => void loadOrders('previous'));
    for (const move of ['start', 'next', 'retry']) node('batch-' + move).addEventListener('click', () => void reconcileBatch(move));
    node('order-list').addEventListener('click', event => {
      const button = event.target.closest('[data-billing-reconcile]');
      if (button && !button.disabled) void reconcile(button);
    });

    return { update, reset, destroy() { panelObserver.disconnect(); reset(); } };
  };
})();
