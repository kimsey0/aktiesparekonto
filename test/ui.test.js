// Røgtest af selve siden: stubber DOM'en, kører index.html's script og klikker rundt.
// Kør med:  node test/ui.test.js  — ingen afhængigheder.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// --- standardværdier og chips parses ud af markuppen
const attrs = {};
for (const m of html.matchAll(/<input\b[^>]*>/g)) {
  const tag = m[0];
  const id = (tag.match(/id="([^"]+)"/) || [])[1];
  if (!id) continue;
  attrs[id] = {
    type: (tag.match(/type="([^"]+)"/) || [])[1] || 'text',
    value: (tag.match(/value="([^"]*)"/) || [])[1] || '',
    checked: /\bchecked\b/.test(tag),
  };
}
const chips = [...html.matchAll(/<button class="chip" data-group="([^"]+)" data-fund="([^"]+)"/g)]
  .map(m => ({ group: m[1], fund: m[2] }));

// --- minimal element-stub
function makeEl(id) {
  const a = attrs[id] || {};
  return {
    id, type: a.type, value: a.value, checked: !!a.checked, disabled: false,
    textContent: '', innerHTML: '', style: {}, dataset: {},
    _handlers: {}, _attrs: {},
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    setAttribute(k, v) { this._attrs[k] = v; },
    classList: {
      _set: new Set(),
      toggle(c, force) { (force === undefined ? !this._set.has(c) : force) ? this._set.add(c) : this._set.delete(c); },
      add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); },
    },
    fire(t) { for (const fn of (this._handlers[t] || [])) fn({}); },
  };
}
const els = {};
const el = id => (els[id] = els[id] || makeEl(id));
const chipEls = chips.map(c => { const e = makeEl('chip:' + c.group + ':' + c.fund); e.dataset = { group: c.group, fund: c.fund }; return e; });

global.document = {
  getElementById: id => (id === 'hover' ? null : el(id)),
  querySelectorAll: sel => (sel === '.chip' ? chipEls : []),
};
global.window = { ASKSIM: require('../sim.js'), addEventListener() {} };

// --- kør sidens script
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };

try {
  eval(script);
  check('script kørt + første render', true);
} catch (e) {
  check('script kørt + første render', false, e.stack.split('\n').slice(0, 3).join(' | '));
  process.exit(1);
}

const num = t => parseFloat(String(t).replace(/\./g, '').replace(',', '.'));
check('hero A', /kr/.test(el('A_big').textContent), el('A_big').textContent);
check('hero B', /kr/.test(el('B_big').textContent), el('B_big').textContent);
check('graf tegnet', /path class="lineA"/.test(el('chart').innerHTML));
check('tabelrækker', (el('bdbody').innerHTML.match(/<tr/g) || []).length === 9);
const A0 = num(el('A_big').textContent);

try {
  el('married').checked = true; el('married').fire('change');
  check('gift fordobler loft-visning', el('ceiling_v').textContent.includes('348.400'), el('ceiling_v').textContent);
  el('married').checked = false; el('married').fire('change');

  chipEls.find(c => c.dataset.fund === 'SPVIGAKL').fire('click');
  check('SPVIGAKL-chip sætter udbytte', el('taxDiv').value === '3.2', el('taxDiv').value);
  check('SPVIGAKL-chip sætter kontant', el('dv_cash')._attrs['aria-pressed'] === 'true');
  el('dv_tech').fire('click');
  check('manuel udbyttetype løsner chip', !chipEls.find(c => c.dataset.fund === 'SPVIGAKL').classList.contains('active'));

  el('dm_kink').fire('click');
  check('høst deaktiveret i op-til-grænsen', el('harvest').disabled === true);
  el('horizon').value = '40'; el('horizon').fire('input');
  check('indekseret grænse: ingen advarsel', !/matematisk korrekt/.test(el('drawNote').textContent));
  el('reg').value = '0'; el('reg').fire('input');
  check('flad grænse: advarsel vises', /matematisk korrekt/.test(el('drawNote').textContent));

  el('dm_years').fire('click');
  el('reset').fire('click');
  check('nulstil genskaber standard', num(el('A_big').textContent) === A0 && el('taxDiv').value == 1.4 && el('dv_tech')._attrs['aria-pressed'] === 'true');

  el('seg_real').fire('click');
  check('realt-visning tegner', /path class="lineA"/.test(el('chart').innerHTML));
} catch (e) {
  check('interaktioner', false, e.stack.split('\n').slice(0, 3).join(' | '));
}

console.log(fails ? `\n${fails} FEJL` : '\nALLE TESTS BESTÅET');
process.exit(fails ? 1 : 0);
