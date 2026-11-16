import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DevtoolsApi } from "../lib/devtools-api";
import { INITIAL_STATE, ScanController, type ScanState } from "../lib/scan-controller";

const NEVER = () => () => undefined;

/** The scan lifecycle (see ScanController) as a hook. `api` is null outside DevTools. */
export function useScanner(api: DevtoolsApi | null): { state: ScanState; rescan: () => void } {
  const controller = useMemo(() => (api ? new ScanController(api) : null), [api]);
  const state = useSyncExternalStore(controller ? controller.subscribe : NEVER, controller ? controller.getState : () => INITIAL_STATE);
  useEffect(() => {
    controller?.start();
    return () => controller?.stop();
  }, [controller]);
  return { state, rescan: () => controller?.rescan() };
}
