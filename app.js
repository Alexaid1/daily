'use strict';

/* =========================================================
   Daily — чекер дел
   Данные: localStorage + (опционально) приватный GitHub Gist.
   Каждая запись имеет updatedAt; при синхронизации побеждает
   более свежая версия каждой записи, так что правки с телефона
   и компьютера не затирают друг друга.
   ========================================================= */

const LS_STATE = 'dt_state_v1';
const LS_TOKEN = 'dt_gh_token';
const LS_GIST = 'dt_gist_id';
const LS_THEME = 'dt_theme';
const GIST_DESC = 'daily-tracker-data';
const GIST_FILE = 'daily-tracker.json';
const COLS = ['habits', 'checks', 'tasks', 'notes'];

const CATS = {
  prog:  { name: 'Программирование', color: '#6366f1' },
  en:    { name: 'Английский',       color: '#0ea5e9' },
  trade: { name: 'Трейдинг',         color: '#f59e0b' },
  sql:   { name: 'SQL',              color: '#10b981' },
  other: { name: 'Другое',           color: '#a855f7' },
};
// порядок кнопок дней: Пн..Вс → значения Date.getDay()
const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];

/* ---------- утилиты ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const now = () => Date.now();
const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function fmtDay(k, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return parseKey(k).toLocaleDateString('ru-RU', opts);
}
function relDay(k) {
  const t = dateKey();
  if (k === t) return 'сегодня';
  if (k === addDays(t, -1)) return 'вчера';
  if (k === addDays(t, 1)) return 'завтра';
  return null;
}
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/* ---------- состояние ---------- */
function defaultState() {
  // фиксированные id и updatedAt=1: если два устройства стартуют с нуля,
  // их стартовые списки совпадут и не задвоятся при синхронизации
  const h = (id, title, cat, order, days = [], hint = '') =>
    [id, { id, title, cat, order, days, hint, updatedAt: 1 }];
  return {
    v: 1,
    habits: Object.fromEntries([
      h('h-prog', 'Программирование', 'prog', 1, [], 'основа — больше всего времени'),
      h('h-en-words', 'Слова', 'en', 2, [], 'Anki / ReWord'),
      h('h-en-listen', 'Аудирование', 'en', 3, [], 'в дороге'),
      h('h-en-grammar', 'Грамматика', 'en', 4, [1, 3, 5], 'Murphy'),
      h('h-en-writing', 'Письмо', 'en', 5, [2, 4], 'текст → разбор с Claude'),
      h('h-en-speaking', 'Разговорная практика', 'en', 6, [6, 0]),
      h('h-trade', 'Разбор графика', 'trade', 7, [], 'запись в журнал наблюдений'),
      h('h-sql', 'SQL', 'sql', 8),
    ]),
    checks: {},
    tasks: {},
    notes: {},
  };
}

function normalize(s) {
  const out = { v: 1 };
  for (const c of COLS) out[c] = (s && typeof s[c] === 'object' && s[c]) || {};
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* битые данные — начинаем заново */ }
  return defaultState();
}

let state = loadState();

function persistLocal() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { toast('Не удалось сохранить на устройстве'); }
}
function commit() { persistLocal(); render(); scheduleSync(); }

