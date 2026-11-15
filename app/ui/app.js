// Окно приложения. Всё через window.possum (preload); ключей здесь нет — только маски.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
const STATUS = { waiting: 'в очереди', working: 'монтирую', done: 'готово', error: 'ошибка' };
const PLAT = { youtube: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram Reels' };
const OUT = { youtube: 'youtube', tiktok: 'tiktok', instagram: 'reels' };

let jobs = [];
let current = null;

function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === name));
  document.querySelectorAll('.side button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  if (name === 'settings') loadSettings();
}
document.querySelectorAll('.side button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

function jobRow(j) {
  const li = document.createElement('li');
  const extra = j.status === 'done' && j.verdict ? `<span class="verdict">Совет: ${esc(j.verdict)}</span>`
    : j.status === 'error' ? `<span class="step bad">${esc(j.error)}</span>`
    : `<span class="step">${esc(j.step ?? '')}</span>`;
  li.innerHTML = `<span class="badge ${j.status}">${STATUS[j.status] ?? j.status}</span><span class="name">${esc(j.name)}</span>${extra}`;
  if (j.status === 'done') { const b = document.createElement('button'); b.textContent = 'Открыть'; b.onclick = () => openClip(j.id); li.append(b); }
  if (j.status === 'error') { const b = document.createElement('button'); b.textContent = 'Переделать'; b.onclick = () => window.possum.redo(j.id); li.append(b); }
  return li;
}

function renderJobs() {
  const active = jobs.filter((j) => j.status !== 'done');
  const done = jobs.filter((j) => j.status === 'done');
  $('#jobs').replaceChildren(...active.map(jobRow));
  $('#doneList').replaceChildren(...done.map(jobRow));
  $('#queueEmpty').hidden = active.length > 0;
  $('#doneEmpty').hidden = done.length > 0;
}

function renderStatus(s) {
  if (!s) { $('#status').textContent = ''; return; }
  const rows = [['claude', 'Claude'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['ffmpeg', 'Монтаж (ffmpeg)']];
  $('#status').innerHTML = rows.map(([k, t]) => `<div class="${s[k] ? 'yes' : ''}">${t}</div>`).join('');
}

async function refresh() {
  const st = await window.possum.state();
  jobs = st.jobs;
  $('#inHint').textContent = `Папка: ${st.inDir}`;
  $('#startError').hidden = !st.error;
  $('#startError').textContent = st.error ? `Студия не запустилась: ${st.error}` : '';
  renderStatus(st.status);
  renderJobs();
}

async function openClip(id) {
  const { job, manifest, done } = await window.possum.job(id);
  current = id;
  $('#clipName').textContent = job?.name ?? '';
  const body = $('#clipBody');
  if (!manifest) { body.innerHTML = '<p class="error">Файлы монтажа не найдены. Нажми «Переделать» в списке.</p>'; go('clip'); return; }
  const p = manifest.packages ?? {};
  const figs = Object.entries(OUT).map(([plat, key]) => `
    <figure>
      <video src="${fileUrl(manifest.outputs[key])}" controls preload="metadata"></video>
      <figcaption><span>${PLAT[plat]}</span>
        <button data-pub="${plat}" ${done?.[plat] ? 'disabled' : ''}>${done?.[plat] ? 'Уже выложено' : plat === 'tiktok' ? 'В черновики' : 'Выложить'}</button>
      </figcaption>
    </figure>`).join('');
  body.innerHTML = `
    <div class="card"><h3>Совет: ${esc(manifest.advice?.verdict)}</h3><div>${esc(manifest.advice?.why)}</div>
      ${manifest.welfare?.length ? `<pre>Забота о зверьке:\n${manifest.welfare.map((w) => '• ' + esc(w)).join('\n')}</pre>` : ''}</div>
    <div class="clips">${figs}</div>
    <div class="row"><button class="primary" id="pubAll">Выложить везде</button><button id="openDir">Открыть папку ролика</button><button id="redoClip">Переделать</button></div>
    <ul class="results" id="results"></ul>
    <div class="card"><h3>YouTube</h3><pre>${esc(p.youtube?.title)}\n\n${esc(p.youtube?.description)}</pre></div>
    <div class="card"><h3>TikTok</h3><pre>${esc(p.tiktok?.caption)}</pre></div>
    <div class="card"><h3>Instagram</h3><pre>${esc(p.instagram?.caption)}</pre></div>
    <p class="hint">Тексты: ${esc(manifest.texts?.source)}${manifest.music?.file ? ' · музыка подобрана' : ''}</p>`;
  body.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', () => publish([b.dataset.pub])));
  $('#pubAll').onclick = () => publish(Object.keys(PLAT).filter((k) => !done?.[k]));
  $('#openDir').onclick = () => window.possum.open(manifest.dir ?? job.dir);
  $('#redoClip').onclick = async () => { await window.possum.redo(id); go('queue'); refresh(); };
  go('clip');
}

function resultLine(r) {
  const name = PLAT[r.platform] ?? r.platform;
  if (r.error) return `<li class="bad">${name}: не вышло — ${esc(r.error)}</li>`;
  if (r.skipped) return `<li>${name}: ${esc(r.note ?? 'уже было')}</li>`;
  if (r.manual) return `<li>${name}: выкладка вручную<pre>${(r.steps ?? []).map((s, i) => `${i + 1}. ${esc(s)}`).join('\n')}\n\nПодпись:\n${esc(r.caption)}</pre></li>`;
  if (r.url) return `<li class="ok">${name}: выложено — <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></li>`;
  return `<li class="ok">${name}: ${esc(r.note ?? 'готово')}</li>`;
}

async function publish(platforms) {
  if (!current || !platforms.length) return;
  const box = $('#results');
  // пока идёт выкладка, кнопки выключены: двойной клик не выложит дважды
  const btns = [...document.querySelectorAll('[data-pub], #pubAll')];
  const was = btns.map((x) => x.disabled);
  btns.forEach((x) => { x.disabled = true; });
  box.innerHTML = '<li>Выкладываю…</li>';
  try {
    const res = await window.possum.publish(current, platforms);
    if (res[0]?.cancelled) { box.innerHTML = '<li>Отменено — ничего не выложено.</li>'; return; }
    box.innerHTML = res.map(resultLine).join('');
    res.forEach((r) => { if (r.id || r.skipped) document.querySelector(`[data-pub="${r.platform}"]`)?.setAttribute('data-done', '1'); });
  } catch (e) { box.innerHTML = `<li class="bad">${esc(e.message)}</li>`; }
  finally { btns.forEach((x, i) => { x.disabled = was[i] || x.dataset.done === '1'; }); }
}

// ——— Настройки ———
const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
function set(o, path, v) { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] ??= {}; }); a[ks.at(-1)] = v; }

