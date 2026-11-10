// Formularios tactiles. En vez de cajas de texto, cada campo es un renglon
// grande que al tocarlo abre el teclado adecuado (texto, dinero, entero,
// lista de opciones) o cambia de valor (interruptor).
//
// Un campo se describe asi:
//   { key: 'price', label: 'Precio', type: 'money' }
//   { key: 'categoryId', label: 'Categoría', type: 'choice', options: [{ value, label }] }
//   { key: 'trackStock', label: 'Lleva inventario', type: 'toggle' }
//   visible: (values) => boolean   (opcional) oculta el campo segun otros valores
//   placeholder: ejemplo que se ve dentro del teclado; emptyText: texto del renglon vacio

import { h, add, money, btn, toast, openModal, choiceDialog } from './ui.js';
import { numpadDialog, textDialog } from './keyboard.js';

function shown(field, values) {
  const value = values[field.key];
  switch (field.type) {
    case 'money':
      return money(value || 0);
    case 'choice': {
      const option = field.options.find((o) => o.value === value);
      return option ? option.label : 'Elegir';
    }
    case 'toggle':
      return value ? 'Sí' : 'No';
    default:
      return value === '' || value == null ? field.emptyText || 'Toca para escribir' : String(value);
  }
}

async function edit(field, values) {
  const value = values[field.key];
  switch (field.type) {
    case 'text':
      return textDialog({ title: field.label, initial: value || '', maxLength: field.maxLength || 60, placeholder: field.placeholder || '' });
    case 'money':
      return numpadDialog({ title: field.label, mode: 'money', initial: value || 0 });
    case 'int':
      return numpadDialog({ title: field.label, mode: 'int', initial: Number(value) || 0 });
    case 'choice':
      return choiceDialog({ title: field.label, options: field.options, current: value, columns: field.columns || 2 });
    case 'toggle':
      return !value;
    default:
      return null;
  }
}

// Dibuja los campos dentro de `container`. onChange(key, value) se llama
// cuando el usuario cambia algo; despues se vuelve a dibujar.
export function renderFields(container, fields, values, onChange) {
  const paint = () => {
    container.replaceChildren(
      ...fields
        .filter((field) => !field.visible || field.visible(values))
        .map((field) => {
          const empty = field.type !== 'toggle' && (values[field.key] === '' || values[field.key] == null);
          return h('button', {
            class: `field ${field.type === 'toggle' ? 'field-toggle' : ''} ${field.type === 'toggle' && values[field.key] ? 'on' : ''}`,
            type: 'button',
            onClick: async () => {
              const next = await edit(field, values);
              if (next === null) return; // cancelo
              const previous = values[field.key];
              values[field.key] = next;
              try {
                if (onChange) await onChange(field.key, next);
              } catch (error) {
                values[field.key] = previous; // no se pudo guardar: se regresa el valor
                toast(error.message, 'error');
              }
              paint();
            },
          },
            h('span', { class: 'field-label' }, field.label, field.hint && h('small', null, field.hint)),
            h('span', { class: `field-value ${empty ? 'unset' : ''}` }, shown(field, values)));
        })
    );
  };
  paint();
  return paint;
}

// Formulario en ventana modal. Regresa { action, values } o null si cancela.
// action es 'ok' o el nombre de un boton extra (por ejemplo 'remove').
export function formDialog({ title, fields, values, okText = 'Guardar', extra = [] }) {
  return new Promise((resolve) => {
    const draft = { ...values };
    openModal(
      (box, close) => {
        const finish = (result) => () => {
          close();
          resolve(result);
        };
        const list = h('div', { class: 'fields' });
        renderFields(list, fields, draft);
        add(box, 
          h('h2', null, title),
          list,
          h('div', { class: 'modal-actions' },
            extra.map((e) => btn(e.label, finish({ action: e.action, values: draft }), e.variant || '')),
            h('span', { class: 'spacer' }),
            btn('Cancelar', finish(null)),
            btn(okText, finish({ action: 'ok', values: draft }), 'btn-primary'))
        );
      },
      { size: 'md' }
    );
  });
}
