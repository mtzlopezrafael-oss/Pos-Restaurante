// Toques confiables en pantallas tactiles viejas.
//
// El navegador solo dispara "click" si el dedo baja y sube casi sin moverse y
// sobre el mismo elemento. En pantallas resistivas eso falla seguido: el dedo
// resbala unos pixeles, o el driver (que se hace pasar por raton) manda el
// "boton abajo" donde el cursor estaba antes y el "boton arriba" donde se toco.
// En esos casos el navegador no da click y parece que la pantalla no hizo caso.
//
// Este modulo decide por su cuenta, con reglas mas tolerantes, que boton se
// toco, y lo activa al LEVANTAR el dedo:
//   1. Si el dedo bajo en un boton y subio dentro de el (con margen), se activa,
//      aunque se haya movido o se haya quedado presionado mucho tiempo.
//   2. Si llega un "salto" de raton (baja en un punto y en un instante sube
//      lejos, algo que una mano con raton no hace), se activa el boton donde subio.
//   3. Si el navegador cancelo el toque porque empezo a desplazar una lista,
//      no se activa nada.
// El click normal del navegador se descarta para no activar dos veces.

const MARGIN = 12; // px de tolerancia alrededor del boton
const JUMP_MS = 200; // un "salto" dura menos que esto...
const JUMP_PX = 40; // ...y recorre mas que esto
const NATIVE_CLICK_WINDOW = 1000; // ms en que se espera el click del navegador

let down = null; // el toque en curso
let pressed = null; // boton que se ve presionado
let lastHandled = -Infinity; // cuando se resolvio el ultimo toque

// Bitacora de los ultimos toques, para la prueba de pantalla en Ajustes.
export const tapLog = [];
const listeners = new Set();
export function onTap(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const buttonOf = (node) => (node instanceof Element ? node.closest('button') : null);
const label = (button) => (button ? button.textContent.trim().replace(/\s+/g, ' ').slice(0, 14) || 'boton' : 'fondo');

function within(button, x, y) {
  const box = button.getBoundingClientRect();
  return x >= box.left - MARGIN && x <= box.right + MARGIN && y >= box.top - MARGIN && y <= box.bottom + MARGIN;
}

function release() {
  if (pressed) pressed.classList.remove('pressed');
  pressed = null;
}

function record(entry) {
  tapLog.unshift({ time: new Date(), native: false, ...entry });
  tapLog.length = Math.min(tapLog.length, 12);
  for (const listener of listeners) listener();
}

document.addEventListener('pointerdown', (event) => {
  release();
  if (!event.isPrimary || event.button !== 0) {
    down = null;
    return;
  }
  const button = buttonOf(event.target);
  down = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, at: event.timeStamp, button };
  if (button && !button.disabled) {
    pressed = button;
    button.classList.add('pressed'); // respuesta visual inmediata
  }
}, true);

document.addEventListener('pointerup', (event) => {
  if (!down || event.pointerId !== down.id) return;
  const start = down;
  down = null;
  release();

  const moved = Math.round(Math.hypot(event.clientX - start.x, event.clientY - start.y));
  const lasted = Math.round(event.timeStamp - start.at);
  // En tactil, event.target es donde BAJO el dedo; por eso se busca aparte
  // que hay debajo del punto donde subio.
  const upButton = buttonOf(document.elementFromPoint(event.clientX, event.clientY));

  let target = null;
  let result = 'soltado fuera';
  if (start.button && within(start.button, event.clientX, event.clientY)) {
    target = start.button;
    result = 'toque';
  } else if (start.type === 'mouse' && lasted < JUMP_MS && moved > JUMP_PX && upButton) {
    target = upButton;
    result = 'salto';
  } else if (!start.button && !upButton) {
    result = 'sin boton';
  }
  if (target && target.disabled) {
    target = null;
    result = 'boton apagado';
  }

  lastHandled = performance.now();
  record({ type: start.type, from: label(start.button), to: label(upButton), moved, lasted, result });
  if (target) target.click(); // click propio; el del navegador se descarta abajo
}, true);

document.addEventListener('pointercancel', (event) => {
  if (!down || event.pointerId !== down.id) return;
  record({ type: down.type, from: label(down.button), to: '', moved: 0, lasted: Math.round(event.timeStamp - down.at), result: 'cancelado (desplazar)' });
  down = null;
  release();
}, true);

// El click "de fabrica" del navegador. isTrusted distingue un click real del
// usuario (true) del que dispara target.click() arriba (false).
document.addEventListener('click', (event) => {
  if (!event.isTrusted || !buttonOf(event.target)) return;
  if (event.pointerId === -1 || event.detail === 0) return; // Enter o Espacio con teclado: pasa normal
  if (performance.now() - lastHandled > NATIVE_CLICK_WINDOW) return; // no vino de un toque que resolvimos
  if (tapLog[0]) {
    tapLog[0].native = true;
    for (const listener of listeners) listener();
  }
  event.stopImmediatePropagation(); // ya se activo (o se decidio que no) al levantar el dedo
  event.preventDefault();
}, true);