async function loadSettings() {
  try {
    const s = await window.possum.settings();
    for (const el of $('#form').elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = Boolean(get(s, el.name));
      else el.value = get(s, el.name) ?? '';
    }
    const st = (await window.possum.state()).status ?? {};
    for (const k of ['youtube', 'tiktok']) $(`[data-state="${k}"]`).innerHTML = st[k] ? '<span class="ok">подключено</span>' : 'не подключено';
  } catch (e) { $('#saved').innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {};
  for (const el of e.target.elements) if (el.name) set(patch, el.name, el.type === 'checkbox' ? el.checked : el.value.trim());
  try { await window.possum.saveSettings(patch); $('#saved').innerHTML = '<span class="ok">Сохранено</span>'; loadSettings(); refresh(); }
  catch (err) { $('#saved').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
});

document.querySelectorAll('[data-connect]').forEach((b) => b.addEventListener('click', async () => {
  const kind = b.dataset.connect;
  const out = $(`[data-state="${kind}"]`);
  out.textContent = 'Открыл браузер — войди и разреши доступ…';
  try { await window.possum.connect(kind); out.innerHTML = '<span class="ok">подключено</span>'; refresh(); }
  catch (e) { out.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
}));

$('#add').onclick = () => window.possum.pick();
$('#openIn').onclick = () => window.possum.open('in');
$('#openOut').onclick = () => window.possum.open('out');
$('#back').onclick = () => go(jobs.find((j) => j.id === current)?.status === 'done' ? 'done' : 'queue');

window.possum.onJobs((list) => { jobs = list; renderJobs(); });
refresh();
