// Ядро бота: чистая логика поверх интерфейсов tg / store / montage / clock. Запуск — src/index.js, тесты — test/.
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { TASKS, byId, renderTask, renderSimple, renderRepeat, nextPlanned } from './tasks.js';
import { buildCaptions, PLATFORMS, qualityIssues } from './post.js';
import { isoWeek, parseStatsText, weekRows, scenarioAverages, bestPost, PLATFORM_LABEL, nf } from './stats.js';
import * as T from './texts.js';

const DAY = 86_400_000;
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_DAYS_NOM = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const btn = (text, data) => ({ text, data });
const sickRe = /вял|не ест|болеет|заболел|приболел|понос|не кушает/i;

export function createBot({ tg, store, montage, clock, config, log = console.log, statsSource = null }) {
  const d = store.data;
  const pet = config.pet;
  const tzNow = () => Number(config.tzOffsetHours ?? 0); // читаем каждый раз: смена пояса ноутбука подхватывается без перезапуска
  const dataDir = config.dataDir ?? 'data';
  const quietMs = config.quietMs ?? 90_000;
  const retryDelay = config.retryDelayMs ?? 0;
  const save = () => store.save();

  // ---------- время ----------
  const nowMs = () => clock.now().getTime();
  const local = () => new Date(nowMs() + tzNow() * 3_600_000); // UTC-поля = местное время
  const today = () => local().toISOString().slice(0, 10);
  const hmNow = () => local().toISOString().slice(11, 16);
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
  const iso = () => clock.now().toISOString();

  // ---------- очереди: обновления и тики идут по одному; сборка роликов — своя очередь ----------
  let chain = Promise.resolve();
  let buildChain = Promise.resolve();
  const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const enqueueBuild = (fn) => { const p = buildChain.then(fn); buildChain = p.catch(() => {}); return p; };

  // ---------- отправка ----------
  async function send(chat, text, buttons) {
    try { return await tg.sendMessage(chat, text, { buttons }); } catch (e) { log(`send failed: ${e.message}`); return null; }
  }
  const toPartner = (text, buttons) => (d.partnerId ? send(d.partnerId, text, buttons) : null);
  const toOwner = (text) => (d.ownerId ? send(d.ownerId, text) : null);
  async function retry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) { last = e; if (retryDelay) await new Promise((r) => setTimeout(r, retryDelay * (i + 1))); }
    }
    throw last;
  }

  // ---------- напарница: состояние ----------
  const newPartner = (id) => ({
    id, startedAt: iso(), lastSeenAt: iso(), introDone: false, pausedUntil: null, cadence: 'normal', awaiting: null, task: null,
    taskHistory: [], nudgesUnanswered: 0, lastNudgeDate: null, lastTaskDate: null, lastWeeklyDate: null, ideas: [], batch: null, cards: null,
  });
  const S = () => d.partner;
  const taskTitle = (id) => byId(id)?.title ?? 'Своя идея';
  const openTask = () => (S()?.task && ['sent', 'accepted', 'postponed', 'received'].includes(S().task.status) ? S().task : null);
  const isPaused = () => {
    const s = S(); if (!s || !s.pausedUntil) return false;
    if (s.pausedUntil === 'manual') return true;
    if (Date.parse(s.pausedUntil) > nowMs()) return true;
    s.pausedUntil = null; save(); return false;
  };
  const record = (entry) => { S().taskHistory.push({ date: today(), clarified: false, ...entry }); };

  // ---------- вход ----------
  async function handleUpdate(u) {
    return enqueue(async () => {
      if (u.update_id !== undefined) {
        if (d.seen.includes(u.update_id)) return;
        d.seen.push(u.update_id); if (d.seen.length > 300) d.seen.splice(0, d.seen.length - 300);
      }
      try {
        if (u.callback_query) await onCallback(u.callback_query);
        else if (u.message) await onMessage(u.message);
      } catch (e) {
        log(`update error: ${e.stack ?? e.message}`);
        await toOwner(`Ошибка в боте: ${T.esc(String(e.message).slice(0, 200))}`);
      }
      save();
    });
  }

  async function onMessage(m) {
    const from = m.from?.id, chat = m.chat?.id;
    const text = m.text?.trim() ?? '';
    if (text.startsWith('/start')) return onStart(from, chat, text.split(/\s+/)[1]);
    const role = from === d.ownerId ? 'owner' : from === d.partnerId ? 'partner' : null;
    if (!role) return void (await send(chat, T.closedBot));
    if (role === 'owner') return onOwner(chat, text, m);
    return onPartner(chat, text, m);
  }

  async function onStart(from, chat, code) {
    if (code && code === d.invites.owner && (!d.ownerId || d.ownerId === from)) {
      d.ownerId = from; save();
      return void (await send(chat, T.ownerHello));
    }
    if (code && code === d.invites.partner && (!d.partnerId || d.partnerId === from)) {
      if (!d.partner) d.partner = newPartner(from);
      d.partnerId = from; save();
      await send(chat, T.hello1(pet));
      await send(chat, T.hello2, [[btn('Поняла', 'a:intro')]]);
      await toOwner(T.partnerConnected);
      return;
    }
    if (from === d.ownerId) return void (await send(chat, T.ownerHello));
    if (from === d.partnerId) return void (await send(chat, T.alreadyHere));
    await send(chat, T.closedBot);
  }

  // ---------- Саша ----------
  async function onOwner(chat, text) {
    if (/^\/(status|статус)/i.test(text)) return void (await send(chat, statusText()));
    if (/^\/(код|code|invite)/i.test(text)) {
      const link = config.botUsername ? `\nСсылка для неё (нажать и «Запустить»): https://t.me/${config.botUsername}?start=${d.invites.partner}` : '';
      return void (await send(chat, `Код для напарницы: <code>${d.invites.partner}</code>${link}\nИли она отправляет боту: /start ${d.invites.partner}`));
    }
    await send(chat, T.ownerHelp);
  }

  function weekPosted() {
    return d.posts.filter((p) => Object.values(p.posted ?? {}).some((t) => nowMs() - Date.parse(t) <= 7 * DAY)).length;
  }
  function statusText() {
    const s = S();
    if (!s) return 'Напарница ещё не подключилась. Код: /код';
    const ago = Math.max(0, Math.round((nowMs() - Date.parse(s.lastSeenAt)) / 3_600_000));
    const t = s.task;
    const taskLine = t ? `«${t.custom ? 'Своя идея' : taskTitle(t.id)}» — ${({ sent: 'выдано, ждём', accepted: 'взяла в работу', postponed: 'перенесено', received: 'съёмка получена', done: 'готово' })[t.status] ?? t.status}` : 'сейчас нет';
    const waiting = d.posts.filter((p) => ['ready', 'approved'].includes(p.status)).length;
    const building = d.posts.filter((p) => p.status === 'building').length;
    const lastWk = [...d.stats].reverse().find((x) => x.weekly)?.week;
    const week = lastWk ? weekRows(d.stats, lastWk) : [];
    return [
      `<b>Напарница на связи:</b> писала ${ago < 1 ? 'только что' : `${ago} ч назад`}${isPaused() ? ' (сейчас пауза)' : ''}.`,
      `<b>Задание дня:</b> ${taskLine}.`,
      `<b>Неделя:</b> ${weekPosted()} из 5.`,
      `<b>Ролики:</b> ждут выкладки — ${waiting}, в работе — ${building}.`,
      `<b>Статистика недели:</b> ${week.length ? `есть по ${week.length} площадкам (вручную)` : 'нет данных'}.`,
    ].join('\n');
  }

  // ---------- напарница ----------
  async function onPartner(chat, text, m) {
    const s = S();
    s.lastSeenAt = iso(); s.nudgesUnanswered = 0;
    if (m.video || m.video_note || (m.document?.mime_type ?? '').startsWith('video/')) return onVideo(chat, m);
    if (m.photo) return onPhoto(chat, m);
    if (!text) return void (await send(chat, T.nonText));
    return onText(chat, text);
  }

  async function onText(chat, text) {
    const s = S(); const low = text.toLowerCase();
    if (s.awaiting?.kind === 'caption') {
      const post = d.posts.find((p) => p.id === s.awaiting.postId);
      s.awaiting = null;
      if (post) {
        post.customCaption = text.slice(0, 500);
        for (const k of ['yt_ru', 'tiktok', 'reels']) if (post.captions?.[k]) post.captions[k].caption = post.customCaption;
        return void (await send(chat, T.customCaptionDone(post.customCaption), [[btn('Всё хорошо', 'a:post_ok'), btn('Поменять текст', 'a:post_edit')]]));
      }
    }
    if (s.awaiting?.kind === 'idea') {
      s.awaiting = null; s.ideas.push({ text: text.slice(0, 300), at: iso() });
      if (openTask()) record({ id: s.task.id ?? null, status: 'missed' });
      s.task = { id: null, custom: text.slice(0, 300), status: 'accepted', sentAt: iso(), date: today(), clarified: false };
      s.lastTaskDate = today();
      return void (await send(chat, T.ideaSaved));
    }
    if (/пауз/.test(low)) return void (await send(chat, T.pauseAsk, [[btn('До завтра', 'a:pause:1d'), btn('На неделю', 'a:pause:7d'), btn('Пока не напишу', 'a:pause:manual')]]));
    if (/вернул/.test(low)) { s.pausedUntil = null; return void (await send(chat, T.resumed)); }
    if (sickRe.test(low) && !/не\s+(вял|болеет|заболел|приболел)/.test(low)) { s.pausedUntil = 'manual'; await toOwner(T.sickOwner); return void (await send(chat, T.sickReply)); }
    if (/(^|\s)(не|пока не|ещё не|еще не)\s+выложил/.test(low)) return void (await send(chat, T.notYet));
    if (/выложил/.test(low)) {
      const post = [...d.posts].reverse().find((p) => ['ready', 'approved'].includes(p.status));
      if (post) return void (await markAll(post));
    }
    const rows = parseStatsText(text);
    if (rows.length) return void (await saveStats(chat, rows));
    if (/^потом/.test(low) && openTask()) return void (await taskLater());
    if (/спит/.test(low) && openTask()) return void (await taskSleep());
    await send(chat, T.fallback);
  }

  // ----- задания -----
  function pauseUntilText(ms) { const l = new Date(ms + tzNow() * 3_600_000); return `${l.getUTCDate()} ${RU_MONTHS[l.getUTCMonth()]} (${RU_DAYS_NOM[l.getUTCDay()]})`; }

  async function issueTask(task, repeat = false) {
    const s = S();
    s.task = { id: task.id, status: 'sent', sentAt: iso(), date: today(), clarified: false };
    s.lastTaskDate = today();
    await toPartner(repeat ? renderRepeat(task, pet) : renderTask(task, pet), [[btn('Снимаю', 'a:go'), btn('Потом', 'a:later')], [btn('Он спит', 'a:sleep'), btn('Не поняла задание', 'a:unclear')]]);
  }
  async function taskGo() {
    const t = openTask();
    if (t && t.status !== 'received') t.status = 'accepted';
    await toPartner(T.goOn);
  }
  async function taskLater() {
    const t = openTask(); if (!t) return void (await toPartner(T.later));
    t.status = 'postponed';
    await toPartner(T.later);
  }
  async function taskSleep() {
    const t = openTask(); if (t) t.status = 'postponed';
    await toPartner(T.sleeping);
  }
  async function taskUnclear() {
    const t = openTask(); const s = S();
    if (!t || t.custom) return void (await toPartner(T.unclearTail));
    t.clarified = true;
    const task = byId(t.id);
    await toPartner(`${T.unclearIntro} ${renderSimple(task)}\n\n${T.unclearTail}`, [[btn('Снимаю', 'a:go'), btn('Потом', 'a:later')]]);
    await toOwner(T.unclearOwner(task.title));
    void s;
  }

  // ----- карточки выбора с 3-й недели -----
  const lastUsed = () => {
    const m = new Map();
    for (const h of S().taskHistory) if (h.id) m.set(h.id, h.date);
    return m;
  };
  function pickCards(offset) {
    const s = S();
    const hist = s.taskHistory.filter((h) => h.id);
    const recent = new Set(hist.slice(-5).map((h) => h.id));
    const avgs = scenarioAverages(d);
    const global = avgs.size ? [...avgs.values()].reduce((a, v) => a + v.avg, 0) / avgs.size : 0;
    const last = lastUsed();
    const scored = TASKS.filter((t) => !recent.has(t.id)).map((t, i) => {
      const a = avgs.get(t.id);
      const since = last.has(t.id) ? daysBetween(last.get(t.id), today()) : 99;
      const score = (a && global ? a.avg / global : 1) + Math.min(since, 14) / 14 + (last.has(t.id) ? 0 : 1) - i * 0.001;
      const reason = a && a.n >= 3 && global && a.avg > global * 1.1 ? `смотрят больше обычного: в среднем ${nf(a.avg)} просмотров`
        : last.has(t.id) ? 'давно не снимали' : 'пока данных нет, пробуем';
      return { t, score, reason };
    }).sort((x, y) => y.score - x.score);
    const n = scored.length;
    const items = [];
    for (let k = 0; k < Math.min(3, n); k++) items.push(scored[(offset + k) % n]);
    return items;
  }
  async function sendCards(offset = 0) {
    const s = S();
    const items = pickCards(offset);
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    s.cards = { id, offset, items: items.map((i) => i.t.id), msgId: null };
    s.lastTaskDate = today();
    const body = items.map((it, i) => `${i + 1}. <b>${it.t.title}</b> — ${it.t.pitch}\n<i>${it.reason}</i>\n${it.t.secs}${it.t.second ? ' · нужен второй человек' : ''}`).join('\n\n');
    const rec = await toPartner(`${T.cardsHead}\n\n${body}`, [
      items.map((_, i) => btn(`Беру ${i + 1}`, `a:pick:${i + 1}:${id}`)),
      [btn('Другие', `a:more:${id}`), btn('Своя идея', `a:own:${id}`)],
      [btn('Сегодня пропускаю', `a:skip:${id}`)],
    ]);
    if (rec) s.cards.msgId = rec.message_id;
  }
  async function dropCardsKeyboard() {
    const s = S();
    if (s.cards?.msgId && d.partnerId) await tg.editButtons?.(d.partnerId, s.cards.msgId, null).catch(() => {});
  }

  // ----- видео -----
  async function onVideo(chat, m) {
    const s = S();
    const v = m.video ?? m.video_note ?? m.document;
    const uid = v.file_unique_id ?? v.file_id;
    if ((v.file_size ?? 0) > (config.maxDownloadBytes ?? 20_000_000)) return void (await send(chat, T.tooBig));
    if (d.clips.some((c) => c.uid === uid)) return void (await send(chat, T.duplicate));
    const dest = join(dataDir, 'clips', `${String(uid).replace(/[^\w-]/g, '_')}.mp4`);
    mkdirSync(join(dataDir, 'clips'), { recursive: true });
    try { await retry(() => tg.download(v.file_id, dest)); } catch (e) {
      log(`download failed: ${e.message}`);
      return void (await send(chat, /too big|слишком/i.test(e.message) ? T.tooBig : T.downloadFailed));
    }
    let info;
    try { info = await montage.probe(dest); } catch (e) { log(`probe failed: ${e.message}`); return void (await send(chat, T.openFailed)); }
    const t = openTask();
    const clip = { id: `k${d.clips.length + 1}-${Date.now().toString(36)}`, uid, path: dest, ...info, receivedAt: iso(), taskId: t?.id ?? null };
    d.clips.push(clip);
    if (t) t.status = 'received';
    const b = s.batch && ['collecting', 'warn', 'short'].includes(s.batch.state) ? s.batch : (s.batch = { clipIds: [], lastAt: nowMs(), taskId: t?.id ?? null, custom: t?.custom ?? null, state: 'collecting' });
    const first = b.clipIds.length === 0;
    b.clipIds.push(clip.id); b.lastAt = nowMs(); b.state = 'collecting';
    if (first) await send(chat, T.received);
    else if (b.clipIds.length === 2) await send(chat, T.several);
  }

  async function onPhoto(chat, m) {
    const p = m.photo[m.photo.length - 1];
    const dest = join(dataDir, 'stats', `${String(p.file_unique_id ?? p.file_id).replace(/[^\w-]/g, '_')}.jpg`);
    mkdirSync(join(dataDir, 'stats'), { recursive: true });
    try { await retry(() => tg.download(p.file_id, dest)); } catch { return void (await send(chat, T.downloadFailed)); }
    S().awaiting = { kind: 'stats' };
    (d.shots ??= []).push({ week: isoWeek(local()), file: dest, at: iso() });
    if (d.ownerId) await tg.sendPhoto(d.ownerId, dest, { caption: T.shotForOwner }).catch((e) => log(`owner photo failed: ${e.message}`));
    await send(chat, T.shotSaved);
  }

  // цифры относятся к неделе последних итогов, если те были в последние 3 дня; иначе — к текущей неделе
  function statsWeek() {
    const s = S();
    if (s.lastWeeklyDate && s.statsWeek && daysBetween(s.lastWeeklyDate, today()) <= 3) return s.statsWeek;
    return isoWeek(local());
  }
  async function saveStats(chat, rows) {
    const wk = statsWeek();
    for (const r of rows) {
      d.stats = d.stats.filter((x) => !(x.weekly && x.week === wk && x.platform === r.platform));
      d.stats.push({ week: wk, platform: r.platform, views: r.views, subs: r.subs, postId: null, source: 'manual', weekly: true, at: iso() });
    }
    S().awaiting = null;
    await send(chat, T.statsSaved(rows.map((r) => `${PLATFORM_LABEL[r.platform]} ${nf(r.views)}${r.subs ? ` (+${r.subs})` : ''}`).join(', ')));
  }

  // ----- сборка и выдача поста -----
  async function processBatch() {
    const s = S(); const b = s?.batch;
    if (!b || b.state !== 'collecting' || nowMs() - b.lastAt < quietMs) return;
    const clips = b.clipIds.map((id) => d.clips.find((c) => c.id === id)).filter(Boolean);
    const total = clips.reduce((a, c) => a + (c.duration ?? 0), 0);
    if (total < 3) { b.state = 'short'; return void (await toPartner(T.tooShort)); }
    const lumas = clips.map((c) => c.luma).filter((x) => typeof x === 'number');
    const luma = lumas.length ? lumas.reduce((a, v) => a + v, 0) / lumas.length : 100;
    if (luma < 40) { b.state = 'warn'; return void (await toPartner(T.darkWarn, [[btn('Собери этот ролик', 'a:warn_go'), btn('Сниму заново', 'a:warn_redo')]])); }
    if (luma > 215) { b.state = 'warn'; return void (await toPartner(T.brightWarn(pet), [[btn('Собери этот ролик', 'a:warn_go'), btn('Сниму заново', 'a:warn_redo')]])); }
    startBuild();
  }
  function startBuild() {
    const s = S(); const b = s.batch; if (!b) return;
    const post = { id: `p${d.posts.length + 1}-${Date.now().toString(36)}`, taskId: b.taskId, custom: b.custom, clipIds: [...b.clipIds], status: 'building', createdAt: iso(), posted: {}, sent: {} };
    d.posts.push(post); s.batch = null; save();
    void enqueueBuild(() => runBuild(post));
  }
  async function runBuild(post) {
    const clips = post.clipIds.map((id) => d.clips.find((c) => c.id === id)).filter(Boolean);
    const task = post.taskId ? byId(post.taskId) : null;
    const title = task?.hook ?? { ru: pet.im, en: pet.en ?? '' };
    const outDir = join(dataDir, 'posts', post.id);
    try {
      const r = await montage.build({ clips: clips.map((c) => ({ path: c.path, info: { duration: c.duration, width: c.width, height: c.height, hasAudio: c.hasAudio, luma: c.luma } })), title, outDir });
      Object.assign(post, { video: r.video, cover: r.cover, proof: r.proof, duration: r.duration, issues: qualityIssues(r) });
      const n = d.posts.filter((p) => p.taskId === post.taskId && p.id !== post.id && p.video).length;
      post.captions = buildCaptions({ task, pet, n });
      post.status = 'ready-unsent';
    } catch (e) {
      log(`build failed: ${e.message}`);
      post.status = 'failed'; save();
      await toPartner(T.buildFailed);
      await toOwner(T.buildFailedOwner(e.message));
      return;
    }
    save();
    await deliverPost(post);
    save();
  }
  const captionBlock = (post) => PLATFORMS.map((p) => {
    const c = post.captions[p.id];
    return `<b>Для ${p.label}</b>\nПодпись: ${T.esc(c.caption)}\nХештеги: ${c.hashtags.join(' ')}\nПервый комментарий: ${T.esc(c.comment)}`;
  }).join('\n\n');
  const delivering = new Set(); // пост выдаётся ровно одним вызовом: тик не запускает вторую выдачу параллельно
  async function deliverPost(post) {
    const chat = d.partnerId; if (!chat || delivering.has(post.id) || post.status === 'stuck') return;
    delivering.add(post.id);
    try { await deliverPostInner(post, chat); } finally { delivering.delete(post.id); }
  }
  async function deliverPostInner(post, chat) {
    const sent = post.sent ?? (post.sent = {});
    try {
      if (!sent.intro) { await tg.sendMessage(chat, T.postIntro, {}); sent.intro = true; save(); }
      if (!sent.video) { await tg.sendVideo(chat, post.video, {}); sent.video = true; save(); }
      if (!sent.cover && post.cover) { try { await tg.sendPhoto(chat, post.cover, { caption: T.coverCaption }); } catch (e) { log(`cover failed: ${e.message}`); } sent.cover = true; save(); }
      if (!sent.captions) { await tg.sendMessage(chat, captionBlock(post), {}); sent.captions = true; save(); }
      if (!sent.outro) { await tg.sendMessage(chat, `${T.postWhen}\n\n${T.postOutro}`, { buttons: [[btn('Всё хорошо', 'a:post_ok'), btn('Поменять текст', 'a:post_edit')]] }); sent.outro = true; save(); }
    } catch (e) {
      log(`deliver failed: ${e.message}`);
      post.deliverAttempts = (post.deliverAttempts ?? 0) + 1;
      post.status = 'ready-unsent';
      // ноутбук спит или нет сети — обычное дело: повторяем всё реже (0,5 → 120 мин) до суток
      const mins = [0.5, 1, 2, 5, 10, 30, 60, 120][Math.min(post.deliverAttempts - 1, 7)];
      post.nextDeliverAt = new Date(nowMs() + mins * 60_000).toISOString();
      const tooOld = nowMs() - Date.parse(post.createdAt) > DAY;
      if (tooOld || /403|blocked|chat not found|deactivated/i.test(e.message)) { // напарница заблокировала бота или сутки без связи
        post.status = 'stuck';
        await toOwner(T.deliveryStuck(post.taskId ? taskTitle(post.taskId) : 'свободная съёмка', e.message));
      } else if (post.deliverAttempts === 5 && !post.ownerWarned) {
        post.ownerWarned = true;
        await toOwner(`Не получается отправить напарнице готовый ролик «${T.esc(post.taskId ? taskTitle(post.taskId) : 'свободная съёмка')}» уже ${post.deliverAttempts} раз подряд. Проверь интернет на ноутбуке, бот будет пробовать дальше.`);
      }
      return;
    }
    post.status = 'ready';
    if (!post.ownerNotified) {
      post.ownerNotified = true;
      const q = post.issues?.length ? `Проверка качества: ${post.issues.join('; ')}.` : 'Проверка качества: всё в порядке.';
      await toOwner(`Ролик готов: «${post.taskId ? taskTitle(post.taskId) : 'свободная съёмка'}» (${Math.round(post.duration ?? 0)} с). ${q}`);
      if (post.proof && d.ownerId) await tg.sendPhoto(d.ownerId, post.proof, { caption: 'Лист проверки' }).catch(() => {});
    }
  }
  const latestPost = (statuses) => [...d.posts].reverse().find((p) => statuses.includes(p.status));

  async function postOk() {
    const post = latestPost(['ready', 'approved']);
    if (!post) return void (await toPartner(T.noPostYet));
    if (post.status === 'approved') return;
    post.status = 'approved';
    await toPartner(T.whereAsk, [
      [btn('YouTube RU', `a:plat:yt_ru:${post.id}`), btn('YouTube EN', `a:plat:yt_en:${post.id}`)],
      [btn('TikTok', `a:plat:tiktok:${post.id}`), btn('Instagram Reels', `a:plat:reels:${post.id}`)],
      [btn('Выложила везде', `a:platall:${post.id}`)],
    ]);
  }
  function recordDone(post) {
    if (post.doneRecorded) return;
    post.doneRecorded = true;
    const s = S();
    record({ id: post.taskId ?? null, status: 'done' });
    if (s.task && (s.task.id === post.taskId || s.task.custom)) s.task.status = 'done';
  }
  async function markPlatform(postId, plat) {
    const post = d.posts.find((p) => p.id === postId); if (!post) return;
    if (post.posted[plat]) return void (await toPartner(T.alreadyMarked));
    post.posted[plat] = iso();
    if (post.status === 'ready') post.status = 'approved';
    recordDone(post);
    if (PLATFORMS.every((p) => post.posted[p.id])) { post.status = 'posted'; return void (await toPartner(T.thanksPosted)); }
    await toPartner(T.marked(PLATFORMS.find((p) => p.id === plat).label));
  }
  async function markAll(post) {
    for (const p of PLATFORMS) post.posted[p.id] ??= iso();
    post.status = 'posted'; recordDone(post);
    await toPartner(T.thanksPosted);
  }

  // ---------- кнопки ----------
  async function onCallback(cb) {
    try { await tg.answerCallback?.(cb.id); } catch { /* ignore */ }
    if (cb.from?.id !== d.partnerId) return;
    const s = S(); s.lastSeenAt = iso(); s.nudgesUnanswered = 0;
    const [, act, a1, a2] = String(cb.data ?? '').split(':');
    switch (act) {
      case 'intro': s.introDone = true; return void (await toPartner(T.introOk(pet)));
      case 'go': return taskGo();
      case 'later': return taskLater();
      case 'sleep': return taskSleep();
      case 'unclear': return taskUnclear();
      case 'warn_go': if (s.batch?.state === 'warn') startBuild(); return;
      case 'warn_redo': if (s.batch?.state === 'warn') { s.batch = null; if (openTask()) S().task.status = 'accepted'; await toPartner(T.redo); } return;
      case 'post_ok': return postOk();
      case 'post_edit': { const post = latestPost(['ready', 'approved']); if (!post) return void (await toPartner(T.noPostYet)); s.awaiting = { kind: 'caption', postId: post.id }; return void (await toPartner(T.askCaption)); }
      case 'plat': return markPlatform(a2, a1);
      case 'platall': { const post = d.posts.find((p) => p.id === a1); if (post) await markAll(post); return; }
      case 'pause': {
        if (a1 === 'manual') { s.pausedUntil = 'manual'; return void (await toPartner(T.pauseManual)); }
        const ms = (a1 === '7d' ? 7 : 1) * DAY; s.pausedUntil = new Date(nowMs() + ms).toISOString();
        return void (await toPartner(T.pauseSet(pauseUntilText(nowMs() + ms))));
      }
      case 'pick': case 'more': case 'own': case 'skip': return onCards(act, act === 'pick' ? a2 : a1, Number(a1));
      case 'wk_shot': s.awaiting = { kind: 'stats' }; return void (await toPartner(T.askStats));
      case 'wk_later': return void (await toPartner(T.notRushing));
      case 'wk_less': s.cadence = 'light'; return void (await toPartner(T.lessOften));
      case 'wk_posts': return void (await toPartner(topPostsText()));
      case 'wk_thanks': return void (await toPartner(T.youreWelcome));
      default: return;
    }
  }
  async function onCards(act, cardsId, n) {
    const s = S();
    if (!s.cards || s.cards.id !== cardsId) return void (await toPartner(T.cardsStale));
    if (act === 'more') { await dropCardsKeyboard(); return sendCards(s.cards.offset + 3); }
    if (act === 'own') { s.awaiting = { kind: 'idea' }; return void (await toPartner(T.askIdea)); }
    if (act === 'skip') { await dropCardsKeyboard(); s.cards = null; record({ id: null, status: 'skipped' }); s.task = null; return void (await toPartner(T.skippedToday)); }
    const id = s.cards.items[n - 1]; if (!id) return;
    await dropCardsKeyboard(); s.cards = null;
    await toPartner(T.picked(taskTitle(id)));
    await issueTask(byId(id));
  }

  // ---------- итоги недели ----------
  function topPostsText() {
    const byPost = new Map();
    for (const r of d.stats) if (r.postId) byPost.set(r.postId, (byPost.get(r.postId) ?? 0) + r.views);
    const top = d.posts.filter((p) => byPost.has(p.id)).sort((a, b) => byPost.get(b.id) - byPost.get(a.id)).slice(0, 5);
    return top.length ? `Лучшие ролики:\n${top.map((p, i) => `${i + 1}. ${p.taskId ? taskTitle(p.taskId) : 'свободная съёмка'} — ${nf(byPost.get(p.id))}`).join('\n')}` : 'Пока нет данных по роликам.';
  }
  async function weekly() {
    const s = S();
    if (!s || !d.partnerId || isPaused()) return;
    const l = local();
    // целевая дата — последнее «воскресенье 19:00»; если ноутбук был выключен, догоняем в течение двух дней
    const wd = config.weeklyDay ?? 0;
    const back = (l.getUTCDay() - wd + 7) % 7;
    const dueDate = back === 0 && hmNow() < (config.weeklyTime ?? '19:00') ? new Date(l.getTime() - 7 * DAY) : new Date(l.getTime() - back * DAY);
    const due = dueDate.toISOString().slice(0, 10);
    if (daysBetween(due, today()) > 2 || (s.lastWeeklyDate && s.lastWeeklyDate >= due)) return;
    const startDay = new Date(Date.parse(s.startedAt) + tzNow() * 3_600_000).toISOString().slice(0, 10);
    if (daysBetween(startDay, due) < 7) return; // первая неделя ещё не прошла: итогов нет
    s.lastWeeklyDate = today();
    s.statsWeek = isoWeek(dueDate);
    // автодоступ к статистике (когда Саша подключит входы): источник отдаёт строки недели, бот кладёт их рядом с ручными
    if (statsSource?.connected) {
      try {
        const got = await statsSource.fetch({ week: isoWeek(dueDate) });
        for (const r of got) {
          d.stats = d.stats.filter((x) => !(x.weekly && x.week === isoWeek(dueDate) && x.platform === r.platform));
          d.stats.push({ week: isoWeek(dueDate), platform: r.platform, views: r.views, subs: r.subs ?? 0, postId: null, source: statsSource.name, weekly: true, at: iso() });
        }
      } catch (e) { log(`stats source failed: ${e.message}`); }
    }
    const n = weekPosted();
    const head = `<b>Итоги недели с ${pet.tv}.</b> Выложено: ${n <= 5 ? `${n} из 5` : `${n} (план — 5)`}. ${n >= 4 ? 'Спасибо, что снимала!' : 'Неделя вышла тихой. Бывает, главное, что мы не бросили.'}`;
    const rows = weekRows(d.stats, isoWeek(dueDate));
    if (!rows.length) {
      return void (await toPartner(`${head}\n\nПришли, пожалуйста, скриншот статистики из YouTube Studio, и я расскажу, какие ролики смотрели больше всего и сколько пришло подписчиков.\n\n<b>Что зашло:</b> пока не знаем — посмотрим после первых роликов.\n\nНа следующую неделю пришлю несколько заданий. Если устала — скажи, будем снимать реже.`,
        [[btn('Пришлю скриншот', 'a:wk_shot'), btn('Позже', 'a:wk_later')], [btn('Хочу реже', 'a:wk_less')]]));
    }
    const table = `Неделя по площадкам (просмотры / новые подписчики):\n<pre>${rows.map((r) => `${PLATFORM_LABEL[r.platform].padEnd(11)} ${nf(r.views).padStart(7)} / +${r.subs}`).join('\n')}</pre>`;
    const parts = [head, table];
    const best = bestPost(d);
    if (best) parts.push(`<b>Лучший ролик:</b> «${best.post.taskId ? taskTitle(best.post.taskId) : 'свободная съёмка'}» — ${nf(best.views)} просмотров на всех площадках.`);
    const avgs = [...scenarioAverages(d)].filter(([, v]) => v.n >= 3).sort((a, b) => b[1].avg - a[1].avg);
    if (avgs.length >= 3) parts.push(`<b>Что общего у лучших:</b> чаще всего смотрят «${taskTitle(avgs[0][0])}» (в среднем ${nf(avgs[0][1].avg)} просмотров на ролик). Попробуем снимать такого больше.`);
    else parts.push('<b>Что зашло:</b> по отдельным роликам цифр пока нет.');
    const perPost = d.stats.some((r) => r.postId);
    await toPartner(parts.join('\n\n'), [perPost ? [btn('Покажи по роликам', 'a:wk_posts'), btn('Спасибо', 'a:wk_thanks')] : [btn('Спасибо', 'a:wk_thanks')], [btn('Хочу реже', 'a:wk_less')]]);
  }

  // ---------- ежедневное ----------
  async function dailyTask() {
    const s = S();
    if (!s || !d.partnerId || isPaused()) return;
    if (hmNow() < (config.taskTime ?? '19:30') || s.lastTaskDate === today()) return;
    if (s.cadence === 'light' && s.lastTaskDate && daysBetween(s.lastTaskDate, today()) < 2) return;
    const t = s.task;
    if (t && t.status === 'sent' && s.nudgesUnanswered >= 1) return; // не наваливаем: ждём её слова
    if (t && t.status === 'postponed' && t.id) return void (await issueTask(byId(t.id), true));
    if (t && t.status === 'postponed') { record({ id: null, status: 'missed' }); s.task = null; }
    if (t && ['sent', 'accepted', 'received'].includes(t.status) && t.date !== today()) { record({ id: t.id, status: 'missed' }); s.task = null; }
    const startDay = new Date(Date.parse(s.startedAt) + tzNow() * 3_600_000).toISOString().slice(0, 10);
    const dayIndex = daysBetween(startDay, today());
    const planned = dayIndex < 14 ? nextPlanned(s.taskHistory) : null;
    if (planned) return void (await issueTask(planned));
    await sendCards(0);
  }

  async function nudge() {
    const s = S();
    if (!s || !d.partnerId || isPaused()) return;
    if (hmNow() < (config.nudgeTime ?? '21:30') || s.lastNudgeDate === today() || s.nudgesUnanswered >= 2) return;
    const t = s.task; if (!t || !['sent', 'accepted'].includes(t.status)) return;
    s.lastNudgeDate = today();
    await toPartner(s.nudgesUnanswered === 0 ? T.nudge1(pet) : T.nudge2);
    s.nudgesUnanswered += 1;
  }

  // после перезапуска: сборка, которую оборвали, возвращается в очередь (клипы сохранены на диске)
  function resumeInterrupted() {
    for (const post of d.posts.filter((p) => p.status === 'building')) void enqueueBuild(() => runBuild(post));
  }

  async function retryUnsent() {
    for (const post of d.posts.filter((p) => p.status === 'ready-unsent' && (!p.nextDeliverAt || Date.parse(p.nextDeliverAt) <= nowMs()))) await deliverPost(post);
  }

  // клипы опубликованных роликов старше 45 дней удаляем: диск ноутбука не бесконечный
  function cleanupOld() {
    const limit = nowMs() - 45 * DAY;
    for (const post of d.posts.filter((p) => p.status === 'posted' && Date.parse(p.createdAt) < limit && !p.cleaned)) {
      for (const id of post.clipIds ?? []) {
        const c = d.clips.find((x) => x.id === id);
        try { if (c?.path) rmSync(c.path, { force: true }); } catch { /* ignore */ }
      }
      post.cleaned = true;
    }
  }

  async function tick() {
    return enqueue(async () => {
      try {
        cleanupOld();
        await retryUnsent();
        await processBatch();
        await weekly();
        await dailyTask();
        await nudge();
      } catch (e) { log(`tick error: ${e.stack ?? e.message}`); }
      save();
    });
  }

  async function idle() {
    for (let i = 0; i < 6; i++) { await chain; await buildChain; }
  }

  resumeInterrupted();
  return { handleUpdate, tick, idle, invites: () => d.invites, taskTitle, statusText: () => statusText() };
}
