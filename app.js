'use strict';

/* =========================================================
   Daily — чекер дел
   Данные: localStorage + (опционально) секретный GitHub Gist.
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
const COLS = ['habits', 'checks', 'tasks', 'notes', 'projects', 'stages', 'blocks'];

const CATS = {
  prog:  { name: 'Программирование', color: '#6366f1' },
  en:    { name: 'Английский',       color: '#0ea5e9' },
  trade: { name: 'Трейдинг',         color: '#f59e0b' },
  sql:   { name: 'SQL',              color: '#10b981' },
  other: { name: 'Другое',           color: '#a855f7' },
};
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
const STATUS = { active: 'В работе', paused: 'На паузе', done: 'Завершён' };
// порядок кнопок дней: Пн..Вс → значения Date.getDay()
const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/* Стартовые проекты. Фиксированные id + updatedAt=1: добавляются один раз,
   не задваиваются между устройствами и не возвращаются, если их удалить. */
const SEED_PROJECTS = [
  ['p-job', 'Поиск работы', 'Стажировка или работа аналитиком данных — главная цель: Яндекс', '#6366f1', '', [
    ['Резюме под аналитика данных', '', true],
    ['Подать заявку на стажировку Яндекса', '2026-10-16'],
    ['SQL: оконные функции и CTE'],
    ['Python: базовые задачи на Контесте'],
    ['Теорвер: Байес и базовые задачи'],
    ['Пройти контест Яндекса'],
    ['Заявки: Ozon, Т-Банк, Mars, ОТП'],
    ['Собеседования'],
  ]],
  ['p-strat', 'StratConstruct', 'Конструктор и бэктестер торговых стратегий без кода', '#f59e0b', '', [
    ['Фондовый рынок: акции'],
    ['Фундаментальный анализ'],
    ['Редизайн'],
    ['Релиз обновления и пост в LinkedIn'],
  ]],
  ['p-loc', 'LocAction', 'Урбан-дашборд: пешеходная связность, коммерческая плотность, белые пятна', '#10b981', '', [
    ['Выбрать город и вертикаль'],
    ['Собрать данные из OSM / Overpass'],
    ['Посчитать метрики и найти белые пятна'],
    ['Интерактивная карта'],
    ['Деплой и кейс в портфолио'],
  ]],
  ['p-ielts', 'IELTS', 'С B1 до IELTS 6.0–6.5; главное слабое место — письмо', '#0ea5e9', '', [
    ['Пробный Duolingo English Test'],
    ['Murphy: закрыть слабые темы'],
    ['Письмо: регулярные эссе с разбором'],
    ['Пробный IELTS (mock)'],
    ['Сдать IELTS на 6.0–6.5'],
  ]],
  ['p-admit', 'Поступление', 'Магистратура в Европе, старт — сентябрь 2028', '#a855f7', '2028-09-01', [
    ['Шорт-лист: PoliMI, PoliTO, IUAV, Bauhaus, VUB/ULB'],
    ['Требования и дедлайны каждой программы'],
    ['Портфолио'],
    ['CV и мотивационные письма'],
    ['Первая волна подачи (Италия)'],
    ['Остальные заявки'],
    ['Результаты и выбор программы'],
  ]],
  ['p-move', 'Переезд', 'Выехать после диплома, до 1 сентября 2027', '#ef4444', '2027-08-31', [
    ['Консультация юриста по воинскому учёту (весна 2027)'],
    ['Накопить 500 тыс ₽'],
    ['Стабильный онлайн-доход'],
    ['Защита диплома (июнь 2027)'],
    ['Выбрать языковую школу на Филиппинах'],
    ['Билеты и жильё'],
    ['Выезд'],
  ]],
];

/* ---------- утилиты ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const now = () => Date.now();
const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const dayDiff = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const REPEAT_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-label="повторяется"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>';

function fmtDay(k, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return parseKey(k).toLocaleDateString('ru-RU', opts);
}
function shortDate(k) {
  const sameYear = parseKey(k).getFullYear() === new Date().getFullYear();
  return fmtDay(k, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).replace(' г.', '');
}
function relDay(k) {
  const t = dateKey();
  if (k === t) return 'сегодня';
  if (k === addDays(t, -1)) return 'вчера';
  if (k === addDays(t, 1)) return 'завтра';
  return null;
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
function fmtDur(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h} ч ${mm} мин`;
  return h ? `${h} ч` : `${mm} мин`;
}

/* ---------- состояние ---------- */
function defaultState() {
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
    checks: {}, tasks: {}, notes: {}, projects: {}, stages: {}, blocks: {},
  };
}

