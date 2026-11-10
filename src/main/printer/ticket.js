// Formato de lo que se imprime: ticket de venta, corte de caja y prueba.
const { EscPos } = require('./escpos');

const METHOD = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };

// 123456 centavos -> "$1,234.56"
function money(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${pesos}.${String(abs % 100).padStart(2, '0')}`;
}

// Fecha ISO en UTC -> "10/11/2026 08:46" en la hora de la computadora.
function stamp(iso) {
  const d = new Date(iso);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function start(settings) {
  return new EscPos({ columns: Number(settings.printerColumns), encoding: settings.printerEncoding });
}

function header(p, settings) {
  p.align('center').bold(true).size(2, 2).wrapped(settings.businessName).size(1, 1).bold(false);
  if (settings.ticketHeader.trim()) p.wrapped(settings.ticketHeader);
  return p.align('left');
}

function saleTicket(order, settings, { openDrawer = false } = {}) {
  const p = start(settings);
  if (openDrawer) p.kickDrawer(); // primero el cajon: abre mientras se imprime
  header(p, settings).rule();

  p.pair(`Folio ${order.id}`, stamp(order.paid_at || order.created_at));
  if (order.label) p.bold(true).line(order.label).bold(false);
  if (order.status === 'cancelled') p.bold(true).line('*** VENTA CANCELADA ***').bold(false);
  p.rule();

  for (const item of order.items) {
    p.pair(`${item.qty} x ${item.name}`, money(item.qty * item.price));
    if (item.note) p.wrapped(`(${item.note})`, 3);
  }
  p.rule();

  p.bold(true).size(1, 2).pair('Total', money(order.total)).size(1, 1).bold(false);
  if (order.payment_method === 'cash') {
    p.pair('Efectivo', money(order.cash_received));
    p.pair('Cambio', money(order.change_given));
  } else if (order.payment_method) {
    p.line(`Pago con ${METHOD[order.payment_method].toLowerCase()}`);
  }

  if (settings.ticketFooter.trim()) p.feed(1).align('center').wrapped(settings.ticketFooter).align('left');
  return p.feed(3).cut().build();
}

function cashCloseTicket(summary, settings) {
  const { session } = summary;
  const p = start(settings);
  header(p, settings);
  p.align('center').bold(true).line('Corte de caja').bold(false).align('left').rule();

  p.pair('Apertura', stamp(session.opened_at));
  if (session.closed_at) p.pair('Cierre', stamp(session.closed_at));
  p.rule();

  p.pair('Fondo inicial', money(session.opening_cash));
  p.pair('Ventas en efectivo', money(summary.sales.cash));
  p.pair('Entradas', money(summary.cashIn));
  p.pair('Salidas', money(-summary.cashOut));
  p.bold(true).pair('Efectivo esperado', money(summary.expectedCash)).bold(false);
  if (session.counted_cash != null) {
    p.pair('Efectivo contado', money(session.counted_cash));
    p.bold(true).pair('Diferencia', money(session.counted_cash - summary.expectedCash)).bold(false);
  }
  p.rule();

  p.pair('Ventas con tarjeta', money(summary.sales.card));
  p.pair('Ventas por transferencia', money(summary.sales.transfer));
  p.bold(true).pair('Total vendido', money(summary.salesTotal)).bold(false);
  p.pair('Cuentas cobradas', summary.orderCount);
  p.pair('Ventas canceladas', summary.cancelledCount);

  if (summary.movements.length) {
    p.rule().line('Movimientos de efectivo');
    for (const m of summary.movements) {
      p.pair(m.reason, money(m.type === 'in' ? m.amount : -m.amount));
    }
  }
  return p.feed(3).cut().build();
}

function testTicket(settings) {
  const p = start(settings);
  header(p, settings).rule();
  p.line('Prueba de impresión');
  p.line('Acentos: á é í ó ú ñ Ñ ¿? ¡!');
  p.line(`Columnas: ${settings.printerColumns}`);
  p.line('1234567890'.repeat(5).slice(0, Number(settings.printerColumns)));
  p.pair('Importe de ejemplo', money(123456));
  return p.feed(3).cut().build();
}

// Solo el pulso del cajon, sin imprimir nada.
function drawerPulse(settings) {
  return start(settings).kickDrawer().build();
}

module.exports = { saleTicket, cashCloseTicket, testTicket, drawerPulse, money, stamp };
