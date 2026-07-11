// Smoke test of the page itself: stubs the DOM, runs index.html's script, and
// clicks around. Run with:  node test/ui.test.js  — no dependencies.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// --- parse default values and preset chips out of the markup
const attrs = {};
for (const m of html.matchAll(/<input\b[^>]*>/g)) {
  const tag = m[0];
  const id = (tag.match(/id="([^"]+)"/) || [])[1];
  if (!id) continue;
  attrs[id] = {
    type: (tag.match(/type="([^"]+)"/) || [])[1] || 'text',
    value: (tag.match(/value="([^"]*)"/) || [])[1] || '',
    min: (tag.match(/min="([^"]*)"/) || [])[1] || '',
    max: (tag.match(/max="([^"]*)"/) || [])[1] || '',
    checked: /\bchecked\b/.test(tag),
  };
}
const chips = [...html.matchAll(/<button class="chip" data-group="([^"]+)" data-fund="([^"]+)"/g)]
  .map(m => ({ group: m[1], fund: m[2] }));

// --- minimal element stub
function makeEl(id) {
  const a = attrs[id] || {};
  return {
    id, type: a.type, value: a.value, min: a.min, max: a.max, checked: !!a.checked, disabled: false,
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

// --- run the page's script
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };

try {
  eval(script);
  check('script executed + initial render', true);
} catch (e) {
  check('script executed + initial render', false, e.stack.split('\n').slice(0, 3).join(' | '));
  process.exit(1);
}

const num = t => parseFloat(String(t).replace(/\./g, '').replace(',', '.'));
check('hero A', /kr/.test(el('A_big').textContent), el('A_big').textContent);
check('hero B', /kr/.test(el('B_big').textContent), el('B_big').textContent);
check('chart drawn', /path class="lineA"/.test(el('chart').innerHTML));
check('table rows', (el('bdbody').innerHTML.match(/<tr/g) || []).length === 10);
const A0 = num(el('A_big').textContent);

try {
  el('married').checked = true; el('married').fire('change');
  check('married doubles displayed ceiling', el('ceiling_v').textContent.includes('348.400'), el('ceiling_v').textContent);
  el('married').checked = false; el('married').fire('change');

  // out-of-range typed input is clamped for the calculation, never NaN in the UI
  el('gross').value = '-50'; el('gross').fire('input');
  check('negative return input clamped, no NaN', isFinite(num(el('A_big').textContent)), el('A_big').textContent);
  el('askTer').value = '250'; el('askTer').fire('input');
  check('absurd TER clamped, no NaN', isFinite(num(el('A_big').textContent)), el('A_big').textContent);
  el('reset').fire('click');

  chipEls.find(c => c.dataset.fund === 'Saxo').fire('click');
  check('Saxo chip sets both fee schedules', el('feeMin').value === '10' && el('askFeeMin').value === '22.4',
        el('feeMin').value + '/' + el('askFeeMin').value);
  chipEls.find(c => c.dataset.fund === 'Nordnet').fire('click');

  chipEls.find(c => c.dataset.fund === 'SPVIGAKL').fire('click');
  check('SPVIGAKL chip sets distribution', el('taxDiv').value === '3.2', el('taxDiv').value);
  check('SPVIGAKL chip sets cash mode', el('dv_cash')._attrs['aria-pressed'] === 'true');
  el('dv_tech').fire('click');
  check('manual dividend type detaches chip', !chipEls.find(c => c.dataset.fund === 'SPVIGAKL').classList.contains('active'));

  el('dm_kink').fire('click');
  check('harvest disabled in up-to-threshold mode', el('harvest').disabled === true);
  check('indexed threshold: no warning at default horizon', !/tvangssælges|matematisk korrekt/.test(el('drawNote').textContent), el('drawNote').textContent);
  el('reg').value = '0'; el('reg').fire('input');
  check('flat threshold: forced-sale warning shown', /tvangssælges/.test(el('drawNote').textContent));
  check('flat threshold: warning names the 30-year window', /30/.test(el('drawNote').textContent));

  el('dm_years').fire('click');
  el('reset').fire('click');
  check('reset restores defaults', num(el('A_big').textContent) === A0 && el('taxDiv').value == 1.4 && el('dv_tech')._attrs['aria-pressed'] === 'true');

  const Ad = num(el('A_big').textContent);   // defaults again after reset (ms = depot)
  el('ms_none').fire('click');
  check('ms=none: A drops (depot buys pay kurtage too)', num(el('A_big').textContent) < Ad);
  el('ms_both').fire('click');
  check('ms=both: A rises (ASK buys free)', num(el('A_big').textContent) > Ad);
  el('reset').fire('click');
  check('reset restores månedsopsparing default', el('ms_depot')._attrs['aria-pressed'] === 'true');

  el('seg_real').fire('click');
  check('real-terms view renders', /path class="lineA"/.test(el('chart').innerHTML));
} catch (e) {
  check('interactions', false, e.stack.split('\n').slice(0, 3).join(' | '));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL TESTS PASS');
process.exit(fails ? 1 : 0);