function seedInto(s) {
  SEED_PROJECTS.forEach(([id, title, goal, color, deadline, stages], i) => {
    if (!s.projects[id]) s.projects[id] = { id, title, goal, color, deadline, status: 'active', order: i + 1, createdAt: 1, updatedAt: 1 };
    stages.forEach(([t, due = '', done = false], j) => {
      const sid = `${id}-s${j + 1}`;
      if (!s.stages[sid]) s.stages[sid] = { id: sid, projectId: id, title: t, due, done, doneAt: done ? 1 : 0, order: j + 1, updatedAt: 1 };
    });
  });
  return s;
}

// сохраняем и неизвестные коллекции — на случай будущих версий
function normalize(s) {
  const out = { v: 1 };
  if (s && typeof s === 'object') for (const k in s) if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) out[k] = s[k];
  for (const c of COLS) if (!out[c]) out[c] = {};
  return seedInto(out);
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* битые данные — начинаем заново */ }
  return normalize(defaultState());
}

let state = loadState();

function persistLocal() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { toast('Не удалось сохранить на устройстве'); }
}
function commit() { persistLocal(); render(); scheduleSync(); }

function merge(a, b) {
  const out = { v: 1 };
  const keys = new Set([...COLS, ...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.delete('v');
  for (const c of keys) {
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

/* ---------- модель: привычки ---------- */
const alive = (o) => Object.values(o || {}).filter((x) => x && !x.deleted);
const habitsSorted = () => alive(state.habits).sort(byOrder);
const scheduledOn = (h, k) => !h.days || h.days.length === 0 || h.days.includes(parseKey(k).getDay());
const isDone = (k, id) => !!(state.checks[k + '|' + id] && state.checks[k + '|' + id].done);

function toggleCheck(k, id) {
  state.checks[k + '|' + id] = { done: !isDone(k, id), updatedAt: now() };
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
  for (const key in state.checks) {
    const [k, id] = key.split('|');
    if (!state.habits[id]) continue;
    if (!min || k < min) min = k;
  }
  return min;
}

/* ---------- модель: проекты ---------- */
const projectsSorted = () => alive(state.projects).sort(byOrder);
const stagesOf = (pid) => alive(state.stages).filter((s) => s.projectId === pid).sort(byOrder);
const projectAlive = (pid) => state.projects[pid] && !state.projects[pid].deleted;
const nextStage = (pid) => stagesOf(pid).find((s) => !s.done);

function toggleStage(sid) {
  const s = state.stages[sid];
  if (!s) return;
  const done = !s.done;
  state.stages[sid] = { ...s, done, doneAt: done ? now() : 0, updatedAt: now() };
  commit();
  if (done) {
    const nx = nextStage(s.projectId);
    toast(nx ? `Готово! Дальше: ${nx.title}` : 'Все этапы проекта закрыты 🎉');
  }
}

/* ---------- модель: блоки времени ---------- */
function occursOn(b, k) {
  if (b.days && b.days.length) return k >= b.date && b.days.includes(parseKey(k).getDay()) && !(b.skip || []).includes(k);
  return b.date === k;
}
const blocksOn = (k) => alive(state.blocks).filter((b) => occursOn(b, k))
  .sort((a, b) => toMin(a.start) - toMin(b.start) || (a.createdAt || 0) - (b.createdAt || 0));

function refInfo(ref) {
  if (ref && ref.startsWith('p:')) {
    const p = state.projects[ref.slice(2)];
    if (p && !p.deleted) return { name: p.title, color: p.color };
  }
  const c = CATS[(ref || '').slice(2)];
  return c ? { name: c.name, color: c.color } : { name: 'Другое', color: CATS.other.color };
}

/* ---------- модель: дедлайны ---------- */
function allDeadlines() {
  const items = [];
  for (const t of alive(state.tasks)) if (t.due) items.push({ kind: 'task', id: t.id, date: t.due, title: t.title, sub: 'Разовое дело', done: t.done, color: 'var(--muted)' });
  for (const s of alive(state.stages)) {
    if (!s.due || !projectAlive(s.projectId)) continue;
    const p = state.projects[s.projectId];
    items.push({ kind: 'stage', id: s.id, pid: p.id, date: s.due, title: s.title, sub: p.title, done: s.done, color: p.color });
  }
  for (const p of alive(state.projects)) if (p.deadline) items.push({ kind: 'project', id: p.id, pid: p.id, date: p.deadline, title: `Дедлайн: ${p.title}`, sub: 'Проект', done: p.status === 'done', color: p.color });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- UI-состояние ---------- */
const VIEWS = ['today', 'projects', 'calendar', 'journal', 'history', 'settings'];
const ui = {
  view: 'today', day: dateKey(), noteFilter: 'all', noteQuery: '', important: false,
  project: null, calMonth: dateKey().slice(0, 7), calDay: dateKey(),
  editHabit: null, editNote: null, editBlock: null, blockDate: null, editProject: null, editStage: null,
};
const isWide = () => window.matchMedia('(min-width: 960px)').matches;

function setView(v) {
  ui.view = v;
  document.body.dataset.view = v;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === v || (v === 'journal' && b.dataset.tab === 'today' && isWide())));
  $('#gearBtn').classList.toggle('active', v === 'settings');
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  window.scrollTo({ top: 0 });
}

/* ---------- общие куски разметки ---------- */
function dueLabel(item) {
  if (!item.due) return '';
  const today = dateKey();
  if (!item.done && item.due < today) return `<span class="due overdue">просрочено · ${shortDate(item.due)}</span>`;
  if (item.due === today) return `<span class="due today">сегодня</span>`;
  const rel = relDay(item.due);
  const left = dayDiff(today, item.due);
  return `<span class="due">${rel || shortDate(item.due)}${!rel && left > 0 && left <= 30 && !item.done ? ` · через ${left} ${plural(left, 'день', 'дня', 'дней')}` : ''}</span>`;
}

function deadlineLabel(p) {
  if (!p.deadline) return '';
  const left = dayDiff(dateKey(), p.deadline);
  if (p.status === 'done') return `до ${shortDate(p.deadline)}`;
  if (left < 0) return `<span class="overdue">просрочен на ${-left} ${plural(-left, 'день', 'дня', 'дней')}</span>`;
  if (left === 0) return `<span class="today">дедлайн сегодня</span>`;
  return `до ${shortDate(p.deadline)} · ${left} ${plural(left, 'день', 'дня', 'дней')}`;
}

/* ---------- План дня (используется на «Сегодня» и в календаре) ---------- */
function renderPlan(k, el) {
  const list = blocksOn(k);
  const isToday = k === dateKey();
  const nm = nowMin();
  const total = list.reduce((s, b) => s + Math.max(0, toMin(b.end) - toMin(b.start)), 0);
  const head = `<div class="section-head">
    <h2 class="section-title">План дня</h2>
    ${total ? `<span class="section-meta">${fmtDur(total)}</span>` : ''}
    <button type="button" class="add-btn" data-add-block="${k}">+ Блок</button>
  </div>`;

  if (!list.length) {
    el.innerHTML = head + `<button type="button" class="card empty-plan" data-add-block="${k}">
      <strong>Распиши день по времени</strong><span>Например, 19:00–21:00 — программирование. Повторяющиеся блоки создаются один раз.</span>
    </button>`;
    return;
  }

  let rows = '', prevEnd = null;
  for (const b of list) {
    const s = toMin(b.start), e = toMin(b.end);
    if (prevEnd !== null && s - prevEnd >= 30) rows += `<div class="gap">свободно ${fmtDur(s - prevEnd)}</div>`;
    const overlap = prevEnd !== null && s < prevEnd;
    prevEnd = prevEnd === null ? e : Math.max(prevEnd, e);
    const info = refInfo(b.ref);
    const done = isDone(k, b.id);
    const nowCls = isToday && nm >= s && nm < e ? 'now' : '';
    const past = isToday && nm >= e && !done ? 'past' : '';
    let meta = `<span class="chip-dot" style="background:${info.color}"></span>${esc(info.name)}`;
    if (b.days && b.days.length) meta += ` ${REPEAT_SVG}`;
    if (nowCls) meta += ` · <b class="now-label">сейчас, ещё ${fmtDur(e - nm)}</b>`;
    if (overlap) meta += ` · <span class="overdue">пересекается</span>`;
    rows += `<div class="block ${done ? 'done' : ''} ${nowCls} ${past}" data-bid="${esc(b.id)}" data-date="${k}" style="--c:${info.color}">
      <button type="button" class="check" data-act="bcheck" aria-label="Выполнено">${CHECK_SVG}</button>
      <button type="button" class="block-body" data-act="bedit">
        <span class="block-time">${b.start}–${b.end}<span class="block-dur">${fmtDur(e - s)}</span></span>
        <span class="block-title">${esc(b.title || info.name)}</span>
        <span class="block-meta">${meta}</span>
      </button>
    </div>`;
  }
  el.innerHTML = head + `<div class="list card">${rows}</div>`;
}

function bindPlan(el) {
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-block]');
    if (add) return openBlock(null, add.dataset.addBlock);
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.block');
    if (!act || !row) return;
    const b = state.blocks[row.dataset.bid];
    if (!b) return;
    if (act.dataset.act === 'bcheck') toggleCheck(row.dataset.date, b.id);
    else openBlock(b, row.dataset.date);
  });
}

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

  renderPlan(k, $('#dayPlan'));

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

  renderNextSteps();
  renderTasks();
}

