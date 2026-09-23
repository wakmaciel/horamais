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

// Configurações que cada mês guarda (snapshot), para aumentos futuros não mudarem o passado
const CFG_KEYS = ['regime', 'salary', 'scale', 'divisor', 'pjExtra', 'pjTax', 'clt50', 'clt100', 'deps', 'dsr'];
const DEFAULT_CFG = {
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
};
const DEFAULTS = { ...DEFAULT_CFG, theme: 'auto', months: {} }; // months: { 'YYYY-MM': { h1, h2, cfg } }

const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/* ---------------- Estado ---------------- */
const pickCfg = (o) => Object.fromEntries(CFG_KEYS.map((k) => [k, o[k]]));

let state = load();
const now = new Date();
let cursor = { y: now.getFullYear(), m: now.getMonth() };
let historyYear = now.getFullYear();

function load() {
  let s;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    s = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS, months: {} };
  } catch { s = { ...DEFAULTS, months: {} }; }
  // Migração: meses antigos sem snapshot recebem a configuração atual
  for (const rec of Object.values(s.months || {})) {
    if (!rec.cfg) rec.cfg = pickCfg(s);
  }
  return s;
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* sem storage */ }
}

const keyOf = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const monthKey = () => keyOf(cursor.y, cursor.m);

// Configuração vigente de um mês: o snapshot dele, ou a configuração atual se ainda não lançado
function cfgFor(key) {
  const rec = state.months[key];
  return { ...DEFAULT_CFG, ...pickCfg(state), ...(rec && rec.cfg) };
}
const cfg = () => cfgFor(monthKey());

function monthData(key = monthKey()) {
  return state.months[key] || { h1: 0, h2: 0 };
}
function setMonthData(patch) {
  const key = monthKey();
  const rec = state.months[key] || { h1: 0, h2: 0, cfg: pickCfg(cfg()) };
  state.months[key] = { ...rec, ...patch };
  save();
}
// Ajustes valem para o mês selecionado e viram o padrão para novos lançamentos
function setCfg(patch) {
  Object.assign(state, patch);
  const rec = state.months[monthKey()];
  if (rec) rec.cfg = { ...rec.cfg, ...patch };
  save();
}

