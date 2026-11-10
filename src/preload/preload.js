// El preload corre antes que la pagina y es lo unico que puede hablar con el
// proceso principal. Expone UNA funcion: window.pos.call(nombre, datos).
// La pagina no recibe ipcRenderer ni nada de Node, solo esta funcion.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pos', {
  call: (name, payload) => ipcRenderer.invoke('pos', name, payload),
});
