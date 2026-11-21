// "Post or not" advice with clear criteria: motion, squeaks, brightness, no flash.
export function advise(a) {
  const peaks = a.peaks ?? [];
  const criteria = {
    движение: peaks.some((p) => p.kind === 'move'),
    писк: peaks.some((p) => p.kind === 'squeak'),
    светло: !a.dark,
  };
  const yes = Object.keys(criteria).filter((k) => criteria[k]);
  const no = Object.keys(criteria).filter((k) => !criteria[k]);
  let verdict;
  if ((a.flash ?? []).length) verdict = 'не советую';
  else if (yes.length === 3) verdict = 'выкладывай';
  else if (yes.length === 2) verdict = 'можно';
  else verdict = 'слабый';
  const list = `Есть: ${yes.join(', ') || 'ничего'}.${no.length ? ` Нет: ${no.join(', ')}.` : ''}`;
  const why = verdict === 'не советую'
    ? `Похоже на вспышку или резкий свет — для глаз зверька это стресс, лучше не выкладывать. ${list}`
    : list;
  // the criteria are always named in words: motion, squeaks, brightness
  return { verdict, criteria, why: /движение/.test(why) ? why : `${why} (смотрю на: движение, писк, светло)` };
}
