/* ═══════════════════════════════════════════
   SpendSmart – app.js
   ═══════════════════════════════════════════ */

const API = '';
let categories = [];
let settings = {};
let pieChart = null, barChart = null, anaPieChart = null, anaBarChart = null;
let currentView = 'daily';
let filterDate = todayStr();
let calYear, calMonth;
let anaYear, anaMonth;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function fmt(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}

// ── API helpers ──
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

// ── Navigation ──
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  const nav = document.getElementById('nav-' + page);
  if (pg) pg.classList.add('active');
  if (nav) nav.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  loadPage(page);
}

function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  else if (page === 'expenses') loadExpenses();
  else if (page === 'calendar') renderCalendar();
  else if (page === 'subscriptions') loadSubscriptions();
  else if (page === 'analytics') loadAnalytics();
  else if (page === 'notes') loadNotes();
  else if (page === 'settings') loadSettings();
}

// ── Dashboard ──
async function loadDashboard() {
  const today = new Date();
  document.getElementById('today-date').textContent = today.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning!' : hour < 17 ? 'Good afternoon!' : 'Good evening!';
  document.querySelector('#page-dashboard .page-title').textContent = greeting + ' 👋';

  const [insightsData, monthData, todayExp, weekExp] = await Promise.all([
    api('/api/analytics/insights'),
    api('/api/analytics/monthly?year=' + today.getFullYear() + '&month=' + (today.getMonth() + 1)),
    api('/api/expenses?view=daily&date=' + todayStr()),
    api('/api/expenses?view=weekly&date=' + todayStr()),
  ]);

  // Budget card
  const budget = parseFloat(insightsData.budget || 0);
  const spent = parseFloat(insightsData.month_total || 0);
  const remaining = parseFloat(insightsData.remaining || 0);
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  document.getElementById('budget-display').textContent = fmt(budget);
  document.getElementById('budget-spent').textContent = fmt(spent) + ' spent';
  document.getElementById('budget-remaining').textContent = fmt(remaining) + ' left';
  const bar = document.getElementById('budget-progress');
  bar.style.width = pct + '%';
  bar.className = 'progress-bar' + (pct >= 80 ? ' danger' : pct >= 50 ? ' warn' : '');

  // Stat cards
  const todayTotal = todayExp.reduce((s, e) => s + e.amount, 0);
  const weekTotal = weekExp.reduce((s, e) => s + e.amount, 0);
  document.getElementById('today-total').textContent = fmt(todayTotal);
  document.getElementById('week-total').textContent = fmt(weekTotal);

  // Days until broke
  const dub = insightsData.days_until_broke;
  const dubEl = document.getElementById('days-broke');
  const dubCard = document.getElementById('days-broke-card');
  dubEl.textContent = budget > 0 ? (dub > 999 ? '∞' : dub + 'd') : '—';
  dubCard.className = 'card stat-card days-card ' + (dub > 14 ? 'safe' : dub > 7 ? 'warn' : 'danger');

  // Insights
  const insEl = document.getElementById('insights-list');
  insEl.innerHTML = insightsData.tips.map(t =>
    `<div class="insight-item ${t.level}">${t.text}</div>`
  ).join('');

  // Charts
  renderPieChart('pie-chart', monthData.categories);
  renderBarChart('bar-chart', monthData.weekly);

  // Recent expenses
  const recent = monthData ? [] : [];
  const recentExp = await api('/api/expenses?view=monthly&date=' + todayStr());
  const top5 = recentExp.slice(0, 5);
  document.getElementById('recent-expenses-list').innerHTML = top5.length
    ? top5.map(e => expenseItemHTML(e)).join('')
    : '<div class="empty-state"><div class="empty-icon">🎉</div><p>No expenses this month yet!</p></div>';
  attachExpenseActions(document.getElementById('recent-expenses-list'));
}

