'use strict';

// A worker keeps the interface responsive while Rust runs a simulation.
(() => {
  const pending = new Map();
  let worker = null;
  let nextId = 0;

  function failed(message) {
    if (worker) worker.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(new URL('engine-worker.js', document.baseURI), {type: 'module'});
    worker.addEventListener('message', event => {
      const {id, result, error} = event.data;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    worker.addEventListener('error', () => failed('The browser engine stopped. Try running again or reload the page.'));
    worker.addEventListener('messageerror', () => failed('Could not read the browser engine response. Reload the page.'));
  }

  function request(action, model) {
    return new Promise((resolve, reject) => {
      let text;
      try {
        text = model === undefined ? '' : JSON.stringify(model);
        ensureWorker();
        const id = ++nextId;
        pending.set(id, {resolve, reject});
        try {
          worker.postMessage({id, action, text});
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  window.EcoRuntime = {
    mode: 'browser',
    workspaceKey: `ecodynamics.workspace.v1:${new URL('.', document.baseURI).pathname}`,
    request(path, model) {
      const action = path.replace(/^\/?api\//, '');
      if (!['validate', 'simulate'].includes(action)) return Promise.reject(new Error('Unknown engine operation.'));
      return request(action, model);
    },
    health() {
      return request('health');
    }
  };
})();