function merge(a, b) {
  const out = { v: 1 };
  for (const c of COLS) {
    const A = (a && a[c]) || {}, B = (b && b[c]) || {}, o = {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[id], y = B[id];
      o[id] = !x ? y : !y ? x : ((y.updatedAt || 0) > (x.updatedAt || 0) ? y : x);
    }
    out[c] = o;
  }
  return out;
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

/* ---------- модель ---------- */
const alive = (o) => Object.values(o).filter((x) => x && !x.deleted);
const habitsSorted = () => alive(state.habits).sort((a, b) => (a.order || 0) - (b.order || 0));
const scheduledOn = (h, k) => !h.days || h.days.length === 0 || h.days.includes(parseKey(k).getDay());
const isDone = (k, hid) => !!(state.checks[k + '|' + hid] && state.checks[k + '|' + hid].done);

function toggleCheck(k, hid) {
  state.checks[k + '|' + hid] = { done: !isDone(k, hid), updatedAt: now() };
  commit();
}

function currentStreak(h) {
  let k = dateKey(), n = 0;
  if (scheduledOn(h, k) && !isDone(k, h.id)) k = addDays(k, -1); // сегодня ещё не вечер
  for (let i = 0; i < 400; i++, k = addDays(k, -1)) {
    if (!scheduledOn(h, k)) continue;
    if (isDone(k, h.id)) n++; else break;
  }
  return n;
}
function bestStreak(h, days = 365) {
  let k = addDays(dateKey(), -days), best = 0, cur = 0;
  for (let i = 0; i <= days; i++, k = addDays(k, 1)) {
    if (!scheduledOn(h, k)) continue;
    if (isDone(k, h.id)) { cur++; best = Math.max(best, cur); } else if (k !== dateKey()) cur = 0;
  }
  return best;
}
function firstDataDay() {
  let min = null;
  for (const key in state.checks) { const k = key.split('|')[0]; if (!min || k < min) min = k; }
  return min;
}

/* ---------- UI-состояние ---------- */
const ui = { view: 'today', day: dateKey(), noteFilter: 'all', noteQuery: '', important: false, editHabit: null, editNote: null };

function setView(v) {
  ui.view = v;
  document.body.dataset.view = v;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === v || (v === 'journal' && b.dataset.tab === 'today' && isWide())));
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  window.scrollTo({ top: 0 });
}
const isWide = () => window.matchMedia('(min-width: 960px)').matches;

/* ---------- отрисовка: Сегодня ---------- */
function habitRow(h, k) {
  const done = isDone(k, h.id);
  const cat = CATS[h.cat] || CATS.other;
  const st = currentStreak(h);
  const streak = st > 0 ? `<span class="streak ${st >= 3 ? 'hot' : ''}" title="Серия">🔥 ${st}</span>` : '';
  return `<button type="button" class="habit ${done ? 'done' : ''}" data-hid="${esc(h.id)}" style="--c:${cat.color}" aria-pressed="${done}">
    <span class="check">${CHECK_SVG}</span>
    <span class="habit-body"><span class="habit-title">${esc(h.title)}</span>${h.hint ? `<span class="habit-hint">${esc(h.hint)}</span>` : ''}</span>
    ${streak}
  </button>`;
}

