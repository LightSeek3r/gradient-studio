# French glossary

Choices made once and used everywhere in `apps/web/src/i18n/fr.ts`. A test rejects the discarded
alternatives (`point d'arrêt`, `arrêt de couleur`, bare `stop`).

| English | French | Why |
|---|---|---|
| stop (colour stop) | **palier** (`palier 2`, `les paliers 1 et 3`) | Short enough for 360 px chips and the tab bar (`Paliers`), unambiguous in context (an `arrêt` is a halt) and natural in the plural. The CSS-spec term *point d'arrêt de couleur* is 14 characters; it would break the mobile tab bar and mix two words for one thing. |
| lightness (OKLCH L) | **clarté** | In colour science *clarté* is lightness (CIE L\*, OKLab L); *luminosité* is brightness. One word for every lightness use, also for the HSL `L` channel, so the app never has two names for one quantity. |
| apparent brightness (Helmholtz–Kohlrausch) | **luminosité apparente** | The perceptual quantity that is not lightness; this is where *luminosité* is correct. |
| hue | **teinte** | Standard. `arc de teinte` for the hue arc. |
| chroma | **chroma** (m.) | The OKLCH axis; kept as the technical term (`équilibre du chroma`). |
| saturation | **saturation** | Used where the rule is about perceived or HSL saturation (`écart de saturation`, the HSL channel). Chroma = the OKLCH value, saturation = how vivid it looks. |
| gradient | **dégradé** | |
| smoothness score | **score de régularité** | PLAN D5: a measure of how evenly the stops flow, by this app's definition, not a quality verdict. `régularité` is measurable and neutral; *fluidité* sounds like a rating and *qualité* is banned. |
| smooth / mostly smooth / uneven / rough | **régulier / plutôt régulier / inégal / heurté** | Descriptive bands, never grades. |
| issue | **problème** | Standard in developer tools. |
| deduction | **déduction** | Points taken off. |
| points ledger | **décompte des points** | |
| floor 0 | **plancher 0** | |
| complement | **complémentaire** (`la complémentaire`) | The complementary colour. |
| suggestion / refinement | **suggestion** / **affinage** | `Suggérer` as the button. |
| direction / layer | **direction** / **calque** | `calque` is the design-tool word for a stacked layer. |
| blend mode | **mode de fusion** (`Fusion`) | CSS keyword shown in brackets: `Écran (screen)`, `Produit (multiply)`. |
| weight | **poids** | |
| undo / redo | **annuler / rétablir** | |
| import / export | **importer / export** | |
| spread | **répartir** | |

Typography: a no-break space before `:`, `?`, `!` and inside « guillemets »; apostrophes are
`’` in prose and `'` where the text quotes CSS. Numbers and percentages go through `Intl`
(`0,42`, `33,5 %`).

Kept in English (platform vocabulary): CSS functions and keywords, colour names, `HEX` `RGB`
`HSL`, `OKLAB`, `OKLCH`, `sRGB`, format names (Tailwind, SwiftUI, …), rule codes.
