'use strict';

/* =========================================================
   Daily — календарь дел
   Всё, что надо сделать, — это «задача» (items): с датой или без,
   с временем или без, разовая или повторяющаяся, с проектом или без.
   Данные: localStorage + (опционально) секретный GitHub Gist.
   У каждой записи есть updatedAt; при синхронизации побеждает
   более свежая версия каждой записи.
   ========================================================= */

const LS_STATE = 'dt_state_v1';
const LS_TOKEN = 'dt_gh_token';
const LS_GIST = 'dt_gist_id';
const LS_THEME = 'dt_theme';
const GIST_DESC = 'daily-tracker-data';
const GIST_FILE = 'daily-tracker.json';
// habits/tasks/stages/blocks — старый формат, читается только для переноса
const COLS = ['items', 'checks', 'notes', 'projects', 'pnotes', 'habits', 'tasks', 'stages', 'blocks'];
const MIGRATION_START = '2026-10-13'; // с этого дня считаются перенесённые ежедневные дела

const CATS = {
  prog:  { name: 'Программирование', color: '#6366f1' },
  en:    { name: 'Английский',       color: '#0ea5e9' },
  trade: { name: 'Трейдинг',         color: '#f59e0b' },
  sql:   { name: 'SQL',              color: '#10b981' },
  other: { name: 'Другое',           color: '#a855f7' },
};
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
const STATUS = { active: 'В работе', paused: 'На паузе', done: 'Завершён' };
const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

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
const dow = (k) => parseKey(k).getDay();
const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const REPEAT_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-label="повторяется"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>';
const NOTE_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8.5 11h7M8.5 15h5"/></svg>';

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
function shortDate(k) {
  const d = parseKey(k);
  const s = `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${s} ${d.getFullYear()}`;
}
function longDate(k) {
  const d = parseKey(k);
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return `${wd}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
function relDay(k) {
  const t = dateKey();
  if (k === t) return 'сегодня';
  if (k === addDays(t, -1)) return 'вчера';
  if (k === addDays(t, 1)) return 'завтра';
  return null;
}
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

/* ---------- состояние ---------- */
function defaultState() {
  // старый формат ежедневных дел — перенесётся в задачи тем же путём, что и у всех
  const h = (id, title, cat, order, days = [], hint = '') => [id, { id, title, cat, order, days, hint, updatedAt: 1 }];
  return {
    v: 2,
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
}

/* Перенос старого формата в задачи. Id детерминированные (h:, t:, s:, b:),
   поэтому одинаковые данные на разных устройствах дают одинаковые задачи. */
function migrate(s) {
  const put = (id, base, src) => {
    if (s.items[id]) return;
    const it = { id, title: '', hint: '', cat: '', projectId: '', date: '', start: '', end: '', repeat: [], skip: [], done: false, doneAt: 0, order: 0, createdAt: src.createdAt || 1, updatedAt: src.updatedAt || 1, ...base };
    if (src.deleted) it.deleted = true;
    s.items[id] = it;
  };
  for (const h of Object.values(s.habits)) if (h && h.id) {
    put('h:' + h.id, { title: h.title || '', hint: h.hint || '', cat: h.cat || 'other', date: MIGRATION_START, repeat: h.days && h.days.length ? [...h.days] : [0, 1, 2, 3, 4, 5, 6], order: h.order || 0 }, h);
  }
  for (const t of Object.values(s.tasks)) if (t && t.id) {
    put('t:' + t.id, { title: t.title || '', date: t.due || '', done: !!t.done, doneAt: t.doneAt || 0 }, t);
  }
  for (const st of Object.values(s.stages)) if (st && st.id) {
    put('s:' + st.id, { title: st.title || '', projectId: st.projectId || '', date: st.due || '', done: !!st.done, doneAt: st.doneAt || 0, order: st.order || 0 }, st);
  }
  for (const b of Object.values(s.blocks)) if (b && b.id) {
    const ref = b.ref || '';
    put('b:' + b.id, {
      title: b.title || '', cat: ref.startsWith('c:') ? ref.slice(2) : '', projectId: ref.startsWith('p:') ? ref.slice(2) : '',
      date: b.date || '', start: b.start || '', end: b.end || '', repeat: b.days ? [...b.days] : [], skip: b.skip ? [...b.skip] : [],
    }, b);
  }
  for (const key of Object.keys(s.checks)) {
    const i = key.indexOf('|');
    const k = key.slice(0, i), id = key.slice(i + 1);
    const nk = s.habits[id] ? `${k}|h:${id}` : s.blocks[id] ? `${k}|b:${id}` : null;
    if (nk && !s.checks[nk]) s.checks[nk] = { ...s.checks[key] };
  }
}

function normalize(src) {
  const s = { v: 2 };
  if (src && typeof src === 'object') for (const k in src) if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) s[k] = src[k];
  for (const c of COLS) if (!s[c]) s[c] = {};
  seedInto(s);
  migrate(s);
  return s;
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

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function merge(a, b) {
  const out = { v: 2 };
  const keys = new Set([...COLS, ...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.delete('v');
  for (const c of keys) {
    const A = (a && a[c]) || {}, B = (b && b[c]) || {}, o = {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[id], y = B[id];
      if (!x || !y) { o[id] = x || y; continue; }
      const dx = x.updatedAt || 0, dy = y.updatedAt || 0;
      // при равном времени выбираем детерминированно, чтобы устройства сошлись к одному
      o[id] = dy > dx ? y : dx > dy ? x : (stable(y) > stable(x) ? y : x);
    }
    out[c] = o;
  }
  return out;
}

/* ---------- модель ---------- */
const alive = (o) => Object.values(o || {}).filter((x) => x && !x.deleted);
const isRepeat = (it) => Array.isArray(it.repeat) && it.repeat.length > 0;
const projectAlive = (pid) => !!pid && state.projects[pid] && !state.projects[pid].deleted;

function occursOn(it, k) {
  if (!it.date) return false;
  if (isRepeat(it)) return k >= it.date && it.repeat.includes(dow(k)) && !(it.skip || []).includes(k);
  return it.date === k;
}
const doneOn = (it, k) => isRepeat(it) ? !!(state.checks[k + '|' + it.id] && state.checks[k + '|' + it.id].done) : !!it.done;

function toggleItem(it, k) {
  if (isRepeat(it)) state.checks[k + '|' + it.id] = { done: !doneOn(it, k), updatedAt: now() };
  else state.items[it.id] = { ...it, done: !it.done, doneAt: it.done ? 0 : now(), updatedAt: now() };
  commit();
}

function itemInfo(it) {
  if (projectAlive(it.projectId)) { const p = state.projects[it.projectId]; return { name: p.title, color: p.color, pid: p.id }; }
  const c = CATS[it.cat];
  if (!c) return { name: '', color: '' };
  return { name: it.cat === 'other' ? '' : c.name, color: c.color };
}
const itemTitle = (it) => it.title || itemInfo(it).name || 'Без названия';

const byTimeThenOrder = (a, b) => {
  const ta = a.start ? toMin(a.start) : 1e4, tb = b.start ? toMin(b.start) : 1e4;
  if (ta !== tb) return ta - tb;
  if (isRepeat(a) !== isRepeat(b)) return isRepeat(a) ? 1 : -1; // разовые выше привычек
  return (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);
};

let _items = null; // кэш живых задач на один проход отрисовки
const liveItems = () => _items || (_items = alive(state.items));
const dayItems = (k) => liveItems().filter((it) => occursOn(it, k)).sort(byTimeThenOrder);
function dayStats(k) {
  const list = dayItems(k);
  return { total: list.length, done: list.filter((it) => doneOn(it, k)).length, oneOff: list.filter((it) => !isRepeat(it)) };
}
const overdueItems = () => liveItems().filter((it) => !isRepeat(it) && it.date && it.date < dateKey() && !it.done).sort((a, b) => a.date.localeCompare(b.date));
const undatedItems = () => {
  const t = dateKey();
  return liveItems().filter((it) => !isRepeat(it) && !it.date && !projectAlive(it.projectId) && (!it.done || (it.doneAt && dateKey(new Date(it.doneAt)) === t)))
    .sort((a, b) => (a.done - b.done) || (a.createdAt || 0) - (b.createdAt || 0));
};

function currentStreak(it) {
  let k = dateKey(), n = 0;
  if (occursOn(it, k) && !doneOn(it, k)) k = addDays(k, -1);
  for (let i = 0; i < 400 && k >= it.date; i++, k = addDays(k, -1)) {
    if (!occursOn(it, k)) continue;
    if (doneOn(it, k)) n++; else break;
  }
  return n;
}

// заметки задачи: новые хранят itemId, старые заметки этапов — stageId
const noteItemId = (n) => n.itemId || (n.stageId ? 's:' + n.stageId : '');
const itemNotes = (iid) => alive(state.pnotes).filter((n) => noteItemId(n) === iid).sort((a, b) => b.ts - a.ts);
const projectNotes = (pid) => alive(state.pnotes).filter((n) => n.projectId === pid && !noteItemId(n)).sort((a, b) => b.ts - a.ts);
const projectsSorted = () => alive(state.projects).sort((a, b) => (a.order || 0) - (b.order || 0));

/* ---------- UI-состояние ---------- */
const VIEWS = ['cal', 'projects', 'settings'];
const ui = {
  view: 'cal', day: dateKey(), month: dateKey().slice(0, 7), project: null, important: false,
  edit: null, editDate: null, editNote: null, editNoteKind: 'notes', editProject: null,
};
const isWide = () => window.matchMedia('(min-width: 960px)').matches;

function setView(v) {
  ui.view = v;
  document.body.dataset.view = v;
  $('#projectsBtn').classList.toggle('active', v === 'projects');
  $('#gearBtn').classList.toggle('active', v === 'settings');
  if (location.hash.slice(1) !== v) history.replaceState(null, '', v === 'cal' ? location.pathname : '#' + v);
  window.scrollTo({ top: 0 });
}

function selectDay(k) {
  ui.day = k;
  ui.month = k.slice(0, 7);
  renderCalendar();
  renderDay();
}

/* ---------- календарь ---------- */
function ringSvg(pct, cls) {
  return `<svg class="ring ${cls}" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="ring-track" cx="18" cy="18" r="15.5"/>
    ${pct > 0 ? `<circle class="ring-prog" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="${Math.max(pct, 4)} 100" transform="rotate(-90 18 18)"/>` : ''}
  </svg>`;
}

function renderCalendar() {
  const today = dateKey();
  const [y, m] = ui.month.split('-').map(Number);
  $('#calMonth').textContent = `${MONTHS[m - 1]} ${y}`;
  const first = `${ui.month}-01`;
  const start = addDays(first, -((dow(first) + 6) % 7));
  const last = `${ui.month}-${pad(new Date(y, m, 0).getDate())}`;
  const end = addDays(last, (7 - dow(last)) % 7);

  const deadlines = {};
  for (const p of alive(state.projects)) if (p.deadline && p.status !== 'done') (deadlines[p.deadline] = deadlines[p.deadline] || []).push(p.color);

  let html = '';
  for (let k = start; k <= end; k = addDays(k, 1)) {
    const { total, done, oneOff } = dayStats(k);
    const out = k.slice(0, 7) !== ui.month;
    let mark = '', extra = '';
    if (k <= today && total) {
      const pct = Math.round(done / total * 100);
      mark = ringSvg(pct, done === total ? 'full' : '');
      if (k < today && done < total) extra = '<i class="miss"></i>';
    } else if (k > today) {
      const dots = oneOff.slice(0, 3).map((it) => `<i style="background:${itemInfo(it).color || 'var(--muted)'}"></i>`);
      (deadlines[k] || []).slice(0, 2).forEach((c) => dots.push(`<i class="flag" style="background:${c}"></i>`));
      if (dots.length) extra = `<span class="dots">${dots.slice(0, 3).join('')}</span>`;
    }
    const cls = [out ? 'out' : '', k === today ? 'is-today' : '', k === ui.day ? 'sel' : ''].join(' ');
    html += `<button type="button" class="cell ${cls}" data-day="${k}" aria-label="${longDate(k)}${total ? `, ${done} из ${total}` : ''}">
      <span class="num-wrap">${mark}<span class="num">${parseKey(k).getDate()}</span></span>${extra}
    </button>`;
  }
  $('#calGrid').innerHTML = html;
}

/* ---------- строки задач ---------- */
function itemRow(it, k, opts = {}) {
  const info = itemInfo(it);
  const done = k ? doneOn(it, k) : !!it.done;
  const isToday = k === dateKey();
  const s = it.start ? toMin(it.start) : null, e = it.end ? toMin(it.end) : null;
  const nm = nowMin();
  const nowCls = isToday && s !== null && e !== null && nm >= s && nm < e && !done ? 'now' : '';
  const sub = [];
  if (info.name && it.title && it.title !== info.name && opts.showProject !== false) sub.push(`<span class="chip-dot" style="background:${info.color}"></span>${esc(info.name)}`);
  if (opts.showDate && it.date) sub.push(`<span class="${!done && it.date < dateKey() ? 'overdue' : ''}">${relDay(it.date) || shortDate(it.date)}</span>`);
  if (it.hint) sub.push(esc(it.hint));
  if (isRepeat(it)) {
    const st = currentStreak(it);
    sub.push(REPEAT_SVG + (st >= 2 ? ` <span class="streak">🔥 ${st}</span>` : ''));
  }
  const nc = itemNotes(it.id).length;
  if (nc) sub.push(`${NOTE_SVG} ${nc}`);
  if (nowCls) sub.push(`<b class="now-label">сейчас, ещё ${fmtDur(e - nm)}</b>`);
  const time = it.start ? `<span class="it-time">${it.start}${it.end ? '–' + it.end : ''}${e !== null && s !== null ? `<span class="it-dur">${fmtDur(e - s)}</span>` : ''}</span>` : '';
  return `<div class="it ${done ? 'done' : ''} ${nowCls} ${info.color ? 'colored' : ''}" data-iid="${esc(it.id)}" data-date="${k || ''}" style="--c:${info.color || 'var(--border)'}">
    <button type="button" class="check" data-act="toggle" aria-label="${done ? 'Вернуть' : 'Выполнено'}">${CHECK_SVG}</button>
    <button type="button" class="it-body" data-act="open">
      ${time}<span class="it-title">${esc(itemTitle(it))}</span>
      ${sub.length ? `<span class="it-sub">${sub.join('<span class="sep">·</span>')}</span>` : ''}
    </button>
  </div>`;
}

function bindItemList(el, dateOf) {
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.it');
    if (!act || !row) return;
    const it = state.items[row.dataset.iid];
    if (!it) return;
    const k = row.dataset.date || dateOf(it);
    if (act.dataset.act === 'toggle') toggleItem(it, k);
    else openItem(it, k);
  });
}

/* ---------- день ---------- */
function renderDay() {
  const k = ui.day, today = dateKey();
  const rel = relDay(k);
  $('#dayTitle').textContent = rel ? cap(rel) : cap(parseKey(k).toLocaleDateString('ru-RU', { weekday: 'long' }));
  const left = dayDiff(today, k);
  $('#daySub').textContent = longDate(k) + (left > 1 ? ` · через ${left} ${plural(left, 'день', 'дня', 'дней')}` : '');

  const list = dayItems(k);
  const done = list.filter((it) => doneOn(it, k)).length;
  $('#dayCount').textContent = list.length ? `${done} / ${list.length}` : '';
  $('#dayCount').classList.toggle('complete', list.length > 0 && done === list.length);
  $('#dayBar').style.width = list.length ? (done / list.length * 100) + '%' : '0';
  $('#dayBar').parentElement.classList.toggle('complete', list.length > 0 && done === list.length);
  $('#dayBar').parentElement.hidden = !list.length;

  let html = '';
  // хвосты — только на сегодня
  if (k === today) {
    const od = overdueItems();
    if (od.length) html += `<h2 class="section-title warn">Хвосты с прошлых дней · ${od.length}</h2><div class="list card">${od.map((it) => itemRow(it, it.date, { showDate: true })).join('')}</div>`;
  }
  // дедлайны проектов
  const dls = alive(state.projects).filter((p) => p.deadline === k);
  if (dls.length) html += `<div class="list card deadline-card">${dls.map((p) => `<button type="button" class="deadline" data-pid="${esc(p.id)}" style="--c:${p.color}">⚑ Дедлайн проекта «${esc(p.title)}»</button>`).join('')}</div>`;

  if (list.length) {
    let rows = '', prevEnd = null;
    for (const it of list) {
      if (it.start && prevEnd !== null) {
        const gap = toMin(it.start) - prevEnd;
        if (gap >= 30) rows += `<div class="gap">свободно ${fmtDur(gap)}</div>`;
      }
      if (it.start) prevEnd = Math.max(prevEnd || 0, toMin(it.end || it.start));
      else prevEnd = null;
      rows += itemRow(it, k);
    }
    html += `<div class="list card day-list">${rows}</div>`;
  } else {
    html += `<div class="card empty">${k < today ? 'В этот день ничего не было запланировано' : 'Пока ничего — добавь первое дело ниже'}</div>`;
  }
  $('#dayList').innerHTML = html;
  $('#quickInput').placeholder = `Добавить на ${rel || shortDate(k)}…`;
  renderNotes();
}

function renderInbox() {
  const list = undatedItems();
  const open = list.filter((it) => !it.done).length;
  $('#inboxCount').textContent = open || '';
  $('#inboxList').innerHTML = list.length ? `<div class="list">${list.map((it) => itemRow(it, '', {})).join('')}</div>` : '<p class="muted small inbox-empty">Здесь — то, что не забыть, но срока пока нет.</p>';
}

function highlightLinks(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function renderNotes() {
  const k = ui.day;
  const notes = alive(state.notes).filter((n) => dateKey(new Date(n.ts)) === k).sort((a, b) => a.ts - b.ts);
  $('#noteList').innerHTML = notes.length ? `<div class="list card">${notes.map((n) => `<button type="button" class="note ${n.important ? 'important' : ''}" data-nid="${esc(n.id)}">
      <span class="note-time">${n.important ? '★ ' : ''}${hhmm(n.ts)}</span>
      <span class="note-text">${highlightLinks(n.text)}</span>
    </button>`).join('')}</div>` : '';
}

/* ---------- проекты ---------- */
function projectStats(pid) {
  const its = liveItems().filter((it) => it.projectId === pid && !isRepeat(it));
  const done = its.filter((it) => it.done).length;
  const open = its.filter((it) => !it.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return { total: its.length, done, open, doneList: its.filter((it) => it.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) };
}
function deadlineLabel(p) {
  if (!p.deadline) return '';
  const left = dayDiff(dateKey(), p.deadline);
  if (p.status === 'done') return `до ${shortDate(p.deadline)}`;
  if (left < 0) return `<span class="overdue">просрочен на ${-left} ${plural(-left, 'день', 'дня', 'дней')}</span>`;
  if (left === 0) return '<span class="warn">дедлайн сегодня</span>';
  return `до ${shortDate(p.deadline)} · ${left} ${plural(left, 'день', 'дня', 'дней')}`;
}

function projectCard(p) {
  const st = projectStats(p.id);
  const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
  const nx = st.open[0];
  return `<button type="button" class="card project-card" data-pid="${esc(p.id)}" style="--c:${p.color}">
    <span class="pc-top"><span class="pc-title">${esc(p.title)}</span><span class="pc-count">${st.done}/${st.total}</span></span>
    ${p.goal ? `<span class="pc-goal">${esc(p.goal)}</span>` : ''}
    <span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>
    <span class="pc-meta">
      <span class="pc-next">${nx ? `Дальше: ${esc(itemTitle(nx))}${nx.date ? ` · ${relDay(nx.date) || shortDate(nx.date)}` : ''}` : st.total ? 'Все задачи закрыты' : 'Задач пока нет'}</span>
      ${p.deadline ? `<span class="pc-deadline">${deadlineLabel(p)}</span>` : ''}
    </span>
  </button>`;
}

function renderProjects() {
  const el = $('#projectsView');
  const draft = $('#projectsView .pnote-form textarea')?.value || '';
  if (ui.project && projectAlive(ui.project)) {
    renderProjectDetail(el, state.projects[ui.project]);
    const ta = $('#projectsView .pnote-form textarea');
    if (ta && draft && document.activeElement !== ta) ta.value = draft;
    return;
  }
  ui.project = null;
  const ps = projectsSorted();
  const group = (st) => ps.filter((p) => p.status === st);
  const openStates = $$('#projectsView details').map((d) => d.open);
  let html = `<div class="pd-nav"><button type="button" class="link-btn back-cal">‹ Календарь</button><button type="button" class="add-btn" id="projectAdd">+ Проект</button></div>
    <h2 class="section-title first">Проекты в работе</h2>`;
  html += group('active').length ? `<div class="project-grid">${group('active').map(projectCard).join('')}</div>` : '<div class="card empty">Активных проектов нет</div>';
  if (group('paused').length) html += `<details class="later"><summary>На паузе (${group('paused').length})</summary><div class="project-grid">${group('paused').map(projectCard).join('')}</div></details>`;
  if (group('done').length) html += `<details class="later"><summary>Завершённые (${group('done').length})</summary><div class="project-grid">${group('done').map(projectCard).join('')}</div></details>`;
  el.innerHTML = html;
  $$('#projectsView details').forEach((d, i) => { if (openStates[i]) d.open = true; });
}

function renderProjectDetail(el, p) {
  const st = projectStats(p.id);
  const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
  const repeats = liveItems().filter((it) => it.projectId === p.id && isRepeat(it));
  const notes = projectNotes(p.id);
  const doneOpen = $('#projectsView details.done-list')?.open;
  el.innerHTML = `
    <div class="pd-nav">
      <button type="button" class="link-btn" id="projectBack">‹ Проекты</button>
      <button type="button" class="btn small-btn" id="projectEdit">Изменить</button>
    </div>
    <div class="card pd-head" style="--c:${p.color}">
      <div class="pd-title-row"><h1 class="pd-title">${esc(p.title)}</h1><span class="status-chip s-${p.status}">${STATUS[p.status] || ''}</span></div>
      ${p.goal ? `<p class="pd-goal">${esc(p.goal)}</p>` : ''}
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="pd-meta"><span>${st.done} из ${st.total} ${plural(st.total, 'задачи', 'задач', 'задач')}</span>${p.deadline ? `<span>${deadlineLabel(p)}</span>` : ''}</div>
    </div>

    <h2 class="section-title">Задачи</h2>
    <div class="proj-items">
      ${st.open.length ? `<div class="list card">${st.open.map((it) => itemRow(it, it.date, { showDate: true, showProject: false })).join('')}</div>` : '<div class="card empty">Открытых задач нет</div>'}
      ${repeats.length ? `<div class="list card" style="margin-top:10px">${repeats.map((it) => itemRow(it, dateKey(), { showProject: false })).join('')}</div>` : ''}
      ${st.doneList.length ? `<details class="later done-list"${doneOpen ? ' open' : ''}><summary>Выполнено (${st.doneList.length})</summary><div class="list card">${st.doneList.map((it) => itemRow(it, it.date, { showDate: true, showProject: false })).join('')}</div></details>` : ''}
    </div>
    <form class="quick-add card proj-add" id="projItemForm" autocomplete="off">
      <span class="plus">+</span>
      <input type="text" id="projItemTitle" placeholder="Новая задача проекта…" enterkeyhint="done">
      <input type="date" id="projItemDate" aria-label="Срок">
    </form>

    <h2 class="section-title">Заметки проекта${notes.length ? ` · ${notes.length}` : ''}</h2>
    <form class="compose card pnote-form" data-pid="${esc(p.id)}">
      <textarea rows="2" placeholder="Мысли, ссылки, договорённости по проекту…"></textarea>
      <div class="compose-row"><span class="compose-hint">Ctrl/⌘ + Enter</span><button class="btn primary" type="submit">Добавить</button></div>
    </form>
    ${notes.length ? `<div class="list card pnote-list">${notes.map(pnoteRow).join('')}</div>` : ''}`;
}

function pnoteRow(n) {
  const k = dateKey(new Date(n.ts));
  return `<button type="button" class="note pnote" data-pnid="${esc(n.id)}">
    <span class="pnote-when">${relDay(k) || shortDate(k)}, ${hhmm(n.ts)}</span>
    <span class="note-text">${highlightLinks(n.text)}</span>
  </button>`;
}

/* ---------- настройки ---------- */
function renderSettings() {
  let theme = 'auto';
  try { theme = localStorage.getItem(LS_THEME) || 'auto'; } catch (e) {}
  $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  renderSync();
}

function render() {
  _items = null;
  renderCalendar();
  renderDay();
  renderInbox();
  renderProjects();
  renderSettings();
  _items = null;
}

/* ---------- синхронизация (GitHub Gist) ---------- */
const sync = { busy: false, again: false, timer: null, state: 'off', lastAt: 0, login: '', error: '' };
const token = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } };

function setSync(s, error = '') { sync.state = s; sync.error = error; renderSync(); }
function renderSync() {
  const pill = $('#syncPill');
  pill.dataset.state = sync.state;
  const labels = { off: 'Локально', busy: 'Синхр…', ok: sync.lastAt ? hhmm(sync.lastAt) : 'OK', error: 'Нет связи', auth: 'Нужен токен' };
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
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token(), 'X-GitHub-Api-Version': '2022-11-28' };
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
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(state) } } }) });
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
      localStorage.removeItem(LS_GIST);
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
  try { const u = await gh('/user'); sync.login = u.login; }
  catch (e) { if (e.status === 401) { localStorage.removeItem(LS_TOKEN); setSync('off'); toast('Токен не подошёл'); return; } }
  await runSync();
  if (sync.state === 'ok') toast('Синхронизация включена');
}

/* ---------- быстрый ввод ---------- */
// «19:00-21:00 Python», «9-10 Слова», «19:30 Созвон»
function parseQuick(text) {
  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?(?:\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?)?\s+(.+)$/);
  if (m) {
    const h1 = +m[1], m1 = +(m[2] || 0);
    if (h1 < 24 && m1 < 60) {
      const start = fromMin(h1 * 60 + m1);
      let end = '';
      if (m[3] !== undefined) {
        const h2 = +m[3], m2 = +(m[4] || 0);
        if (h2 < 24 && m2 < 60 && h2 * 60 + m2 > h1 * 60 + m1) end = fromMin(h2 * 60 + m2);
      }
      return { title: m[5].trim(), start, end };
    }
  }
  return { title: text, start: '', end: '' };
}

function newItem(fields) {
  const id = uid(), t = now();
  state.items[id] = { id, title: '', hint: '', cat: '', projectId: '', date: '', start: '', end: '', repeat: [], skip: [], done: false, doneAt: 0, order: 0, createdAt: t, updatedAt: t, ...fields };
  return state.items[id];
}

/* ---------- карточка задачи ---------- */
function daysButtons(el, days) {
  el.innerHTML = WEEK.map(([d, n]) => `<button type="button" data-d="${d}" class="${days.includes(d) ? 'on' : ''}">${n}</button>`).join('');
}
const selectedDays = () => $$('#iDays button.on').map((b) => Number(b.dataset.d));
function setDays(days) { $$('#iDays button').forEach((b) => b.classList.toggle('on', days.includes(Number(b.dataset.d)))); updateItemForm(); }
function updateItemForm() {
  const rep = selectedDays().length > 0;
  $('#iDateLabel').textContent = rep ? 'Повторять начиная с' : 'Дата';
  $('#iNoDate').hidden = rep;
  $('#iDur').hidden = !$('#iStart').value;
  $('#iNoTime').hidden = !$('#iStart').value && !$('#iEnd').value;
}

function openItem(it, k, preset = {}) {
  ui.edit = it ? it.id : null;
  ui.editDate = k || '';
  const v = it || { title: '', hint: '', date: k || '', start: '', end: '', repeat: [], projectId: '', ...preset };
  $('#itemDlgTitle').textContent = it ? (isRepeat(it) ? 'Повторяющаяся задача' : 'Задача') : 'Новая задача';
  $('#iTitle').value = it ? itemTitle(it) : v.title || '';
  $('#iHint').value = v.hint || '';
  $('#iDate').value = v.date || '';
  $('#iStart').value = v.start || '';
  $('#iEnd').value = v.end || '';
  daysButtons($('#iDays'), v.repeat || []);
  const ps = projectsSorted().filter((p) => p.status !== 'done' || p.id === v.projectId);
  $('#iProject').innerHTML = '<option value="">Без проекта</option>' + ps.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  $('#iProject').value = projectAlive(v.projectId) ? v.projectId : '';
  $('#iNotesWrap').hidden = !it;
  $('#iNoteText').value = '';
  renderItemNotes();
  $('#iError').hidden = true;
  $('#iDelete').hidden = !it;
  $('#iDelete').textContent = it && isRepeat(it) ? 'Удалить совсем' : 'Удалить';
  $('#iSkip').hidden = !(it && isRepeat(it) && k);
  updateItemForm();
  $('#itemDialog').showModal();
  if (!it && !v.title) $('#iTitle').focus();
}
function renderItemNotes() {
  const list = ui.edit ? itemNotes(ui.edit) : [];
  $('#iNotes').innerHTML = list.length ? `<div class="list card">${list.map(pnoteRow).join('')}</div>` : '';
}

function saveItem(e) {
  const title = $('#iTitle').value.trim();
  const start = $('#iStart').value, end = $('#iEnd').value;
  const repeat = selectedDays();
  let date = $('#iDate').value;
  const err = !title ? 'Напиши, что сделать'
    : end && !start ? 'Укажи время начала'
    : start && end && toMin(end) <= toMin(start) ? 'Конец должен быть позже начала' : '';
  if (err) { e.preventDefault(); $('#iError').textContent = err; $('#iError').hidden = false; return; }
  if (repeat.length && !date) date = ui.editDate || dateKey();
  const fields = { title, hint: $('#iHint').value.trim(), date, start, end, repeat, projectId: $('#iProject').value };
  if (ui.edit) {
    const it = state.items[ui.edit];
    // если название совпадает с подставленным по умолчанию — не фиксируем его
    if (!it.title && title === itemInfo(it).name) fields.title = '';
    state.items[it.id] = { ...it, ...fields, updatedAt: now() };
  } else {
    newItem(fields);
  }
  commit();
}

/* ---------- проектный диалог ---------- */
function openProject(p) {
  ui.editProject = p ? p.id : null;
  $('#projectDlgTitle').textContent = p ? 'Проект' : 'Новый проект';
  $('#pTitle').value = p ? p.title : '';
  $('#pGoal').value = p ? p.goal || '' : '';
  $('#pDeadline').value = p ? p.deadline || '' : '';
  const used = new Set(projectsSorted().map((x) => x.color));
  const color = p ? p.color : (PALETTE.find((c) => !used.has(c)) || PALETTE[0]);
  $('#pColors').innerHTML = PALETTE.map((c) => `<button type="button" data-color="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="Цвет"></button>`).join('');
  const status = p ? p.status : 'active';
  $$('#pStatus button').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
  $('#pDelete').hidden = !p;
  $('#projectDialog').showModal();
  if (!p) $('#pTitle').focus();
}