function stageRow(s, p, withProject) {
  return `<div class="task stage ${s.done ? 'done' : ''}" data-sid="${esc(s.id)}" style="--c:${p.color}">
    <button type="button" class="check" data-act="stoggle" aria-label="${s.done ? 'Вернуть' : 'Выполнено'}">${CHECK_SVG}</button>
    <button type="button" class="task-body as-btn" data-act="${withProject ? 'sopen' : 'sedit'}">
      <span class="task-title">${esc(s.title)}</span>
      <span class="task-sub">${withProject ? `<span class="chip-dot" style="background:${p.color}"></span>${esc(p.title)}` : ''}${withProject && s.due ? ' · ' : ''}${dueLabel(s)}</span>
    </button>
  </div>`;
}

function renderNextSteps() {
  const show = ui.day === dateKey();
  const rows = [];
  if (show) {
    for (const p of projectsSorted()) {
      if (p.status !== 'active') continue;
      const s = nextStage(p.id);
      if (s) rows.push(stageRow(s, p, true));
    }
  }
  $('#nextWrap').hidden = !rows.length;
  $('#nextSteps').innerHTML = rows.length ? `<div class="list card">${rows.join('')}</div>` : '';
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
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt;
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

/* ---------- отрисовка: Проекты ---------- */
function projectCard(p) {
  const st = stagesOf(p.id);
  const done = st.filter((s) => s.done).length;
  const pct = st.length ? Math.round(done / st.length * 100) : 0;
  const nx = st.find((s) => !s.done);
  return `<button type="button" class="card project-card" data-pid="${esc(p.id)}" style="--c:${p.color}">
    <span class="pc-top">
      <span class="pc-title">${esc(p.title)}</span>
      <span class="pc-count">${done}/${st.length}</span>
    </span>
    ${p.goal ? `<span class="pc-goal">${esc(p.goal)}</span>` : ''}
    <span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>
    <span class="pc-meta">
      ${nx ? `<span class="pc-next">Дальше: ${esc(nx.title)}${nx.due ? ' · ' + dueLabel(nx) : ''}</span>` : `<span class="pc-next">${st.length ? 'Все этапы закрыты' : 'Этапов пока нет'}</span>`}
      ${p.deadline ? `<span class="pc-deadline">${deadlineLabel(p)}</span>` : ''}
    </span>
  </button>`;
}

function renderProjects() {
  const el = $('#projectsView');
  if (ui.project && projectAlive(ui.project)) return renderProjectDetail(el, state.projects[ui.project]);
  ui.project = null;
  const ps = projectsSorted();
  const active = ps.filter((p) => p.status === 'active');
  const paused = ps.filter((p) => p.status === 'paused');
  const done = ps.filter((p) => p.status === 'done');
  let html = `<div class="section-head first"><h2 class="section-title">Проекты в работе</h2><button type="button" class="add-btn" id="projectAdd">+ Проект</button></div>`;
  html += active.length ? `<div class="project-grid">${active.map(projectCard).join('')}</div>` : `<div class="card empty">Активных проектов нет</div>`;
  if (paused.length) html += `<details class="later"><summary>На паузе (${paused.length})</summary><div class="project-grid">${paused.map(projectCard).join('')}</div></details>`;
  if (done.length) html += `<details class="later"><summary>Завершённые (${done.length})</summary><div class="project-grid">${done.map(projectCard).join('')}</div></details>`;
  const openStates = $$('#projectsView details').map((d) => d.open);
  el.innerHTML = html;
  $$('#projectsView details').forEach((d, i) => { if (openStates[i]) d.open = true; });
}

function renderProjectDetail(el, p) {
  const st = stagesOf(p.id);
  const done = st.filter((s) => s.done).length;
  const pct = st.length ? Math.round(done / st.length * 100) : 0;
  el.innerHTML = `
    <div class="pd-nav">
      <button type="button" class="link-btn" id="projectBack">‹ Все проекты</button>
      <button type="button" class="btn small-btn" id="projectEdit">Изменить</button>
    </div>
    <div class="card pd-head" style="--c:${p.color}">
      <div class="pd-title-row"><h1 class="pd-title">${esc(p.title)}</h1><span class="status-chip s-${p.status}">${STATUS[p.status] || ''}</span></div>
      ${p.goal ? `<p class="pd-goal">${esc(p.goal)}</p>` : ''}
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="pd-meta"><span>${done} из ${st.length} ${plural(st.length, 'этапа', 'этапов', 'этапов')}</span>${p.deadline ? `<span>${deadlineLabel(p)}</span>` : ''}</div>
    </div>
    <h2 class="section-title">Этапы</h2>
    ${st.length ? `<div class="list card" id="stageList">${st.map((s) => stageRow(s, p, false)).join('')}</div>` : `<div class="card empty">Добавь первый этап — маленький и конкретный</div>`}
    <form class="add-task card add-stage" id="stageForm" autocomplete="off">
      <input type="text" id="stageTitle" placeholder="Новый этап…" enterkeyhint="done" required>
      <div class="add-task-row">
        <label class="date-chip"><span>Срок</span><input type="date" id="stageDue"></label>
        <button class="btn primary" type="submit">Добавить</button>
      </div>
    </form>`;
}

/* ---------- отрисовка: Календарь ---------- */
function renderCalendar() {
  const today = dateKey();
  const [y, m] = ui.calMonth.split('-').map(Number);
  $('#calMonth').textContent = `${MONTHS[m - 1]} ${y}`;
  const first = `${ui.calMonth}-01`;
  const start = addDays(first, -((parseKey(first).getDay() + 6) % 7));
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${ui.calMonth}-${pad(lastDay)}`;
  const end = addDays(last, (7 - parseKey(last).getDay()) % 7);

  const dl = allDeadlines();
  const byDate = {};
  for (const d of dl) (byDate[d.date] = byDate[d.date] || []).push(d);

  let html = '';
  for (let k = start; k <= end; k = addDays(k, 1)) {
    const items = byDate[k] || [];
    const dots = items.slice(0, 3).map((d) => `<i style="background:${d.color}" class="${d.done ? 'dim' : ''}"></i>`).join('');
    // отметка «есть план» — только для разовых блоков, иначе повторяющиеся (работа) зашумят всю сетку
    const plan = blocksOn(k).some((x) => !(x.days && x.days.length)) ? '<b class="has-plan"></b>' : '';
    const cls = [k.slice(0, 7) !== ui.calMonth ? 'out' : '', k === today ? 'is-today' : '', k === ui.calDay ? 'sel' : '', k < today ? 'past' : ''].join(' ');
    html += `<button type="button" class="cal-cell ${cls}" data-day="${k}"><span class="cal-num">${parseKey(k).getDate()}</span><span class="cal-dots">${dots}</span>${plan}</button>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calToday').hidden = ui.calMonth === today.slice(0, 7) && ui.calDay === today;

  // выбранный день
  const k = ui.calDay;
  const rel = relDay(k);
  $('#calDayTitle').textContent = (rel ? rel[0].toUpperCase() + rel.slice(1) + ', ' : '') + fmtDay(k, { weekday: rel ? 'short' : 'long', day: 'numeric', month: 'long' });
  const dayItems = byDate[k] || [];
  $('#calDeadlines').innerHTML = dayItems.length
    ? `<div class="section-head"><h2 class="section-title">Дедлайны</h2></div><div class="list card">${dayItems.map((d) => deadlineRow(d, false)).join('')}</div>`
    : '';
  renderPlan(k, $('#calPlan'));

  // ближайшие 14 дней + просроченное
  const horizon = addDays(today, 14);
  const overdue = dl.filter((d) => !d.done && d.date < today && d.kind !== 'project');
  const soon = dl.filter((d) => d.date >= today && d.date <= horizon);
  let up = '';
  if (overdue.length) up += `<div class="list card overdue-card">${overdue.map((d) => deadlineRow(d, true)).join('')}</div>`;
  up += soon.length
    ? `<div class="list card">${soon.map((d) => deadlineRow(d, true)).join('')}</div>`
    : `<div class="card empty">В ближайшие две недели дедлайнов нет. Поставь сроки этапам в проектах — они появятся здесь.</div>`;
  $('#upcoming').innerHTML = up;
}

function deadlineRow(d, withDate) {
  const today = dateKey();
  const overdue = !d.done && d.date < today;
  const checkable = d.kind !== 'project';
  const dateTxt = d.date === today ? 'сегодня' : (relDay(d.date) || shortDate(d.date));
  return `<div class="task dl ${d.done ? 'done' : ''}" data-kind="${d.kind}" data-id="${esc(d.id)}" data-pid="${esc(d.pid || '')}" style="--c:${d.color}">
    ${checkable ? `<button type="button" class="check" data-act="dltoggle" aria-label="Выполнено">${CHECK_SVG}</button>` : `<span class="flag" style="color:${d.color}">⚑</span>`}
    <button type="button" class="task-body as-btn" data-act="dlopen">
      <span class="task-title">${esc(d.title)}</span>
      <span class="task-sub"><span class="chip-dot" style="background:${d.color}"></span>${esc(d.sub)}</span>
    </button>
    ${withDate ? `<span class="dl-date ${overdue ? 'overdue' : d.date === today ? 'today' : ''}">${dateTxt}</span>` : ''}
  </div>`;
}

/* ---------- отрисовка: Журнал ---------- */
function highlight(text, q) {
  let html = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  if (q) {
    const re = new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi');
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
    return `<div class="stat" style="--c:${cat.color}">
      <div class="stat-title"><span class="swatch" style="background:${cat.color}"></span>${esc(h.title)}</div>
      <div class="stat-pct">${pct}%</div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="stat-meta">${done} из ${sched} · серия ${currentStreak(h)} · рекорд ${bestStreak(h)}</div>
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

  let theme = 'auto';
  try { theme = localStorage.getItem(LS_THEME) || 'auto'; } catch (e) {}
  $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  renderSync();
}

function render() {
  renderToday();
  renderProjects();
  renderCalendar();
  renderJournal();
  renderHistory();
  renderSettings();
}

/* ---------- синхронизация (GitHub Gist) ---------- */
const sync = { busy: false, again: false, timer: null, state: 'off', lastAt: 0, login: '', error: '' };
const token = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } };

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
function daysButtons(el, days) {
  el.innerHTML = WEEK.map(([d, n]) => `<button type="button" data-d="${d}" class="${days.includes(d) ? 'on' : ''}">${n}</button>`).join('');
}

function openHabit(h) {
  ui.editHabit = h ? h.id : null;
  $('#habitDlgTitle').textContent = h ? 'Редактировать дело' : 'Новое дело';
  $('#hTitle').value = h ? h.title : '';
  $('#hHint').value = h ? h.hint || '' : '';
  $('#hCat').innerHTML = Object.entries(CATS).map(([id, c]) => `<option value="${id}">${esc(c.name)}</option>`).join('');
  $('#hCat').value = h && CATS[h.cat] ? h.cat : 'other';
  daysButtons($('#hDays'), h ? h.days || [] : []);
  $('#hDelete').hidden = !h;
  $('#habitDialog').showModal();
  if (!h) $('#hTitle').focus();
}

function suggestTimes(k) {
  const list = blocksOn(k);
  let start = list.length ? Math.max(...list.map((b) => toMin(b.end))) : 9 * 60;
  if (k === dateKey()) start = Math.max(start, Math.ceil(nowMin() / 30) * 30);
  start = Math.min(start, 22 * 60);
  return [fromMin(start), fromMin(Math.min(start + 60, 23 * 60 + 59))];
}
function blockRefOptions(selected) {
  let html = '<optgroup label="Направления">' + Object.entries(CATS).map(([id, c]) => `<option value="c:${id}">${esc(c.name)}</option>`).join('') + '</optgroup>';
  const ps = projectsSorted().filter((p) => p.status !== 'done' || 'p:' + p.id === selected);
  if (ps.length) html += '<optgroup label="Проекты">' + ps.map((p) => `<option value="p:${esc(p.id)}">${esc(p.title)}</option>`).join('') + '</optgroup>';
  return html;
}
function updateBlockDateLabel() {
  $('#bDateLabel').textContent = $$('#bDays button.on').length ? 'Начиная с' : 'Дата';
}
function openBlock(b, k) {
  ui.editBlock = b ? b.id : null;
  ui.blockDate = k;
  const [s, e] = b ? [b.start, b.end] : suggestTimes(k);
  $('#blockDlgTitle').textContent = b ? 'Блок времени' : 'Новый блок';
  $('#bStart').value = s;
  $('#bEnd').value = e;
  $('#bRef').innerHTML = blockRefOptions(b ? b.ref : '');
  $('#bRef').value = b ? b.ref : 'c:prog';
  if (!$('#bRef').value) $('#bRef').value = 'c:other';
  $('#bTitle').value = b ? b.title || '' : '';
  $('#bDate').value = b ? b.date : k;
  daysButtons($('#bDays'), b ? b.days || [] : []);
  updateBlockDateLabel();
  $('#bError').hidden = true;
  $('#bDelete').hidden = !b;
  $('#bDelete').textContent = b && b.days && b.days.length ? 'Удалить серию' : 'Удалить';
  $('#bSkip').hidden = !(b && b.days && b.days.length);
  $('#blockDialog').showModal();
}

function openProject(p) {
  ui.editProject = p ? p.id : null;
  $('#projectDlgTitle').textContent = p ? 'Проект' : 'Новый проект';
  $('#pTitle').value = p ? p.title : '';
  $('#pGoal').value = p ? p.goal || '' : '';
  $('#pDeadline').value = p ? p.deadline || '' : '';
  const used = new Set(projectsSorted().map((x) => x.color));
  const color = p ? p.color : (PALETTE.find((c) => !used.has(c)) || PALETTE[0]);
  $('#pColors').innerHTML = PALETTE.map((c) => `<button type="button" data-color="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('');
  const status = p ? p.status : 'active';
  $$('#pStatus button').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
  $('#pDelete').hidden = !p;
  $('#projectDialog').showModal();
  if (!p) $('#pTitle').focus();
}

function openStage(s) {
  ui.editStage = s.id;
  $('#sTitle').value = s.title;
  $('#sDue').value = s.due || '';
  const list = stagesOf(s.projectId);
  const i = list.findIndex((x) => x.id === s.id);
  $('#sUp').disabled = i <= 0;
  $('#sDown').disabled = i >= list.length - 1;
  $('#stageDialog').showModal();
}

function moveStage(dir) {
  const s = state.stages[ui.editStage];
  if (!s) return;
  const list = stagesOf(s.projectId);
  const i = list.findIndex((x) => x.id === s.id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const t = now();
  list.forEach((x, idx) => { if (x.order !== idx + 1) state.stages[x.id] = { ...x, order: idx + 1, updatedAt: t }; });
  commit();
  $('#sUp').disabled = j <= 0;
  $('#sDown').disabled = j >= list.length - 1;
}

function openNote(n) {
  ui.editNote = n.id;
  const d = new Date(n.ts);
  $('#nTime').value = `${dateKey(d)}T${hhmm(n.ts)}`;
  $('#nText').value = n.text;
  $('#nImportant').checked = !!n.important;
  $('#noteDialog').showModal();
}

function goProject(pid) {
  ui.project = pid;
  renderProjects();
  setView('projects');
}

/* ---------- тост ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- события ---------- */
function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === 'projects') { ui.project = null; renderProjects(); }
    setView(b.dataset.tab);
  }));
  $('#gearBtn').addEventListener('click', () => setView(ui.view === 'settings' ? 'today' : 'settings'));
  $('#syncPill').addEventListener('click', () => setView('settings'));

  // дни
  $('#dayPrev').addEventListener('click', () => { ui.day = addDays(ui.day, -1); renderToday(); });
  $('#dayNext').addEventListener('click', () => { if (ui.day < dateKey()) { ui.day = addDays(ui.day, 1); renderToday(); } });
  $('#dayToday').addEventListener('click', () => { ui.day = dateKey(); renderToday(); });

  // план дня
  bindPlan($('#dayPlan'));
  bindPlan($('#calPlan'));

  // привычки
  $('#habitList').addEventListener('click', (e) => {
    const b = e.target.closest('.habit');
    if (b) toggleCheck(ui.day, b.dataset.hid);
  });

  // следующие шаги
  $('#nextSteps').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.stage');
    if (!act || !row) return;
    const s = state.stages[row.dataset.sid];
    if (!s) return;
    if (act.dataset.act === 'stoggle') toggleStage(s.id);
    else goProject(s.projectId);
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

  // проекты
  $('#projectsView').addEventListener('click', (e) => {
    if (e.target.closest('#projectAdd')) return openProject(null);
    if (e.target.closest('#projectBack')) { ui.project = null; renderProjects(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('#projectEdit')) return openProject(state.projects[ui.project]);
    const card = e.target.closest('.project-card');
    if (card) { ui.project = card.dataset.pid; renderProjects(); window.scrollTo({ top: 0 }); return; }
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.stage');
    if (act && row && state.stages[row.dataset.sid]) {
      if (act.dataset.act === 'stoggle') toggleStage(row.dataset.sid);
      else openStage(state.stages[row.dataset.sid]);
    }
  });
  $('#projectsView').addEventListener('submit', (e) => {
    if (e.target.id !== 'stageForm') return;
    e.preventDefault();
    const title = $('#stageTitle').value.trim();
    if (!title || !ui.project) return;
    const list = stagesOf(ui.project);
    const id = uid(), t = now();
    state.stages[id] = { id, projectId: ui.project, title, due: $('#stageDue').value || '', done: false, doneAt: 0, order: (list.length ? Math.max(...list.map((s) => s.order || 0)) : 0) + 1, createdAt: t, updatedAt: t };
    commit();
    $('#stageTitle').focus();
  });
  $('#pColors').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#pColors button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $$('#pStatus button').forEach((b) => b.addEventListener('click', () => {
    $$('#pStatus button').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#projectDlgForm').addEventListener('submit', () => {
    const title = $('#pTitle').value.trim();
    if (!title) return;
    const base = ui.editProject ? state.projects[ui.editProject]
      : { id: uid(), order: (projectsSorted().length ? Math.max(...projectsSorted().map((p) => p.order || 0)) : 0) + 1, createdAt: now() };
    state.projects[base.id] = {
      ...base, title,
      goal: $('#pGoal').value.trim(),
      color: $('#pColors button.on')?.dataset.color || PALETTE[0],
      status: $('#pStatus button.active')?.dataset.status || 'active',
      deadline: $('#pDeadline').value || '',
      updatedAt: now(),
    };
    if (!ui.editProject) ui.project = base.id;
    commit();
  });
  $('#pDelete').addEventListener('click', () => {
    const p = state.projects[ui.editProject];
    if (!p || !confirm(`Удалить проект «${p.title}» вместе с этапами?`)) return;
    state.projects[p.id] = { ...p, deleted: true, updatedAt: now() };
    $('#projectDialog').close();
    ui.project = null;
    commit();
  });
  $('#stageDlgForm').addEventListener('submit', () => {
    const s = state.stages[ui.editStage];
    const title = $('#sTitle').value.trim();
    if (!s || !title) return;
    state.stages[s.id] = { ...s, title, due: $('#sDue').value || '', updatedAt: now() };
    commit();
  });
  $('#sUp').addEventListener('click', () => moveStage(-1));
  $('#sDown').addEventListener('click', () => moveStage(1));
  $('#sDelete').addEventListener('click', () => {
    const s = state.stages[ui.editStage];
    if (!s || !confirm('Удалить этап?')) return;
    state.stages[s.id] = { ...s, deleted: true, updatedAt: now() };
    $('#stageDialog').close();
    commit();
  });

  // блоки времени
  $('#bDays').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { b.classList.toggle('on'); updateBlockDateLabel(); }
  });
  $('#bDurChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = toMin($('#bStart').value || '09:00');
    $('#bEnd').value = fromMin(Math.min(s + Number(b.dataset.min), 23 * 60 + 59));
  });
  $('#bStart').addEventListener('change', () => {
    // сдвигаем конец, сохраняя длительность
    const b = ui.editBlock && state.blocks[ui.editBlock];
    const dur = b ? toMin(b.end) - toMin(b.start) : 60;
    const s = toMin($('#bStart').value);
    if (toMin($('#bEnd').value) <= s) $('#bEnd').value = fromMin(Math.min(s + dur, 23 * 60 + 59));
  });
  $('#blockDlgForm').addEventListener('submit', (e) => {
    const start = $('#bStart').value, end = $('#bEnd').value, date = $('#bDate').value;
    const err = !start || !end ? 'Укажи время начала и конца'
      : toMin(end) <= toMin(start) ? 'Конец должен быть позже начала'
      : !date ? 'Укажи дату' : '';
    if (err) { e.preventDefault(); $('#bError').textContent = err; $('#bError').hidden = false; return; }
    const days = $$('#bDays button.on').map((b) => Number(b.dataset.d));
    const base = ui.editBlock ? state.blocks[ui.editBlock] : { id: uid(), createdAt: now(), skip: [] };
    state.blocks[base.id] = { ...base, start, end, date, days, ref: $('#bRef').value, title: $('#bTitle').value.trim(), updatedAt: now() };
    commit();
  });
  $('#bDelete').addEventListener('click', () => {
    const b = state.blocks[ui.editBlock];
    if (!b) return;
    const series = b.days && b.days.length;
    if (series && !confirm('Удалить блок из всех дней?')) return;
    state.blocks[b.id] = { ...b, deleted: true, updatedAt: now() };
    $('#blockDialog').close();
    commit();
  });
  $('#bSkip').addEventListener('click', () => {
    const b = state.blocks[ui.editBlock];
    if (!b) return;
    state.blocks[b.id] = { ...b, skip: [...new Set([...(b.skip || []), ui.blockDate])], updatedAt: now() };
    $('#blockDialog').close();
    commit();
    toast('Убрано только из этого дня');
  });

  // календарь
  const shiftMonth = (n) => {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    ui.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    renderCalendar();
  };
  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  $('#calToday').addEventListener('click', () => { ui.calDay = dateKey(); ui.calMonth = ui.calDay.slice(0, 7); renderCalendar(); });
  $('#calGrid').addEventListener('click', (e) => {
    const c = e.target.closest('.cal-cell');
    if (!c) return;
    ui.calDay = c.dataset.day;
    if (ui.calDay.slice(0, 7) !== ui.calMonth) ui.calMonth = ui.calDay.slice(0, 7);
    renderCalendar();
    if (!isWide()) $('.cal-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const onDeadlineClick = (e) => {
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.dl');
    if (!act || !row) return;
    const { kind, id, pid } = row.dataset;
    if (act.dataset.act === 'dltoggle') {
      if (kind === 'stage') return toggleStage(id);
      const t = state.tasks[id];
      if (t) { state.tasks[id] = { ...t, done: !t.done, doneAt: t.done ? 0 : now(), updatedAt: now() }; commit(); }
    } else if (pid) goProject(pid);
    else if (kind === 'task') { const t = state.tasks[id]; if (t && t.due) { ui.calDay = t.due; ui.calMonth = t.due.slice(0, 7); renderCalendar(); } }
  };
  $('#calDeadlines').addEventListener('click', onDeadlineClick);
  $('#upcoming').addEventListener('click', onDeadlineClick);

  // журнал
  const tickCompose = () => { $('#composeTime').textContent = hhmm(now()); };
  tickCompose();
  setInterval(() => {
    tickCompose();
    // обновляем «сейчас» в плане дня раз в минуту
    if (ui.view === 'today' && !document.querySelector('dialog[open]')) renderPlan(ui.day, $('#dayPlan'));
  }, 60000);
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
  $('#noteDlgForm').addEventListener('submit', () => {
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

  // настройки: ежедневные дела
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
    try {
      if (t === 'auto') { localStorage.removeItem(LS_THEME); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem(LS_THEME, t); document.documentElement.dataset.theme = t; }
    } catch (e) {}
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
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== ui.view) setView(v); });
}

/* ---------- старт ---------- */
bind();
const startView = location.hash.slice(1);
setView(VIEWS.includes(startView) ? startView : 'today');
render();
if (token()) runSync();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
