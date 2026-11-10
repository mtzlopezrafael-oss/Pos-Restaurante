// Pantalla de reportes: ventas de un periodo.

import { h, fill, money, plural, call, safe, isoDay, METHOD } from '../ui.js';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d;
};

// Cada periodo calcula sus fechas al momento de tocarlo.
const RANGES = [
  { id: 'hoy', label: 'Hoy', dates: () => [new Date(), new Date()] },
  { id: 'ayer', label: 'Ayer', dates: () => [daysAgo(1), daysAgo(1)] },
  { id: 'semana', label: 'Últimos 7 días', dates: () => [daysAgo(6), new Date()] },
  { id: 'mes', label: 'Este mes', dates: () => [monthStart(), new Date()] },
];

const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function dayLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return `${DAY_NAMES[d.getDay()]} ${day}/${month}`;
}

let root = null;
let active = 'hoy';

export async function mount(container) {
  root = container;
  root.className = 'screen-page';
  await load();
}

async function load() {
  const [from, to] = RANGES.find((r) => r.id === active).dates().map(isoDay);
  paint(await call('reports.sales', { from, to }));
}

// Renglon con una barra proporcional: se compara de un vistazo sin graficas.
function barRow(label, detail, amount, max) {
  const percent = max > 0 ? Math.max(2, Math.round((amount / max) * 100)) : 0;
  return h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, label, detail && h('small', null, detail)),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${percent}%` } })),
    h('span', { class: 'num' }, money(amount)));
}

function paint(report) {
  const maxProduct = Math.max(0, ...report.topProducts.map((p) => p.total));
  const maxDay = Math.max(0, ...report.byDay.map((d) => d.total));

  fill(root,
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Reportes'))),
    h('div', { class: 'tabs' },
      RANGES.map((range) =>
        h('button', {
          class: `tab ${range.id === active ? 'active' : ''}`,
          type: 'button',
          onClick: safe(async () => {
            active = range.id;
            await load();
          }),
        }, range.label))),

    report.count === 0
      ? h('div', { class: 'empty' }, h('p', null, 'No hay ventas cobradas en este periodo.'))
      : [
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('strong', null, money(report.total)), h('span', null, 'vendido')),
            h('div', { class: 'stat' }, h('strong', null, String(report.count)), h('span', null, report.count === 1 ? 'cuenta cobrada' : 'cuentas cobradas')),
            h('div', { class: 'stat' }, h('strong', null, money(report.average)), h('span', null, 'promedio por cuenta'))),
          report.cancelled > 0 && h('p', { class: 'muted' }, `${plural(report.cancelled, 'venta cancelada', 'ventas canceladas')} en el periodo (no se suman).`),

          h('div', { class: 'two-col' },
            h('section', { class: 'card' },
              h('h2', null, 'Forma de pago'),
              report.byMethod.map((m) => barRow(METHOD[m.method], plural(m.count, 'cuenta', 'cuentas'), m.total, report.total))),
            report.byDay.length > 1 && h('section', { class: 'card' },
              h('h2', null, 'Por día'),
              report.byDay.map((d) => barRow(dayLabel(d.day), plural(d.count, 'cuenta', 'cuentas'), d.total, maxDay)))),

          h('section', { class: 'card' },
            h('h2', null, 'Lo más vendido'),
            report.topProducts.map((p) => barRow(p.name, plural(p.qty, 'vendido', 'vendidos'), p.total, maxProduct))),
        ]
  );
}