/* ---------- заметки ---------- */
function openNote(n, kind) {
  ui.editNote = n.id;
  ui.editNoteKind = kind;
  const d = new Date(n.ts);
  $('#nTime').value = `${dateKey(d)}T${hhmm(n.ts)}`;
  $('#nText').value = n.text;
  $('#nImportant').checked = !!n.important;
  $('#nImportantRow').hidden = kind !== 'notes';
  $('#noteDialog').showModal();
}
function addPnote(fields, text) {
  const id = uid(), t = now();
  state.pnotes[id] = { id, projectId: '', itemId: '', stageId: '', text, ts: t, updatedAt: t, ...fields };
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

function goProject(pid) { ui.project = pid; renderProjects(); setView('projects'); }

/* ---------- события ---------- */
function bind() {
  // навигация
  $('#brandBtn').addEventListener('click', () => { setView('cal'); selectDay(dateKey()); });
  $('#projectsBtn').addEventListener('click', () => { if (ui.view === 'projects' && !ui.project) return setView('cal'); ui.project = null; renderProjects(); setView('projects'); });
  $('#gearBtn').addEventListener('click', () => setView(ui.view === 'settings' ? 'cal' : 'settings'));
  $('#syncPill').addEventListener('click', () => setView('settings'));
  document.addEventListener('click', (e) => { if (e.target.closest('.back-cal')) setView('cal'); });

  // календарь
  const shiftMonth = (n) => {
    const [y, m] = ui.month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    renderCalendar();
  };
  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  $('#calMonth').addEventListener('click', () => selectDay(dateKey()));
  $('#calGrid').addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (c) selectDay(c.dataset.day);
  });
  // свайп по месяцу
  let sx = null, sy = null;
  $('#calGrid').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#calGrid').addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
    sx = null;
  }, { passive: true });

  // день
  bindItemList($('#dayList'), (it) => it.date || ui.day);
  $('#dayList').addEventListener('click', (e) => { const d = e.target.closest('.deadline'); if (d) goProject(d.dataset.pid); });
  bindItemList($('#inboxList'), () => '');
  $('#quickAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#quickInput').value.trim();
    if (!text) return;
    const q = parseQuick(text);
    newItem({ title: q.title, start: q.start, end: q.end, date: ui.day });
    $('#quickInput').value = '';
    commit();
    toast(q.start ? `Добавлено на ${q.start}${q.end ? '–' + q.end : ''}` : 'Добавлено');
  });
  $('#quickMore').addEventListener('click', () => {
    const q = parseQuick($('#quickInput').value.trim());
    $('#quickInput').value = '';
    openItem(null, ui.day, { title: q.title, start: q.start, end: q.end });
  });
  $('#inboxForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('input', e.target);
    const text = inp.value.trim();
    if (!text) return;
    newItem({ title: text });
    inp.value = '';
    commit();
  });

  // карточка задачи
  $('#iDays').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { b.classList.toggle('on'); updateItemForm(); } });
  $('#iEveryDay').addEventListener('click', () => setDays([0, 1, 2, 3, 4, 5, 6]));
  $('#iWeekdays').addEventListener('click', () => setDays([1, 2, 3, 4, 5]));
  $('#iNoRepeat').addEventListener('click', () => setDays([]));
  $('#iNoDate').addEventListener('click', () => { $('#iDate').value = ''; });
  $('#iNoTime').addEventListener('click', () => { $('#iStart').value = ''; $('#iEnd').value = ''; updateItemForm(); });
  $('#iStart').addEventListener('input', () => {
    const s = $('#iStart').value;
    if (s && (!$('#iEnd').value || toMin($('#iEnd').value) <= toMin(s))) $('#iEnd').value = fromMin(Math.min(toMin(s) + 60, 23 * 60 + 59));
    updateItemForm();
  });
  $('#iEnd').addEventListener('input', updateItemForm);
  $('#iDur').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !$('#iStart').value) return;
    $('#iEnd').value = fromMin(Math.min(toMin($('#iStart').value) + Number(b.dataset.min), 23 * 60 + 59));
  });
  $('#itemForm').addEventListener('submit', saveItem);
  $('#iDelete').addEventListener('click', () => {
    const it = state.items[ui.edit];
    if (!it) return;
    if (!confirm(isRepeat(it) ? 'Удалить задачу из всех дней? История отметок сохранится.' : 'Удалить задачу?')) return;
    state.items[it.id] = { ...it, deleted: true, updatedAt: now() };
    $('#itemDialog').close();
    commit();
  });
  $('#iSkip').addEventListener('click', () => {
    const it = state.items[ui.edit];
    if (!it) return;
    state.items[it.id] = { ...it, skip: [...new Set([...(it.skip || []), ui.editDate])], updatedAt: now() };
    $('#itemDialog').close();
    commit();
    toast('Убрано только из этого дня');
  });
  $('#iNoteAdd').addEventListener('click', () => {
    const it = state.items[ui.edit];
    const text = $('#iNoteText').value.trim();
    if (!it || !text) return $('#iNoteText').focus();
    addPnote({ projectId: it.projectId || '', itemId: it.id }, text);
    $('#iNoteText').value = '';
    commit();
    renderItemNotes();
  });
  $('#iNotes').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const n = e.target.closest('.pnote');
    if (n && state.pnotes[n.dataset.pnid]) openNote(state.pnotes[n.dataset.pnid], 'pnotes');
  });

  // заметки дня
  const tick = () => { $('#composeTime').textContent = hhmm(now()); };
  tick();
  setInterval(() => {
    tick();
    if (ui.view === 'cal' && !document.querySelector('dialog[open]') && ui.day === dateKey()) { _items = null; renderDay(); _items = null; }
  }, 60000);
  $('#noteImportant').addEventListener('click', () => {
    ui.important = !ui.important;
    $('#noteImportant').setAttribute('aria-pressed', ui.important);
  });
  $('#noteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#noteText').value.trim();
    if (!text) return $('#noteText').focus();
    const id = uid(), t = now();
    // заметка «в другой день» — ставим текущее время на выбранную дату
    let ts = t;
    if (ui.day !== dateKey()) { const d = parseKey(ui.day); const n = new Date(); d.setHours(n.getHours(), n.getMinutes()); ts = d.getTime(); }
    state.notes[id] = { id, text, ts, important: ui.important, updatedAt: t };
    $('#noteText').value = '';
    ui.important = false;
    $('#noteImportant').setAttribute('aria-pressed', 'false');
    commit();
  });
  $('#noteText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#noteForm').requestSubmit(); } });
  $('#noteList').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const b = e.target.closest('.note');
    if (b && state.notes[b.dataset.nid]) openNote(state.notes[b.dataset.nid], 'notes');
  });
  $('#noteDlgForm').addEventListener('submit', () => {
    const col = state[ui.editNoteKind];
    const n = col[ui.editNote];
    const text = $('#nText').value.trim();
    let ts = new Date($('#nTime').value).getTime();
    if (!n || !text || Number.isNaN(ts)) return;
    if ($('#nTime').value === `${dateKey(new Date(n.ts))}T${hhmm(n.ts)}`) ts = n.ts;
    col[n.id] = { ...n, text, ts, updatedAt: now() };
    if (ui.editNoteKind === 'notes') col[n.id].important = $('#nImportant').checked;
    commit();
    if ($('#itemDialog').open) renderItemNotes();
  });
  $('#nDelete').addEventListener('click', () => {
    const col = state[ui.editNoteKind];
    const n = col[ui.editNote];
    if (!n || !confirm('Удалить заметку?')) return;
    col[n.id] = { ...n, deleted: true, updatedAt: now() };
    $('#noteDialog').close();
    commit();
    if ($('#itemDialog').open) renderItemNotes();
  });

  // проекты
  $('#projectsView').addEventListener('click', (e) => {
    if (e.target.closest('#projectAdd')) return openProject(null);
    if (e.target.closest('#projectBack')) { ui.project = null; renderProjects(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('#projectEdit')) return openProject(state.projects[ui.project]);
    const card = e.target.closest('.project-card');
    if (card) { ui.project = card.dataset.pid; renderProjects(); window.scrollTo({ top: 0 }); return; }
    const pn = e.target.closest('.pnote');
    if (pn && !e.target.closest('a') && state.pnotes[pn.dataset.pnid]) return openNote(state.pnotes[pn.dataset.pnid], 'pnotes');
  });
  bindItemList($('#projectsView'), (it) => isRepeat(it) ? dateKey() : it.date);
  $('#projectsView').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'projItemForm') {
      const title = $('#projItemTitle').value.trim();
      if (!title || !ui.project) return;
      const order = Math.max(0, ...liveItems().filter((it) => it.projectId === ui.project).map((it) => it.order || 0)) + 1;
      newItem({ title, projectId: ui.project, date: $('#projItemDate').value || '', order });
      _items = null;
      commit();
      $('#projItemTitle').focus();
    } else if (e.target.classList.contains('pnote-form')) {
      const ta = $('textarea', e.target);
      if (!ta.value.trim()) return ta.focus();
      addPnote({ projectId: e.target.dataset.pid }, ta.value.trim());
      ta.value = '';
      commit();
    }
  });
  $('#projectsView').addEventListener('keydown', (e) => {
    const f = e.target.closest('.pnote-form');
    if (f && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); }
  });
  $('#pColors').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) $$('#pColors button').forEach((x) => x.classList.toggle('on', x === b)); });
  $$('#pStatus button').forEach((b) => b.addEventListener('click', () => $$('#pStatus button').forEach((x) => x.classList.toggle('active', x === b))));
  $('#projectDlgForm').addEventListener('submit', () => {
    const title = $('#pTitle').value.trim();
    if (!title) return;
    const ps = projectsSorted();
    const base = ui.editProject ? state.projects[ui.editProject] : { id: uid(), order: Math.max(0, ...ps.map((p) => p.order || 0)) + 1, createdAt: now() };
    state.projects[base.id] = {
      ...base, title, goal: $('#pGoal').value.trim(),
      color: $('#pColors button.on')?.dataset.color || PALETTE[0],
      status: $('#pStatus button.active')?.dataset.status || 'active',
      deadline: $('#pDeadline').value || '', updatedAt: now(),
    };
    if (!ui.editProject) ui.project = base.id;
    commit();
  });
  $('#pDelete').addEventListener('click', () => {
    const p = state.projects[ui.editProject];
    if (!p || !confirm(`Удалить проект «${p.title}»? Его задачи останутся, но без проекта.`)) return;
    state.projects[p.id] = { ...p, deleted: true, updatedAt: now() };
    $('#projectDialog').close();
    ui.project = null;
    commit();
  });

  // диалоги: закрытие
  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // настройки
  $('#tokenSave').addEventListener('click', () => {
    const t = $('#tokenInput').value.trim();
    if (!t) return $('#tokenInput').focus();
    $('#tokenInput').value = '';
    connectToken(t);
  });
  $('#syncNow').addEventListener('click', () => runSync());
  $('#syncOff').addEventListener('click', () => {
    if (!confirm('Отключить синхронизацию на этом устройстве? Данные останутся и здесь, и в Gist.')) return;
    localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_GIST);
    sync.login = ''; sync.lastAt = 0;
    setSync('off');
  });
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.theme;
    try {
      if (t === 'auto') { localStorage.removeItem(LS_THEME); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem(LS_THEME, t); document.documentElement.dataset.theme = t; }
    } catch (e) {}
    renderSettings();
  }));
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
    try { state = merge(state, normalize(JSON.parse(await f.text()))); commit(); toast('Копия загружена'); }
    catch (err) { toast('Файл не похож на копию Daily'); }
    e.target.value = '';
  });

  // возврат в приложение
  let lastToday = dateKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (dateKey() !== lastToday) { if (ui.day === lastToday) { ui.day = dateKey(); ui.month = ui.day.slice(0, 7); } lastToday = dateKey(); }
    render();
    scheduleSync(200);
  });
  window.addEventListener('online', () => scheduleSync(200));
  window.addEventListener('storage', (e) => { if (e.key === LS_STATE) { state = loadState(); render(); } });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1) || 'cal'; if (VIEWS.includes(v) && v !== ui.view) setView(v); });
}

/* ---------- старт ---------- */
bind();
const startView = location.hash.slice(1);
setView(VIEWS.includes(startView) ? startView : 'cal');
render();
if (token()) runSync();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
