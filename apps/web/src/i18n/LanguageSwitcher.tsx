import { Segmented } from "../components/ui/Segmented";
import { LOCALES, LOCALE_LABELS, type Locale } from "./locale";
import { useI18n } from "./context";

const OPTIONS = LOCALES.map((value) => ({
  value,
  label: LOCALE_LABELS[value].short,
  // Each language is named in itself, whatever the interface language is.
  ariaLabel: LOCALE_LABELS[value].name,
  title: LOCALE_LABELS[value].name,
  lang: value,
}));

/** EN | FR segmented control (a radio group: one tab stop, arrows move and switch). */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <Segmented<Locale>
      label={t("lang.group")}
      options={OPTIONS}
      value={locale}
      onChange={setLocale}
      size="sm"
      className="lang-switch"
    />
  );
}
