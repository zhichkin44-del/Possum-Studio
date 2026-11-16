// Окно приложения. Всё через window.possum (preload); ключей здесь нет — только маски.
const $ = (s, el = document) => el.querySelector(s);
/** Текст ошибки без служебной приставки Electron «Error invoking remote method '…': Error:». */
const errText = (e) => String(e?.message ?? e ?? '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
const STATUS = { copying: 'копируется', waiting: 'в очереди', working: 'в работе', done: 'готово', notpet: 'не взято', error: 'ошибка' };
const PLAT = { youtube: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram Reels' };
const KIND = { top5: 'Топ-5 моментов', day: 'День из жизни', beforeAfter: 'Сначала и потом', calm: 'Спокойные моменты', asmr: 'АСМР', series: 'Серия' };
// имя файла для людей: без даты в начале, без расширения, без подчёркиваний; полное — во всплывающей подсказке
const nice = (n) => String(n ?? '').replace(/^\d{4}-\d{2}-\d{2}[ _T-]*(\d{2}[.:-]\d{2}([.:-]\d{2})?[ _-]*)?/, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim() || String(n ?? '');
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const api = window.possum;

let jobs = [];
let current = null;
let pair = { role: null, paired: false };
let status = {};
let speciesSt = { name: null, asked: false };
const received = [];

function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === name));
  document.querySelectorAll('.side button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  document.body.classList.toggle('inWizard', name === 'wizard');
  if (name === 'settings') loadSettings();
  if (name === 'calendar') loadCalendar();
  if (name === 'today') loadToday();
  if (name === 'ideas') loadIdeas();
}
document.querySelectorAll('.side button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

const gb = (n) => (n == null ? '' : `${(n / 1e9).toFixed(1)} ГБ`);
const dayName = (s) => { if (!s?.at) return s?.day ?? ''; const d = new Date(s.at); return `${WD[d.getDay()]} ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:00`; };
const eta = (sec) => (sec == null ? '' : sec < 60 ? `≈ ${Math.max(1, Math.round(sec))} с` : `≈ ${Math.round(sec / 60)} мин`);

// ——— Входящие ———
function jobRow(j) {
  const li = document.createElement('li');
  const extra = j.status === 'error' ? `<span class="step bad">${esc(j.error)}</span>` : `<span class="step">${esc(j.step ?? '')}</span>`;
  li.innerHTML = `<span class="badge ${j.status}">${STATUS[j.status] ?? j.status}</span><span class="name" title="${esc(j.name)}">${esc(j.id === 'copying' ? j.name : nice(j.name))}</span>${extra}`;
  if (j.status === 'error') { const b = document.createElement('button'); b.textContent = 'Ещё раз'; b.onclick = () => api.redo(j.id); li.append(b); }
  return li;
}

function renderJobs() {
  // докопируемые файлы — одной строкой, чтобы пачка из 50 видео не растягивала список
  const copy = jobs.filter((j) => j.status === 'copying');
  const rest = jobs.filter((j) => j.status !== 'copying');
  const head = copy.length > 1 ? [{ id: 'copying', status: 'copying', name: `${copy.length} видео`, step: `ждём, пока докопируются: ${copy.slice(0, 3).map((j) => nice(j.name)).join(', ')}${copy.length > 3 ? '…' : ''}` }] : copy;
  const fin = (j) => j.status === 'done' || j.status === 'notpet';
  const active = head.concat(rest.filter((j) => !fin(j)), rest.filter(fin).slice(-10).reverse());
  $('#jobs').replaceChildren(...active.map(jobRow));
  $('#queueEmpty').hidden = jobs.length > 0;
  if (!jobs.some((j) => j.status === 'working' || j.status === 'waiting')) $('#progress').hidden = true;
}

function renderProgress(p) {
  if (!p) return;
  $('#progress').hidden = false;
  $('#pgStage').textContent = `${p.stage ?? 'работаю'}${p.n ? ` · ${Math.min(p.i + 1, p.n)} из ${p.n}` : ''}`;
  $('#pgName').textContent = p.name ?? '';
  $('#pgEta').textContent = eta(p.eta);
  $('#pgBar').style.width = p.n ? `${Math.round(((p.i + 0.5) / p.n) * 100)}%` : '10%';
}

function renderLast(l) {
  const box = $('#lastBox');
  if (!l) { box.hidden = true; return; }
  box.hidden = false;
  const made = l.made ?? [];
  const ref = (l.decisions ?? []).find((d) => d.type === 'reference');
  if (ref) { renderReference(box, l, ref); return; }
  const confirm = (l.decisions ?? []).find((d) => d.type === 'confirm');
  if (confirm?.clips?.length) { renderConfirm(box, l, confirm); return; }
  const head = made.length
    ? `Готово роликов: <b>${made.length}</b>. Разобрано видео: ${l.n}. Посмотрите каждый ролик в календаре.`
    : pair.role === 'partner' && pair.paired ? `Отправлено монтажёру: ${l.n} видео.` : `Разобрано видео: ${l.n}. Новых роликов нет.${l.queued ? ` В календаре уже роликов: <b>${l.queued}</b> — их можно смотреть и выкладывать.` : ''}`;
  // коротко: только то, что требует действия; выбор заголовка и дня — в календаре
  const lines = [];
  for (const c of l.confirmed ?? []) lines.push(esc(c.text));
  const rej = l.rejected ?? [];
  if (rej.length) lines.push(`<details><summary>Не взято видео: ${rej.length} (причина у каждого; если это ваш зверёк — верните)</summary>${rej.map((r) => `<div class="row">${esc(nice(r.name))} — ${esc(r.why ?? 'не ваш зверёк')}${r.id && pair.role !== 'partner' ? ` <button data-mine="${esc(r.id)}">Это мой зверёк</button>` : ''}</div>`).join('')}</details>`);
  else if (l.notPet) lines.push(`Не взято видео: ${l.notPet} — на них не ваш зверёк`);
  for (const d of l.decisions ?? []) if (['disk', 'full', 'more', 'reshoot'].includes(d.type)) lines.push(esc(d.text));
  const missing = (l.decisions ?? []).filter((d) => d.type === 'missing');
  const dec = lines.map((t) => `<li>${t}</li>`).join('') + (missing.length ? `<li><details><summary>Каких видов роликов нет и почему</summary>${missing.map((d) => esc(d.text)).join('<br>')}</details></li>` : '');
  const errs = (l.errors ?? []).map((e) => `<li class="bad">${esc(e.story ?? '')}: ${esc(e.error)}</li>`).join('');
  box.innerHTML = `<h3>Последняя пачка</h3><p>${head}</p>${dec || errs ? `<ul class="decisions">${dec}${errs}</ul>` : ''}${made.length || l.queued ? '<button data-go2="calendar" class="primary">В календарь</button>' : ''}`;
  box.querySelector('[data-go2]')?.addEventListener('click', () => go('calendar'));
  box.querySelectorAll('[data-mine]').forEach((b) => b.addEventListener('click', async () => {
    box.querySelectorAll('[data-mine]').forEach((x) => { x.disabled = true; });
    b.textContent = 'Беру в ролики, пересобираю…';
    try { renderLast(await api.confirmPets({ [b.dataset.mine]: true })); }
    catch (e) { b.insertAdjacentHTML('afterend', `<span class="bad">${esc(errText(e))}</span>`); }
    $('#progress').hidden = true;
  }));
}

// Один раз: 3–5 снимков «вот мой зверёк». Дальше модель узнаёт его сама, человеку — только неуверенные.
function renderReference(box, l, d) {
  box.innerHTML = `<h3>Разобрано видео: ${l.n ?? 0}. Покажите вашего зверька</h3>
    <p>${esc(d.text ?? '')}</p>
    <div class="row"><button class="primary" id="refPick">Выбрать фото или видео</button><span class="hint" id="refMsg"></span></div>`;
  $('#refPick').onclick = async () => {
    $('#refPick').disabled = true;
    $('#refMsg').textContent = 'Запоминаю зверька и пересматриваю видео…';
    try {
      const r = await api.setReference();
      if (!r) { $('#refMsg').textContent = ''; $('#refPick').disabled = false; return; }
      if (r.refused) { $('#refMsg').innerHTML = `<span class="bad">${esc(r.refused)}</span>`; $('#refPick').disabled = false; $('#progress').hidden = true; return; }
      await refresh();
      if (r.failed?.length) $('#lastBox').insertAdjacentHTML('afterbegin', `<p class="hint bad">Не прочитались: ${r.failed.map((f) => esc(nice(f.file ?? f))).join(', ')}</p>`);
    } catch (e) { $('#refMsg').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; $('#refPick').disabled = false; }
    $('#progress').hidden = true;
  };
}

// Вид зверька в подписях называем только после «Да» владельца; до этого — «наш зверёк».
function renderSpecies() {
  const box = $('#speciesBox');
  const ask = (status.species?.refs ?? 0) > 0 && pair.role !== 'partner';
  box.hidden = !ask;
  if (!ask) return;
  const yes = !!speciesSt.name;
  const no = !yes && Boolean(speciesSt.asked);
  const chosen = yes ? '✓ Выбрано: да, сахарный поссум' : no ? '✓ Выбрано: другой зверь' : 'ещё не отмечено';
  box.innerHTML = `<h3>Это сахарный поссум?</h3><p class="hint">Тогда назову вид в подписях и тегах. Пока не ответите — пишу «наш зверёк». Ответ можно поменять.</p>
    <div class="row pets"><button id="spYes"${yes ? ' class="on"' : ''}>Да</button><button id="spNo"${no ? ' class="on"' : ''}>Другой зверь</button><span class="hint">${chosen}</span></div>`;
  const answer = async (name) => {
    try { await api.setSpecies(name); speciesSt = { name: name?.ru ?? null, asked: true }; renderSpecies(); }
    catch (e) { box.insertAdjacentHTML('beforeend', `<p class="bad">${esc(errText(e))}</p>`); }
  };
  $('#spYes').onclick = () => answer({ ru: 'сахарный поссум', en: 'sugar glider', tag: 'сахарныйпоссум' });
  $('#spNo').onclick = () => answer(null);
}

// Видео разобраны, но кто на них — проверяет человек: по листу кадров «Мой зверёк» или «Не он». Потом — сборка.
function renderConfirm(box, l, d) {
  const marks = {};
  box.innerHTML = `<h3>Разобрано видео: ${l.n}. Отметьте, где ваш зверёк</h3>
    <p class="hint">${esc(d.text ?? '')}</p>
    <ul class="pets">${d.clips.map((c) => `<li data-id="${esc(c.id)}">
      ${c.sheet ? `<img src="${fileUrl(c.sheet)}" alt="">` : '<div class="nocover">🐾<small>кадр ещё не готов</small></div>'}
      <span class="name" title="${esc(c.name)}">${esc(nice(c.name))}</span>
      <div class="row"><button data-yes>Мой зверёк</button><button data-no>Не он</button>${c.video ? `<button class="link" data-video>Открыть видео</button>` : ''}</div>
      <span class="picked">ещё не отмечено</span></li>`).join('')}</ul>
    <div class="row"><button class="primary" id="petsGo" disabled>Собрать ролики</button><span class="hint" id="petsLeft"></span></div>`;
  const left = () => {
    const n = d.clips.filter((c) => !(c.id in marks)).length;
    $('#petsGo').disabled = n > 0;
    $('#petsLeft').textContent = n ? `осталось отметить: ${n}` : '';
  };
  box.querySelectorAll('.pets li').forEach((li) => {
    const y = li.querySelector('[data-yes]'); const n = li.querySelector('[data-no]');
    const mark = (yes) => {
      marks[li.dataset.id] = yes;
      y.classList.toggle('on', yes); n.classList.toggle('on', !yes); li.classList.toggle('no', !yes);
      y.textContent = yes ? '✓ Мой зверёк' : 'Мой зверёк'; n.textContent = yes ? 'Не он' : '✓ Не он';
      li.querySelector('.picked').textContent = yes ? 'Выбрано: беру в ролики' : 'Выбрано: не беру';
      left();
    };
    const v = d.clips.find((c) => c.id === li.dataset.id)?.video;
    const vb = li.querySelector('[data-video]'); if (vb && v) vb.onclick = () => api.open(v);
    li.querySelector('[data-yes]').onclick = () => mark(true);
    li.querySelector('[data-no]').onclick = () => mark(false);
  });
  $('#petsGo').onclick = async () => {
    box.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    $('#petsLeft').textContent = 'Собираю ролики…';
    try { renderLast(await api.confirmPets(marks)); } catch (e) { $('#petsLeft').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; left(); box.querySelectorAll('.pets button').forEach((x) => { x.disabled = false; }); }
    $('#progress').hidden = true;
  };
  left();
}

function renderStatus(s) {
  status = s ?? {};
  if (!s) { $('#status').textContent = ''; return; }
  const rows = [['claude', 'ИИ'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['ffmpeg', 'Монтаж']];
  // ● — подключено, ○ — нет; подключается в «Настройках»
  $('#status').innerHTML = rows.map(([k, t]) => `<div class="${s[k] ? 'yes' : ''}" title="${t}: ${s[k] ? 'подключено' : 'не подключено — подключите в Настройках'}">${t}</div>`).join('') + '<p class="legend">● подключено · ○ нет — подключите в Настройках</p>';
}

function renderPair(p) {
  pair = p ?? pair;
  const who = pair.role === 'owner' ? 'с напарницей' : pair.role === 'partner' ? 'с монтажёром' : null;
  const line = !who ? 'Работаю один' : pair.paired ? `Связь ${who}: есть` : `Связь ${who}: ждёт кода`;
  $('#pairLine').textContent = line;
  $('#pairLine').classList.toggle('solo', !who);
  $('#pairInfo').textContent = !who ? 'Пара не настроена — приложение работает одно.' : `${line}. Общая папка: ${pair.sharedDir ?? '—'}`;
  $('#pairAgain').textContent = who ? 'Настроить пару заново' : 'Настроить пару';
  // у напарницы нет выкладки и настроек площадок: монтирует и выкладывает монтажёр
  const partner = pair.role === 'partner';
  $('#pairAgain').hidden = partner && pair.paired;
  $('#partnerHint').hidden = !partner;
  document.querySelectorAll('.ownerOnly').forEach((el) => { el.hidden = partner; });
  $('[data-go="calendar"]').hidden = partner;
  $('[data-go="settings"]').hidden = partner && pair.paired; // соединённой напарнице настраивать нечего
  $('#navFrom').hidden = !partner;
  $('#add').textContent = pair.role === 'partner' && pair.paired ? 'Отправить видео монтажёру' : 'Добавить видео';
  $('#addName').textContent = `«${$('#add').textContent}»`;
  $('#addTail').textContent = partner && pair.paired ? 'видео уйдут ему сами' : 'разбор начнётся сам';
  $('#status').hidden = partner; // Claude, YouTube, TikTok настраивает только монтажёр
}

async function refresh() {
  const st = await api.state();
  jobs = st.jobs;
  // полный путь — только во всплывающей подсказке: на экране он длинный и пугает; папку открывает кнопка «Открыть папку»
  const toOwner = st.pair?.role === 'partner' && st.pair?.paired;
  $('#inHint').textContent = toOwner ? 'Видео уходят монтажёру сами.' : `Всё снятое — здесь${st.disk != null ? ` · свободно на диске ${gb(st.disk)}` : ''}`;
  $('#inHint').title = st.inDir ?? '';
  $('#startError').hidden = !st.error;
  $('#startError').textContent = st.error ? `Студия не запустилась: ${st.error}` : '';
  renderStatus(st.status);
  renderPair(st.pair);
  speciesSt = st.species ?? speciesSt;
  renderSpecies();
  renderJobs();
  renderLast(st.last);
  if (!st.wizardDone && !st.error) go('wizard');
  return st;
}

// ——— Что снять сегодня ———
let todayBusy = false;
function renderToday({ scenario: s, coverage: c }) {
  const shots = c?.shots ?? s.shots;
  const done = c?.done ?? 0;
  $('#todayCard').innerHTML = `
    <h3>${esc(s.title)}</h3>
    <p class="hint">${esc(KIND[s.kind] ?? s.kind)} · крючок: «${esc(s.hook)}» · ${s.source === 'ИИ' ? 'сценарий написал ИИ' : 'сценарий по шаблону'}</p>
    ${s.fallbackReason ? `<p class="hint">${esc(s.fallbackReason)}</p>` : ''}
    <p><b class="${done === shots.length && shots.length ? 'ok' : ''}">Снято ${done} из ${shots.length}</b>${c?.missing?.length ? ` · не хватает: ${c.missing.map((n) => `№${n}`).join(', ')}` : ''}</p>
    <ol class="shots">${shots.map((x) => `<li class="${x.have ? 'have' : ''}">
      <div><b>${x.have ? '✓' : '○'} ${esc(x.what)}</b> <span class="hint">· ${esc(x.secs)}</span></div>
      <div class="hint">Угол: ${esc(x.angle)}</div>
      <div class="hint">Свет: ${esc(x.light)}</div>
    </li>`).join('')}</ol>
    <p class="note">${esc(s.note)}</p>
    <p class="hint">Снятое закидывай в «Отснятое» — галочки встанут сами, монтаж пойдёт по порядку кадров.</p>`;
}
async function loadToday(refresh = false) {
  if (todayBusy) return;
  todayBusy = true;
  try { renderToday(await api.today(refresh)); }
  catch (e) { $('#todayCard').innerHTML = `<p class="bad">Сценарий не получился: ${esc(e?.message ?? e)}</p>`; }
  finally { todayBusy = false; }
}
$('#todayNew').onclick = () => loadToday(true);

// ——— Идеи и советы: каталог сюжетов + наставник ———
let cat = null;      // каталог из core/ideas.js
let catFilter = 'all';
const chat = [];     // [{q, a}] — только в окне, на диск не пишем
const lis = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
function ideaCard(i, open = false) {
  return `<details class="card idea" id="idea-${esc(i.id)}"${open ? ' open' : ''}>
    <summary><b>${esc(i.title)}</b> <span class="hint">· ${esc(KIND[i.kind] ?? i.kind)} · «${esc(i.hook)}»</span></summary>
    <p>${esc(i.why)}</p>
    <h4>Кадры по порядку</h4>
    <ol class="shots">${i.shots.map((s) => `<li><div><b>${esc(s.what)}</b> <span class="hint">· ${esc(s.secs)}</span></div><div class="hint">Угол: ${esc(s.angle)}</div></li>`).join('')}</ol>
    <p class="hint">Свет на всех кадрах: ${esc(i.shots[0]?.light ?? '')}</p>
    <h4>Как снимать</h4>${lis(i.how)}
    <h4>Как выложить</h4>
    <p>Подпись: «${esc(i.post.caption)}»</p><p class="hint">${esc(i.post.format)}</p>
    <div class="bw"><div class="better"><h4>Так лучше</h4>${lis(i.better)}</div><div class="worse"><h4>Так хуже</h4>${lis(i.worse)}</div></div>
    <p class="note">${esc(i.welfare)}</p>
  </details>`;
}
function renderIdeas() {
  const cats = [['all', 'Все'], ...cat.categories];
  $('#ideaCats').innerHTML = cats.map(([id, label]) => `<button data-cat="${esc(id)}" class="${id === catFilter ? 'on' : ''}">${esc(label)}</button>`).join('');
  const list = cat.ideas.filter((i) => catFilter === 'all' || i.cat === catFilter);
  $('#ideaList').innerHTML = list.map((i) => ideaCard(i)).join('') || '<p class="hint">В этой теме пока пусто.</p>';
  const nc = cat.noCostume;
  $('#ideaRules').innerHTML = `
    <div class="card no"><h3>${esc(nc.title)}</h3><p>${esc(nc.why)}</p><h4>Вместо этого</h4>${lis(nc.instead)}</div>
    <details class="card"><summary><b>Чем угощать — и чем нельзя</b></summary>
      <p class="hint">Крошечный кусочек, мельче горошины, вместо части обычного ужина. Вымыть и порезать.</p>
      <div class="bw"><div class="better"><h4>Можно</h4>${lis(cat.safe)}</div><div class="worse"><h4>Нельзя никогда</h4>${lis(cat.forbidden)}</div></div>
    </details>
    <details class="card"><summary><b>Как вести TikTok, Reels, Shorts</b></summary>
      ${cat.posting.map((p) => `<h4>${esc(p.title)}</h4><div class="bw"><div class="better"><p>${esc(p.better)}</p></div><div class="worse"><p>${esc(p.worse)}</p></div></div>`).join('')}
    </details>`;
}
async function loadIdeas() {
  if (cat) return;
  try { cat = await api.ideas(); renderIdeas(); }
  catch (e) { $('#ideaList').innerHTML = `<p class="bad">Идеи не загрузились: ${esc(errText(e))}</p>`; }
}
$('#ideaCats').onclick = (ev) => { const b = ev.target.closest('button[data-cat]'); if (!b || !cat) return; catFilter = b.dataset.cat; renderIdeas(); };
function openIdea(id) {
  if (!cat) return;
  if (catFilter !== 'all' && !cat.ideas.some((i) => i.id === id && i.cat === catFilter)) { catFilter = 'all'; renderIdeas(); }
  const el = document.getElementById(`idea-${id}`);
  if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function renderChat() {
  const title = (id) => cat?.ideas.find((i) => i.id === id)?.title ?? id;
  $('#askLog').innerHTML = chat.map((m) => `<div class="q">${esc(m.q)}</div><div class="a">${m.a == null ? '<span class="hint">думаю…</span>' : `<pre>${esc(m.a)}</pre>${(m.ideaIds ?? []).length ? `<div class="row">${m.ideaIds.map((id) => `<button data-idea="${esc(id)}">Открыть идею: ${esc(title(id))}</button>`).join('')}</div>` : ''}${m.source === 'catalog' ? '<p class="hint">Наставник отдыхает — вот проверенные советы.</p>' : ''}`}</div>`).join('');
}
$('#askLog').onclick = (ev) => { const b = ev.target.closest('button[data-idea]'); if (b) openIdea(b.dataset.idea); };
$('#askForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const q = $('#askQ').value.trim();
  if (!q || $('#askGo').disabled) return;
  $('#askGo').disabled = true; $('#askQ').value = '';
  const history = chat.filter((m) => m.a != null).slice(-4).map(({ q: hq, a }) => ({ q: hq, a }));
  const m = { q, a: null }; chat.push(m); renderChat();
  try { await loadIdeas(); const r = await api.mentor(q, history); Object.assign(m, { a: r.answer, ideaIds: r.ideaIds, source: r.source }); }
  catch (e) { m.a = `Не получилось ответить: ${errText(e)}`; }
  finally { $('#askGo').disabled = false; renderChat(); }
};

// ——— Календарь ———
function slotCard(s, past = false) {
  const li = document.createElement('li');
  const pick = s.pick ?? 'A';
  const t = s.titles ?? {};
  const state = s.status === 'published' ? '<span class="badge done">выложено</span>' : s.status === 'skipped' ? '<span class="badge">пропущено</span>' : s.needsReview ? '<span class="badge working">посмотрите</span>' : '<span class="badge done">готово</span>';
  li.innerHTML = `
    ${s.cover ? `<img src="${fileUrl(s.cover)}" alt="">` : '<div class="nocover">🐾<small>кадр ещё не готов</small></div>'}
    <div class="sbody">
      <div class="row"><b>${esc(dayName(s))}</b><span class="kind">${esc(KIND[s.kind] ?? s.kind)}</span>${state}${!past && s.textsSource !== 'claude' ? '<span class="badge working" title="Тексты этого ролика собраны по шаблону (Claude их не писал) — проверьте перед выкладкой">тексты по шаблону</span>' : ''}</div>
      ${t.A?.ru ? `<div class="titles">${['A', 'B'].filter((k) => t[k]?.ru).map((k) => `<label class="${pick === k ? 'on' : ''}"><input type="radio" name="t-${esc(s.id)}" value="${k}" ${pick === k ? 'checked' : ''} ${past ? 'disabled' : ''}> ${k}: ${esc(t[k].ru)}</label>`).join('')}</div>` : ''}
      ${s.why ? `<p class="hint">${esc(s.why)}</p>` : ''}
      ${past ? '' : '<div class="row"><button class="primary" data-open>Посмотреть перед выкладкой</button><button data-skip>Не выкладывать</button></div>'}
    </div>`;
  li.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', async () => { await api.pickTitle(s.id, r.value); loadCalendar(); }));
  li.querySelector('[data-open]')?.addEventListener('click', () => openSlot(s.id));
  li.querySelector('[data-skip]')?.addEventListener('click', async () => { await api.skip(s.id); loadCalendar(); });
  return li;
}

async function loadCalendar() {
  try {
    const c = await api.calendar();
    $('#slots').replaceChildren(...c.slots.map((s) => slotCard(s)));
    $('#hist').replaceChildren(...c.history.map((s) => slotCard(s, true)));
    $('#histBox').hidden = !c.history.length;
    $('#calEmpty').hidden = c.slots.length > 0;
    $('#calHint').textContent = `Один ролик в день, в ${c.hour}:00. Свободных дней в ближайшие две недели: ${c.free}. Выкладка — только по кнопке «Выложить».`;
  } catch (e) { $('#calHint').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
}

const watched = new Set(); // ролики, досмотренные до конца в этом запуске
async function openSlot(id) {
  let r;
  try { r = await api.slot(id); } catch (e) { alert(e.message); return; }
  const { slot, manifest, done } = r;
  current = id;
  $('#clipName').textContent = `${KIND[slot.kind] ?? slot.kind} · ${dayName(slot)}`;
  const body = $('#clipBody');
  if (!manifest) { body.innerHTML = '<p class="error">Файлы монтажа не найдены. Закиньте видео ещё раз.</p>'; go('clip'); return; }
  const p = manifest.packages ?? {};
  const pick = slot.pick ?? manifest.pick ?? 'A';
  // значок площадки: подключено ли (YouTube и TikTok — вход в Настройках; Instagram — всегда вручную)
  const ready = (plat) => plat === 'instagram' || Boolean(status[plat]);
  const mark = (plat) => (done?.[plat] || plat === 'instagram' ? '' : ready(plat) ? ' <span class="badge done">готово</span>' : ' <span class="badge">подключите в Настройках</span>');
  const btn = (plat) => `<button data-pub="${plat}" ${done?.[plat] ? 'disabled data-done="1"' : ready(plat) ? '' : 'disabled data-done="1" title="Подключите в Настройках"'}>${done?.[plat] ? `${PLAT[plat]}: уже выложено` : plat === 'tiktok' ? 'TikTok — в черновики' : plat === 'instagram' ? 'Instagram: скопировать подпись и открыть папку' : 'Выложить в YouTube'}${mark(plat)}</button>`;
  const review = slot.needsReview && !done?.youtube && !done?.tiktok && !done?.instagram;
  const draft = manifest.texts?.source !== 'claude' && !done?.youtube && !done?.tiktok && !done?.instagram;
  // главная кнопка — только на подключённые площадки; остальным — подсказка
  const readyList = Object.keys(PLAT).filter((k) => k !== 'instagram' && !done?.[k] && ready(k));
  const notReady = Object.keys(PLAT).filter((k) => !done?.[k] && !ready(k));
  body.innerHTML = `
    <div class="clipgrid">
      <video src="${fileUrl(manifest.outputs?.youtube)}" ${manifest.cover ? `poster="${fileUrl(manifest.cover)}"` : ''} controls preload="metadata"></video>
      <div>
        ${draft || review ? `<div class="note"><p>Проверьте перед выкладкой: ${[draft ? esc(manifest.texts?.reason ?? 'тексты собраны по шаблону') : '', review ? esc(slot.needsReview) : ''].filter(Boolean).join('; ')}.</p>${review ? '<p>Плохой момент — «Убрать» в списке ниже; плохой весь ролик — <button id="skipClip">Не выкладывать</button></p>' : ''}</div>` : ''}${manifest.sources?.length ? `<details class="moments" ${review ? 'open' : ''}><summary>Моменты ролика: ${manifest.sources.length} (клик — перемотка)</summary><ol>${manifest.sources.map((s, k) => `<li><button data-at="${esc(s.at)}">${esc(s.at)}–${esc(s.to)} · «${esc(nice(s.file))}»</button>${manifest.sources.length > 1 ? ` <button class="rm" data-rm="${k}" title="Убрать этот момент и пересобрать ролик">Убрать</button>` : ''}</li>`).join('')}</ol></details>` : ''}${review ? `<label class="checkline"><input type="checkbox" id="seen" ${watched.has(id) ? '' : 'disabled'}> На всех кадрах наш зверёк, он спокоен — без этой галочки кнопки выкладки выключены <span class="hint" id="seenHint" ${watched.has(id) ? 'hidden' : ''}>(галочка включится, когда досмотрите ролик до конца)</span></label>` : ''}
        <div class="card"><h3>Совет: ${esc(manifest.advice?.verdict)}</h3><div>${esc(manifest.advice?.why ?? slot.why)}</div>
          ${manifest.welfare?.length ? `<ul class="care">${manifest.welfare.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card"><h3>Заголовок</h3><div class="titles">${['A', 'B'].filter((k) => slot.titles?.[k]?.ru).map((k) => `<label class="${pick === k ? 'on' : ''}"><input type="radio" name="clipTitle" value="${k}" ${pick === k ? 'checked' : ''}> ${k}: ${esc(slot.titles[k].ru)}</label>`).join('')}</div></div>
        <div class="row">${Object.keys(PLAT).map(btn).join('')}</div>
        <div class="row"><button class="primary" id="pubAll" ${readyList.length ? '' : 'disabled data-done="1"'}>${readyList.length ? `Выложить: ${readyList.map((k) => PLAT[k]).join(', ')}` : notReady.length ? 'Выложить — сначала подключите площадку' : 'Всё выложено'}</button><button id="openDir">Папка ролика</button>${review ? '' : '<button id="skipClip">Не выкладывать</button>'}</div>
        <p class="hint">${notReady.length ? `${notReady.map((k) => PLAT[k]).join(' и ')}: подключите в Настройках. ` : ''}Перед отправкой спрошу подтверждение; в Instagram — вручную.</p>
        <ul class="results" id="results"></ul>
      </div>
    </div>
    <details class="card"><summary>Подписи к площадкам…</summary>
      <h3>YouTube</h3><pre>${esc(p.youtube?.title)}\n\n${esc(p.youtube?.description)}</pre>
      <h3>TikTok</h3><pre>${esc(p.tiktok?.caption)}</pre>
      <h3>Instagram</h3><pre>${esc(p.instagram?.caption)}</pre>
    </details>
    ${manifest.music?.file ? '<p class="hint">Музыка подобрана из вашей папки.</p>' : ''}`;
  // пункт списка моментов перематывает ролик на этот момент
  body.querySelectorAll('[data-at]').forEach((b) => b.addEventListener('click', () => { const v = body.querySelector('video'); const [m, s] = String(b.dataset.at).split(':').map(Number); v.currentTime = (m || 0) * 60 + (s || 0); v.play().catch(() => {}); }));
  body.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', () => publish([b.dataset.pub])));
  body.querySelectorAll('input[name=clipTitle]').forEach((r) => r.addEventListener('change', async () => { await api.pickTitle(id, r.value); openSlot(id); }));
  $('#pubAll').onclick = () => publish(readyList);
  if (review) {
    // пока человек не отметил, что посмотрел ролик, выкладка выключена
    const gate = () => body.querySelectorAll('[data-pub]:not([data-done]), #pubAll:not([data-done])').forEach((x) => { x.disabled = !$('#seen').checked; });
    $('#seen').addEventListener('change', gate);
    // галочку можно поставить только после досмотра до конца
    body.querySelector('video').addEventListener('ended', () => { watched.add(id); $('#seen').disabled = false; $('#seenHint').hidden = true; });
    gate();
  }
  $('#openDir').onclick = () => api.open(slot.dir);
  const skipBtn = $('#skipClip');
  if (skipBtn) { skipBtn.hidden = Boolean(done?.youtube || done?.tiktok || done?.instagram); skipBtn.onclick = async () => { await api.skip(id); go('calendar'); }; }
  // «Убрать» — момент без зверька: приложение ставит другой и пересобирает ролик
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const k = Number(b.dataset.rm);
    if (!confirm(`Убрать момент ${k + 1} и пересобрать ролик? Это займёт до минуты.`)) return;
    body.querySelectorAll('[data-rm]').forEach((x) => { x.disabled = true; });
    b.textContent = 'Пересобираю…';
    try { await api.removeMoment(id, k); watched.delete(id); openSlot(id); } catch (e) { alert(e.message); openSlot(id); }
  }));
  go('clip');
}

function resultLine(r) {
  const name = PLAT[r.platform] ?? r.platform;
  if (r.error) return `<li class="bad">${name}: не вышло — ${esc(r.error)}</li>`;
  if (r.skipped) return `<li>${name}: ${esc(r.note ?? 'уже было')}</li>`;
  if (r.manual) return `<li>${name}: выкладка вручную, подпись уже в буфере обмена<pre>${(r.steps ?? []).map((s, i) => `${i + 1}. ${esc(s)}`).join('\n')}</pre></li>`;
  if (r.url) return `<li class="ok">${name}: выложено — <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></li>`;
  return `<li class="ok">${name}: ${esc(r.note ?? 'готово')}</li>`;
}

async function publish(platforms) {
  if (!current || !platforms.length) return;
  const box = $('#results');
  // пока идёт выкладка, кнопки выключены: двойной клик не выложит дважды
  const btns = [...document.querySelectorAll('[data-pub], #pubAll')];
  btns.forEach((x) => { x.disabled = true; });
  box.innerHTML = '<li>Жду подтверждения…</li>';
  try {
    const res = await api.publish(current, platforms);
    if (res[0]?.cancelled) { box.innerHTML = '<li>Отменено — ничего не выложено.</li>'; return; }
    box.innerHTML = res.map(resultLine).join('');
    res.forEach((r) => { if (r.id || r.skipped) document.querySelector(`[data-pub="${r.platform}"]`)?.setAttribute('data-done', '1'); });
  } catch (e) { box.innerHTML = `<li class="bad">${esc(errText(e))}</li>`; }
  finally { btns.forEach((x) => { x.disabled = x.dataset.done === '1' || ($('#seen') && !$('#seen').checked); }); }
}

// ——— Мастер первого запуска ———
let wzRole = null;
document.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => {
  wzRole = b.dataset.role;
  try {
    const p = await api.pairSetup(wzRole);
    if (!p.sharedDir) { $('#wzMsg').textContent = 'Папка не выбрана — выберите общую папку, чтобы соединиться.'; $('#wzCode').hidden = false; return; }
    renderPair(p);
    $('#wzRole').hidden = true;
    $('#wzCode').hidden = false;
    $('#wzOwner').hidden = wzRole !== 'owner';
    $('#wzPartner').hidden = wzRole !== 'partner';
    $('#wzMsg').textContent = `Общая папка «${p.sharedDir.split(/[\\/]/).filter(Boolean).pop()}» выбрана.`;
    $('#wzMsg').title = p.sharedDir;
  } catch (e) { $('#wzMsg').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; $('#wzCode').hidden = false; }
}));
$('#wzCreate').onclick = async () => {
  try { const r = await api.pairCreate(); $('#wzCodeOut').textContent = r.code; $('#wzMsg').textContent = 'Продиктуйте код напарнице. Когда она его введёт, внизу слева появится «соединено».'; }
  catch (e) { $('#wzMsg').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
};
$('#wzJoin').onclick = async () => {
  try { const p = await api.pairJoin($('#wzCodeIn').value.trim()); renderPair(p); $('#wzCodeIn').value = ''; $('#wzPartner').hidden = true; $('#wzMsg').innerHTML = '<span class="ok">Соединено. Теперь нажмите «Отправить видео монтажёру» — видео уйдут ему сами.</span>'; }
  catch (e) { $('#wzMsg').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
};
// Шаг «Ключ ИИ» — только для того, кто выкладывает (владелец или «один»). Напарнице ключ не нужен.
const usd = (x) => (x < 0.01 ? `меньше цента` : `${x.toFixed(2)}`);
async function keyStep() {
  $('#wzRole').hidden = true; $('#wzCode').hidden = true; $('#wzKey').hidden = false;
  $('#wzKeyMsg').textContent = ''; $('#wzKeyIn').value = '';
  const c = await api.aiPrice().catch(() => null);
  $('#wzKeyCost').textContent = c
    ? `Расход по прайсу ${c.model} (${c.priceIn} за 1 млн токенов на вход, ${c.priceOut} на выход): обычно около ${usd(c.perClip)} за тексты к одному ролику, не больше ${usd(c.perClipMax)}. Ролик в день — около ${usd(c.perClip * 30)} в месяц.`
    : 'Прайс выбранной модели в приложении не задан — расход покажет сайт, где взят ключ.';
  setTimeout(() => $('#wzKeyIn').focus(), 0);
}
function keyDone() { $('#wzKey').hidden = true; $('#wzRole').hidden = false; go('today'); refresh(); }
$('#wzKeySave').onclick = async () => {
  const key = $('#wzKeyIn').value.trim();
  if (!key) { $('#wzKeyMsg').innerHTML = '<span class="bad">Вставьте ключ или нажмите «Позже».</span>'; return; }
  try {
    const res = await api.saveSettings({ claudeKey: key });
    if (res?.warning) { $('#wzKeyMsg').innerHTML = `<span class="bad">${esc(res.warning)}</span>`; return; }
    keyDone();
  }
  catch (e) { $('#wzKeyMsg').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
  finally { $('#wzKeyIn').value = ''; } // ключ в поле не держим: ни после сохранения, ни при «не сохранён» (NO_CRYPTO), ни при ошибке
};
$('#wzKeyIn').onkeydown = (e) => { if (e.key === 'Enter') $('#wzKeySave').click(); };
$('#wzKeyLater').onclick = keyDone;
$('#wzSolo').onclick = async () => { await api.solo(); keyStep(); };
$('#wzFinish').onclick = () => { if (wzRole === 'partner') { go('today'); refresh(); } else keyStep(); };
$('#pairAgain').onclick = () => { $('#wzRole').hidden = false; $('#wzCode').hidden = true; $('#wzKey').hidden = true; $('#wzCodeOut').textContent = ''; $('#wzMsg').textContent = ''; go('wizard'); };

// ——— Настройки ———
const get = PossumForm.getPath; // логика формы — в form.js, её проверяет test/form.test.js

async function loadSettings() {
  try {
    const s = await api.settings();
    for (const el of $('#form').elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = Boolean(get(s, el.name));
      else { el.value = get(s, el.name) ?? ''; el.dataset.had = el.value; }
    }
    if (s.warning) $('#saved').innerHTML = `<span class="bad">${esc(s.warning)}</span>`;
    const st = await api.state();
    renderPair(st.pair);
    for (const k of ['youtube', 'tiktok']) $(`[data-state="${k}"]`).innerHTML = st.status?.[k] ? '<span class="ok">подключено</span>' : 'не подключено';
  } catch (e) { $('#saved').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // маску ключа «•••abcd» не шлём; поле, которое очистили, шлём пустым — это «удалить» (dataset.had — что было при открытии)
  const patch = PossumForm.formPatch([...e.target.elements].map((el) => ({ name: el.name, type: el.type, value: el.value, had: el.dataset.had })));
  try {
    const res = await api.saveSettings(patch);
    $('#saved').innerHTML = res?.warning ? `<span class="bad">${esc(res.warning)}</span>` : '<span class="ok">Сохранено</span>';
    loadSettings(); refresh();
  }
  catch (err) { $('#saved').innerHTML = `<span class="bad">${esc(errText(err))}</span>`; }
});

document.querySelectorAll('[data-connect]').forEach((b) => b.addEventListener('click', async () => {
  const kind = b.dataset.connect;
  const out = $(`[data-state="${kind}"]`);
  out.textContent = 'Открыл браузер — войдите и разрешите доступ…';
  try { await api.connect(kind); out.innerHTML = '<span class="ok">подключено</span>'; refresh(); }
  catch (e) { out.innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
}));

// ——— Готовые от монтажёра (у напарницы) ———
function renderReceived() {
  $('#fromList').replaceChildren(...received.slice(-30).reverse().map((n) => { const li = document.createElement('li'); li.innerHTML = `<span class="badge done">новое</span><span class="name" title="${esc(n)}">${esc(n)}</span>`; return li; }));
}

$('#add').onclick = () => api.pick().catch((e) => copyDone({ end: true, error: e.message }));

// ——— Перетаскивание видео и папок в окно ———
// Бросить можно в любое место окна: откроются «Входящие». Пока копируется — кнопка «Добавить видео» неактивна.
let copyTimer = null;
function copyDone(p) {
  $('#add').disabled = false;
  $('#cpBar').style.width = '100%';
  $('#cpTitle').textContent = p.error ? 'Не удалось скопировать' : p.none ? 'Видео не найдено' : 'Скопировано';
  $('#cpName').textContent = p.error ? p.error : p.none ? 'в брошенном нет видеофайлов (mp4, mov и др.)' : (p.same ? `повторы пропущены: ${p.same}` : '');
  $('#cpCount').textContent = p.none || p.error ? '' : `новых видео: ${p.copied ?? p.done}`;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $('#copyBox').hidden = true; }, p.error || p.none ? 12000 : 5000);
}
api.onCopy((p) => {
  if (p.end) return copyDone(p);
  clearTimeout(copyTimer);
  $('#copyBox').hidden = false;
  $('#add').disabled = true;
  $('#cpTitle').textContent = 'Копирую видео в «Отснятое»';
  $('#cpName').textContent = nice(p.name);
  $('#cpCount').textContent = `${Math.min(p.done + 1, p.total)} из ${p.total}${p.bytesTotal ? ` · ${gb(p.bytesDone)} из ${gb(p.bytesTotal)}` : ''}`;
  $('#cpBar').style.width = `${p.bytesTotal ? Math.round((100 * p.bytesDone) / p.bytesTotal) : 0}%`;
});
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || document.body.classList.contains('inWizard')) return;
  e.preventDefault(); dragDepth++;
  if (!$('#queue').classList.contains('on')) go('queue');
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = $('#add').disabled ? 'none' : 'copy'; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if ($('#add').disabled || document.body.classList.contains('inWizard')) return;
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api.pathOf(f)).filter(Boolean);
  if (paths.length) api.addPaths(paths).catch((err) => copyDone({ end: true, error: err.message }));
});
$('#openIn').onclick = () => api.open('in');
$('#openOut').onclick = () => api.open('out');
$('#openFrom').onclick = () => api.open('from');
$('#back').onclick = () => go('calendar');

api.onJobs((list) => { jobs = list; renderJobs(); });
api.onProgress(renderProgress);
api.onBatch((l) => { renderLast(l); $('#progress').hidden = true; if ($('#calendar').classList.contains('on')) loadCalendar(); if ($('#today').classList.contains('on')) loadToday(); });
api.onReceived((names) => {
  if (pair.role === 'partner') { received.push(...names); renderReceived(); }
  api.pairStatus().then(renderPair).catch(() => {});
});
setInterval(() => { if (!pair.paired && pair.role) api.pairStatus().then(renderPair).catch(() => {}); }, 5000);
refresh().then((st) => { if (!st?.error && $('#today').classList.contains('on')) loadToday(); });
