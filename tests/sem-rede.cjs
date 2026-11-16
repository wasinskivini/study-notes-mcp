// Usado por tests/semantic.model.ts (NODE_OPTIONS=--require=...): o servidor
// sobe como num computador sem internet. Qualquer acesso à rede falha.
globalThis.fetch = async url => {
    throw new TypeError(`sem rede (teste): ${url}`)
}
