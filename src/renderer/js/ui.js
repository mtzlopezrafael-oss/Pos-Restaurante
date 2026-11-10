// Piezas basicas de la interfaz. No hay framework: todo es DOM directo, para
// que se pueda leer de principio a fin sin magia.

// ---------- Crear elementos ----------
// h('button', { class: 'btn', onClick: fn }, 'Texto') crea
// <button class="btn">Texto</button> con su evento. Los hijos pueden ser
// texto, otros elementos, arreglos, o null/false (se ignoran).
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, children);
  return el;
}

// Agrega hijos a un elemento. Acepta arreglos y se salta null, false y ''.
// Se usa en vez de el.append() porque el.append(null) escribe la palabra
// "null" en pantalla, y aqui es comun escribir `condicion && elemento`.
export function add(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Vacia un elemento y lo vuelve a llenar con las mismas reglas que add().
export function fill(el, ...children) {
  el.replaceChildren();
  return add(el, children);
}

// ---------- Formatos ----------
// El dinero viaja en centavos (entero). Aqui se convierte a "$1,234.50".
export function money(cents) {
  const amount = (Math.abs(cents) / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? '-' : ''}$${amount}`;
}

// plural(1, 'cuenta', 'cuentas') -> "1 cuenta";  plural(3, ...) -> "3 cuentas"
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const two = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export const clock = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
export const dayAndClock = (iso) => {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${clock(iso)}`;
};

export const METHOD = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };

// ---------- Hablar con el proceso principal ----------
// Toda operacion pasa por aqui. Si el proceso principal responde con error,
// se lanza una excepcion con el mensaje ya listo para mostrarse.
export async function call(name, payload) {
  const response = await window.pos.call(name, payload);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// Envuelve el manejador de un boton:
//   - si falla, muestra el error en pantalla en vez de perderlo en la consola;
//   - mientras trabaja, deshabilita el boton (un doble toque no cobra dos veces).
export function safe(handler) {
  return async (event) => {
    const button = event && event.currentTarget;
    if (button && button.disabled) return;
    if (button) button.disabled = true;
    try {
      await handler(event);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };
}

export function btn(label, onClick, variant = '', extra = {}) {
  return h('button', { class: `btn ${variant}`, type: 'button', onClick: safe(onClick), ...extra }, label);
}

// ---------- Margen de pantalla ----------
// Deja `pixels` de franja vacia alrededor de toda la interfaz (ver app.css).
export function setScreenMargin(pixels) {
  document.body.style.setProperty('--inset', `${Number(pixels) || 0}px`);
}

// ---------- Avisos ----------
export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 5000 : 2800);
}

// ---------- Ventanas modales ----------
// Las teclas fisicas (Enter, Esc, numeros) solo llegan a la modal de hasta
// arriba; por eso se guardan en una pila.
const keyHandlers = [];
document.addEventListener('keydown', (event) => {
  const top = keyHandlers[keyHandlers.length - 1];
  if (top) top(event);
});

// build(box, close) llena la modal. Regresa la funcion que la cierra.
export function openModal(build, { size = 'md', onKey = null } = {}) {
  const box = h('div', { class: `modal modal-${size}` });
  const overlay = h('div', { class: 'overlay' }, box);
  const handler = onKey || (() => {});
  keyHandlers.push(handler);
  const close = () => {
    overlay.remove();
    const index = keyHandlers.lastIndexOf(handler);
    if (index >= 0) keyHandlers.splice(index, 1);
  };
  build(box, close);
  document.getElementById('overlays').append(overlay);
  return close;
}

// Pregunta de si/no. Regresa una promesa: true si acepto, false si no.
export function confirmDialog({ title, message, okText = 'Aceptar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    openModal(
      (box, close) => {
        const answer = (value) => () => {
          close();
          resolve(value);
        };
        add(box,
          h('h2', null, title),
          message && h('p', { class: 'modal-text' }, message),
          h('div', { class: 'modal-actions' },
            btn(cancelText, answer(false)),
            btn(okText, answer(true), danger ? 'btn-danger' : 'btn-primary'))
        );
      },
      { size: 'sm' }
    );
  });
}

