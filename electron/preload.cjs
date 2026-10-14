// The only doorway between the page and the main process. Everything the
// renderer may ask for is listed here, and nothing else gets through.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bits', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  window: {
    flags: () => ipcRenderer.invoke('window:flags'),
    onFlags: (callback) => {
      const listener = (_e, flags) => callback(flags);
      ipcRenderer.on('window:flags', listener);
      return () => ipcRenderer.removeListener('window:flags', listener);
    },
    setWidth: (width) => ipcRenderer.send('window:set-width', width),
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
    setPinned: (pinned) => ipcRenderer.send('window:set-pinned', pinned),
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
  },
  screenshots: {
    save: (bytes) => ipcRenderer.invoke('screenshot:save', bytes),
    openFolder: () => ipcRenderer.send('screenshot:open-folder'),
  },
});
