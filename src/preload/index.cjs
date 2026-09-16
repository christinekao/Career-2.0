const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('careerFoundation', {
  getStatus: () => ipcRenderer.invoke('foundation:get-status'),
});
