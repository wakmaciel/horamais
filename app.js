'use strict';

/* =========================================================
   Hora+ — calculadora de horas extras (PJ e CLT)
   ========================================================= */

const STORAGE_KEY = 'horaplus:v1';

// Escalas: divisor mensal padrão por regime.
// CLT usa o divisor legal (44h → 220, 40h → 200 ...).
// PJ usa horas efetivamente trabalhadas no mês (ex.: 21 dias × 8h = 168).
const SCALES = [
  { id: '44',     title: '44h',       desc: 'semanais', pj: 168, clt: 220 },
  { id: '40',     title: '40h',       desc: 'semanais', pj: 160, clt: 200 },
  { id: '36',     title: '36h',       desc: 'semanais', pj: 144, clt: 180 },
  { id: '30',     title: '30h',       desc: 'semanais', pj: 120, clt: 150 },
  { id: '12x36',  title: '12x36',     desc: 'plantão',  pj: 180, clt: 180 },
  { id: 'custom', title: 'Personalizada', desc: 'defina as horas', pj: null, clt: null },
];

// Tabelas 2026
const INSS_2026 = [ // faixas progressivas (teto R$ 8.475,55)
  { upTo: 1621.00, rate: 0.075 },
  { upTo: 2902.84, rate: 0.09 },
  { upTo: 4354.27, rate: 0.12 },
  { upTo: 8475.55, rate: 0.14 },
];
const IRRF_2026 = [
  { upTo: 2428.80,  rate: 0,     ded: 0 },
  { upTo: 2826.65,  rate: 0.075, ded: 182.16 },
  { upTo: 3751.05,  rate: 0.15,  ded: 394.16 },
  { upTo: 4664.68,  rate: 0.225, ded: 675.49 },
  { upTo: Infinity, rate: 0.275, ded: 908.73 },
];
const IRRF_DEP = 189.59;          // dedução por dependente
const IRRF_SIMPLIFICADO = 607.20; // desconto simplificado mensal
const FGTS_RATE = 0.08;

const DEFAULTS = {
  regime: 'PJ',
  salary: 0,
  scale: '44',
  divisor: 168,
  pjExtra: 0,
  pjTax: 0,
  clt50: 50,
  clt100: 100,
  deps: 0,
  dsr: true,
  months: {}, // { 'YYYY-MM': { h1: minutos, h2: minutos } }
};

/* ---------------- Estado ---------------- */
let state = load();
const now = new Date();
let cursor = { y: now.getFullYear(), m: now.getMonth() };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* sem storage */ }
}
const monthKey = () => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
function monthData() {
  return state.months[monthKey()] || { h1: 0, h2: 0 };
}
function setMonthData(patch) {
  state.months[monthKey()] = { ...monthData(), ...patch };
  save();
}

/* ---------------- Utilidades ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => brl.format(v || 0);
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function parseNum(str) {
  if (typeof str === 'number') return str;
  const s = String(str || '').trim().replace(/\s|R\$/g, '');
  if (!s) return 0;
  // "1.234,56" → 1234.56 | "12,5" → 12.5 | "12.5" → 12.5
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : 0;
}
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(v).replace('.', ','));

function fmtTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fmtTimeHuman(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!m) return `${h}h`;
  if (!h) return `${m}min`;
  return `${h}h${String(m).padStart(2, '0')}`;
}
// "1230" → 750 minutos (12:30). Minutos acima de 59 viram horas ("0190" → 1h30 + 1h = 2h30).
function digitsToMinutes(digits) {
  const d = String(digits).replace(/\D/g, '');
  if (!d) return 0;
  const mm = parseInt(d.slice(-2), 10) || 0;
  const hh = parseInt(d.slice(0, -2) || '0', 10);
  return hh * 60 + mm;
}
// Exibe o buffer cru enquanto digita: "175" → "01:75"
function fmtDigits(d) {
  const p = d.padStart(4, '0');
  return `${p.slice(0, -2)}:${p.slice(-2)}`;
}

/* ---------------- Calendário (DSR) ---------------- */
function easter(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function nationalHolidays(y) {
  const e = easter(y);
  const goodFriday = new Date(y, e.getMonth(), e.getDate() - 2);
  const list = [
    [0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [10, 20], [11, 25],
  ].map(([m, d]) => new Date(y, m, d));
  list.push(goodFriday);
  return new Set(list.map((d) => `${d.getMonth()}-${d.getDate()}`));
}
// Dias úteis (seg–sáb) e dias de descanso (domingos + feriados) do mês
function monthDays(y, m) {
  const hol = nationalHolidays(y);
  const last = new Date(y, m + 1, 0).getDate();
  let uteis = 0, descanso = 0;
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m, d);
    if (dt.getDay() === 0 || hol.has(`${m}-${d}`)) descanso++;
    else uteis++;
  }
  return { uteis, descanso };
}

