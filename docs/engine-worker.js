import initialize, {model_request, engine_version} from './pkg/ecodynamics.js';

let ready;

function loadEngine() {
  if (!ready) {
    ready = initialize().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

self.addEventListener('message', async event => {
  const {id, action, text} = event.data;
  try {
    await loadEngine();
    if (action === 'health') {
      self.postMessage({id, result: {name: 'EcoDynamics', version: engine_version(), engine: 'Rust / WebAssembly'}});
      return;
    }
    const result = JSON.parse(model_request(action, text));
    self.postMessage({id, result});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({id, error: message || 'The calculation failed.'});
  }
});