// ── Charts ──
function renderPieChart(canvasId, cats) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (pieChart && canvasId === 'pie-chart') { pieChart.destroy(); pieChart = null; }
  if (anaPieChart && canvasId === 'ana-pie-chart') { anaPieChart.destroy(); anaPieChart = null; }
  if (!cats || !cats.length) { ctx.parentElement.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>No data yet</p></div>'; return; }
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.name || 'Other'),
      datasets: [{ data: cats.map(c => c.total), backgroundColor: cats.map(c => c.color || '#a0c4ff'), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { padding: 16, font: { family: 'Nunito', weight: '700', size: 12 }, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      animation: { animateScale: true, duration: 600 }
    }
  });
  if (canvasId === 'pie-chart') pieChart = chart;
  else anaPieChart = chart;
}

function renderBarChart(canvasId, weekly) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (barChart && canvasId === 'bar-chart') { barChart.destroy(); barChart = null; }
  if (anaBarChart && canvasId === 'ana-bar-chart') { anaBarChart.destroy(); anaBarChart = null; }
  if (!weekly || !weekly.length) { ctx.parentElement.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><p>No data yet</p></div>'; return; }
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weekly.map(w => w.label),
      datasets: [{ label: 'Spending', data: weekly.map(w => w.total), backgroundColor: 'rgba(108,99,255,0.25)', borderColor: '#6c63ff', borderWidth: 2, borderRadius: 8, hoverBackgroundColor: 'rgba(108,99,255,0.5)' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { y: { beginAtZero: true, grid: { color: '#f0f1f8' }, ticks: { callback: v => '₹' + v } }, x: { grid: { display: false } } },
      animation: { duration: 600 }
    }
  });
  if (canvasId === 'bar-chart') barChart = chart;
  else anaBarChart = chart;
}

// ── Expense list helpers ──
function expenseItemHTML(e) {
  const color = e.category_color || '#a0c4ff';
  const icon = e.category_icon || '💰';
  return `<div class="expense-item" data-id="${e.id}">
    <div class="expense-cat-icon" style="background:${color}20">${icon}</div>
    <div class="expense-info">
      <div class="expense-desc">${e.description || e.category_name || 'Expense'}</div>
      <div class="expense-meta">${e.category_name || ''} · ${fmtDate(e.expense_date)}${e.is_subscription ? ' · 🔄' : ''}${e.notes ? ' · ' + e.notes : ''}</div>
    </div>
    <div class="expense-amount">${fmt(e.amount)}</div>
    <div class="expense-actions">
      <button class="btn-icon-sm edit-btn" data-id="${e.id}" title="Edit">✏️</button>
      <button class="btn-icon-sm btn-delete delete-btn" data-id="${e.id}" title="Delete">🗑️</button>
    </div>
  </div>`;
}

function attachExpenseActions(container) {
  container.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
  container.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteExpense(btn.dataset.id)));
}

// ── Expenses page ──
async function loadExpenses() {
  const url = `/api/expenses?view=${currentView}&date=${filterDate}`;
  const expenses = await api(url);
  const cat = document.getElementById('filter-category').value;
  const filtered = cat ? expenses.filter(e => e.category_id == cat) : expenses;
  const list = document.getElementById('expenses-list');
  const empty = document.getElementById('expenses-empty');
  if (filtered.length) {
    list.innerHTML = filtered.map(e => expenseItemHTML(e)).join('');
    list.style.display = '';
    empty.style.display = 'none';
    attachExpenseActions(list);
  } else {
    list.style.display = 'none';
    empty.style.display = '';
  }
}