/* ---------------- Impostos CLT ---------------- */
function calcINSS(base) {
  let total = 0, prev = 0;
  for (const f of INSS_2026) {
    if (base <= prev) break;
    total += (Math.min(base, f.upTo) - prev) * f.rate;
    prev = f.upTo;
  }
  return r2(total);
}
function irrfTable(base) {
  if (base <= 0) return 0;
  const f = IRRF_2026.find((x) => base <= x.upTo);
  return Math.max(0, base * f.rate - f.ded);
}
function calcIRRF(bruto, inss, deps) {
  const baseLegal = bruto - inss - deps * IRRF_DEP;
  const baseSimpl = bruto - IRRF_SIMPLIFICADO;
  const base = Math.min(baseLegal, baseSimpl); // usa o mais vantajoso
  let imposto = irrfTable(base);
  // Redutor da Lei 15.270/2025 (isenção até R$ 5.000)
  let redutor = 0;
  if (bruto <= 5000) redutor = Math.min(imposto, 312.89);
  else if (bruto <= 7350) redutor = Math.max(0, 978.62 - 0.133145 * bruto);
  imposto = Math.max(0, imposto - redutor);
  return { valor: r2(imposto), base: r2(base) };
}

/* ---------------- Cálculo principal ---------------- */
function compute() {
  const { regime, salary, divisor } = state;
  const { h1, h2 } = monthData();
  const rate = divisor > 0 ? salary / divisor : 0;

  if (regime === 'PJ') {
    const extraRate = rate * (1 + (state.pjExtra || 0) / 100);
    const he = r2((h1 / 60) * extraRate);
    const nf = r2(salary + he);
    const tax = state.pjTax > 0 ? r2(nf * state.pjTax / 100) : 0;
    return { regime, rate, extraRate, he, nf, tax, liquido: r2(nf - tax), h1 };
  }

  const r50 = rate * (1 + (state.clt50 || 0) / 100);
  const r100 = rate * (1 + (state.clt100 || 0) / 100);
  const he50 = r2((h1 / 60) * r50);
  const he100 = r2((h2 / 60) * r100);
  const days = monthDays(cursor.y, cursor.m);
  const dsr = state.dsr && days.uteis ? r2(((he50 + he100) / days.uteis) * days.descanso) : 0;
  const bruto = r2(salary + he50 + he100 + dsr);
  const inss = calcINSS(bruto);
  const irrf = calcIRRF(bruto, inss, state.deps || 0);
  const liquido = r2(bruto - inss - irrf.valor);
  const fgts = r2(bruto * FGTS_RATE);
  return { regime, rate, r50, r100, he50, he100, dsr, days, bruto, inss, irrf, liquido, fgts, h1, h2 };
}

/* ---------------- Render ---------------- */
let lastHero = null;

