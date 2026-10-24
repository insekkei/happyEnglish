/**
 * 英语绘本打卡 —— 渲染与打卡逻辑
 * 数据：data.js（window.SERIES_DATA）
 * 存储：localStorage
 *
 * 记录结构 state.logs[]：
 *   { id, key, date(yyyy-mm-dd), ts(毫秒), delta(+1 打卡 / -1 撤销), score, title, norm }
 *
 * 积分规则（同一系列内按书名判重，忽略大小写）：
 *   第 1 次阅读      -> 该级别基础分
 *   第 2 次重复阅读  -> 基础分 - 1；不足 1 分按 0.5 分计
 *   第 3 次及以上    -> min(1, 第二次得分)，不超过前两次
 */
(function () {
  var STORE_KEY = 'reading-checkin-v1';
  // 分值方案标识：调整 data.js 的分值后改这里，即可触发历史记录一次性重算
  var SCORE_SCHEME = 'v3-plus-one';
  var MAX_ROWS = 300; // 单次最多渲染条数，避免卡顿
  var series = window.SERIES_DATA || [];

  // ---------- 存储 ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function emptyState() {
    return { items: {}, logs: [], exchanges: [], updated: '' };
  }

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) return emptyState();
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object') return emptyState();
    return {
      items: data.items && typeof data.items === 'object' ? data.items : {},
      logs: data.logs && data.logs.length ? data.logs : [],
      exchanges: data.exchanges && data.exchanges.length ? data.exchanges : [],
      updated: data.updated || '',
    };
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 忽略存储失败 */
    }
  }

  var state = load();

  // ---------- 索引 ----------
  var levelMap = {}; // 'seriesId:levelId' -> { series, level }
  var seriesMap = {};
  series.forEach(function (s) {
    seriesMap[s.id] = s;
    s.levels.forEach(function (lv) {
      levelMap[s.id + ':' + lv.id] = { series: s, level: lv };
    });
  });

  function nameOf(key) {
    var ref = levelMap[key];
    return ref ? ref.series.name + ' · ' + ref.level.title : key;
  }
  function seriesIdOf(key) {
    return String(key || '').split(':')[0];
  }
  function itemOf(key) {
    if (!state.items[key]) state.items[key] = { count: 0, last: '', books: {} };
    var it = state.items[key];
    if (!it.books) it.books = {};
    if (typeof it.count !== 'number') it.count = 0;
    return it;
  }
  function countOf(key) {
    return state.items[key] && state.items[key].count ? state.items[key].count : 0;
  }
  // 该级别累计得分：直接由记录累加，保证与历史表完全一致
  function round1(n) { return Math.round(n * 10) / 10; }
  function scoreOf(key) {
    var sum = 0;
    state.logs.forEach(function (l) {
      if (l.key === key) sum += l.delta * l.score;
    });
    return round1(sum);
  }
  // 分值展示：整数不带小数点，0.5 这类保留一位
  function fmtScore(n) {
    var v = round1(n);
    return v % 1 === 0 ? String(v) : v.toFixed(1);
  }
  function fmtSigned(n) {
    var v = round1(n);
    return v < 0 ? '−' + fmtScore(-v) : '+' + fmtScore(v);
  }

  // ---------- 书名判重与积分 ----------
  // 归一化：忽略大小写与多余空白
  function normTitle(t) {
    return String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // 本系列内（跨级别）该书名已读次数
  function readTimesOf(key, norm) {
    if (!norm) return 0;
    var sid = seriesIdOf(key);
    var s = seriesMap[sid];
    if (!s) return 0;
    var n = 0;
    s.levels.forEach(function (lv) {
      var it = state.items[sid + ':' + lv.id];
      if (it && it.books && it.books[norm]) n += it.books[norm].n;
    });
    return n;
  }

  // 第 2 次重复阅读得分：基础分 - 1；不足 1 分按 0.5 分计
  function secondScore(base) {
    var v = round1(base - 1);
    if (v < 0) v = 0;
    return v < 1 ? 0.5 : v;
  }

  // 本次打卡应得积分
  function scoreFor(key, norm) {
    var base = levelMap[key] ? levelMap[key].level.score : 0;
    var times = readTimesOf(key, norm);
    if (times <= 0) return { score: base, times: 0, again: false };
    if (times === 1) return { score: secondScore(base), times: 1, again: true };
    // 第 3 次及以上：不超过第 2 次得分，且最多 1 分
    var third = Math.min(1, secondScore(base));
    return { score: Math.max(0, third), times: times, again: true };
  }

  // 应用 / 回滚一条记录（sign: +1 应用, -1 回滚）
  function applyLog(log, sign) {
    var it = itemOf(log.key);
    it.count += sign * log.delta;
    if (it.count < 0) it.count = 0;
    if (log.norm) {
      var b = it.books[log.norm];
      if (!b) b = it.books[log.norm] = { title: log.title || '', n: 0, last: '' };
      b.n += sign * log.delta;
      if (b.n <= 0) {
        delete it.books[log.norm];
      } else {
        b.last = log.date;
        b.title = log.title || b.title;
      }
    }
    if (sign > 0 && log.delta > 0) it.last = log.date;
  }

  function pushLog(log) {
    state.logs.push(log);
    applyLog(log, 1);
  }

  // 本系列内读过的不同书名数
  function bookKindsOf(seriesId) {
    var s = seriesMap[seriesId];
    if (!s) return 0;
    var set = {};
    s.levels.forEach(function (lv) {
      var it = state.items[seriesId + ':' + lv.id];
      if (!it || !it.books) return;
      Object.keys(it.books).forEach(function (norm) {
        if (it.books[norm].n > 0) set[norm] = 1;
      });
    });
    return Object.keys(set).length;
  }

  // 该级别最近一次打卡记录（用于「撤销一本」）
  function lastCheckLog(key) {
    for (var i = state.logs.length - 1; i >= 0; i--) {
      if (state.logs[i].key === key && state.logs[i].delta > 0) return state.logs[i];
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- 旧数据兼容：补齐 id / 时间戳 / 分值 ----------
  var uidSeed = 0;
  function nextId() {
    uidSeed += 1;
    return 'r' + Date.now().toString(36) + uidSeed;
  }
  (function migrate() {
    var changed = false;
    state.logs.forEach(function (l) {
      if (!l.id) { l.id = nextId(); changed = true; }
      if (typeof l.delta !== 'number') { l.delta = 1; changed = true; }
      if (typeof l.score !== 'number') {
        l.score = levelMap[l.key] ? levelMap[l.key].level.score : 0;
        changed = true;
      }
      if (typeof l.ts !== 'number' || l.ts !== l.ts) {
        l.ts = Date.parse(l.date || '') || 0;
        changed = true;
      }
      // 早期记录没有书名，标记为「未填书名」，不参与判重
      if (typeof l.title !== 'string') {
        l.title = '';
        l.norm = '';
        changed = true;
      }
      if (l.id > uidSeed && typeof l.id === 'number') uidSeed = l.id;
    });
    Object.keys(state.items).forEach(function (key) {
      var it = state.items[key];
      if (!it.books) { it.books = {}; changed = true; }
    });
    if (!state.exchanges) { state.exchanges = []; changed = true; }
    if (changed) save();
  })();

  // ---------- 分值调整迁移：所有级别分值 +1，历史记录同步重算（仅执行一次） ----------
  (function rescoreByScheme() {
    var flag = '';
    try {
      flag = window.localStorage.getItem('reading-checkin-scheme') || '';
    } catch (e) {
      flag = '';
    }
    if (flag === SCORE_SCHEME) return;

    // 按时间顺序重放所有记录，用最新分值重算得分并重建本数/书名计数
    var sorted = state.logs.slice().sort(function (a, b) {
      return (a.ts || 0) - (b.ts || 0);
    });
    state.items = {};
    var lastScoreByKey = {};
    sorted.forEach(function (l) {
      if (!levelMap[l.key]) return;
      var it = itemOf(l.key);
      if (l.delta > 0) {
        // 此刻 state.items 只含该记录之前的打卡，故为当时的真实阅读次数
        var r = scoreFor(l.key, l.norm || '');
        l.score = r.score;
        it.count += 1;
        it.last = l.date;
        if (l.norm) {
          var b = it.books[l.norm] || (it.books[l.norm] = { title: l.title || '', n: 0, last: '' });
          b.n += 1;
          b.last = l.date;
          b.title = l.title || b.title;
        }
        lastScoreByKey[l.key] = l.score;
      } else {
        if (lastScoreByKey[l.key] != null) l.score = lastScoreByKey[l.key];
        it.count -= 1;
        if (it.count < 0) it.count = 0;
        if (l.norm && it.books[l.norm]) {
          it.books[l.norm].n -= 1;
          if (it.books[l.norm].n <= 0) delete it.books[l.norm];
        }
      }
    });

    try {
      window.localStorage.setItem('reading-checkin-scheme', SCORE_SCHEME);
    } catch (e) {
      /* 忽略 */
    }
    save();
  })();

  // ---------- 渲染封面 ----------
  var board = document.getElementById('board');

  function buildCard(s, lv) {
    var key = s.id + ':' + lv.id;
    var el = document.createElement('article');
    el.className = 'cover';
    el.setAttribute('data-key', key);
    el.style.setProperty('--c1', lv.color1);
    el.style.setProperty('--c2', lv.color2);

    var labelCls = lv.label.length > 2 ? 'book-level small' : 'book-level';
    el.innerHTML =
      '<div class="book">' +
        '<span class="book-series">' + s.en + '</span>' +
        '<span class="' + labelCls + '">' + lv.label + '</span>' +
        '<div class="book-foot">' +
          '<span>' + lv.title + '</span>' +
          (lv.subtitle ? '<span class="en">' + lv.subtitle + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="meta">' +
        '<div class="meta-title">' + s.name + ' ' + lv.title + '</div>' +
        '<span class="score-tag">首次 +' + fmtScore(lv.score) + ' 分</span>' +
        '<div class="progress">' +
          '已读 <b class="js-count">0</b> 本 · 累计 <b class="js-score">0</b> 分' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn primary js-check" data-key="' + key + '">打卡</button>' +
          '<button class="btn ghost js-undo" data-key="' + key + '" title="撤销最近一本">−</button>' +
        '</div>' +
      '</div>';
    return el;
  }

  function buildSeries(s) {
    var sec = document.createElement('section');
    sec.className = 'series';
    sec.setAttribute('data-series', s.id);

    var head = document.createElement('div');
    head.className = 'series-head';
    head.innerHTML =
      '<h2>' + s.name + '</h2>' +
      '<span class="en">' + s.en + '</span>' +
      '<span class="note">' + s.note + '</span>' +
      '<span class="series-score">系列积分 <b class="js-series-score" data-series="' + s.id + '">0</b></span>';
    sec.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'grid';
    s.levels.forEach(function (lv) {
      grid.appendChild(buildCard(s, lv));
    });
    sec.appendChild(grid);
    return sec;
  }

  series.forEach(function (s) {
    board.appendChild(buildSeries(s));
  });

  // ---------- 系列 Tab ----------
  var TAB_KEY = 'reading-checkin-tab';
  var tabsNav = document.getElementById('tabs');
  var currentTab = 'all';

  function buildTabs() {
    var mk = function (id, text, c1, c2) {
      var btn = document.createElement('button');
      btn.className = 'tab';
      btn.setAttribute('data-tab', id);
      if (c1) {
        btn.style.setProperty('--c1', c1);
        btn.style.setProperty('--c2', c2);
        var dot = document.createElement('span');
        dot.className = 'dot';
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(text));
      var score = document.createElement('span');
      score.className = 'tab-score js-tab-score';
      score.setAttribute('data-series', id);
      score.textContent = '0 分';
      btn.appendChild(score);
      return btn;
    };

    tabsNav.appendChild(mk('all', '全部'));
    series.forEach(function (s) {
      tabsNav.appendChild(mk(s.id, s.short || s.name, s.levels[0].color1, s.levels[s.levels.length - 1].color2));
    });
  }

  function setTab(id) {
    currentTab = id;
    var found = false;
    Array.prototype.forEach.call(tabsNav.children, function (btn) {
      var on = btn.getAttribute('data-tab') === id;
      btn.classList.toggle('active', on);
      if (on) found = true;
    });
    if (!found && tabsNav.children.length) {
      tabsNav.children[0].classList.add('active');
      id = tabsNav.children[0].getAttribute('data-tab');
    }

    Array.prototype.forEach.call(board.children, function (sec) {
      var show = id === 'all' || sec.getAttribute('data-series') === id;
      sec.classList.toggle('hidden', !show);
    });

    try {
      window.localStorage.setItem(TAB_KEY, id);
    } catch (e) {
      /* 忽略 */
    }
  }

  tabsNav.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tab') : null;
    if (!btn) return;
    setTab(btn.getAttribute('data-tab'));
    renderHistory();
  });

  buildTabs();
  var savedTab = 'all';
  try {
    savedTab = window.localStorage.getItem(TAB_KEY) || 'all';
  } catch (e) {
    savedTab = 'all';
  }
  // 移动端不展示「全部」，默认选中第一个系列
  var isMobile = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
  if (isMobile && (savedTab === 'all' || !document.querySelector('.tab[data-tab="' + savedTab + '"]'))) {
    savedTab = series[0].id;
  }

  // ---------- 顶部统计 ----------
  function refresh() {
    var totalScore = 0;
    var totalBooks = 0;

    Object.keys(levelMap).forEach(function (key) {
      var card = board.querySelector('.cover[data-key="' + key + '"]');
      if (!card) return;
      var c = countOf(key);
      var sc = scoreOf(key);
      card.querySelector('.js-count').textContent = c;
      card.querySelector('.js-score').textContent = fmtScore(sc);
      card.querySelector('.js-undo').disabled = c === 0;
      if (c > 0) card.classList.add('done');
      else card.classList.remove('done');
      totalBooks += c;
      totalScore += sc;
    });

    series.forEach(function (s) {
      var sum = 0;
      s.levels.forEach(function (lv) {
        sum += scoreOf(s.id + ':' + lv.id);
      });
      var el = board.querySelector('.js-series-score[data-series="' + s.id + '"]');
      if (el) el.textContent = fmtScore(sum);
      var tabEl = tabsNav.querySelector('.js-tab-score[data-series="' + s.id + '"]');
      if (tabEl) tabEl.textContent = fmtScore(sum) + ' 分';
    });

    var today = todayStr();
    var todayCount = 0;
    var totalScoreReal = 0;
    var totalBooksReal = 0;
    state.logs.forEach(function (l) {
      if (l.date === today && l.delta > 0) todayCount += 1;
      totalScoreReal += l.delta * l.score;
      totalBooksReal += l.delta;
    });
    totalScore = round1(totalScoreReal);
    totalBooks = totalBooksReal > 0 ? totalBooksReal : 0;

    var allTab = tabsNav.querySelector('.js-tab-score[data-series="all"]');
    if (allTab) allTab.textContent = fmtScore(totalScore) + ' 分';

    document.getElementById('statScoreNum').textContent = fmtScore(totalScore);
    document.getElementById('statBooksNum').textContent = totalBooks;
    document.getElementById('statTodayNum').textContent = todayCount;
    document.getElementById('statScoreNumM').textContent = fmtScore(totalScore);
    document.getElementById('statBooksNumM').textContent = totalBooks;
    document.getElementById('statTodayNumM').textContent = todayCount;
  }

  // ---------- 历史记录 ----------
  var historyList = document.getElementById('historyList');
  var historySummary = document.getElementById('historySummary');
  var filterDate = document.getElementById('filterDate');
  var filterSeries = document.getElementById('filterSeries');
  var filterType = document.getElementById('filterType');

  series.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    filterSeries.appendChild(opt);
  });

  function timeText(ts) {
    if (!ts) return '--:--';
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function sortedLogs() {
    return state.logs.slice().sort(function (a, b) {
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function filteredLogs() {
    var d = filterDate.value || '';
    var s = filterSeries.value || '';
    var t = filterType.value || '';
    return sortedLogs().filter(function (l) {
      if (d && l.date !== d) return false;
      if (s && l.key.indexOf(s + ':') !== 0) return false;
      if (t && String(l.delta) !== t) return false;
      return true;
    });
  }

  function buildRow(l) {
    var ref = levelMap[l.key];
    var plus = l.delta > 0;
    var deltaScore = plus ? l.score : -l.score;
    var tr = document.createElement('div');
    tr.className = 'row' + (plus ? '' : ' row-undo');
    var title = l.title ? l.title : '（未填书名）';
    tr.innerHTML =
      '<span class="c-time">' + timeText(l.ts) + '</span>' +
      '<span class="c-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>' +
      '<span class="c-book">' +
        '<b>' + (ref ? ref.series.name : l.key) + '</b>' +
        '<i>' + (ref ? ref.level.title : '') + '</i>' +
      '</span>' +
      '<span class="c-act ' + (plus ? 'act-in' : 'act-out') + '">' + (plus ? '打卡' : '撤销') + '</span>' +
      '<span class="c-score ' + (plus ? 'score-plus' : 'score-minus') + '">' +
        fmtSigned(deltaScore) +
      '</span>' +
      '<span class="c-op">' +
        '<button class="link js-del" data-id="' + l.id + '" title="删除这条记录并回滚积分">删除</button>' +
      '</span>';
    return tr;
  }

  function renderHistory() {
    var list = filteredLogs();
    var sum = 0;
    list.forEach(function (l) {
      sum += l.delta > 0 ? l.score : -l.score;
    });

    var scope = [];
    if (filterDate.value) scope.push(filterDate.value);
    if (filterSeries.value) {
      scope.push(filterSeries.options[filterSeries.selectedIndex].text);
    }
    var typeText = filterType.value === '1' ? '仅打卡' : (filterType.value === '-1' ? '仅撤销' : '');
    if (typeText) scope.push(typeText);

    historySummary.innerHTML =
      '<span>共 <b>' + list.length + '</b> 条记录</span>' +
      '<span>积分合计 <b class="' + (sum >= 0 ? 'score-plus' : 'score-minus') + '">' +
        fmtSigned(sum) + '</b></span>' +
      (scope.length ? '<span class="scope">筛选：' + scope.join(' / ') + '</span>' : '');

    historyList.innerHTML = '';
    if (!list.length) {
      historyList.innerHTML = '<p class="empty">没有符合条件的记录</p>';
      return;
    }

    var shown = list.slice(0, MAX_ROWS);
    var lastDate = '';
    shown.forEach(function (l) {
      if (l.date !== lastDate) {
        lastDate = l.date;
        var dayRows = list.filter(function (x) { return x.date === l.date; });
        var daySum = 0;
        dayRows.forEach(function (x) { daySum += x.delta > 0 ? x.score : -x.score; });
        var head = document.createElement('div');
        head.className = 'day';
        head.innerHTML =
          '<span class="day-date">' + l.date + '</span>' +
          '<span class="day-meta">' + dayRows.length + ' 条 · ' +
            '<b class="' + (daySum >= 0 ? 'score-plus' : 'score-minus') + '">' +
              fmtSigned(daySum) + ' 分</b></span>';
        historyList.appendChild(head);
      }
      historyList.appendChild(buildRow(l));
    });

    if (list.length > shown.length) {
      var more = document.createElement('p');
      more.className = 'empty';
      more.textContent = '仅显示最近 ' + shown.length + ' 条（共 ' + list.length + ' 条），可用日期筛选查看更早记录';
      historyList.appendChild(more);
    }
  }

  // ---------- 积分兑换 ----------
  var YUAN_PER_POINT = 0.1; // 10 积分 = 1 元

  function earnedTotal() {
    var sum = 0;
    state.logs.forEach(function (l) { sum += l.delta * l.score; });
    return round1(sum);
  }
  function exchangedTotal() {
    var sum = 0;
    state.exchanges.forEach(function (x) { sum += x.points; });
    return round1(sum);
  }
  function availablePoints() {
    return Math.max(0, round1(earnedTotal() - exchangedTotal()));
  }

  var exModal = document.getElementById('exchangeModal');
  var starPad = document.getElementById('starPad');
  var exPop = document.getElementById('exPop');
  var selPoints = 0;    // 实际可兑换积分（10 的倍数）
  var litCount = 0;     // 视觉点亮到的星星序号
  var dragging = false;

  function starHit(e) {
    var el = e.target.closest ? e.target.closest('.star') : null;
    if (!el) return null;
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    return idx > 0 ? idx : null;
  }

  function setSel(n) {
    if (n == null || isNaN(n) || n <= 0) return;
    // 所有星都能点亮到第 n 颗；可兑换数取不大于 n 的最大整十数
    litCount = Math.min(n, Math.floor(availablePoints() + 1e-9));
    selPoints = Math.floor(litCount / 10) * 10;
    renderStars();
    renderExSel();
  }

  // 兑换按 10 的倍数计；不足 10 的零头不可选
  function maxSelectable() {
    return Math.floor(availablePoints() / 10) * 10;
  }

  // 星星总数 = 可兑换积分的整数积分个数（1 星 = 1 积分），
  // 每颗星都能点亮，只有点亮数达到 10 的倍数时兑换按钮才生效
  function renderStars() {
    var avail = availablePoints();
    var total = Math.floor(avail + 1e-9); // 展示的星星总数
    var html = '';
    for (var i = 1; i <= total; i++) {
      var isMilestone = i % 10 === 0;
      var sel = i <= litCount;
      // 点亮但超出实际可兑换数（10n 之外）的星用浅金色
      var soft = sel && i > selPoints + 1e-9;
      var milestoneOk = isMilestone && i <= selPoints + 1e-9;
      html += '<span class="star' + (sel ? ' sel' : '') + (soft ? ' soft' : '') +
              (isMilestone ? ' milestone' : '') + (milestoneOk ? ' milestone-ok' : '') +
              '" data-idx="' + i + '" data-pts="' + (isMilestone ? i : '') +
              '" title="' + i + ' 积分">★</span>';
    }
    if (!total) {
      html = '<span class="no-star">可兑换积分为 0，快去打卡赚积分吧</span>';
    }
    starPad.innerHTML = html;
  }

  function renderExSel() {
    var pts = round1(selPoints);
    document.getElementById('exSelPts').textContent = fmtScore(pts);
    document.getElementById('exSelYuan').textContent = fmtScore(round1(pts * YUAN_PER_POINT));
    document.getElementById('btnDoExchange').disabled = pts <= 0;
  }

  function renderExHistory() {
    var listEl = document.getElementById('exList');
    var totalPts = exchangedTotal();
    var totalYuan = round1(totalPts * YUAN_PER_POINT);
    document.getElementById('exSum').innerHTML =
      '已兑换 <b>' + fmtScore(totalPts) + '</b> 积分 · 共 <b>' + fmtScore(totalYuan) + '</b> 元';

    if (!state.exchanges.length) {
      listEl.innerHTML = '<p class="empty">还没有兑换记录</p>';
      return;
    }
    var rows = state.exchanges.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })
      .map(function (x) {
        return '<div class="row ex-row">' +
          '<span class="c-time">' + (x.date || '') + '</span>' +
          '<span class="c-title">' + fmtScore(x.points) + ' 积分</span>' +
          '<span class="c-act act-in">零花钱 ' + fmtScore(x.yuan) + ' 元</span>' +
          '<span class="c-op"><button class="link js-ex-del" data-id="' + x.id + '">删除</button></span>' +
        '</div>';
      });
    listEl.innerHTML = rows.join('');
  }

  function renderExchange() {
    document.getElementById('exAvail').textContent = fmtScore(availablePoints());
    var cap = Math.floor(availablePoints() + 1e-9);
    if (litCount > cap) litCount = cap;
    if (selPoints > maxSelectable()) selPoints = Math.min(selPoints, maxSelectable());
    if (selPoints > cap) selPoints = cap;
    renderStars();
    renderExSel();
    renderExHistory();
  }

  function hideExPop() {
    exPop.classList.remove('open');
  }

  starPad.addEventListener('mousedown', function (e) {
    var pts = starHit(e);
    if (pts == null) return;
    dragging = true;
    setSel(pts);
    e.preventDefault();
  });
  starPad.addEventListener('mouseover', function (e) {
    if (!dragging) return;
    setSel(starHit(e));
  });
  document.addEventListener('mouseup', function () {
    dragging = false;
  });

  document.getElementById('btnDoExchange').addEventListener('click', function () {
    if (selPoints <= 0) return;
    document.getElementById('exPopPts').textContent = fmtScore(selPoints);
    document.getElementById('exPopYuan').textContent = fmtScore(round1(selPoints * YUAN_PER_POINT));
    exPop.classList.add('open');
  });
  document.getElementById('exPopCancel').addEventListener('click', hideExPop);
  document.getElementById('exPopOk').addEventListener('click', function () {
    if (selPoints <= 0) { hideExPop(); return; }
    state.exchanges.push({
      id: nextId(),
      date: todayStr(),
      ts: Date.now(),
      points: round1(selPoints),
      yuan: round1(selPoints * YUAN_PER_POINT),
    });
    selPoints = 0;
    litCount = 0;
    hideExPop();
    save();
    refresh();
    renderExchange();
  });
  document.addEventListener('click', function (e) {
    if (!exPop.classList.contains('open')) return;
    if (e.target.closest && (e.target.closest('#exPop') || e.target.closest('#btnDoExchange'))) return;
    hideExPop();
  });

  document.getElementById('exList').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.js-ex-del') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var idx = -1;
    for (var i = 0; i < state.exchanges.length; i++) {
      if (state.exchanges[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (!window.confirm('删除这条兑换记录后，对应积分将退回可兑换余额，确定吗？')) return;
    state.exchanges.splice(idx, 1);
    save();
    refresh();
    renderExchange();
  });

  document.getElementById('btnExchange').addEventListener('click', function () {
    renderExchange();
    exModal.classList.add('open');
  });

  // ---------- 移动端底栏与移动统计卡（与 PC 入口行为一致） ----------
  function openBooksModal() {
    renderBooksDetail();
    document.getElementById('booksModal').classList.add('open');
  }

  document.getElementById('btnExchangeM').addEventListener('click', function () {
    renderExchange();
    exModal.classList.add('open');
  });
  document.getElementById('statScoreM').addEventListener('click', function () {
    openHistory();
  });
  document.getElementById('statBooksM').addEventListener('click', openBooksModal);
  document.getElementById('statTodayM').addEventListener('click', function () {
    resetHistoryFilters();
    filterDate.value = todayStr();
    renderHistory();
    historyModal.classList.add('open');
  });

  document.getElementById('tabbar').addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('.tb-item') : null;
    if (!item) return;
    var act = item.getAttribute('data-act');
    if (act === 'exchange') {
      renderExchange();
      exModal.classList.add('open');
    } else if (act === 'score') {
      openHistory();
    } else if (act === 'books') {
      openBooksModal();
    } else if (act === 'today') {
      resetHistoryFilters();
      filterDate.value = todayStr();
      renderHistory();
      historyModal.classList.add('open');
    }
  });

  document.getElementById('exchangeClose').addEventListener('click', function () {
    exModal.classList.remove('open');
    hideExPop();
  });

  // ---------- 打卡弹窗（输入书名 + 判重 + 积分确认） ----------
  var ciModal = document.getElementById('checkinModal');
  var ciKey = '';

  function openCheckin(key, btnEl) {
    ciKey = key;
    var ref = levelMap[key];
    document.getElementById('ciTitle').textContent = ref.series.name + ' · ' + ref.level.title;
    document.getElementById('ciBase').textContent = fmtScore(ref.level.score);
    var second = secondScore(ref.level.score);
    document.getElementById('ciSecond').textContent = fmtScore(second);
    document.getElementById('ciThird').textContent = fmtScore(Math.min(1, second));

    var input = document.getElementById('ciBook');
    input.value = '';
    updateCiPreview();
    ciModal.classList.add('open');
    window.setTimeout(function () { input.focus(); }, 40);
    if (btnEl) btnEl.blur();
  }

  function closeCheckin() {
    ciModal.classList.remove('open');
    ciKey = '';
  }

  function updateCiPreview() {
    var raw = document.getElementById('ciBook').value;
    var title = String(raw || '').trim();
    var norm = normTitle(title);
    var dupEl = document.getElementById('ciDup');
    var confirmBtn = document.getElementById('ciConfirm');

    if (!norm) {
      dupEl.className = 'ci-dup';
      dupEl.innerHTML = '<span class="ci-hint">请输入书名，系统会在本系列内判断是否重复</span>';
      confirmBtn.disabled = true;
      confirmBtn.textContent = '确认打卡';
      return;
    }

    var r = scoreFor(ciKey, norm);
    confirmBtn.disabled = false;
    confirmBtn.textContent = '确认打卡 +' + fmtScore(r.score) + ' 分';

    if (r.again) {
      dupEl.className = 'ci-dup warn';
      dupEl.innerHTML =
        '<b>重复阅读</b>《' + escapeHtml(title) + '》在本系列已读过 <b>' + r.times + '</b> 次，' +
        '本次为第 <b>' + (r.times + 1) + '</b> 次，可得 <b>' + fmtScore(r.score) + '</b> 分。仍可继续录入。';
    } else {
      dupEl.className = 'ci-dup ok';
      dupEl.innerHTML =
        '<b>首次阅读</b>《' + escapeHtml(title) + '》可得 <b>' + fmtScore(r.score) + '</b> 分。';
    }
  }

  function confirmCheckin() {
    var title = String(document.getElementById('ciBook').value || '').trim();
    var norm = normTitle(title);
    if (!norm || !ciKey) return;
    var now = new Date();
    var date = todayStr(now);
    var r = scoreFor(ciKey, norm);
    pushLog({
      id: nextId(),
      key: ciKey,
      date: date,
      ts: now.getTime(),
      delta: 1,
      score: r.score,
      title: title,
      norm: norm,
    });
    state.updated = date;
    closeCheckin();
    commit();
    openHistory();

    // 飘字挂在可见的统计卡上（PC 或移动端），都不可见时挂在页面顶部中央
    var statEl = document.querySelector('.stats:not([hidden]) #statScoreNum');
    var top = 80;
    var left = window.innerWidth / 2;
    if (statEl) {
      var rect = statEl.getBoundingClientRect();
      if (rect.top > 0 && rect.top < window.innerHeight) {
        top = rect.top;
        left = rect.left + rect.width / 2;
      }
    }
    popText(left, top, '+' + fmtScore(r.score) + ' 分');
  }

  document.getElementById('ciBook').addEventListener('input', updateCiPreview);
  document.getElementById('ciConfirm').addEventListener('click', confirmCheckin);
  document.getElementById('ciCancel').addEventListener('click', closeCheckin);
  document.getElementById('ciClose').addEventListener('click', closeCheckin);
  // ---------- 写操作 ----------
  function commit() {
    save();
    refresh();
    renderHistory();
  }

  function popText(x, y, text) {
    var pop = document.createElement('span');
    pop.className = 'pop';
    pop.textContent = text;
    pop.style.left = x + 'px';
    pop.style.top = y - 12 + 'px';
    document.body.appendChild(pop);
    window.setTimeout(function () {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    }, 700);
  }

  board.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    var key = btn.getAttribute('data-key');
    if (!key || !levelMap[key]) return;

    if (btn.classList.contains('js-check')) {
      openCheckin(key, btn);
      return;
    }

    if (btn.classList.contains('js-undo')) {
      var last = lastCheckLog(key);
      if (!last) return;
      var now = new Date();
      var date = todayStr(now);
      pushLog({
        id: nextId(),
        key: key,
        date: date,
        ts: now.getTime(),
        delta: -1,
        score: last.score,
        title: last.title,
        norm: last.norm,
      });
      state.updated = date;
      commit();
      openHistory();
      var rect = btn.getBoundingClientRect();
      popText(rect.left + rect.width / 2, rect.top, '−' + fmtScore(last.score) + ' 分');
    }
  });

  // 删除单条记录：回滚该级别的已读本数与积分
  historyList.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.js-del') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var idx = -1;
    for (var i = 0; i < state.logs.length; i++) {
      if (state.logs[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;

    var log = state.logs[idx];
    applyLog(log, -1); // 回滚本数、书名次数与积分
    state.logs.splice(idx, 1);
    state.updated = todayStr();
    commit();
  });

  [filterDate, filterSeries, filterType].forEach(function (el) {
    el.addEventListener('change', renderHistory);
  });

  document.getElementById('btnClearFilter').addEventListener('click', function () {
    filterDate.value = '';
    filterSeries.value = '';
    filterType.value = '';
    renderHistory();
  });

  document.getElementById('btnToday').addEventListener('click', function () {
    filterDate.value = filterDate.value === todayStr() ? '' : todayStr();
    renderHistory();
  });

  // ---------- 打卡历史弹窗 ----------
  var historyModal = document.getElementById('historyModal');

  function resetHistoryFilters() {
    filterDate.value = '';
    filterSeries.value = '';
    filterType.value = '';
  }

  function openHistory(keepFilters) {
    if (!keepFilters) resetHistoryFilters();
    renderHistory();
    historyModal.classList.add('open');
  }
  function closeHistory() {
    historyModal.classList.remove('open');
  }

  document.getElementById('historyClose').addEventListener('click', closeHistory);

  // 顶部统计卡快捷筛选
  document.getElementById('statToday').addEventListener('click', function () {
    resetHistoryFilters();
    filterDate.value = todayStr();
    renderHistory();
    historyModal.classList.add('open');
  });

  document.getElementById('statScore').addEventListener('click', function () {
    openHistory();
  });

  // 累计本数：展示每个系列每个级别的打卡本数明细
  function renderBooksDetail() {
    var wrap = document.getElementById('booksDetail');
    var total = 0;
    var html = series.map(function (s) {
      var rows = s.levels.map(function (lv) {
        var c = countOf(s.id + ':' + lv.id);
        total += c;
        return (
          '<div class="bd-row' + (c > 0 ? '' : ' bd-zero') + '">' +
            '<span class="bd-name">' + lv.title + '</span>' +
            '<span class="bd-score">首次 +' + fmtScore(lv.score) + ' 分</span>' +
            '<b class="bd-count">' + c + '</b>' +
          '</div>'
        );
      }).join('');
      var sum = s.levels.reduce(function (acc, lv) {
        return acc + countOf(s.id + ':' + lv.id);
      }, 0);
      var kinds = bookKindsOf(s.id);
      return (
        '<div class="bd-series">' +
          '<div class="bd-head">' +
            '<span class="bd-title">' + s.name + '</span>' +
            '<b class="bd-sum">' + sum + ' 本 · ' + kinds + ' 种</b>' +
          '</div>' + rows +
        '</div>'
      );
    }).join('');
    document.getElementById('booksDetailTotal').textContent = total;
    wrap.innerHTML = html;
  }

  document.getElementById('statBooks').addEventListener('click', function () {
    renderBooksDetail();
    document.getElementById('booksModal').classList.add('open');
  });

  document.getElementById('booksModalClose').addEventListener('click', function () {
    document.getElementById('booksModal').classList.remove('open');
  });

  document.getElementById('btnExport').addEventListener('click', function () {
    var list = filteredLogs();
    if (!list.length) {
      window.alert('当前筛选条件下没有记录可导出');
      return;
    }
    var rows = [['日期', '时间', '书名', '系列', '级别', '操作', '分值变化']];
    list.forEach(function (l) {
      var ref = levelMap[l.key];
      rows.push([
        l.date,
        timeText(l.ts),
        l.title || '（未填书名）',
        ref ? ref.series.name : l.key,
        ref ? ref.level.title : '',
        l.delta > 0 ? '打卡' : '撤销',
        (l.delta > 0 ? '+' : '-') + fmtScore(l.score),
      ]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        return '"' + String(c).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '打卡记录-' + todayStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---------- 导入 CSV：还原另一台设备导出的记录 ----------
  function parseCsvLine(line) {
    var out = [];
    var cur = '';
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // 系列/级别名 -> levelKey 反查表
  var nameToKey = {};
  (function buildNameMap() {
    Object.keys(levelMap).forEach(function (key) {
      var ref = levelMap[key];
      // 精确名与不带「Level」的简称都登记，导入更宽容
      nameToKey[ref.series.name + ' · ' + ref.level.title] = key;
      nameToKey[ref.series.name + ref.level.title] = key;
      nameToKey[ref.series.name + '·' + ref.level.title] = key;
      if (ref.level.title.indexOf('Level ') === 0) {
        nameToKey[ref.series.name + ' · ' + ref.level.title.slice(6)] = key;
      }
    });
  })();

  function resolveKey(seriesName, levelTitle) {
    var s = String(seriesName || '').trim();
    var lv = String(levelTitle || '').trim();
    var candidates = [
      s + ' · ' + lv, s + lv, s + '·' + lv,
    ];
    if (lv.indexOf('Level ') === 0) candidates.push(s + ' · ' + lv.slice(6));
    for (var i = 0; i < candidates.length; i++) {
      if (nameToKey[candidates[i]]) return nameToKey[candidates[i]];
    }
    // 模糊兜底：系列名前缀 + 级别名包含
    var keys = Object.keys(nameToKey);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(s) === 0 && keys[j].indexOf(lv) >= 0) return nameToKey[keys[j]];
    }
    return null;
  }

  document.getElementById('btnImport').addEventListener('click', function () {
    document.getElementById('importFile').value = '';
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
      var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) {
        window.alert('文件内容为空或没有数据行');
        return;
      }

      var head = parseCsvLine(lines[0]).map(function (h) { return h.trim(); });
      var iDate = head.indexOf('日期');
      var iTime = head.indexOf('时间');
      var iTitle = head.indexOf('书名');
      var iSeries = head.indexOf('系列');
      var iLevel = head.indexOf('级别');
      var iAct = head.indexOf('操作');
      var iScore = head.indexOf('分值变化');
      if (iDate < 0 || iSeries < 0 || iLevel < 0) {
        window.alert('CSV 缺少必需列（日期 / 系列 / 级别），请使用本页面导出的文件');
        return;
      }

      var added = 0;
      var skipped = 0;
      var duped = 0;
      var errs = [];
      // 已有记录的特征指纹，用于去重（同一文件重复导入不再产生重复数据）
      var seen = {};
      state.logs.forEach(function (l) {
        seen[l.date + '|' + l.ts + '|' + (l.norm || '') + '|' + l.key + '|' + l.delta + '|' + l.score] = true;
      });
      for (var i = 1; i < lines.length; i++) {
        var cols = parseCsvLine(lines[i]);
        var date = (cols[iDate] || '').trim();
        var seriesName = iSeries >= 0 ? (cols[iSeries] || '').trim() : '';
        var levelTitle = iLevel >= 0 ? (cols[iLevel] || '').trim() : '';
        var key = resolveKey(seriesName, levelTitle);
        if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          skipped++;
          errs.push('第 ' + (i + 1) + ' 行无法识别：' + seriesName + ' ' + levelTitle);
          continue;
        }
        var isUndo = iAct >= 0 && String(cols[iAct] || '').indexOf('撤销') >= 0;
        var delta = isUndo ? -1 : 1;
        var score = 0;
        if (iScore >= 0) {
          score = parseFloat(String(cols[iScore] || '').replace(/[+−-]/g, ''));
        }
        if (isNaN(score) || score < 0) score = levelMap[key].level.score;

        var ts = Date.parse(date + 'T00:00:00');
        if (iTime >= 0) {
          var tm = Date.parse(date + 'T' + (cols[iTime] || '').trim());
          if (!isNaN(tm)) ts = tm;
        }
        if (isNaN(ts)) ts = Date.parse(date) || Date.now();

        var sig = date + '|' + ts + '|' + normTitle(iTitle >= 0 ? cols[iTitle] : '') + '|' + key + '|' + delta + '|' + round1(score);
        if (seen[sig]) { duped++; continue; }
        seen[sig] = true;

        state.logs.push({
          id: nextId(),
          key: key,
          date: date,
          ts: ts,
          delta: delta,
          score: round1(score),
          title: iTitle >= 0 ? String(cols[iTitle] || '').trim() : '',
          norm: normTitle(iTitle >= 0 ? cols[iTitle] : ''),
        });
        applyLog(state.logs[state.logs.length - 1], 1);
        added++;
      }

      state.updated = todayStr();
      save();
      refresh();
      renderHistory();
      renderExchange();

      var msg = '导入完成：新增 ' + added + ' 条';
      if (duped) msg += '，跳过 ' + duped + ' 条重复记录';
      if (skipped) msg += '，跳过 ' + skipped + ' 条无法识别的记录';
      window.alert(msg + (errs.length ? '\n' + errs.slice(0, 5).join('\n') : ''));
    };
    reader.readAsText(file, 'utf-8');
  });

  refresh();
  renderHistory();
  setTab(savedTab);
  renderHistory();
})();