function applyTheme() {
  const t = state.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
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
// "1230" → 750 minutos (12:30). Minutos acima de 59 viram horas ("0190" → 1h + 90min = 2h30).
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
function monthName(y, m) {
  const n = new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return n[0].toUpperCase() + n.slice(1);
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
// Calcula um mês qualquer. heTotal = tudo que as horas extras renderam; total = NF (PJ) ou bruto (CLT).
function compute(y = cursor.y, m = cursor.m) {
  const key = keyOf(y, m);
  const c = cfgFor(key);
  const { h1 = 0, h2 = 0 } = monthData(key);
  const rate = c.divisor > 0 ? c.salary / c.divisor : 0;

  if (c.regime === 'PJ') {
    const extraRate = rate * (1 + (c.pjExtra || 0) / 100);
    const he = r2((h1 / 60) * extraRate);
    const nf = r2(c.salary + he);
    const tax = c.pjTax > 0 ? r2(nf * c.pjTax / 100) : 0;
    return { cfg: c, regime: 'PJ', rate, extraRate, he, nf, tax, liquido: r2(nf - tax), h1, h2: 0,
      minutes: h1, heTotal: he, total: nf };
  }

  const r50 = rate * (1 + (c.clt50 || 0) / 100);
  const r100 = rate * (1 + (c.clt100 || 0) / 100);
  const he50 = r2((h1 / 60) * r50);
  const he100 = r2((h2 / 60) * r100);
  const days = monthDays(y, m);
  const dsr = c.dsr && days.uteis ? r2(((he50 + he100) / days.uteis) * days.descanso) : 0;
  const bruto = r2(c.salary + he50 + he100 + dsr);
  const inss = calcINSS(bruto);
  const irrf = calcIRRF(bruto, inss, c.deps || 0);
  const liquido = r2(bruto - inss - irrf.valor);
  const fgts = r2(bruto * FGTS_RATE);
  return { cfg: c, regime: 'CLT', rate, r50, r100, he50, he100, dsr, days, bruto, inss, irrf, liquido, fgts, h1, h2,
    minutes: h1 + h2, heTotal: r2(he50 + he100 + dsr), total: bruto };
}

/* ---------------- Render: Calcular ---------------- */
let lastHero = null;

function renderCalc() {
  const c = compute();
  const s = c.cfg;
  const isPJ = c.regime === 'PJ';

  $('#regimePillText').textContent = c.regime;
  $('#monthLabel').textContent = `${monthName(cursor.y, cursor.m)} ${cursor.y}`;
  $('#setupHint').hidden = s.salary > 0;

  $('#statSalary').textContent = money(s.salary);
  $('#statHours').textContent = `${fmtNum(s.divisor)}h`;
  $('#statRate').textContent = money(c.rate);

  $('#h1Label').textContent = isPJ ? 'Horas extras realizadas' : 'Horas extras em dias úteis';
  $('#h1Hint').textContent = isPJ
    ? (s.pjExtra > 0 ? `+${fmtNum(s.pjExtra)}%` : '')
    : `+${fmtNum(s.clt50)}%`;
  $('#h2Hint').textContent = `+${fmtNum(s.clt100)}%`;

  const lines = [];
  const line = (label, value, cls = '', sub = '') =>
    lines.push(`<li class="${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${value}</b></li>`);

  let hero;
  if (isPJ) {
    hero = c.nf;
    $('#heroCaption').textContent = 'Valor da Nota Fiscal';
    $('#heroSub').textContent = 'Salário + horas extras';
    $('#copyText').textContent = 'Copiar valor da NF';
    line('Salário', money(s.salary));
    line('Horas extras', `+ ${money(c.he)}`, 'pos', `${fmtTimeHuman(c.h1)} × ${money(c.extraRate)}`);
    line('Total da NF', money(c.nf), 'total');
    if (c.tax > 0) {
      line(`Impostos (${fmtNum(s.pjTax)}%)`, `− ${money(c.tax)}`, 'neg muted');
      line('Líquido estimado', money(c.liquido), 'muted');
    }
    $('#footnote').textContent = `Valor hora = salário ÷ ${fmtNum(s.divisor)} horas mensais.`;
  } else {
    hero = c.liquido;
    $('#heroCaption').textContent = 'Líquido a receber';
    $('#heroSub').textContent = `Bruto ${money(c.bruto)} · salário + horas extras + DSR`;
    $('#copyText').textContent = 'Copiar valor bruto';
    line('Salário', money(s.salary));
    if (c.h1) line(`HE ${fmtNum(s.clt50)}%`, `+ ${money(c.he50)}`, 'pos', `${fmtTimeHuman(c.h1)} × ${money(c.r50)}`);
    if (c.h2) line(`HE ${fmtNum(s.clt100)}%`, `+ ${money(c.he100)}`, 'pos', `${fmtTimeHuman(c.h2)} × ${money(c.r100)}`);
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

/* ---------------- Render: Histórico ---------------- */
function yearRows(y) {
  const rows = [];
  for (let m = 0; m < 12; m++) {
    const rec = state.months[keyOf(y, m)];
    if (!rec || !((rec.h1 || 0) + (rec.h2 || 0))) { rows.push(null); continue; }
    rows.push({ y, m, ...compute(y, m) });
  }
  return rows;
}

function compactMoney(v) {
  return v >= 1000 ? `R$ ${fmtNum(Math.round(v / 100) / 10)} mil` : `R$ ${Math.round(v)}`;
}

function renderHistory() {
  $('#yearLabel').textContent = historyYear;
  const rows = yearRows(historyYear);
  const filled = rows.filter(Boolean);

  const heSum = r2(filled.reduce((a, r) => a + r.heTotal, 0));
  const totalSum = r2(filled.reduce((a, r) => a + r.total, 0));
  const minSum = filled.reduce((a, r) => a + r.minutes, 0);
  const allPJ = filled.every((r) => r.regime === 'PJ');
  const allCLT = filled.length && filled.every((r) => r.regime === 'CLT');

  $('#yearCaption').textContent = `Horas extras em ${historyYear}`;
  $('#yearHero').textContent = money(heSum);
  $('#yearSub').textContent = filled.length
    ? `${fmtTimeHuman(minSum)} em ${filled.length} ${filled.length === 1 ? 'mês' : 'meses'}`
    : 'Nenhum mês lançado neste ano';
  $('#yearTotalLabel').textContent = allPJ ? 'Total NFs' : allCLT ? 'Total bruto' : 'Total';
  $('#yearTotal').textContent = money(totalSum);
  $('#yearHours').textContent = fmtTimeHuman(minSum);
  $('#yearAvg').textContent = money(filled.length ? heSum / filled.length : 0);

  // Gráfico: uma série (R$ de HE por mês), rótulo só no maior valor
  const max = Math.max(0, ...filled.map((r) => r.heTotal));
  const maxIdx = filled.length ? rows.findIndex((r) => r && r.heTotal === max) : -1;
  const isNow = (m) => historyYear === now.getFullYear() && m === now.getMonth();
  $('#chart').innerHTML = rows.map((r, m) => {
    const v = r ? r.heTotal : 0;
    const h = max > 0 ? Math.max(v > 0 ? 3 : 0, (v / max) * 100) : 0;
    const label = m === maxIdx && v > 0 ? `<span class="bar-label" style="bottom:${h}%">${compactMoney(v)}</span>` : '';
    return `<button type="button" class="bar-col ${r ? 'has' : ''} ${isNow(m) ? 'now' : ''}" data-m="${m}"
        aria-label="${MONTHS_SHORT[m]}: ${r ? money(v) : 'sem lançamento'}">
        <span class="bar-track">${label}<span class="bar" style="height:${h}%"></span></span>
        <span class="bar-x">${MONTHS_SHORT[m][0]}</span>
      </button>`;
  }).join('');
  $('#chartTip').hidden = true;

  // Lista (também serve como a "tabela" do gráfico)
  $('#monthList').innerHTML = filled.length
    ? filled.slice().reverse().map((r) => `
      <button type="button" class="month-row" data-open="${r.m}">
        <span class="mr-left">
          <strong>${monthName(r.y, r.m)}</strong>
          <small>${fmtTimeHuman(r.minutes)} · ${r.regime} · ${money(r.rate)}/h</small>
        </span>
        <span class="mr-right">
          <b>+ ${money(r.heTotal)}</b>
          <small>${r.regime === 'PJ' ? 'NF' : 'Bruto'} ${money(r.total)}</small>
        </span>
        <svg viewBox="0 0 24 24" class="chev"><path d="M9 5l7 7-7 7"/></svg>
      </button>`).join('')
    : `<p class="empty">Lance as horas na aba <b>Calcular</b> e elas aparecem aqui, mês a mês.</p>`;
  $('#exportCsv').hidden = !filled.length;
}

function showChartTip(m) {
  const r = compute(historyYear, m);
  const rec = state.months[keyOf(historyYear, m)];
  const col = $(`#chart .bar-col[data-m="${m}"]`);
  const tip = $('#chartTip');
  $$('#chart .bar-col').forEach((b) => b.classList.toggle('sel', b === col));
  tip.innerHTML = rec && r.minutes
    ? `<strong>${monthName(historyYear, m)}</strong><span>${money(r.heTotal)} · ${fmtTimeHuman(r.minutes)}</span>`
    : `<strong>${monthName(historyYear, m)}</strong><span>sem lançamento</span>`;
  tip.hidden = false;
  // Posiciona logo acima da barra, sem invadir o título do cartão
  const card = col.closest('.chart-card').getBoundingClientRect();
  const chart = $('#chart').getBoundingClientRect();
  const bar = col.querySelector('.bar').getBoundingClientRect();
  const x = bar.left - card.left + bar.width / 2;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(card.width - w - 8, Math.max(8, x - w / 2))}px`;
  tip.style.top = `${Math.max(chart.top - card.top, bar.top - card.top - h - 8)}px`;
}

/* ---------------- Render: Ajustes ---------------- */
function renderSettings() {
  const s = cfg();
  const hasRec = !!state.months[monthKey()];
  $('#settingsEyebrow').textContent = `Configuração · ${monthName(cursor.y, cursor.m)} ${cursor.y}`;
  $('#scopeNote').textContent = hasRec
    ? `Alterações valem para ${monthName(cursor.y, cursor.m)}/${cursor.y} e para os próximos meses que você lançar. Meses anteriores mantêm os valores da época.`
    : 'Alterações valem para os próximos meses que você lançar. Meses já lançados mantêm os valores da época.';

  $('#themeSeg').dataset.value = state.theme || 'auto';
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.value === (state.theme || 'auto')));

  const seg = $('#regimeSeg');
  seg.dataset.value = s.regime;
  $$('#regimeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.value === s.regime));
  $('#regimeHelp').textContent = s.regime === 'PJ'
    ? 'PJ: hora extra = valor hora × horas. O total é o valor para emitir a nota fiscal.'
    : 'CLT: aplica adicionais legais, DSR e descontos de INSS e IRRF.';

  $('#scales').innerHTML = SCALES.map((sc) => {
    const h = s.regime === 'PJ' ? sc.pj : sc.clt;
    const sub = h ? `${sc.desc} · ${h}h/mês` : sc.desc;
    return `<button type="button" class="glass scale ${s.scale === sc.id ? 'on' : ''}" data-scale="${sc.id}">
      <strong>${sc.title}</strong><span>${sub}</span></button>`;
  }).join('');

  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('#salary', s.salary ? money(s.salary) : '');
  set('#divisor', fmtNum(s.divisor));
  set('#pjExtra', s.pjExtra ? fmtNum(s.pjExtra) : '');
  set('#pjTax', s.pjTax ? fmtNum(s.pjTax) : '');
  set('#clt50', fmtNum(s.clt50));
  set('#clt100', fmtNum(s.clt100));
  set('#deps', s.deps ? String(s.deps) : '');
  $('#dsr').checked = !!s.dsr;

  $('#divisorHelp').textContent = s.regime === 'PJ'
    ? 'Divisor do salário para achar o valor da hora. Ex.: 21 dias úteis × 8h = 168h.'
    : 'Divisor legal CLT: 44h semanais = 220h, 40h = 200h, 36h = 180h, 30h = 150h.';
}

let currentTab = 'calc';
function render() {
  document.body.dataset.regime = cfg().regime;
  renderCalc();
  renderSettings();
  if (currentTab === 'history') renderHistory();
}

/* ---------------- Navegação ---------------- */
function goTo(tab) {
  currentTab = tab;
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

// Compartilha (iOS: salvar em Arquivos, mandar no WhatsApp...) ou baixa o arquivo
async function shareFile(name, type, content) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportCsv() {
  const rows = yearRows(historyYear).filter(Boolean);
  const n = (v) => num.format(v);
  const head = ['Mês', 'Regime', 'Salário', 'Horas mensais', 'Valor hora', 'Horas extras', 'Valor HE (R$)', 'Total NF/Bruto (R$)'];
  const body = rows.map((r) => [
    `${MONTHS_SHORT[r.m]}/${r.y}`, r.regime, n(r.cfg.salary), fmtNum(r.cfg.divisor), n(r.rate),
    fmtTime(r.minutes), n(r.heTotal), n(r.total),
  ]);
  const tot = ['Total', '', '', '', '', fmtTime(rows.reduce((a, r) => a + r.minutes, 0)),
    n(rows.reduce((a, r) => a + r.heTotal, 0)), n(rows.reduce((a, r) => a + r.total, 0))];
  const csv = '﻿' + [head, ...body, tot].map((l) => l.join(';')).join('\r\n');
  shareFile(`horas-extras-${historyYear}.csv`, 'text/csv', csv);
}

/* ---------------- Eventos ---------------- */
function bind() {
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.goto)));
  $('#regimePill').addEventListener('click', () => goTo('settings'));

  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));
  $('#prevYear').addEventListener('click', () => { historyYear--; renderHistory(); });
  $('#nextYear').addEventListener('click', () => { historyYear++; renderHistory(); });

  // Histórico: toque na barra mostra o valor; toque no mês da lista abre no Calcular
  const hideChartTip = () => {
    $('#chartTip').hidden = true;
    $$('#chart .bar-col').forEach((b) => b.classList.remove('sel'));
  };
  $('#chart').addEventListener('click', (e) => {
    const col = e.target.closest('.bar-col');
    if (!col) return;
    if (col.classList.contains('sel') && e.pointerType !== 'mouse') hideChartTip(); // tocar de novo fecha
    else showChartTip(Number(col.dataset.m));
  });
  $('#chart').addEventListener('pointerover', (e) => {
    const col = e.target.closest('.bar-col');
    if (col && e.pointerType === 'mouse') showChartTip(Number(col.dataset.m));
  });
  $('#chart').addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideChartTip();
  });
  $('#monthList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (!row) return;
    cursor = { y: historyYear, m: Number(row.dataset.open) };
    lastHero = null;
    goTo('calc');
  });
  $('#exportCsv').addEventListener('click', exportCsv);

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
    const v = num.format(compute().total);
    try {
      await navigator.clipboard.writeText(v);
      toast(`Copiado: ${v}`);
    } catch {
      toast(v);
    }
  });

  // Regime
  $$('#regimeSeg button').forEach((b) => b.addEventListener('click', () => {
    const s = cfg();
    if (s.regime === b.dataset.value) return;
    const patch = { regime: b.dataset.value };
    const sc = SCALES.find((x) => x.id === s.scale);
    if (sc && sc.id !== 'custom') patch.divisor = patch.regime === 'PJ' ? sc.pj : sc.clt;
    setCfg(patch); render();
  }));

  // Tema
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    state.theme = b.dataset.value;
    save(); applyTheme(); renderSettings();
  }));

  // Escalas
  $('#scales').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scale]');
    if (!btn) return;
    const sc = SCALES.find((x) => x.id === btn.dataset.scale);
    const patch = { scale: sc.id };
    if (sc.id !== 'custom') patch.divisor = cfg().regime === 'PJ' ? sc.pj : sc.clt;
    setCfg(patch); render();
    if (sc.id === 'custom') $('#divisor').focus();
  });

  // Salário (máscara monetária)
  const sal = $('#salary');
  sal.addEventListener('input', () => {
    const cents = parseInt(sal.value.replace(/\D/g, '').slice(-11) || '0', 10);
    setCfg({ salary: cents / 100 });
    sal.value = cents ? money(cents / 100) : '';
    renderCalc();
  });
  sal.addEventListener('keydown', (e) => { if (e.key === 'Enter') sal.blur(); });

  // Numéricos
  const numField = (id, key, { int = false, min = 0 } = {}) => {
    const el = $(id);
    el.addEventListener('input', () => {
      let v = parseNum(el.value);
      if (int) v = Math.floor(v);
      const patch = { [key]: Math.max(min, v) };
      if (key === 'divisor') {
        const s = cfg();
        const sc = SCALES.find((x) => x.id === s.scale);
        const def = sc && (s.regime === 'PJ' ? sc.pj : sc.clt);
        if (def !== patch.divisor) {
          patch.scale = 'custom';
          $$('#scales .scale').forEach((b) => b.classList.toggle('on', b.dataset.scale === 'custom'));
        }
      }
      setCfg(patch); renderCalc();
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

  $('#dsr').addEventListener('change', (e) => { setCfg({ dsr: e.target.checked }); renderCalc(); });

  // Backup
  $('#backupBtn').addEventListener('click', () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    shareFile(`horaplus-backup-${stamp}.json`, 'application/json', JSON.stringify(state, null, 2));
  });
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || typeof data.months !== 'object') throw new Error('formato');
      const n = Object.keys(data.months).length;
      if (!confirm(`Restaurar backup com ${n} ${n === 1 ? 'mês' : 'meses'}? Os dados atuais deste aparelho serão substituídos.`)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      state = load();
      save();
      applyTheme();
      render();
      toast('Backup restaurado');
    } catch {
      toast('Arquivo de backup inválido');
    }
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Apagar salário, escala e todo o histórico salvo neste aparelho?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nada */ }
    state = { ...DEFAULTS, months: {} };
    applyTheme();
    render();
    toast('Dados apagados');
  });
}

function shiftMonth(delta) {
  const d = new Date(cursor.y, cursor.m + delta, 1);
  cursor = { y: d.getFullYear(), m: d.getMonth() };
  lastHero = null;
  render();
}

function greet() {
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/* ---------------- Init ---------------- */
applyTheme();
greet();
bind();
goTo(cfg().salary > 0 ? 'calc' : 'settings');

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
