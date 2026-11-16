import { useId, useState } from "react";
import { DEFAULT_STUDIO_URL, normalizeStudioUrl } from "../lib/studio-link";

export function SettingsForm({ value, onSave }: { value: string; onSave: (url: string) => boolean }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState("");
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const save = () => {
    if (normalizeStudioUrl(text) === null) {
      setError("Enter an https:// address (http:// is accepted for localhost).");
      return;
    }
    setError("");
    if (onSave(text)) setText(normalizeStudioUrl(text) ?? text);
  };

  return (
    <form
      className="settings"
      aria-label="Settings"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor={inputId}>
        <strong>Gradient Studio address</strong>
      </label>
      <input
        id={inputId}
        type="url"
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="hint" id={hintId}>
        Where “Open in Gradient Studio” goes. The gradient travels in the link’s <code>#</code> part, which browsers never send to a server. Nothing is
        opened until you click the link.
      </p>
      {error && (
        <p className="hint" id={errorId} role="alert" style={{ color: "var(--sev-error)" }}>
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText(DEFAULT_STUDIO_URL);
            setError("");
            onSave(DEFAULT_STUDIO_URL);
          }}
        >
          Reset to default
        </button>
      </div>
    </form>
  );
}
