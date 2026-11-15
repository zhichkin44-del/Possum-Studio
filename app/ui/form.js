// Логика формы настроек без DOM: что уходит в saveSettings по кнопке «Сохранить».
// Классический скрипт: окно грузит его раньше app.js, тест (test/form.test.js) — через node:vm.
(function (root) {
  const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
  function setPath(o, path, v) { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] ??= {}; }); a[ks.at(-1)] = v; }
  const SECRET_PATH = /^(claudeKey|(youtube|tiktok|instagram|telegram)\.(clientSecret|refreshToken|accessToken|botToken))$/;
  const CUT = /^[^\s\/\\]{0,24}…[^\s\/\\]{0,8}$/;
  /**
   * Не настоящее значение поля name, его не шлём: маска «•••abcd» — в любом поле; укороченное «sk-ant…3456» — только в поле ключа.
   * В пути, имени, модели «…» — часть значения. Та же проверка, что isShown в core/settings.js (тест сверяет).
   */
  const isShown = (v, name = '') => {
    if (typeof v !== 'string') return false;
    const t = v.trim();
    return t.startsWith('•••') || (SECRET_PATH.test(String(name ?? '')) && CUT.test(t));
  };
  /**
   * fields: [{ name, type, value, had }] → patch. had — значение поля при открытии настроек.
   * Маску не шлём (не затирает ключ); очищенное поле, где было значение, шлём пустым — «удалить»; флажки здесь не участвуют.
   */
  function formPatch(fields) {
    const patch = {};
    for (const f of fields) {
      if (!f.name || f.type === 'checkbox') continue;
      const v = String(f.value ?? '').trim();
      if (isShown(v, f.name)) continue;
      if (v) setPath(patch, f.name, v);
      else if (f.had) setPath(patch, f.name, '');
    }
    return patch;
  }
  root.PossumForm = { formPatch, getPath, setPath, isShown };
})(globalThis);