function renderToday() {
  const k = ui.day, today = dateKey();
  const rel = relDay(k);
  $('#dayName').textContent = rel || fmtDay(k, { weekday: 'long' });
  $('#daySub').textContent = fmtDay(k, rel ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long' });
  $('#dayToday').hidden = k === today;
  $('#dayNext').disabled = k >= today;

  const all = habitsSorted();
  const on = all.filter((h) => scheduledOn(h, k));
  const off = all.filter((h) => !scheduledOn(h, k));
  const done = on.filter((h) => isDone(k, h.id)).length;
  $('#progressCount').textContent = `${done} / ${on.length}`;
  $('#progressFill').style.width = on.length ? (done / on.length * 100) + '%' : '0';
  $('.progress').classList.toggle('complete', on.length > 0 && done === on.length);

  let html = '';
  for (const [cid, cat] of Object.entries(CATS)) {
    const items = on.filter((h) => (CATS[h.cat] ? h.cat : 'other') === cid);
    if (!items.length) continue;
    const d = items.filter((h) => isDone(k, h.id)).length;
    html += `<div class="group">
      <div class="group-head"><span class="swatch" style="background:${cat.color}"></span>${esc(cat.name)}<span class="group-count">${d}/${items.length}</span></div>
      <div class="list card">${items.map((h) => habitRow(h, k)).join('')}</div>
    </div>`;
  }
  if (!on.length) html += `<div class="group"><div class="card empty">На этот день ничего не запланировано</div></div>`;
  if (off.length) {
    html += `<details class="offday"><summary>Не по расписанию (${off.length}) — можно отметить, если сделал</summary>
      <div class="list card">${off.map((h) => habitRow(h, k)).join('')}</div></details>`;
  }
  const open = $('#habitList details.offday')?.open;
  $('#habitList').innerHTML = html;
  if (open) $('#habitList details.offday').open = true;

  renderTasks();
}

function dueLabel(t) {
  if (!t.due) return '';
  const today = dateKey();
  const rel = relDay(t.due);
  if (!t.done && t.due < today) return `<span class="due overdue">просрочено · ${fmtDay(t.due, { day: 'numeric', month: 'short' })}</span>`;
  if (t.due === today) return `<span class="due today">сегодня</span>`;
  return `<span class="due">${rel || fmtDay(t.due, { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
}
function taskRow(t) {
  return `<div class="task ${t.done ? 'done' : ''}" data-tid="${esc(t.id)}">
    <button type="button" class="check" data-act="toggle" aria-label="${t.done ? 'Вернуть' : 'Выполнено'}">${CHECK_SVG}</button>
    <div class="task-body"><div class="task-title">${esc(t.title)}</div>${dueLabel(t)}</div>
    <button type="button" class="x-btn" data-act="del" aria-label="Удалить">×</button>
  </div>`;
}

function renderTasks() {
  const today = dateKey();
  const tasks = alive(state.tasks);
  const byDue = (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || a.createdAt - b.createdAt;
  const current = tasks.filter((t) => !t.done && (!t.due || t.due <= today)).sort(byDue);
  const later = tasks.filter((t) => !t.done && t.due && t.due > today).sort(byDue);
  const doneToday = tasks.filter((t) => t.done && t.doneAt && dateKey(new Date(t.doneAt)) === today).sort((a, b) => b.doneAt - a.doneAt);

  let html = '';
  const main = [...current, ...doneToday];
  html += main.length
    ? `<div class="list card">${main.map(taskRow).join('')}</div>`
    : `<div class="card empty">Разовых дел нет — можно выдохнуть</div>`;
  if (later.length) {
    const open = $('#taskList details.later')?.open;
    html += `<details class="later"${open ? ' open' : ''}><summary>Запланировано (${later.length})</summary><div class="list card">${later.map(taskRow).join('')}</div></details>`;
  }
  $('#taskList').innerHTML = html;
}

/* ---------- отрисовка: Журнал ---------- */
function highlight(text, q) {
  let html = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  if (q) {
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}
function renderJournal() {
  const q = ui.noteQuery.trim().toLowerCase();
  let notes = alive(state.notes).sort((a, b) => b.ts - a.ts);
  if (ui.noteFilter === 'important') notes = notes.filter((n) => n.important);
  if (q) notes = notes.filter((n) => n.text.toLowerCase().includes(q));

  if (!notes.length) {
    $('#noteList').innerHTML = `<div class="card empty" style="margin-top:14px">${q || ui.noteFilter === 'important' ? 'Ничего не найдено' : 'Здесь появятся записи со временем'}</div>`;
    return;
  }
  let html = '', curDay = null, buf = [];
  const flush = () => {
    if (!buf.length) return;
    const rel = relDay(curDay);
    html += `<div class="note-day">${rel ? rel + ', ' : ''}${fmtDay(curDay, { weekday: rel ? undefined : 'short', day: 'numeric', month: 'long' })}</div><div class="list card">${buf.join('')}</div>`;
    buf = [];
  };
  for (const n of notes) {
    const k = dateKey(new Date(n.ts));
    if (k !== curDay) { flush(); curDay = k; }
    buf.push(`<button type="button" class="note ${n.important ? 'important' : ''}" data-nid="${esc(n.id)}">
      <span class="note-time">${n.important ? '★ ' : ''}${hhmm(n.ts)}</span>
      <span class="note-text">${highlight(n.text, ui.noteQuery.trim())}</span>
    </button>`);
  }
  flush();
  $('#noteList').innerHTML = html;
}

/* ---------- отрисовка: История ---------- */
function renderHistory() {
  const today = dateKey();
  const habits = habitsSorted();
  const first = firstDataDay() || today;
  // начало сетки — понедельник 15 недель назад
  const t = parseKey(today);
  const mondayOffset = (t.getDay() + 6) % 7;
  let k = addDays(today, -mondayOffset - 15 * 7);

  let html = '';
  WEEK.forEach(([, name], i) => { html += `<span class="lbl">${i % 2 === 0 ? name : ''}</span>`; });
  for (let i = 0; i < 16 * 7; i++, k = addDays(k, 1)) {
    if (k > today) { html += `<span class="cell future"></span>`; continue; }
    const on = habits.filter((h) => scheduledOn(h, k));
    const d = on.filter((h) => isDone(k, h.id)).length;
    const p = on.length ? d / on.length : 0;
    const lvl = d === 0 ? 0 : p < .34 ? 1 : p < .67 ? 2 : p < 1 ? 3 : 4;
    const cls = k < first ? 'none' : 'l' + lvl;
    html += `<span class="cell ${cls}${k === today ? ' is-today' : ''}" title="${fmtDay(k, { day: 'numeric', month: 'short' })}: ${d}/${on.length}"></span>`;
  }
  $('#heatmap').innerHTML = html;

  const from = addDays(today, -29);
  $('#habitStats').innerHTML = habits.length ? `<div class="list card">${habits.map((h) => {
    let sched = 0, done = 0;
    for (let x = from; x <= today; x = addDays(x, 1)) {
      if (x < first || !scheduledOn(h, x)) continue;
      sched++; if (isDone(x, h.id)) done++;
    }
    const pct = sched ? Math.round(done / sched * 100) : 0;
    const cat = CATS[h.cat] || CATS.other;
    const cur = currentStreak(h), best = bestStreak(h);
    return `<div class="stat" style="--c:${cat.color}">
      <div class="stat-title"><span class="swatch" style="background:${cat.color}"></span>${esc(h.title)}</div>
      <div class="stat-pct">${pct}%</div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="stat-meta">${done} из ${sched} · серия ${cur} · рекорд ${best}</div>
    </div>`;
  }).join('')}</div>` : `<div class="card empty">Нет дел</div>`;
}

/* ---------- отрисовка: Настройки ---------- */
function daysLabel(days) {
  if (!days || !days.length || days.length === 7) return 'каждый день';
  return WEEK.filter(([d]) => days.includes(d)).map(([, n]) => n).join(', ');
}
function renderSettings() {
  const hs = habitsSorted();
  $('#habitAdmin').innerHTML = `<div class="list card">${hs.map((h, i) => {
    const cat = CATS[h.cat] || CATS.other;
    return `<div class="admin-row" data-hid="${esc(h.id)}">
      <span class="swatch" style="background:${cat.color}"></span>
      <div class="admin-body" data-act="edit"><div class="admin-title">${esc(h.title)}</div><div class="admin-meta">${esc(cat.name)} · ${daysLabel(h.days)}</div></div>
      <button type="button" class="mini-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
      <button type="button" class="mini-btn" data-act="down" ${i === hs.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
    </div>`;
  }).join('') || '<div class="empty">Список пуст</div>'}</div>`;

  const theme = localStorage.getItem(LS_THEME) || 'auto';
  $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  renderSync();
}

function render() {
  renderToday();
  renderJournal();
  renderHistory();
  renderSettings();
}

/* ---------- синхронизация (GitHub Gist) ---------- */
const sync = { busy: false, again: false, timer: null, state: 'off', lastAt: 0, login: '', error: '' };
const token = () => localStorage.getItem(LS_TOKEN) || '';

function setSync(s, error = '') {
  sync.state = s; sync.error = error;
  renderSync();
}
function renderSync() {
  const pill = $('#syncPill');
  pill.dataset.state = sync.state;
  const labels = {
    off: 'Локально',
    busy: 'Синхронизация…',
    ok: sync.lastAt ? 'Синхр. ' + hhmm(sync.lastAt) : 'Синхронизировано',
    error: 'Нет связи',
    auth: 'Нужен токен',
  };
  $('.label', pill).textContent = labels[sync.state] || '';

  const has = !!token();
  $('#syncSetup').hidden = has && sync.state !== 'auth';
  $('#syncActions').hidden = !has;
  let text = 'Данные хранятся только на этом устройстве.';
  if (has) {
    text = sync.state === 'auth' ? 'GitHub не принял токен — вставь новый.'
      : sync.state === 'error' ? `Не удалось синхронизироваться${sync.error ? ' (' + sync.error + ')' : ''}. Данные сохранены локально, повторю позже.`
      : sync.state === 'busy' ? 'Синхронизация…'
      : `Синхронизация включена${sync.login ? ' · ' + sync.login : ''}${sync.lastAt ? '. Последняя: ' + hhmm(sync.lastAt) : ''}.`;
  }
  $('#syncStatus').textContent = text;
}

async function gh(path, opts = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token(),
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch('https://api.github.com' + path, { ...opts, headers, cache: 'no-store' });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

async function findOrCreateGist() {
  let id = localStorage.getItem(LS_GIST);
  if (id) return id;
  for (let page = 1; page <= 10 && !id; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find((x) => x.description === GIST_DESC && x.files && x.files[GIST_FILE]);
    if (g) id = g.id;
    if (list.length < 100) break;
  }
  if (!id) {
    const g = await gh('/gists', {
      method: 'POST',
      body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(state) } } }),
    });
    id = g.id;
  }
  localStorage.setItem(LS_GIST, id);
  return id;
}

async function readGist(id) {
  const g = await gh('/gists/' + id);
  const f = g.files && g.files[GIST_FILE];
  if (!f) return null;
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
  try { return normalize(JSON.parse(content)); } catch (e) { return null; }
}

async function runSync() {
  if (!token()) { setSync('off'); return; }
  if (!navigator.onLine) { setSync('error', 'офлайн'); return; }
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true;
  setSync('busy');
  try {
    let id = await findOrCreateGist();
    let remote;
    try { remote = await readGist(id); }
    catch (e) {
      if (e.status !== 404) throw e;
      localStorage.removeItem(LS_GIST);           // гист удалили — ищем/создаём заново
      id = await findOrCreateGist();
      remote = await readGist(id);
    }
    const merged = remote ? merge(state, remote) : state;
    if (stable(merged) !== stable(state)) { state = merged; persistLocal(); render(); }
    if (!remote || stable(merged) !== stable(remote)) {
      await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(merged) } } }) });
    }
    sync.lastAt = now();
    setSync('ok');
  } catch (e) {
    console.warn('sync failed', e);
    setSync(e.status === 401 ? 'auth' : 'error', e.status ? 'код ' + e.status : 'сеть');
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; scheduleSync(300); }
  }
}

function scheduleSync(delay = 1500) {
  if (!token()) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}

async function connectToken(t) {
  localStorage.setItem(LS_TOKEN, t);
  localStorage.removeItem(LS_GIST);
  setSync('busy');
  try {
    const u = await gh('/user');
    sync.login = u.login;
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(LS_TOKEN); setSync('off'); toast('Токен не подошёл'); return; }
  }
  await runSync();
  if (sync.state === 'ok') toast('Синхронизация включена');
}

/* ---------- диалоги ---------- */
function openHabit(h) {
  ui.editHabit = h ? h.id : null;
  $('#habitDlgTitle').textContent = h ? 'Редактировать дело' : 'Новое дело';
  $('#hTitle').value = h ? h.title : '';
  $('#hHint').value = h ? h.hint || '' : '';
  $('#hCat').innerHTML = Object.entries(CATS).map(([id, c]) => `<option value="${id}">${esc(c.name)}</option>`).join('');
  $('#hCat').value = h && CATS[h.cat] ? h.cat : 'other';
  const days = h ? h.days || [] : [];
  $('#hDays').innerHTML = WEEK.map(([d, n]) => `<button type="button" data-d="${d}" class="${days.includes(d) ? 'on' : ''}">${n}</button>`).join('');
  $('#hDelete').hidden = !h;
  $('#habitDialog').showModal();
  if (!h) $('#hTitle').focus();
}

function openNote(n) {
  ui.editNote = n.id;
  const d = new Date(n.ts);
  $('#nTime').value = `${dateKey(d)}T${hhmm(n.ts)}`;
  $('#nText').value = n.text;
  $('#nImportant').checked = !!n.important;
  $('#noteDialog').showModal();
}

/* ---------- тост ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- события ---------- */
function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.tab)));
  $('#syncPill').addEventListener('click', () => setView('settings'));

  // дни
  $('#dayPrev').addEventListener('click', () => { ui.day = addDays(ui.day, -1); renderToday(); });
  $('#dayNext').addEventListener('click', () => { if (ui.day < dateKey()) { ui.day = addDays(ui.day, 1); renderToday(); } });
  $('#dayToday').addEventListener('click', () => { ui.day = dateKey(); renderToday(); });

  // привычки
  $('#habitList').addEventListener('click', (e) => {
    const b = e.target.closest('.habit');
    if (b) toggleCheck(ui.day, b.dataset.hid);
  });

  // разовые дела
  $('#taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    const id = uid(), t = now();
    state.tasks[id] = { id, title, due: $('#taskDue').value || '', done: false, doneAt: 0, createdAt: t, updatedAt: t };
    $('#taskTitle').value = '';
    $('#taskDue').value = '';
    commit();
  });
  $('#taskList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.task');
    if (!btn || !row) return;
    const t = state.tasks[row.dataset.tid];
    if (!t) return;
    if (btn.dataset.act === 'toggle') {
      state.tasks[t.id] = { ...t, done: !t.done, doneAt: t.done ? 0 : now(), updatedAt: now() };
      commit();
    } else if (btn.dataset.act === 'del') {
      state.tasks[t.id] = { ...t, deleted: true, updatedAt: now() };
      commit();
      toast('Дело удалено');
    }
  });

  // журнал
  const tickCompose = () => { $('#composeTime').textContent = hhmm(now()); };
  tickCompose(); setInterval(tickCompose, 15000);
  $('#noteImportant').addEventListener('click', () => {
    ui.important = !ui.important;
    $('#noteImportant').setAttribute('aria-pressed', ui.important);
  });
  $('#noteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#noteText').value.trim();
    if (!text) { $('#noteText').focus(); return; }
    const id = uid(), t = now();
    state.notes[id] = { id, text, ts: t, important: ui.important, updatedAt: t };
    $('#noteText').value = '';
    ui.important = false;
    $('#noteImportant').setAttribute('aria-pressed', 'false');
    commit();
  });
  $('#noteText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#noteForm').requestSubmit(); }
  });
  $$('.journal-tools .seg button').forEach((b) => b.addEventListener('click', () => {
    ui.noteFilter = b.dataset.filter;
    $$('.journal-tools .seg button').forEach((x) => x.classList.toggle('active', x === b));
    renderJournal();
  }));
  $('#noteSearch').addEventListener('input', (e) => { ui.noteQuery = e.target.value; renderJournal(); });
  $('#noteList').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const b = e.target.closest('.note');
    if (b && state.notes[b.dataset.nid]) openNote(state.notes[b.dataset.nid]);
  });
  $('#noteDlgForm').addEventListener('submit', (e) => {
    const n = state.notes[ui.editNote];
    const text = $('#nText').value.trim();
    const ts = new Date($('#nTime').value).getTime();
    if (!n || !text || Number.isNaN(ts)) return;
    state.notes[n.id] = { ...n, text, ts, important: $('#nImportant').checked, updatedAt: now() };
    commit();
  });
  $('#nDelete').addEventListener('click', () => {
    const n = state.notes[ui.editNote];
    if (!n || !confirm('Удалить запись?')) return;
    state.notes[n.id] = { ...n, deleted: true, updatedAt: now() };
    $('#noteDialog').close();
    commit();
  });

  // настройки: привычки
  $('#habitAdd').addEventListener('click', () => openHabit(null));
  $('#habitAdmin').addEventListener('click', (e) => {
    const row = e.target.closest('.admin-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const hs = habitsSorted();
    const i = hs.findIndex((h) => h.id === row.dataset.hid);
    if (act === 'edit') return openHabit(hs[i]);
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= hs.length) return;
    [hs[i], hs[j]] = [hs[j], hs[i]];
    const t = now();
    hs.forEach((h, idx) => { if (h.order !== idx + 1) state.habits[h.id] = { ...h, order: idx + 1, updatedAt: t }; });
    commit();
  });
  $('#hDays').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) b.classList.toggle('on');
  });
  $('#habitDlgForm').addEventListener('submit', () => {
    const title = $('#hTitle').value.trim();
    if (!title) return;
    const days = $$('#hDays button.on').map((b) => Number(b.dataset.d));
    const base = ui.editHabit ? state.habits[ui.editHabit] : { id: uid(), order: habitsSorted().length + 1 };
    state.habits[base.id] = { ...base, title, hint: $('#hHint').value.trim(), cat: $('#hCat').value, days: days.length === 7 ? [] : days, updatedAt: now() };
    commit();
  });
  $('#hDelete').addEventListener('click', () => {
    const h = state.habits[ui.editHabit];
    if (!h || !confirm(`Удалить «${h.title}»? Отметки в истории останутся.`)) return;
    state.habits[h.id] = { ...h, deleted: true, updatedAt: now() };
    $('#habitDialog').close();
    commit();
  });
  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // настройки: синхронизация
  $('#tokenSave').addEventListener('click', () => {
    const t = $('#tokenInput').value.trim();
    if (!t) { $('#tokenInput').focus(); return; }
    $('#tokenInput').value = '';
    connectToken(t);
  });
  $('#syncNow').addEventListener('click', () => runSync());
  $('#syncOff').addEventListener('click', () => {
    if (!confirm('Отключить синхронизацию на этом устройстве? Данные останутся и здесь, и в Gist.')) return;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_GIST);
    sync.login = ''; sync.lastAt = 0;
    setSync('off');
  });

  // тема
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.theme;
    if (t === 'auto') { localStorage.removeItem(LS_THEME); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem(LS_THEME, t); document.documentElement.dataset.theme = t; }
    renderSettings();
  }));

  // экспорт / импорт
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-backup-${dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      state = merge(state, normalize(JSON.parse(await f.text())));
      commit();
      toast('Копия загружена');
    } catch (err) { toast('Файл не похож на копию Daily'); }
    e.target.value = '';
  });

  // синхронизация при возврате на вкладку / в приложение
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (ui.day > dateKey()) ui.day = dateKey();
      render();
      scheduleSync(200);
    }
  });
  window.addEventListener('online', () => scheduleSync(200));
  window.addEventListener('storage', (e) => { if (e.key === LS_STATE) { state = loadState(); render(); } });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== ui.view) setView(v); });
}

/* ---------- старт ---------- */
bind();
const startView = location.hash.slice(1);
setView(['today', 'journal', 'history', 'settings'].includes(startView) ? startView : 'today');
render();
if (token()) runSync();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
