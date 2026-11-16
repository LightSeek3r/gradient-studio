// Plugin entry (manifest "main"): the sandbox side. All logic is in sandbox.ts
// so the tests can drive it with a stub instead of Figma.
import { start } from './sandbox'

start(figma, __html__)
