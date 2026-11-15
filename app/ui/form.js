// Логика формы настроек без DOM: что уходит в saveSettings по кнопке «Сохранить».
// Классический скрипт: окно грузит его раньше app.js, тест (test/form.test.js) — через node:vm.
(function (root) {
  const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
  function setPath(o, path, v) { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] ??= {}; }); a[ks.at(-1)] = v; }
  /** Маска ключа «•••abcd» или укороченное «…» — не настоящее значение, его не шлём. */
  const isShown = (v) => v.startsWith('•••') || v.includes('…');
  /**
   * fields: [{ name, type, value, had }] → patch. had — значение поля при открытии настроек.
   * Маску не шлём (не затирает ключ); очищенное поле, где было значение, шлём пустым — «удалить»; флажки здесь не участвуют.
   */
  function formPatch(fields) {
    const patch = {};
    for (const f of fields) {
      if (!f.name || f.type === 'checkbox') continue;
      const v = String(f.value ?? '').trim();
      if (isShown(v)) continue;
      if (v) setPath(patch, f.name, v);
      else if (f.had) setPath(patch, f.name, '');
    }
    return patch;
  }
  root.PossumForm = { formPatch, getPath, setPath, isShown };
})(globalThis);
