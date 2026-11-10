// Orden en que se muestran los productos: alfabetico o con los parecidos
// juntos. La eleccion se guarda en localStorage (la memoria del navegador que
// Electron conserva entre sesiones), no en la base de datos: es una
// preferencia de pantalla, no un dato del negocio.

import { arrangeBySimilarity } from './similar.js';

const KEY = 'pos.productOrder';

export function orderMode() {
  try {
    return localStorage.getItem(KEY) === 'similar' ? 'similar' : 'alpha';
  } catch (error) {
    return 'alpha';
  }
}

export function setOrderMode(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch (error) {
    // Sin localStorage el orden sigue funcionando; solo no se recuerda al reabrir.
  }
}

// products llega en orden alfabetico (asi lo entrega el proceso principal).
export function ordered(products) {
  return orderMode() === 'similar' ? arrangeBySimilarity(products) : products;
}
