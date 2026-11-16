// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// breakdown and the protocol's farm plan, and a live-token tab. No network: every byte it shows
// is in data.js. The page recomputes a row's implied value from the snapshot figures and checks
// the number board.json carries, so the page's code and the board's data are visibly the same
// arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return '×' + n.toFixed(2); }

  // The model in one function: the same arithmetic main.ts runs, from the same figures.
  function sectorOf(category) {
    if (category !== null && category !== undefined && Object.prototype.hasOwnProperty.call(MODEL.sector_multiples, category)) return MODEL.sector_multiples[category];
    return MODEL.default_sector_multiple;
  }
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + MODEL.growth_weight * Math.tanh(growth / MODEL.growth_scale);
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var extra = Math.max(0, Math.min((row.chains || []).length - 1, MODEL.chain_max_extra));
    var chainMult = 1 + MODEL.chain_per_extra * extra;
    var sector = sectorOf(row.category);
    return { implied: Math.max(1, Math.round(row.tvl_usd * sector * growthMult * maturity * chainMult)), sector: sector, growth: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: age };
  }

  // ---- header stats -------------------------------------------------------
  function renderStats() {
    var total = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var top = DATA.rows[0];
    $('asof').textContent = DATA.as_of;
    $('mver').textContent = DATA.model_version;
    $('src').textContent = 'DefiLlama protocols, fetched ' + DATA.as_of;
    $('stats').innerHTML =
      stat(DATA.watchlist_size, 'Watchlist', 'pre-token, TVL ≥ $50M') +
      stat(DATA.board_size, 'Board rows', DATA.early_size + ' found below the floor') +
      stat(fmtUsd(total), 'Total implied value', 'across the whole board') +
      stat(top ? esc(top.name) : '—', 'Top pick', top ? 'rank 1 · ' + fmtUsd(top.implied_value_usd) : '');
    function stat(b, label, sub) {
      return '<div class="stat"><span>' + label + '</span><b>' + b + '</b><em>' + esc(sub) + '</em></div>';
    }
  }

  // ---- controls -----------------------------------------------------------
  function renderCategories() {
    var cats = {};
    DATA.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
    var sel = $('category');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a.rank; vb = b.rank; dir = 1; }
      if (va !== vb) return (va < vb ? -1 : 1) * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }

  // ---- board table --------------------------------------------------------
  function renderBoard() {
    var board = $('board');
    if (state.tab === 'live') { renderLive(board); return; }
    if (state.tab === 'model') { board.innerHTML = ''; return; }
    var rows = filteredRows();
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    $('count').textContent = 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' protocols';
    if (!rows.length) { board.innerHTML = '<div class="empty">Nothing matches this filter. Clear the search or pick another category.</div>'; return; }
    var html = '<table><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var pct = r.change_7d;
      var cls = pct === null ? '' : pct >= 0 ? 'pos' : 'neg';
      var bar = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td><span class="rank' + (r.rank > 3 ? ' dim' : '') + '">' + r.rank + '</span></td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (WATCH[r.slug] ? '<span class="badge">Watchlist</span>' : '') +
        '<div class="pmeta">' + esc(r.category || 'Uncategorised') + ' · ' + esc((r.chains || []).slice(0, 3).join(', ')) + '</div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(pct) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b><div class="bar"><i style="width:' + bar + '%"></i></div></td>' +
        '<td><button type="button" class="plan-btn" data-plan="' + esc(r.slug) + '">Farm plan</button></td></tr>';
    });
    html += '</tbody></table><p class="note">Implied value is the radar&rsquo;s own claim from TVL, growth, age and chains — never a promise of a token. “Records no token” means DefiLlama&rsquo;s record carries none; it is not proof that none exists.</p>';
    board.innerHTML = html;
    board.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target && ev.target.getAttribute('data-plan')) return;
        select(tr.getAttribute('data-slug'));
      });
    });
    board.querySelectorAll('[data-plan]').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); select(b.getAttribute('data-plan')); });
    });
  }

  // ---- live tab -----------------------------------------------------------
  function renderLive(board) {
    $('count').textContent = DATA.live.length + ' live-token protocols, by market cap';
    var html = '<table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>';
    DATA.live.forEach(function (r) {
      html += '<tr><td><span class="pname">' + esc(r.name) + '</span><div class="pmeta">' + esc(r.category || 'Uncategorised') + ' · ' + esc((r.chains || []).slice(0, 3).join(', ')) + '</div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    });
    html += '</tbody></table><p class="note">These already trade: the board shows the market&rsquo;s own value for them, never a model&rsquo;s. They are here so the radar&rsquo;s pre-token ranks can be read against what launched tokens are actually worth.</p>';
    board.innerHTML = html;
  }

  // ---- detail drawer ------------------------------------------------------
  function select(slug) {
    state.selected = slug;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var drawer = $('drawer');
    if (!row) { drawer.hidden = true; renderBoard(); return; }
    var v = impliedOf(row);
    var match = v.implied === row.implied_value_usd ? 'matches board.json' : 'differs from board.json — do not trust it';
    var steps = (row.farm_steps || []).map(function (s) {
      var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
      if (m) return '<li>' + esc(m[1]) + '<span class="cost">Cost: ' + esc(m[2]) + ' · Time: ' + esc(m[3]) + '</span></li>';
      return '<li>' + esc(s) + '</li>';
    }).join('');
    drawer.innerHTML =
      '<button type="button" class="close" id="drawer-close">Close ✕</button>' +
      '<span class="badge">Rank ' + row.rank + (WATCH[row.slug] ? ' · Watchlist' : '') + '</span>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="pmeta">' + esc(row.category || 'Uncategorised') + ' · ' + esc((row.chains || []).join(', ')) + ' · records no token</p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>7-day growth</span><b class="' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>Age</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '</div>' +
      '<h3>Why this rank</h3>' +
      '<div class="model-line">TVL ' + fmtUsd(row.tvl_usd) + ' × sector ' + fmtMult(v.sector) + ' (' + esc(row.category || 'default') + ')\n' +
      '× growth ' + fmtMult(v.growthMult) + ' (' + fmtPct(v.growth) + ' over 7 days)\n' +
      '× maturity ' + fmtMult(v.maturity) + ' (' + fmtAge(v.age) + ' with no token)\n' +
      '× chains ' + fmtMult(v.chainMult) + ' (' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')\n' +
      '= ' + fmtUsd(v.implied) + ' — ' + match + '</div>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="note">The plan is the radar&rsquo;s own suggestion, not financial advice. Never pay to claim, and never share a seed phrase.</p>';
    drawer.hidden = false;
    $('drawer-close').addEventListener('click', function () { state.selected = null; drawer.hidden = true; renderBoard(); });
    renderBoard();
  }

  // ---- model tab ----------------------------------------------------------
  function renderModelGrid() {
    var g = $('model-grid');
    var items = Object.keys(MODEL.sector_multiples).sort().map(function (c) {
      return '<div><b>' + esc(c) + '</b>sector multiple ×' + MODEL.sector_multiples[c].toFixed(2) + '</div>';
    });
    items.push('<div><b>Default sector</b>×' + MODEL.default_sector_multiple.toFixed(2) + ' when no sector is listed</div>');
    items.push('<div><b>Growth curve</b>1 + ' + MODEL.growth_weight + '·tanh(growth ÷ ' + MODEL.growth_scale + '), clamped ' + MODEL.growth_floor + '% to ' + MODEL.growth_cap + '%</div>');
    items.push('<div><b>Maturity</b>' + MODEL.maturity_floor + ' + ' + MODEL.maturity_range + '·min(age, ' + MODEL.maturity_days + 'd) ÷ ' + MODEL.maturity_days + 'd</div>');
    g.innerHTML = items.join('');
  }

  // ---- tabs, controls, hash ----------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    $('controls').style.display = tab === 'model' ? 'none' : '';
    $('model').hidden = tab !== 'model';
    if (tab === 'model') renderModelGrid();
    renderBoard();
  }

  function readHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    var parts = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (parts.tab && (parts.tab === 'pre-token' || parts.tab === 'live' || parts.tab === 'model')) state.tab = parts.tab;
    if (parts.filter) { state.category = parts.filter; var sel = $('category'); if (sel) sel.value = parts.filter; }
    if (parts.q) { state.q = parts.q; var q = $('q'); if (q) q.value = parts.q; }
    if (parts.detail) state.selected = parts.detail;
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
    });
    $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
    $('category').addEventListener('change', function () { state.category = this.value; renderBoard(); });
    $('sort').addEventListener('change', function () {
      state.sort = this.value;
      state.dir = this.value === 'rank' ? 1 : -1;
      renderBoard();
    });
    $('watchlist').addEventListener('change', function () { state.watchlistOnly = this.checked; renderBoard(); });
    window.addEventListener('hashchange', function () {
      readHash();
      setTab(state.tab);
      if (state.selected) select(state.selected);
    });
  }

  renderStats();
  renderCategories();
  bind();
  readHash();
  setTab(state.tab);
  if (state.selected) select(state.selected);
})();