function renderCalc() {
  const c = compute();
  const isPJ = c.regime === 'PJ';
  document.body.dataset.regime = c.regime;

  $('#regimePillText').textContent = c.regime;
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('pt-BR', { month: 'long' });
  $('#monthLabel').textContent = `${monthName[0].toUpperCase()}${monthName.slice(1)} ${cursor.y}`;
  $('#setupHint').hidden = state.salary > 0;

  $('#statSalary').textContent = money(state.salary);
  $('#statHours').textContent = `${fmtNum(state.divisor)}h`;
  $('#statRate').textContent = money(c.rate);

  $('#h1Label').textContent = isPJ ? 'Horas extras realizadas' : 'Horas extras em dias úteis';
  $('#h1Hint').textContent = isPJ
    ? (state.pjExtra > 0 ? `+${fmtNum(state.pjExtra)}%` : '')
    : `+${fmtNum(state.clt50)}%`;
  $('#h2Hint').textContent = `+${fmtNum(state.clt100)}%`;

  const lines = [];
  const line = (label, value, cls = '', sub = '') =>
    lines.push(`<li class="${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${value}</b></li>`);

  let hero;
  if (isPJ) {
    hero = c.nf;
    $('#heroCaption').textContent = 'Valor da Nota Fiscal';
    $('#heroSub').textContent = 'Salário + horas extras';
    $('#copyText').textContent = 'Copiar valor da NF';
    line('Salário', money(state.salary));
    line('Horas extras', `+ ${money(c.he)}`, 'pos', `${fmtTimeHuman(c.h1)} × ${money(c.extraRate)}`);
    line('Total da NF', money(c.nf), 'total');
    if (c.tax > 0) {
      line(`Impostos (${fmtNum(state.pjTax)}%)`, `− ${money(c.tax)}`, 'neg muted');
      line('Líquido estimado', money(c.liquido), 'muted');
    }
    $('#footnote').textContent = `Valor hora = salário ÷ ${fmtNum(state.divisor)} horas mensais.`;
  } else {
    hero = c.liquido;
    $('#heroCaption').textContent = 'Líquido a receber';
    $('#heroSub').textContent = `Bruto ${money(c.bruto)} · salário + horas extras + DSR`;
    $('#copyText').textContent = 'Copiar valor bruto';
    line('Salário', money(state.salary));
    if (c.h1) line(`HE ${fmtNum(state.clt50)}%`, `+ ${money(c.he50)}`, 'pos', `${fmtTimeHuman(c.h1)} × ${money(c.r50)}`);
    if (c.h2) line(`HE ${fmtNum(state.clt100)}%`, `+ ${money(c.he100)}`, 'pos', `${fmtTimeHuman(c.h2)} × ${money(c.r100)}`);
    if (c.dsr) line('DSR sobre HE', `+ ${money(c.dsr)}`, 'pos', `${c.days.descanso} domingos/feriados ÷ ${c.days.uteis} dias úteis`);
    line('Total bruto', money(c.bruto));
    line('INSS', `− ${money(c.inss)}`, 'neg');
    line('IRRF', `− ${money(c.irrf.valor)}`, 'neg', c.irrf.valor === 0 && c.bruto <= 5000 ? 'isento (até R$ 5.000)' : '');
    line('Líquido', money(c.liquido), 'total');
    line('FGTS depositado', money(c.fgts), 'muted', '8% pago pela empresa, não desconta');
    $('#footnote').textContent =
      'Estimativa com tabelas INSS/IRRF 2026 e feriados nacionais. Não inclui adicional noturno, faltas, VT, benefícios ou regras de convenção coletiva.';
  }

  $('#lines').innerHTML = lines.join('');
  const heroEl = $('#heroValue');
  heroEl.textContent = money(hero);
  if (lastHero !== null && lastHero !== hero) {
    heroEl.classList.remove('bump'); void heroEl.offsetWidth; heroEl.classList.add('bump');
  }
  lastHero = hero;

  const { h1, h2 } = monthData();
  if (document.activeElement !== $('#h1')) $('#h1').value = fmtTime(h1);
  if (document.activeElement !== $('#h2')) $('#h2').value = fmtTime(h2);
}

