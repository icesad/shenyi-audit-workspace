(function () {
  'use strict';

  const orderNames = { annual: '团队年费', seat: '增购席位' };
  const orderStates = { pending: '待支付', closed: '超时关闭', 'payment-verified': '已核验，待到账', paid: '已到账' };
  const nativeProducts = { 'team-annual-renewal': '团队年订阅', 'team-seat-addition': '增购席位' };
  const nativeOrderStates = {
    pending: '待付款', pending_fulfilment: '收款已核实，待到账', fulfilled: '权益已到账',
    needs_review: '待复核', closed: '已关闭', expired: '已过付款截止'
  };
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
  const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const nativeOrderId = value => typeof value === 'string' && orderIdPattern.exec(value)?.[0] === value;
  const nativeNumber = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
  const methods = ['getBillingAccess', 'getBillingOverview', 'listBillingOrders', 'createBillingOrder', 'reconcileBillingOrder'];
  const permissionErrors = new Set(['FORBIDDEN', 'HTTP_403', 'HTTP_404', 'NOT_FOUND']);
  const deviceErrors = new Set(['DEVICE_PROOF_REQUIRED', 'DEVICE_NOT_READY', 'DEVICE_STATE_CHANGED', 'DEVICE_VAULT_UNAVAILABLE', 'DEVICE_CAPABILITY_REQUIRED', 'DEVICE_SERVER_CHANGED']);
  const knownErrors = {
    SUBSCRIPTION_REQUIRED: '需要有效的团队年订阅才能增购席位。',
    BILLING_OFFER_CHANGED: '账务选项已更新，请刷新订阅与席位后重新核对。',
    BILLING_CONFLICT: '团队账务状态已变化，请刷新后重新核对。',
    BILLING_RECONCILIATION_BUSY: '本团队已有一批订单正在核对，请稍后重试本批。',
    BILLING_RECONCILIATION_CONFLICT: '本批核对请求与已保存记录不一致，请核对团队、订单类型及批次。',
    BILLING_RECONCILIATION_RECEIPT_FAILED: '本批核对结果保存未确认，请沿用原请求重试。',
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
    const lookupSupported = typeof api?.getBillingOrder === 'function';
    const nativeSupported = typeof api?.openNativeWebsiteCheckout === 'function';
    const nativeHistorySupported = typeof api?.listNativeBillingOrders === 'function';
    let scope = '', identity = '', revision = 0, accessRead = null, team = '', teams = [];
    let overview = null, overviewRead = null, ordersRead = null, orders = [], nextCursor = null, pageCursor = null, previousCursors = [];
    let nativeOrdersRead = null, nativeOrders = [], nativeNext = null, nativeCursor = null, nativePrevious = [];
    let kind = 'annual', confirmation = null, mutation = null;
    let batchReport = null, failedBatch = null, batchIntent = null;
    let lookupRead = null;
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

    function websiteCheckoutReady() {
      return overview?.simulation === true && overview.websiteCheckout === true && overview.websiteCheckoutReady === true &&
        typeof api?.openWebsiteCheckout === 'function';
    }

    function nativeCheckoutReady() {
      return nativeSupported && overview?.simulation === false && typeof overview.nativeCheckout?.canPurchase === 'boolean';
    }

    function nativeHistoryReady() {
      return nativeHistorySupported && overview?.simulation === false && overview.nativeCheckout?.orderHistory === true;
    }

    function drawNativeControls(blocked) {
      const enabled = nativeCheckoutReady();
      const canPurchase = enabled && overview.nativeCheckout.canPurchase;
      const canRead = nativeHistoryReady();
      node('native-checkout-section').hidden = !enabled;
      node('native-purchase').hidden = !canPurchase;
      node('native-kind').disabled = node('native-continue').disabled = node('native-next').disabled = blocked || !canPurchase;
      node('native-order-id').disabled = node('native-open-order').disabled = blocked || !enabled;
      node('native-history').hidden = !canRead;
      node('native-history-list').setAttribute('aria-busy', String(Boolean(nativeOrdersRead)));
      node('native-history-previous').hidden = nativePrevious.length === 0;
      node('native-history-next').hidden = !nativeNext;
      const historyBlocked = blocked || !canRead || Boolean(nativeOrdersRead);
      node('native-history-refresh').disabled = historyBlocked;
      node('native-history-previous').disabled = historyBlocked || nativePrevious.length === 0;
      node('native-history-next').disabled = historyBlocked || !nativeNext;
      for (const button of node('native-history-list').querySelectorAll('[data-billing-native-receipt]')) {
        button.disabled = historyBlocked || !enabled;
      }
    }

    function canOpenWebsiteReceipt(order) {
      if (!websiteCheckoutReady() || order?.teamId !== team || typeof order.id !== 'string' ||
          orderIdPattern.exec(order.id)?.[0] !== order.id) return false;
      if (kind === 'seat') return order.offer?.product === 'team-seat-addition';
      const selectedSeats = order.renewalSeats?.selectedSeats;
      return order.offer?.product === 'team-annual-renewal' && Number.isSafeInteger(selectedSeats) && selectedSeats >= 0;
    }

    function controls() {
      const disabled = !currentScope(scope) || panel.hidden || !panel.open || !!getContext().busy || !!mutation;
      const annual = kind === 'annual';
      const simulation = overview?.simulation === true;
      const website = simulation && overview.websiteCheckout === true;
      const websiteReady = websiteCheckoutReady();
      const hasOffer = simulation && (annual ? overview.annualOffers.length > 0 : !!overview.seatOffer);
      const blocked = disabled || !!overviewRead;
      node('team').disabled = disabled || teams.length <= 1 || !!accessRead;
      node('refresh').disabled = blocked || !!accessRead;
      node('overview').hidden = !overview;
      node('checkout-section').hidden = node('orders-section').hidden = !simulation;
      drawNativeControls(blocked || !!accessRead);
      node('website-checkout-section').hidden = !website;
      node('website-checkout').hidden = !websiteReady;
      node('website-checkout').disabled = blocked || !!accessRead || !!ordersRead || !websiteReady;
      const websiteSeatReady = websiteReady && !!overview.seatOffer && overview.subscription.state === 'active';
      node('website-seat-checkout').hidden = !websiteSeatReady;
      node('website-seat-checkout').disabled = blocked || !!accessRead || !!ordersRead || !websiteSeatReady;
      node('website-checkout-hint').textContent = websiteReady ? '将在管理员配置的受信官网核对并生成合成订单；本次演练不收款。完成后请回到此处刷新订单。' : '当前电脑尚未配置可用的受信官网合成下单入口，请联系管理员核对配置。';
      node('checkout-heading').textContent = website ? '选择订单类型' : '创建订单';
      node('review').hidden = node('order-hint').hidden = website;
      node('order-kind').disabled = blocked || !simulation;
      node('annual-fields').hidden = website || !annual;
      node('renewal-fields').hidden = website || !annual || !overview?.renewalSeats;
      node('seat-fields').hidden = website || annual;
      node('annual-offer').disabled = blocked || !hasOffer;
      node('selected-seats').disabled = blocked || !hasOffer;
      node('seat-quantity').disabled = blocked || !hasOffer;
      node('review').disabled = blocked || website || !hasOffer || !!confirmation;
      node('confirmation').hidden = website || !confirmation;
      node('confirm').disabled = blocked || website || !!ordersRead || !confirmation;
      node('cancel').disabled = disabled;
      node('orders-refresh').disabled = disabled || !simulation || !!ordersRead;
      node('orders-more').hidden = !nextCursor;
      node('orders-previous').hidden = !previousCursors.length;
      node('orders-more').disabled = node('orders-previous').disabled = node('orders-refresh').disabled;
      node('order-lookup').hidden = !simulation || !lookupSupported;
      node('order-lookup-id').disabled = blocked || !simulation || !lookupSupported;
      node('order-lookup-submit').disabled = node('order-lookup-id').disabled || !!lookupRead;
      node('order-lookup-hint').textContent = '查询当前团队的' + orderNames[kind] + '订单，不改变订单状态。';
      for (const button of node('order-list').querySelectorAll('[data-billing-reconcile]')) button.disabled = disabled || !!ordersRead;
      for (const list of ['order-list', 'order-lookup-result']) {
        for (const button of node(list).querySelectorAll('[data-billing-website-receipt]')) {
          button.hidden = !websiteReady;
          button.disabled = blocked || !!accessRead || !!ordersRead || !!lookupRead || !websiteReady;
        }
      }
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
      clearOrderLookup();
      ordersRead = null;
      orders = [];
      nextCursor = null;
      pageCursor = null;
      previousCursors = [];
      node('order-list').replaceChildren();
      node('orders-message').textContent = '';
    }

    function nativeHistoryMessage(words = '', error = false) {
      const feedback = node('native-history-message');
      feedback.textContent = words;
      feedback.classList.toggle('error', error);
    }

    function clearNativeOrders() {
      nativeOrdersRead = null;
      nativeOrders = [];
      nativeCursor = nativeNext = null;
      nativePrevious = [];
      node('native-history-list').replaceChildren();
      nativeHistoryMessage();
    }

    function lookupMessage(words = '', error = false) {
      const feedback = node('order-lookup-message');
      feedback.textContent = words;
      feedback.classList.toggle('error', error);
    }

    function clearOrderLookup(keepInput = false) {
      lookupRead = null;
      node('order-lookup-result').replaceChildren();
      if (!keepInput) node('order-lookup-id').value = '';
      lookupMessage();
    }

    async function lookupOrder() {
      if (node('order-lookup-submit').disabled || !lookupSupported || overview?.simulation !== true || !currentView(capture())) return;
      const orderId = node('order-lookup-id').value.trim().toLowerCase();
      clearOrderLookup(true);
      if (!orderIdPattern.test(orderId)) {
        lookupMessage('请输入完整的订单编号（UUID）。', true);
        return;
      }
      node('order-lookup-id').value = orderId;
      const read = { ...capture(), orderId };
      lookupRead = read;
      lookupMessage('正在查询' + orderNames[kind] + '订单…');
      controls();
      try {
        const value = await invoke('getBillingOrder', { teamId: read.team, kind: read.kind, orderId });
        if (!currentView(read) || lookupRead !== read) return;
        if (value?.order?.teamId !== read.team || value.order.id !== orderId) throw new Error('Unexpected billing order');
        node('order-lookup-result').replaceChildren(orderRow(value.order, false));
        lookupMessage('已找到' + orderNames[kind] + '订单。此处仅供查阅。');
      } catch (error) {
        if (!currentView(read) || lookupRead !== read || handleSessionError(error)) return;
        if (error?.code === 'HTTP_403' || error?.code === 'FORBIDDEN') discardTeam();
        else lookupMessage(error?.code === 'HTTP_404' || error?.code === 'NOT_FOUND'
          ? '未找到该订单，或当前无权查阅。请核对编号、订单类型和团队。'
          : errorMessage(error, '暂时无法查询订单，请核对后重试。'), true);
      } finally {
        if (lookupRead === read) lookupRead = null;
        controls();
      }
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

    function sameBatchBinding(intent, context = getContext()) {
      return intent && intent.identity === context.identity && typeof context.binding === 'string' && context.binding &&
        intent.binding === context.binding;
    }

    function updateBatchIntent(context) {
      if (!batchIntent) return;
      if (!sameBatchBinding(batchIntent, context)) { batchIntent = null; return; }
      if (context.paused === true) { batchIntent.paused = true; return; }
      // The approved device snapshot can become ready before enter() reveals the
      // workspace. Preserve only an intent already suspended on this binding.
      if (!context.ready) { if (!batchIntent.paused) batchIntent = null; return; }
      if (!batchIntent.paused && (batchIntent.actor !== context.actor || batchIntent.contextTeamId !== context.teamId)) batchIntent = null;
    }

    function restoreBatchIntent() {
      if (!sameBatchBinding(batchIntent) || overview?.canResumeBillingBatch !== true ||
          batchIntent.teamId !== team || batchIntent.kind !== kind) return;
      failedBatch = { after: batchIntent.after, requestId: batchIntent.requestId };
      batchIntent.actor = getContext().actor;
      batchIntent.contextTeamId = getContext().teamId;
      batchIntent.paused = false;
      batchMessage('本批结果尚未确认。可手动重试本批，系统会沿用原核对请求，不会自动提交。');
    }

    function clearOverview() {
      revision++;
      overview = null;
      overviewRead = null;
      clearConfirmation();
      clearOrders();
      clearNativeOrders();
      clearBatch();
      message();
      for (const name of ['notice', 'term', 'seats', 'annual-offer', 'order-hint']) node(name).replaceChildren();
      drawExpiryReminder();
      node('selected-seats').value = '';
      node('seat-quantity').value = '';
      node('native-kind').value = 'annual';
      node('native-order-id').value = '';
      node('native-order-id').removeAttribute('aria-invalid');
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
      batchIntent = null;
      clearScope();
    }

    function discardTeam() {
      batchIntent = null;
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
        if (batchIntent?.paused && sameBatchBinding(batchIntent)) {
          if (value.teams.some(candidate => candidate.id === batchIntent.teamId)) {
            team = batchIntent.teamId;
            kind = node('order-kind').value = batchIntent.kind;
          } else batchIntent = null;
        }
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
      const context = getContext();
      updateBatchIntent(context);
      const next = supported ? keys(context) : { owner: '', view: '' };
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

    function drawExpiryReminder(subscription) {
      const reminder = node('expiry-reminder');
      const days = subscription?.renewalReminderDays;
      let text = '';
      if (subscription?.state === 'expired') {
        text = '业务新增和修改已暂停。已有资料仍可按原权限查阅或导出。';
      } else if (subscription?.state === 'active' && Number.isSafeInteger(days) && days >= 1 && days <= 30) {
        const remaining = days === 1 ? '24 小时' : days + ' 天';
        text = subscription.pilot === true ? '团队试点将在 ' + remaining + '内结束。' : '团队年订阅将在 ' + remaining + '内到期。请提前安排续费。';
      }
      reminder.textContent = text;
      reminder.hidden = !text;
    }

    function drawOverview(keepDraft = false) {
      const { subscription, seats, annualOffers, renewalSeats } = overview;
      const pilot = subscription.pilot === true;
      node('notice').textContent = overview.simulation
        ? '本机模拟账务。创建订单和核对状态均不收款。'
        : nativeCheckoutReady() && overview.nativeCheckout.canPurchase ? '请在官网核对金额、确认订单和扫码付款。'
        : nativeCheckoutReady() ? '可在官网打开已有订单，核对付款状态。'
        : nativeHistoryReady() ? '可查阅本团队的官网订单记录。'
        : pilot ? '本团队当前显示获批的试点期限与席位。' : '当前仅可查阅订阅与席位。在线续费尚未开通。';
      const term = subscription.startsAt == null ? '' : '　' + date(subscription.startsAt) + ' 至 ' + date(subscription.endsAt) + '（北京时间）';
      node('term').textContent = (pilot ? '团队试点 · ' : '团队年订阅 · ') + (subscriptionStates[subscription.state] || '状态待核对') + term;
      drawExpiryReminder(subscription);
      node('seats').replaceChildren();
      const metrics = [
        [pilot ? '试点席位' : '已购', seats.purchasedSeats], ['已启用', seats.activeBusinessSeats], ['邀请预留', seats.reservedInvitationSeats],
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
      clearOrderLookup();
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
        restoreBatchIntent();
        message(success);
        if (!overview.simulation) {
          clearConfirmation();
          clearOrders();
          if (nativeHistoryReady()) void loadNativeOrders();
          else clearNativeOrders();
        } else {
          clearNativeOrders();
          if (keepOrders) drawOrders();
          else void loadOrders();
        }
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

    function canResumeFulfilment(order) {
      return overview?.simulation === true && overview.canResumeFulfilment === true &&
        order?.status === 'payment-verified' && !order.paymentException && !order.closure;
    }

    function orderRow(order, actionable = true) {
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
      if (canOpenWebsiteReceipt(order)) {
        const at = capture();
        const button = element('button', '在官网核对原单', 'button');
        button.type = 'button';
        button.dataset.billingWebsiteReceipt = order.id;
        button.addEventListener('click', () => {
          if (button.isConnected && currentView(at)) void openWebsiteCheckout(at.kind, { button, order });
        });
        row.append(button);
      }
      for (const source of [undefined, 'recorded-payment']) {
        if (!actionable || !(source ? canResumeFulfilment(order) : canReconcileOrder(order))) continue;
        const button = element('button', source ? '恢复兑现' : '核对订单状态', 'button');
        button.type = 'button';
        button.dataset.billingReconcile = order.id;
        if (source) button.dataset.billingSource = source;
        row.append(button);
      }
      return row;
    }

    function drawOrders() {
      node('order-list').replaceChildren(...orders.map(order => orderRow(order)));
      node('orders-message').textContent = orders.length === 0 ? '暂无' + orderNames[kind] + '订单。' : previousCursors.length || nextCursor ? '第 ' + (previousCursors.length + 1) + ' 页' : '';
    }

    function nativeOrderRow(order) {
      const row = element('li', undefined, 'billing-order');
      row.dataset.orderId = order.id;
      const header = element('div');
      const state = element('strong', nativeOrderStates[order.status], 'billing-order-state');
      state.dataset.state = order.status;
      header.append(element('span', nativeProducts[order.product]), state,
        element('span', amount(order.amountMinor), 'billing-order-amount'));
      row.append(header, element('p', '订单 ' + order.id),
        element('p', order.seats + ' 席 · ' + date(order.createdAt) + '（北京时间）'));
      if (nativeCheckoutReady()) {
        const button = element('button', '在官网核对原单', 'button');
        button.type = 'button';
        button.dataset.billingNativeReceipt = order.id;
        button.setAttribute('aria-label', '在官网核对原单 ' + order.id);
        const at = capture();
        button.addEventListener('click', () => {
          if (button.isConnected && currentView(at)) void openNativeWebsiteCheckout('order', { button, order });
        });
        row.append(button);
      }
      return row;
    }

    function validNativeOrderPage(value, teamId, after) {
      if (value?.teamId !== teamId || !Array.isArray(value.orders) || value.orders.length > 20 || typeof value.hasMore !== 'boolean' ||
          (value.hasMore ? !nativeOrderId(value.nextCursor) || value.nextCursor !== value.orders.at(-1)?.id : value.nextCursor !== null)) return false;
      const seen = new Set([after]);
      return value.orders.every((order, index) => {
        if (!order || !nativeOrderId(order.id) || seen.has(order.id) || !Object.hasOwn(nativeProducts, order.product) ||
            !Object.hasOwn(nativeOrderStates, order.status) || order.currency !== 'CNY' ||
            !nativeNumber(order.createdAt, 0, 253_402_300_799_000) || !nativeNumber(order.amountMinor, 1, 2_147_483_647) ||
            !nativeNumber(order.seats, order.product === 'team-seat-addition' ? 1 : 0, 1000)) return false;
        const previous = value.orders[index - 1];
        if (previous && (previous.createdAt < order.createdAt || previous.createdAt === order.createdAt && previous.id <= order.id)) return false;
        seen.add(order.id);
        return true;
      });
    }

    async function loadNativeOrders(move = 'first', source) {
      if (!nativeHistoryReady() || nativeOrdersRead || source?.disabled ||
          move === 'next' && !nativeNext || move === 'previous' && !nativePrevious.length) return;
      const read = capture();
      if (!currentView(read)) return;
      const after = move === 'next' ? nativeNext : move === 'previous' ? nativePrevious.at(-1) : null;
      const restoreFocus = source ? trackActionFocus(source) : null;
      nativeOrdersRead = read;
      nativeHistoryMessage('正在读取官网订单…');
      controls();
      try {
        const value = await invoke('listNativeBillingOrders', { teamId: read.team, ...(after ? { after } : {}) });
        if (!currentView(read) || nativeOrdersRead !== read) return;
        if (!validNativeOrderPage(value, read.team, after)) throw new Error('Unexpected Native order history');
        if (move === 'next') nativePrevious.push(nativeCursor);
        else if (move === 'previous') nativePrevious.pop();
        else nativePrevious = [];
        nativeCursor = after;
        nativeNext = value.nextCursor;
        nativeOrders = value.orders;
        node('native-history-list').replaceChildren(...nativeOrders.map(nativeOrderRow));
        nativeHistoryMessage(nativeOrders.length === 0 ? '暂无官网订单。' :
          '第 ' + (nativePrevious.length + 1) + ' 页，共 ' + nativeOrders.length + ' 笔。');
      } catch (error) {
        if (!currentView(read) || nativeOrdersRead !== read || handleSessionError(error)) return;
        if (error?.code === 'HTTP_403' || error?.code === 'FORBIDDEN') discardTeam();
        else {
          clearNativeOrders();
          nativeHistoryMessage('无法读取官网订单，请刷新重试。', true);
        }
      } finally {
        if (nativeOrdersRead === read) nativeOrdersRead = null;
        controls();
        restoreFocus?.(() => {
          if (!currentView(read) || !nativeHistoryReady()) return null;
          return source.hidden || source.disabled ? node('native-history-heading') : source;
        });
      }
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
      if (overview?.websiteCheckout === true || node('review').disabled || overview?.simulation !== true || !currentView(capture())) return;
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

    async function openWebsiteCheckout(checkoutKind = 'annual', receipt) {
      const seatCheckout = checkoutKind === 'seat';
      const button = receipt?.button ?? node(seatCheckout ? 'website-seat-checkout' : 'website-checkout');
      const at = capture();
      if ((checkoutKind !== 'annual' && !seatCheckout) || !currentView(at) || !websiteCheckoutReady() || button.hidden || button.disabled) return;
      if (receipt) {
        if (!button.isConnected || checkoutKind !== at.kind || !canOpenWebsiteReceipt(receipt.order) ||
            mutation || accessRead || overviewRead || ordersRead || lookupRead || getContext().busy) return;
      } else if (seatCheckout && (!overview.seatOffer || overview.subscription.state !== 'active')) return;
      const operation = {};
      const input = { teamId: at.team };
      if (receipt || seatCheckout) input.kind = checkoutKind;
      if (receipt) input.orderId = receipt.order.id;
      mutation = operation;
      clearConfirmation();
      message(receipt ? '正在请求受信官网的原单查阅入口…' : seatCheckout ? '正在请求受信官网的席位增购入口…' : '正在请求受信官网的合成下单入口…');
      controls();
      try {
        const value = await invoke('openWebsiteCheckout', input);
        if (!currentView(at)) return;
        if (value?.opened !== true) throw new Error('Unexpected website handoff result');
        message(receipt ? '已请求打开官网原单核对页。' : seatCheckout ? '已请求打开官网合成席位增购页。生成订单后，请返回并刷新增购席位订单记录。' : '已请求打开官网合成下单页。生成订单后，请返回并刷新订单记录。');
      } catch (error) {
        if (!currentView(at) || handleSessionError(error)) return;
        if (receipt && (error?.code === 'HTTP_404' || error?.code === 'NOT_FOUND')) message('官网暂时无法查阅该订单。请刷新订单记录后核对。', true);
        else if (permissionErrors.has(error?.code)) discardTeam();
        else message('无法确认官网页面已打开；入口可能已签发。请核对浏览器和订单记录后再操作，系统不会自动重试。', true);
      } finally {
        if (mutation === operation) mutation = null;
        controls();
      }
    }

    async function openNativeWebsiteCheckout(action, receipt) {
      const original = action === 'order';
      const button = receipt?.button ?? node(original ? 'native-open-order' : 'native-' + action);
      const at = capture();
      if (!currentView(at) || !nativeCheckoutReady() || button.disabled || mutation || accessRead || overviewRead || getContext().busy) return;
      const input = { teamId: at.team };
      if (original) {
        const field = node('native-order-id');
        const orderId = receipt?.order.id ?? field.value;
        if (receipt && (!button.isConnected || !nativeHistoryReady() || !nativeOrders.includes(receipt.order))) return;
        if (!nativeOrderId(orderId)) {
          field.setAttribute('aria-invalid', 'true');
          message('请输入完整的原订单编号，包含小写字母和连字符。', true);
          field.focus();
          return;
        }
        input.orderId = orderId;
      } else {
        const purchaseKind = node('native-kind').value;
        if (!overview.nativeCheckout.canPurchase || !Object.hasOwn(orderNames, purchaseKind)) return;
        input.kind = purchaseKind;
        if (action === 'next') input.newPurchase = true;
      }
      const restoreFocus = trackActionFocus(button);
      const operation = {};
      mutation = operation;
      message(original ? '正在打开官网原订单…' : '正在打开官网购买页…');
      controls();
      try {
        const value = await invoke('openNativeWebsiteCheckout', input);
        if (!currentView(at) || mutation !== operation) return;
        if (value?.opened !== true || Object.keys(value).length !== 1) throw new Error('Unexpected website handoff result');
        message(original ? '已打开官网原订单。请在浏览器中核对付款状态。' : '已打开官网购买页。请在浏览器中核对本次订单。');
      } catch (error) {
        if (!currentView(at) || mutation !== operation || handleSessionError(error)) return;
        const code = error?.code;
        if (code === 'WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED') {
          message('上一笔购买尚无已到账或已关闭的确认。请选择「打开或继续本次购买」，在官网核对原订单。', true);
        } else if (code === 'NATIVE_PURCHASE_STORAGE_UNAVAILABLE') {
          message('本机暂时无法保存购买记录。请检查客户端存储，或凭原订单编号在官网核对。', true);
        } else if (code === 'WEBSITE_CHECKOUT_IN_PROGRESS') {
          message('正在打开官网，请稍候。');
        } else if (original && permissionErrors.has(code)) {
          message('无法打开该原订单，请核对订单编号、账务团队和权限。', true);
        } else if (code === 'FORBIDDEN' || code === 'HTTP_403') {
          discardTeam();
        } else {
          message(original ? '无法确认官网原订单已打开。请先检查浏览器，再按原编号重试。' :
            '无法确认官网购买页已打开。请先检查浏览器，再选择「打开或继续本次购买」。', true);
        }
      } finally {
        const owned = mutation === operation;
        if (owned) mutation = null;
        controls();
        restoreFocus?.(() => owned && currentView(at) && !button.disabled ? button : null);
      }
    }

    async function createOrder() {
      if (overview?.websiteCheckout === true || node('confirm').disabled || overview?.simulation !== true || !confirmation || !currentView(capture())) return;
      const at = capture();
      clearOrderLookup();
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

    async function performOrderAction(button) {
      const orderId = button.dataset.billingReconcile;
      const source = button.dataset.billingSource;
      const order = orders.find(item => item.id === orderId);
      if (mutation || ordersRead || !(source ? canResumeFulfilment(order) : canReconcileOrder(order))) return;
      const at = capture();
      if (!currentView(at) || getContext().busy) return;
      const restoreFocus = trackActionFocus(button);
      const operation = {};
      mutation = operation;
      clearOrderLookup();
      clearConfirmation();
      controls();
      message(source ? '正在按原收款记录恢复兑现…' : '正在核对订单状态…');
      try {
        const result = await invoke('reconcileBillingOrder', { teamId: team, kind, orderId, ...(source ? { source } : {}) });
        if (!currentView(at)) return;
        if (result?.order?.id !== orderId || result.order.teamId !== team) throw new Error('Unexpected billing order');
        upsertOrder(result.order);
        if (result.order.closure) message('模拟订单 · ' + orderStateText(result.order.status, result.order.paymentException, true) + '。');
        else if (result.order.paymentException) message('模拟订单 · ' + paymentExceptionStates[result.order.paymentException.kind] + '。');
        else if (order.status !== 'paid' && result.order.status === 'paid') await loadOverview({ success: source ? '模拟订单已按原收款记录恢复兑现。' : '模拟订单已到账。', keepOrders: true });
        else message('模拟订单 · ' + orderStates[result.order.status] + '。');
      } catch (error) {
        if (!currentView(at) || handleSessionError(error)) return;
        message(errorMessage(error, source ? '暂时无法确认兑现结果，请刷新后核对原订单。' : '暂时无法核对订单结果，请刷新订单后重试。'), true);
      } finally {
        const owned = mutation === operation;
        if (owned) mutation = null;
        controls();
        restoreFocus?.(() => {
          if (!owned || !currentView(at) || !overview || getContext().busy) return null;
          const buttons = node('order-list').querySelectorAll('[data-billing-reconcile]');
          return Array.from(buttons).find(action => action.dataset.billingReconcile === orderId && action.dataset.billingSource === source && !action.disabled) ?? node('orders-heading');
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
      const requestId = move === 'retry' && failedBatch?.requestId ? failedBatch.requestId
        : overview.canResumeBillingBatch === true ? window.crypto.randomUUID() : undefined;
      const context = getContext();
      const intent = requestId && typeof context.binding === 'string' && context.binding ? {
        identity: context.identity, actor: context.actor, binding: context.binding, contextTeamId: context.teamId,
        teamId: team, kind, after, requestId, paused: false
      } : null;
      batchIntent = intent;
      const operation = {};
      mutation = operation;
      clearOrderLookup();
      clearConfirmation();
      batchMessage('正在批量核对' + orderNames[kind] + '订单…');
      controls();
      try {
        const value = await invoke('reconcileBillingPage', { teamId: team, kind, ...(after ? { after } : {}), ...(requestId ? { requestId } : {}) });
        if (!currentView(at)) return;
        if (batchIntent === intent) batchIntent = null;
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
          failedBatch = { after, ...(requestId ? { requestId } : {}) };
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
      else {
        const context = getContext();
        if (!sameBatchBinding(batchIntent, context) || context.paused !== true && !(panel.hidden && batchIntent?.paused)) batchIntent = null;
        clearOverview();
      }
    }

    const panelObserver = new MutationObserver(panelOpenChanged);
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['open'] });
    node('refresh').addEventListener('click', () => { if (!node('refresh').disabled) void discover(); });
    node('team').addEventListener('change', () => {
      const selected = node('team').value;
      if (!teams.some(candidate => candidate.id === selected)) return;
      batchIntent = null;
      team = selected;
      void loadOverview();
    });
    node('order-kind').addEventListener('change', () => {
      if (overview?.simulation !== true || !Object.hasOwn(orderNames, node('order-kind').value)) return;
      kind = node('order-kind').value;
      batchIntent = null;
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
    node('website-checkout').addEventListener('click', () => void openWebsiteCheckout());
    node('website-seat-checkout').addEventListener('click', () => void openWebsiteCheckout('seat'));
    node('native-continue').addEventListener('click', () => void openNativeWebsiteCheckout('continue'));
    node('native-next').addEventListener('click', () => void openNativeWebsiteCheckout('next'));
    node('native-open-order').addEventListener('click', () => void openNativeWebsiteCheckout('order'));
    for (const [name, move] of [['refresh', 'first'], ['next', 'next'], ['previous', 'previous']]) {
      node('native-history-' + name).addEventListener('click', event => void loadNativeOrders(move, event.currentTarget));
    }
    node('native-order-id').addEventListener('input', event => event.currentTarget.removeAttribute('aria-invalid'));
    node('native-order-id').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void openNativeWebsiteCheckout('order');
      }
    });
    node('review').addEventListener('click', review);
    node('confirm').addEventListener('click', () => void createOrder());
    node('cancel').addEventListener('click', () => { clearConfirmation(); message(); controls(); node('review').focus(); });
    node('orders-refresh').addEventListener('click', () => void loadOrders());
    node('orders-more').addEventListener('click', () => void loadOrders('next'));
    node('orders-previous').addEventListener('click', () => void loadOrders('previous'));
    node('order-lookup-id').addEventListener('input', () => { clearOrderLookup(true); controls(); });
    node('order-lookup-id').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); void lookupOrder(); }
    });
    node('order-lookup-submit').addEventListener('click', () => void lookupOrder());
    for (const move of ['start', 'next', 'retry']) node('batch-' + move).addEventListener('click', () => void reconcileBatch(move));
    node('order-list').addEventListener('click', event => {
      const button = event.target.closest('[data-billing-reconcile]');
      if (button && !button.disabled) void performOrderAction(button);
    });

    return { update, reset, destroy() { panelObserver.disconnect(); reset(); } };
  };
})();
