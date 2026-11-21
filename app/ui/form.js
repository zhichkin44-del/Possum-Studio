// Settings form logic without the DOM: what goes to saveSettings on the "Save" button.
// A classic script: the window loads it before app.js; the test (test/form.test.js) loads it via node:vm.
(function (root) {
  const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
  function setPath(o, path, v) { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] ??= {}; }); a[ks.at(-1)] = v; }
  const SECRET_PATH = /^(claudeKey|(youtube|tiktok|instagram|telegram)\.(clientSecret|refreshToken|accessToken|botToken))$/;
  const CUT = /^[^\s\/\\]{0,24}…[^\s\/\\]{0,8}$/;
  /**
   * Not a real value of the name field, we do not send it: the mask "•••abcd" — in any field; the shortened "sk-ant…3456" — only in a key field.
   * In a path, name or model "…" is part of the value. The same check as isShown in core/settings.js (a test compares them).
   */
  const isShown = (v, name = '') => {
    if (typeof v !== 'string') return false;
    const t = v.trim();
    return t.startsWith('•••') || (SECRET_PATH.test(String(name ?? '')) && CUT.test(t));
  };
  /**
   * fields: [{ name, type, value, had }] → patch. had — the field's value when the settings were opened.
   * The mask is not sent (it does not overwrite the key); a cleared field that had a value is sent empty — "delete"; checkboxes do not take part here.
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
