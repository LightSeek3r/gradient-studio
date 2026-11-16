import { buildGradientCSS } from "@opal42/gradient";
import { EXAMPLES, exampleTicks } from "../examples";
import { ruleText } from "../explain/explain";
import { issueHash } from "../persist/issue-link";
import { Icon } from "./ui/Icon";

/**
 * One example gradient per rule of the score. Each entry is a real link
 * (`#issue=<code>`), so it can be opened in a new tab, copied or bookmarked;
 * activating it loads the example and opens that rule in the ledger.
 */
export function Examples({ onOpen }: { onOpen: (code: string) => void }) {
  return (
    <details className="examples">
      <summary className="disclosure-summary examples-summary">
        <Icon name="chevron" size={14} className="disclosure-chevron" />
        Examples
        <span className="curves-hint">one gradient per rule</span>
      </summary>
      <p className="examples-note">
        Each link replaces your gradient with a small one that triggers that rule (Undo brings yours back).
      </p>
      <ul className="examples-list">
        {EXAMPLES.map((e) => (
          <li key={e.code}>
            <a
              className="example-link"
              href={issueHash(e.code)}
              onClick={(event) => {
                // Plain activation is handled here (so it also works when the
                // address already shows this link); modified clicks open a new tab.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                onOpen(e.code);
              }}
            >
              <span className="example-swatch" aria-hidden="true" style={{ background: buildGradientCSS(exampleTicks(e), 90) }} />
              <span className="example-name">{ruleText(e.code).name}</span>
              <span className="example-code mono">{e.code}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