function renderSettings() {
  const seg = $('#regimeSeg');
  seg.dataset.value = state.regime;
  $$('#regimeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.value === state.regime));
  $('#regimeHelp').textContent = state.regime === 'PJ'
    ? 'PJ: hora extra = valor hora × horas. O total é o valor para emitir a nota fiscal.'
    : 'CLT: aplica adicionais legais, DSR e descontos de INSS e IRRF.';

  $('#scales').innerHTML = SCALES.map((s) => {
    const h = state.regime === 'PJ' ? s.pj : s.clt;
    const sub = h ? `${s.desc} · ${h}h/mês` : s.desc;
    return `<button type="button" class="glass scale ${state.scale === s.id ? 'on' : ''}" data-scale="${s.id}">
      <strong>${s.title}</strong><span>${sub}</span></button>`;
  }).join('');

  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('#salary', state.salary ? money(state.salary) : '');
  set('#divisor', fmtNum(state.divisor));
  set('#pjExtra', state.pjExtra ? fmtNum(state.pjExtra) : '');
  set('#pjTax', state.pjTax ? fmtNum(state.pjTax) : '');
  set('#clt50', fmtNum(state.clt50));
  set('#clt100', fmtNum(state.clt100));
  set('#deps', state.deps ? String(state.deps) : '');
  $('#dsr').checked = !!state.dsr;

  $('#divisorHelp').textContent = state.regime === 'PJ'
    ? 'Divisor do salário para achar o valor da hora. Ex.: 21 dias úteis × 8h = 168h.'
    : 'Divisor legal CLT: 44h semanais = 220h, 40h = 200h, 36h = 180h, 30h = 150h.';
}

function render() {
  document.body.dataset.regime = state.regime;
  renderCalc();
  renderSettings();
}

/* ---------------- Navegação ---------------- */
function goTo(tab) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.goto === tab));
  $('#tabbar').dataset.tab = tab;
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------- Eventos ---------------- */
function bind() {
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.goto)));
  $('#regimePill').addEventListener('click', () => goTo('settings'));

  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));

  // Campos de horas (máscara hh:mm)
  ['h1', 'h2'].forEach((key) => {
    const el = $(`#${key}`);
    // Digitação estilo caixa registradora: os dígitos entram pela direita,
    // independente de onde está o cursor. Ex.: 1 → 00:01, 12 → 00:12, 1230 → 12:30.
    let buf = '';
    const apply = (digits) => {
      buf = digits.replace(/\D/g, '').replace(/^0+/, '').slice(-5);
      el.value = fmtDigits(buf);
      setMonthData({ [key]: digitsToMinutes(buf) });
      renderCalc();
    };
    const caretEnd = () => requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    el.addEventListener('focus', () => {
      buf = fmtTime(monthData()[key] || 0).replace(/\D/g, '').replace(/^0+/, '');
      caretEnd();
    });
    el.addEventListener('click', caretEnd);
    el.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' || e.inputType === 'insertReplacementText') {
        e.preventDefault();
        const add = (e.data || '').replace(/\D/g, '');
        if (add) apply(buf + add);
      } else if (e.inputType.startsWith('delete')) {
        e.preventDefault();
        apply(buf.slice(0, -1));
      }
      caretEnd();
    });
    el.addEventListener('input', () => apply(el.value)); // colar / autofill
    el.addEventListener('blur', () => { el.value = fmtTime(monthData()[key] || 0); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
    el.closest('.stepper').querySelectorAll('.step').forEach((btn) =>
      btn.addEventListener('click', () => {
        const cur = monthData()[key] || 0;
        const next = Math.max(0, cur + Number(btn.dataset.step));
        setMonthData({ [key]: next });
        el.value = fmtTime(next);
        if (navigator.vibrate) navigator.vibrate(8);
        renderCalc();
      }));
  });

  // Copiar
  $('#copyBtn').addEventListener('click', async () => {
    const c = compute();
    const v = num.format(c.regime === 'PJ' ? c.nf : c.bruto);
    try {
      await navigator.clipboard.writeText(v);
      toast(`Copiado: ${v}`);
    } catch {
      toast(v);
    }
  });

  // Regime
  $$('#regimeSeg button').forEach((b) => b.addEventListener('click', () => {
    if (state.regime === b.dataset.value) return;
    state.regime = b.dataset.value;
    const s = SCALES.find((x) => x.id === state.scale);
    if (s && s.id !== 'custom') state.divisor = state.regime === 'PJ' ? s.pj : s.clt;
    save(); render();
  }));

  // Escalas
  $('#scales').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scale]');
    if (!btn) return;
    const s = SCALES.find((x) => x.id === btn.dataset.scale);
    state.scale = s.id;
    if (s.id === 'custom') {
      $('#divisor').focus();
    } else {
      state.divisor = state.regime === 'PJ' ? s.pj : s.clt;
    }
    save(); render();
  });

  // Salário (máscara monetária)
  const sal = $('#salary');
  sal.addEventListener('input', () => {
    const cents = parseInt(sal.value.replace(/\D/g, '').slice(-11) || '0', 10);
    state.salary = cents / 100;
    sal.value = cents ? money(state.salary) : '';
    save(); renderCalc();
  });

  // Numéricos
  const numField = (id, key, { int = false, min = 0 } = {}) => {
    const el = $(id);
    el.addEventListener('input', () => {
      let v = parseNum(el.value);
      if (int) v = Math.floor(v);
      state[key] = Math.max(min, v);
      if (key === 'divisor') {
        const s = SCALES.find((x) => x.id === state.scale);
        const def = s && (state.regime === 'PJ' ? s.pj : s.clt);
        if (def !== state.divisor) {
          state.scale = 'custom';
          $$('#scales .scale').forEach((b) => b.classList.toggle('on', b.dataset.scale === 'custom'));
        }
      }
      save(); renderCalc();
    });
    el.addEventListener('blur', renderSettings);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  };
  numField('#divisor', 'divisor');
  numField('#pjExtra', 'pjExtra');
  numField('#pjTax', 'pjTax');
  numField('#clt50', 'clt50');
  numField('#clt100', 'clt100');
  numField('#deps', 'deps', { int: true });
  sal.addEventListener('keydown', (e) => { if (e.key === 'Enter') sal.blur(); });

  $('#dsr').addEventListener('change', (e) => { state.dsr = e.target.checked; save(); renderCalc(); });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Apagar salário, escala e horas salvas neste aparelho?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nada */ }
    state = { ...DEFAULTS, months: {} };
    render();
    toast('Dados apagados');
  });
}

function shiftMonth(delta) {
  const d = new Date(cursor.y, cursor.m + delta, 1);
  cursor = { y: d.getFullYear(), m: d.getMonth() };
  lastHero = null;
  renderCalc();
}

function greet() {
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/* ---------------- Init ---------------- */
greet();
bind();
render();
goTo(state.salary > 0 ? 'calc' : 'settings');

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