// ── Calendar ──
async function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  label.textContent = new Date(calYear, calMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const data = await api(`/api/analytics/monthly?year=${calYear}&month=${calMonth + 1}`);
  const daily = data.daily || {};
  const grid = document.getElementById('calendar-grid');
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();

  // Calculate thresholds for color coding
  const amounts = Object.values(daily).filter(v => v > 0);
  const avgAmt = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const highThreshold = avgAmt * 1.4;
  const lowThreshold = avgAmt * 0.6;

  function calColorClass(amt) {
    if (!amt) return '';
    if (amt >= highThreshold) return ' cal-high';
    if (amt >= lowThreshold) return ' cal-mid';
    return ' cal-low';
  }

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day other-month"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const amt = daily[ds];
    const isToday = ds === today;
    const colorCls = calColorClass(amt);
    html += `<div class="cal-day${isToday ? ' today' : ''}${amt ? ' has-spend' : ''}${colorCls}" data-date="${ds}">
      <span class="cal-date">${d}</span>
      ${amt ? `<span class="cal-amount">${fmt(amt)}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // Legend
  let legend = document.getElementById('cal-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'cal-legend';
    legend.className = 'cal-legend';
    document.querySelector('.calendar-card').appendChild(legend);
  }
  legend.innerHTML = `<span class="leg-item"><span class="leg-dot" style="background:#22c55e"></span>Low</span><span class="leg-item"><span class="leg-dot" style="background:#f59e0b"></span>Moderate</span><span class="leg-item"><span class="leg-dot" style="background:#ef4444"></span>High</span>`;

  grid.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => openDayModal(el.dataset.date));
  });
}

