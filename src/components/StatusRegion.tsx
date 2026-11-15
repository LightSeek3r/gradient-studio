import { useEffect, useState } from "react";
import { subscribeAnnouncements } from "../announce";

/** Visually-hidden live region that voices copy/paste feedback to screen readers. */
export function StatusRegion() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    let n = 0;
    return subscribeAnnouncements((text) => {
      // Alternate a trailing nbsp so an identical repeat still counts as a change.
      n += 1;
      setMessage(n % 2 ? text : `${text}${"\u00a0"}`);
    });
  }, []);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
