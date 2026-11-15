// A tiny pub/sub so any button can announce its outcome ("Copied #4F46E5")
// through the single `role="status"` region mounted by <StatusRegion />.

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function announce(message: string): void {
  listeners.forEach((fn) => fn(message));
}

export function subscribeAnnouncements(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
