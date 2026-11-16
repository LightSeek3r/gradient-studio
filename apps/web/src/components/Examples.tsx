import { buildGradientCSS } from "@opal42/gradient";
import { EXAMPLES, exampleTicks } from "../examples";
import { ruleText } from "../explain/explain";
import { issueHash } from "../persist/issue-link";
import { useI18n } from "../i18n/context";
import { Icon } from "./ui/Icon";

/**
 * One example gradient per rule of the score. Each entry is a real link
 * (`#issue=<code>`), so it can be opened in a new tab, copied or bookmarked;
 * activating it loads the example and opens that rule in the ledger.
 */
export function Examples({ onOpen }: { onOpen: (code: string) => void }) {
  const { t, linkLang } = useI18n();
  return (
    <details className="examples">
      <summary className="disclosure-summary examples-summary">
        <Icon name="chevron" size={14} className="disclosure-chevron" />
        {t("examples.title")}
        <span className="curves-hint">{t("examples.hint")}</span>
      </summary>
      <p className="examples-note">{t("examples.note")}</p>
      <ul className="examples-list">
        {EXAMPLES.map((e) => (
          <li key={e.code}>
            <a
              className="example-link"
              href={issueHash(e.code, linkLang)}
              onClick={(event) => {
                // Plain activation is handled here (so it also works when the
                // address already shows this link); modified clicks open a new tab.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                onOpen(e.code);
              }}
            >
              <span className="example-swatch" aria-hidden="true" style={{ background: buildGradientCSS(exampleTicks(e), 90) }} />
              <span className="example-name">{ruleText(e.code, t).name}</span>
              <span className="example-code mono">{e.code}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