async function openDayModal(dateStr) {
  const expenses = await api('/api/expenses/date/' + dateStr);
  document.getElementById('day-modal-title').textContent = fmtDate(dateStr);
  const body = document.getElementById('day-modal-body');
  if (!expenses.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">✨</div><p>No expenses on this day</p></div>';
  } else {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const catMap = {};
    expenses.forEach(e => { catMap[e.category_name || 'Other'] = (catMap[e.category_name || 'Other'] || 0) + e.amount; });
    body.innerHTML = `<div style="margin-bottom:1rem"><strong>Total: ${fmt(total)}</strong></div>
      <div class="expense-list">${expenses.map(e => expenseItemHTML(e)).join('')}</div>
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
        <strong style="font-size:.85rem;color:var(--text-secondary)">BY CATEGORY</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.4rem">
          ${Object.entries(catMap).map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:.88rem"><span>${k}</span><strong>${fmt(v)}</strong></div>`).join('')}
        </div>
      </div>`;
    attachExpenseActions(body);
  }
  document.getElementById('day-modal').classList.add('open');
}

// ── Subscriptions ──
async function loadSubscriptions() {
  const subs = await api('/api/subscriptions');
  const list = document.getElementById('subscriptions-list');
  const empty = document.getElementById('subs-empty');
  if (subs.length) {
    list.innerHTML = subs.map(e => expenseItemHTML(e)).join('');
    list.style.display = '';
    empty.style.display = 'none';
    attachExpenseActions(list);
    const monthlyTotal = subs.filter(s => s.recurrence === 'monthly').reduce((s, e) => s + e.amount, 0);
    const weeklyTotal = subs.filter(s => s.recurrence === 'weekly').reduce((s, e) => s + e.amount, 0);
    const dailyImpact = monthlyTotal / 30 + weeklyTotal / 7;
    document.getElementById('sub-summary-row').innerHTML = `
      <div class="card sub-stat-card"><div class="sub-stat-icon">📅</div><div class="sub-stat-label">Monthly</div><div class="sub-stat-value">${fmt(monthlyTotal)}</div></div>
      <div class="card sub-stat-card"><div class="sub-stat-icon">📆</div><div class="sub-stat-label">Weekly</div><div class="sub-stat-value">${fmt(weeklyTotal)}</div></div>
      <div class="card sub-stat-card"><div class="sub-stat-icon">📊</div><div class="sub-stat-label">Daily Impact</div><div class="sub-stat-value">${fmt(dailyImpact)}</div></div>`;
  } else {
    list.style.display = 'none';
    empty.style.display = '';
    document.getElementById('sub-summary-row').innerHTML = '';
  }
}

// ── Analytics ──
async function loadAnalytics() {
  document.getElementById('ana-month-label').textContent = new Date(anaYear, anaMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const [data, ins] = await Promise.all([
    api(`/api/analytics/monthly?year=${anaYear}&month=${anaMonth + 1}`),
    api('/api/analytics/insights')
  ]);
  renderPieChart('ana-pie-chart', data.categories);
  renderBarChart('ana-bar-chart', data.weekly);
  const total = data.categories.reduce((s, c) => s + c.total, 0);

  // Day analysis
  const dailyEntries = Object.entries(data.daily || {});
  let mostDay = '—', leastDay = '—', mostAmt = 0, leastAmt = Infinity;
  dailyEntries.forEach(([d, v]) => {
    if (v > mostAmt)  { mostAmt = v;  mostDay = d; }
    if (v < leastAmt) { leastAmt = v; leastDay = d; }
  });
  if (!dailyEntries.length) { leastDay = '—'; leastAmt = 0; }

  document.getElementById('analytics-stats-row').innerHTML = `
    <div class="card stat-card"><div class="stat-icon">💸</div><div class="stat-label">Total Spent</div><div class="stat-value">${fmt(total)}</div></div>
    <div class="card stat-card"><div class="stat-icon">📊</div><div class="stat-label">Daily Avg</div><div class="stat-value">${fmt(ins.daily_avg)}</div></div>
    <div class="card stat-card" style="border-left:4px solid #ef4444">
      <div class="stat-icon">🔴</div><div class="stat-label">Most Expensive Day</div>
      <div class="stat-value" style="font-size:1rem">${mostDay !== '—' ? fmtDate(mostDay) : '—'}</div>
      <div style="font-size:.85rem;color:#ef4444;font-weight:800">${mostAmt ? fmt(mostAmt) : ''}</div>
    </div>
    <div class="card stat-card" style="border-left:4px solid #22c55e">
      <div class="stat-icon">🟢</div><div class="stat-label">Least Expensive Day</div>
      <div class="stat-value" style="font-size:1rem">${leastDay !== '—' ? fmtDate(leastDay) : '—'}</div>
      <div style="font-size:.85rem;color:#22c55e;font-weight:800">${leastAmt !== Infinity ? fmt(leastAmt) : ''}</div>
    </div>`;

  const tableEl = document.getElementById('analytics-cat-table');
  if (!data.categories.length) { tableEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>No data for this month</p></div>'; return; }
  tableEl.innerHTML = `<table class="ana-cat-table" style="width:100%">
    <thead><tr><th>Category</th><th>Amount</th><th>Share</th><th style="width:35%">Bar</th></tr></thead>
    <tbody>${data.categories.map(c => {
      const pct = total > 0 ? ((c.total / total) * 100).toFixed(1) : 0;
      return `<tr>
        <td>${c.icon || '💰'} ${c.name || 'Other'}</td>
        <td><strong>${fmt(c.total)}</strong></td>
        <td>${pct}%</td>
        <td><div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%;background:${c.color || '#a0c4ff'}"></div></div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// ── Notes ──
async function loadNotes() {
  const d = document.getElementById('notes-date').value || todayStr();
  const note = await api('/api/notes/' + d);
  document.getElementById('notes-textarea').value = note.content || '';
}

// ── Settings ──
async function loadSettings() {
  const [cats, sets] = await Promise.all([api('/api/categories'), api('/api/settings')]);
  settings = sets;
  categories = cats;
  document.getElementById('budget-input').value = sets.monthly_budget || '';
  populateCategoriesSettings(cats);
  populateCategorySelects();
}

function populateCategoriesSettings(cats) {
  const el = document.getElementById('categories-list-settings');
  el.innerHTML = cats.map(c => `<div class="cat-item">
    <span class="cat-item-icon">${c.icon}</span>
    <span class="cat-item-name">${c.name}</span>
    ${c.is_custom ? `<span class="cat-item-badge">custom</span><button class="btn-icon-sm btn-delete" onclick="deleteCategory(${c.id})">🗑️</button>` : ''}
  </div>`).join('');
}

function populateCategorySelects() {
  const opts = categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  ['exp-category', 'filter-category'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const extra = id === 'filter-category' ? '<option value="">All Categories</option>' : '';
    el.innerHTML = extra + opts;
  });
}

async function deleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  await api('/api/categories/' + id, 'DELETE');
  const cats = await api('/api/categories');
  categories = cats;
  populateCategoriesSettings(cats);
  populateCategorySelects();
  showToast('Category deleted');
}

// ── Expense Modal ──
function openAddModal(isSub = false) {
  document.getElementById('modal-title').textContent = 'Add Expense';
  document.getElementById('edit-expense-id').value = '';
  document.getElementById('expense-form').reset();
  document.getElementById('exp-date').value = todayStr();
  if (isSub) { document.getElementById('exp-is-sub').checked = true; document.getElementById('recurrence-group').style.display = ''; }
  else document.getElementById('recurrence-group').style.display = 'none';
  populateCategorySelects();
  renderQuickAddCategory();
  document.getElementById('expense-modal').classList.add('open');
}

function renderQuickAddCategory() {
  let wrap = document.getElementById('quick-cat-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="quick-cat-form" id="quick-cat-toggle-row">
      <button type="button" class="btn-link" id="toggle-quick-cat">＋ Add new category</button>
    </div>
    <div class="quick-cat-inputs" id="quick-cat-inputs" style="display:none">
      <input type="text" id="qc-name" class="form-input" placeholder="Category name" maxlength="30" style="flex:1"/>
      <input type="text" id="qc-icon" class="form-input" placeholder="Emoji" maxlength="4" style="width:60px"/>
      <input type="color" id="qc-color" class="color-input" value="#a0c4ff" title="Color"/>
      <button type="button" class="btn btn-primary" id="qc-save" style="white-space:nowrap">Save</button>
    </div>`;
  document.getElementById('toggle-quick-cat').addEventListener('click', () => {
    const inp = document.getElementById('quick-cat-inputs');
    inp.style.display = inp.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('qc-save').addEventListener('click', async () => {
    const name = document.getElementById('qc-name').value.trim();
    const icon = document.getElementById('qc-icon').value.trim() || '💰';
    const color = document.getElementById('qc-color').value;
    if (!name) return showToast('Enter category name', 'error');
    const newCat = await api('/api/categories', 'POST', { name, icon, color });
    categories = await api('/api/categories');
    populateCategorySelects();
    document.getElementById('exp-category').value = newCat.id;
    document.getElementById('quick-cat-inputs').style.display = 'none';
    showToast('Category "' + name + '" added!', 'success');
  });
}

async function openEditModal(id) {
  const exps = await api('/api/expenses?view=monthly&date=' + todayStr());
  let exp = exps.find(e => e.id == id);
  if (!exp) {
    const allSubs = await api('/api/subscriptions');
    exp = allSubs.find(e => e.id == id);
  }
  if (!exp) return;
  document.getElementById('modal-title').textContent = 'Edit Expense';
  document.getElementById('edit-expense-id').value = exp.id;
  document.getElementById('exp-amount').value = exp.amount;
  document.getElementById('exp-date').value = exp.expense_date;
  document.getElementById('exp-desc').value = exp.description || '';
  document.getElementById('exp-notes').value = exp.notes || '';
  document.getElementById('exp-is-sub').checked = !!exp.is_subscription;
  document.getElementById('recurrence-group').style.display = exp.is_subscription ? '' : 'none';
  document.getElementById('exp-recurrence').value = exp.recurrence || 'monthly';
  populateCategorySelects();
  document.getElementById('exp-category').value = exp.category_id || '';
  document.getElementById('expense-modal').classList.add('open');
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await api('/api/expenses/' + id, 'DELETE');
  showToast('Expense deleted', 'success');
  loadPage(document.querySelector('.page.active').id.replace('page-', ''));
}

// ── Init ──
async function init() {
  const today = new Date();
  calYear = anaYear = today.getFullYear();
  calMonth = anaMonth = today.getMonth();
  document.getElementById('filter-date').value = todayStr();
  document.getElementById('notes-date').value = todayStr();

  // Load categories
  categories = await api('/api/categories');
  settings = await api('/api/settings');
  populateCategorySelects();

  // Nav
  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('click', e => { e.preventDefault(); navigate(n.dataset.page); });
  });
  document.querySelectorAll('[data-page]').forEach(el => {
    if (!el.classList.contains('nav-item')) el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); });
  });

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  // Add expense buttons
  ['open-add-modal', 'open-add-modal-2', 'open-add-modal-3', 'add-expense-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => openAddModal());
  });
  document.getElementById('open-sub-modal').addEventListener('click', () => openAddModal(true));

  // Close modals
  ['close-expense-modal', 'cancel-expense-modal'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => document.getElementById('expense-modal').classList.remove('open'));
  });
  document.getElementById('close-day-modal').addEventListener('click', () => document.getElementById('day-modal').classList.remove('open'));
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

  // Subscription checkbox
  document.getElementById('exp-is-sub').addEventListener('change', e => {
    document.getElementById('recurrence-group').style.display = e.target.checked ? '' : 'none';
  });

  // Expense form submit
  document.getElementById('expense-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('edit-expense-id').value;
    const body = {
      amount: document.getElementById('exp-amount').value,
      expense_date: document.getElementById('exp-date').value,
      description: document.getElementById('exp-desc').value,
      category_id: document.getElementById('exp-category').value || null,
      notes: document.getElementById('exp-notes').value,
      is_subscription: document.getElementById('exp-is-sub').checked ? 1 : 0,
      recurrence: document.getElementById('exp-recurrence').value,
    };
    if (id) await api('/api/expenses/' + id, 'PUT', body);
    else await api('/api/expenses', 'POST', body);
    document.getElementById('expense-modal').classList.remove('open');
    showToast(id ? 'Expense updated!' : 'Expense added!', 'success');
    loadPage(document.querySelector('.page.active').id.replace('page-', ''));
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      loadExpenses();
    });
  });
  document.getElementById('filter-date').addEventListener('change', e => { filterDate = e.target.value; loadExpenses(); });
  document.getElementById('filter-category').addEventListener('change', () => loadExpenses());

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
  document.getElementById('cal-next').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });

  // Analytics nav
  document.getElementById('ana-prev').addEventListener('click', () => { anaMonth--; if (anaMonth < 0) { anaMonth = 11; anaYear--; } loadAnalytics(); });
  document.getElementById('ana-next').addEventListener('click', () => { anaMonth++; if (anaMonth > 11) { anaMonth = 0; anaYear++; } loadAnalytics(); });

  // Save budget
  document.getElementById('save-budget-btn').addEventListener('click', async () => {
    const val = document.getElementById('budget-input').value;
    await api('/api/settings', 'POST', { monthly_budget: val });
    settings.monthly_budget = val;
    document.getElementById('budget-save-status').textContent = '✅ Saved!';
    setTimeout(() => document.getElementById('budget-save-status').textContent = '', 2500);
    showToast('Budget saved!', 'success');
  });

  // Add category
  document.getElementById('add-cat-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value.trim() || '💰';
    const color = document.getElementById('new-cat-color').value;
    if (!name) return showToast('Please enter a category name', 'error');
    await api('/api/categories', 'POST', { name, icon, color });
    document.getElementById('new-cat-name').value = '';
    document.getElementById('new-cat-icon').value = '';
    const cats = await api('/api/categories');
    categories = cats;
    populateCategoriesSettings(cats);
    populateCategorySelects();
    showToast('Category added!', 'success');
  });

  // Notes
  document.getElementById('notes-date').addEventListener('change', loadNotes);
  document.getElementById('save-note-btn').addEventListener('click', async () => {
    const d = document.getElementById('notes-date').value;
    const content = document.getElementById('notes-textarea').value;
    await api('/api/notes/' + d, 'POST', { content });
    document.getElementById('save-status').textContent = '✅ Saved!';
    setTimeout(() => document.getElementById('save-status').textContent = '', 2500);
  });

  // Load dashboard
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