// Lista de opciones en botones grandes. Regresa el value elegido o null.
// options: [{ value, label, color? }]
export function choiceDialog({ title, options, columns = 2, current = undefined, size = 'md' }) {
  return new Promise((resolve) => {
    openModal(
      (box, close) => {
        const pick = (value) => () => {
          close();
          resolve(value);
        };
        add(box,
          h('h2', null, title),
          h('div', { class: 'choices', style: { '--cols': String(columns) } },
            options.map((option) =>
              h('button', {
                class: `choice ${option.value === current ? 'active' : ''} ${option.color ? 'has-color' : ''}`,
                type: 'button',
                style: option.color ? { '--cat': option.color } : null,
                onClick: pick(option.value),
              }, option.label))),
          h('div', { class: 'modal-actions' }, btn('Cancelar', pick(null)))
        );
      },
      { size }
    );
  });
}

// Varias opciones a la vez, en grupos. Regresa el arreglo de values elegidos, o
// null si cancela. groups: [{ label, color?, options: [{ value, label }] }]
export function multiSelectDialog({ title, hint = '', groups, selected = [], okText = 'Guardar' }) {
  return new Promise((resolve) => {
    const chosen = new Set(selected);
    openModal(
      (box, close) => {
        const finish = (value) => {
          close();
          resolve(value);
        };
        const counter = h('span', { class: 'muted' });
        const repaint = []; // una funcion por boton; se actualizan sin redibujar la lista (no pierde el scroll)
        const refresh = () => {
          counter.textContent = chosen.size === 1 ? '1 seleccionado' : `${chosen.size} seleccionados`;
          for (const update of repaint) update();
        };

        const sections = groups.filter((group) => group.options.length > 0).map((group) => {
          const allChosen = () => group.options.every((option) => chosen.has(option.value));
          const toggleAll = h('button', {
            class: 'btn btn-quiet',
            type: 'button',
            onClick: () => {
              const clear = allChosen();
              for (const option of group.options) (clear ? chosen.delete(option.value) : chosen.add(option.value));
              refresh();
            },
          });
          repaint.push(() => {
            toggleAll.textContent = allChosen() ? 'Quitar todos' : 'Marcar todos';
          });
          return [
            h('div', { class: 'multi-head' }, h('strong', null, group.label), group.options.length > 1 && toggleAll),
            h('div', { class: 'choices', style: { '--cols': '3' } },
              group.options.map((option) => {
                const button = h('button', {
                  class: `choice check ${group.color ? 'has-color' : ''}`,
                  type: 'button',
                  style: group.color ? { '--cat': group.color } : null,
                  onClick: () => {
                    if (chosen.has(option.value)) chosen.delete(option.value);
                    else chosen.add(option.value);
                    refresh();
                  },
                }, option.label);
                repaint.push(() => button.classList.toggle('active', chosen.has(option.value)));
                return button;
              })),
          ];
        });

        add(box,
          h('h2', null, title),
          hint && h('p', { class: 'modal-text' }, hint),
          h('div', { class: 'multi' }, sections),
          h('div', { class: 'modal-actions' },
            counter,
            h('span', { class: 'spacer' }),
            btn('Cancelar', () => finish(null)),
            btn(okText, () => finish([...chosen]), 'btn-primary')));
        refresh();
      },
      { size: 'lg' }
    );
  });
}

// ---------- Iconos ----------
// SVG en linea: Windows 7 no trae emojis a color y no hay internet para
// bajar una fuente de iconos.
const ICONS = {
  venta: '<path d="M4 3h16v18l-3-2-2.5 2-2.5-2-2.5 2L7 19l-3 2z"/><path d="M8 8h8M8 12h8"/>',
  caja: '<rect x="3" y="11" width="18" height="9" rx="1"/><path d="M6 11V5h12v6M10 15.5h4"/>',
  inventario: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  productos: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="14" cy="12" r="1.6" fill="currentColor"/><circle cx="9" cy="18" r="1.6" fill="currentColor"/>',
  reportes: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  ajustes: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
};

export function icon(name) {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return wrapper;
}
