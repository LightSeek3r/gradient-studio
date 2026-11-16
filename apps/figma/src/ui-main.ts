// UI entry (bundled and inlined into ui.html): connects `mountUi` to Figma's
// postMessage transport. Messages to the sandbox are wrapped as
// `{ pluginMessage }`; messages from it arrive as `event.data.pluginMessage`.
// Every incoming message is validated by `parsePluginMessage` before use.
import { copyToClipboard, mountUi } from './ui'

const root = document.getElementById('app')
if (root) {
  const ui = mountUi(root, {
    post: (message) => parent.postMessage({ pluginMessage: message }, '*'),
    copy: copyToClipboard,
  })
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { pluginMessage?: unknown } | null
    if (data && typeof data === 'object') ui.receive(data.pluginMessage)
  })
  parent.postMessage({ pluginMessage: { type: 'ready' } }, '*')
}
