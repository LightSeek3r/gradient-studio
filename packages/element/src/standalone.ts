// The single self-contained file (`dist/opal42-element.js`): defines the
// elements on load and re-exports the API, for a plain <script type="module">.
// (Calls defineElements directly instead of importing ./define, so no bundler
// can drop the side effect.)
import { defineElements } from "./register";

export * from "./index";

defineElements();
