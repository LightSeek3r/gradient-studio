// ── Catalogue français ────────────────────────────────────────────────────────
// Typé `Record<keyof typeof en, string>` : une clé manquante (ou en trop) fait
// échouer `npm run typecheck`. Terminologie et justifications : docs/i18n-glossary.md.
// En bref : stop = « palier », lightness = « clarté », hue = « teinte »,
// chroma = « chroma », saturation = « saturation », gradient = « dégradé »,
// smoothness score = « score de régularité » (jamais « qualité », PLAN D5).
// Typographie : espace insécable ( ) avant « : », « ? », « ! » et dans les « guillemets ».

import type { en } from "./en";

export const fr: Record<keyof typeof en, string> = {
  // ── Métadonnées de la page ──────────────────────────────────────────────────
  "meta.title": "Gradient Studio — Éditeur de dégradés perceptuel et générateur de CSS",
  "meta.description":
    "Créez des dégradés CSS évalués avec la colorimétrie perceptuelle (OKLAB/OKLCH), avec tous les formats de couleur, des couleurs complémentaires en un clic et jusqu’à 7 directions de dégradé simultanées. Copiez le CSS exact une fois terminé.",
  "meta.ogDescription":
    "Créez des dégradés CSS évalués avec la colorimétrie perceptuelle (OKLAB/OKLCH), avec tous les formats de couleur, des couleurs complémentaires en un clic et jusqu’à 7 directions de dégradé simultanées.",
  "meta.twitterDescription":
    "Créez des dégradés CSS évalués avec la colorimétrie perceptuelle, avec tous les formats de couleur, des complémentaires et jusqu’à 7 directions de dégradé.",
  "meta.ogImageAlt": "Gradient Studio — aperçu d’un dégradé sombre de l’indigo au violet avec ses paliers de couleur",
  "meta.ogLocale": "fr_FR",

  // ── Interface générale ──────────────────────────────────────────────────────
  "app.name": "Gradient Studio",
  "app.subtitle": "Score de régularité perceptuel, corrections ciblées et affinage en un clic",
  "app.skipToMain": "Aller au contenu principal",
  "lang.group": "Langue",
  "common.done": "Terminé",
  "common.failed": "Échec",
  "common.copied": "Copié",
  "common.copyFailed": "Échec de la copie",
  "common.cancel": "Annuler",

  // ── En-tête ─────────────────────────────────────────────────────────────────
  "header.toolbar": "Document",
  "header.undo": "Annuler",
  "header.undoTitle": "Annuler (Ctrl/Cmd+Z)",
  "header.redo": "Rétablir",
  "header.redoTitle": "Rétablir (Maj+Ctrl/Cmd+Z ou Ctrl+Y)",
  "header.import": "Importer du CSS",
  "header.importTitle": "Importer un linear-gradient CSS (ou en coller un n’importe où)",
  "header.copyLink": "Copier le lien",
  "header.copyLinkTitle": "Copier un lien qui rouvre ce dégradé",
  "header.linkCopied": "Lien copié",
  "header.linkCopiedSr": "Lien copié dans le presse-papiers",
  "header.reset": "Réinitialiser",
  "header.resetTitle": "Repartir du dégradé par défaut",

  // ── Notifications et annonces ───────────────────────────────────────────────
  "toast.region": "Notification",
  "toast.dismiss": "Fermer la notification",
  "toast.undo": "Annuler",
  "toast.undoHint": "Appuyez sur Contrôle Z pour annuler.",
  "toast.updateAvailable": "Mise à jour disponible - rechargez",
  "toast.reload": "Recharger",
  "toast.undone": "Annulé",
  "toast.redone": "Rétabli",
  "toast.reset": "Retour au dégradé de départ",
  "toast.notImported": "Non importé : {error}",
  "toast.clipboardNotGradient":
    "Le presse-papiers ne contient pas de dégradé CSS - collez un linear-gradient(…) pour l’importer",
  "toast.exampleLoaded": "Exemple chargé pour « {name} »",
  "toast.fixApplied": "{label} (score {before} → {after})",
  "toast.linkLoaded": "Dégradé chargé depuis le lien",
  "toast.stopRemoved": "Palier {n} supprimé",
  "toast.complementApplied": "Palier {n} remplacé par sa complémentaire",
  "toast.directionCount":
    "{count, plural, one {# direction} other {# directions}}{removed, select, yes { (retirées en fin de liste)} other {}}",
  "toast.suggestionApplied": "Suggestion appliquée (score {before} → {after})",
  "announce.suggestionReady":
    "Suggestion prête : score de {before} à {after}. Le dégradé suggéré est affiché.",
  "announce.scoreUp": "Score en hausse de {delta}, maintenant {score}",
  "announce.scoreDown": "Score en baisse de {delta}, maintenant {score}",
  "announce.scoreSummary":
    "Score de régularité {score}, {band}, {issues, plural, one {# problème} other {# problèmes}}",

  // ── Scène ───────────────────────────────────────────────────────────────────
  "stage.now": "Actuel",
  "stage.withFix": "Avec correction",
  "stage.suggestedPreview": "Aperçu suggéré",
  "stage.stopsGroup": "Paliers de couleur",
  "stage.scoreChipTitle": "Afficher le détail du score",
  "stage.scoreWord": "Score",
  "bar.addTitle": "Cliquer pour ajouter un palier",
  "bar.handle": "Palier {n}",
  "bar.handleValue": "Palier {n}, {position} pour cent, couleur {color}",

  // ── Bandes de score (descriptions neutres, PLAN D5) ─────────────────────────
  "band.smooth": "régulier",
  "band.mostlySmooth": "plutôt régulier",
  "band.uneven": "inégal",
  "band.rough": "heurté",

  // ── Paliers ─────────────────────────────────────────────────────────────────
  "stops.title": "Paliers",
  "stops.add": "Ajouter un palier",
  "stops.addAtMax": "Ajouter un palier (max {max})",
  "stops.addTitle": "Ajouter un palier dans le plus grand intervalle",
  "stops.maxTitle": "Maximum de {max} paliers atteint",
  "stops.hint": "Faites glisser une poignée pour la déplacer. Cliquez ou touchez la barre pour ajouter un palier.",
  "stops.ref": "{count, plural, one {palier {list}} other {paliers {list}}}",
  "stops.refThe": "{count, plural, one {le palier {list}} other {les paliers {list}}}",
  "stops.refOf": "{count, plural, one {du palier {list}} other {des paliers {list}}}",

  // ── Carte et pastille de palier ─────────────────────────────────────────────
  "stop.group": "Palier {n}",
  "stop.heading": "Palier {n}",
  "stop.picker": "Sélecteur de couleur du palier {n}",
  "stop.position": "Position du palier {n}",
  "stop.removeTitle": "Supprimer ce palier",
  "stop.remove": "Supprimer le palier {n}",
  "stop.notation": "Notation de couleur du palier {n}",
  "stop.hexValue": "Valeur hexadécimale du palier {n}",
  "stop.colorName": "Nom de couleur du palier {n}",
  "stop.channelLabel": "Palier {n}, {channel}",
  "notation.hex": "HEX",
  "notation.rgb": "RGB",
  "notation.hsl": "HSL",
  "notation.name": "NOM",
  "field.hex": "Hex",
  "field.rgb": "RGB",
  "field.hsl": "HSL",
  "field.name": "Nom",
  "channel.red": "rouge",
  "channel.green": "vert",
  "channel.blue": "bleu",
  "channel.hue": "teinte",
  "channel.saturation": "saturation",
  "channel.lightness": "clarté",
  "target.hex": "palier {n} (hex)",
  "target.rgb": "palier {n} (RGB)",
  "target.hsl": "palier {n} (HSL)",
  "target.name": "palier {n} (nom)",
  "target.complementHex": "complémentaire du palier {n} (hex)",
  "target.complementRgb": "complémentaire du palier {n} (RGB)",
  "target.complementHsl": "complémentaire du palier {n} (HSL)",
  "target.complementName": "complémentaire du palier {n} (nom)",
  "copy.title": "Copier : {label}",
  "copy.done": "Copié : {label}",
  "paste.title": "Coller une couleur unique dans : {label} (hex, rgb, hsl ou nom)",
  "paste.aria": "Coller dans : {label}",
  "paste.done": "Collé dans : {label}",
  "paste.failed": "Impossible de coller dans : {label}. Le presse-papiers ne contient pas une couleur unique",
  "complement.title": "Complémentaire",
  "complement.replace": "Remplacer par la complémentaire",
  "complement.replaceAria": "Remplacer par la complémentaire (palier {n})",
  "complement.replaceTitle": "Remplacer le palier {n} par sa complémentaire",
  "complement.replaced": "Remplacé",
  "chip.editTitle": "Modifier le palier {n}",
  "chip.name": "Palier {n}",
  "chip.selectHint": ", sélectionner pour modifier",

  // ── Panneau de score ────────────────────────────────────────────────────────
  "score.heading": "Score de régularité",
  "score.scope":
    "Mesure la régularité avec laquelle vos paliers de couleur s’enchaînent, selon la définition de cette application. Ce n’est pas un jugement de qualité. Les directions et le mode de fusion ne sont pas évalués.",
  "score.refineHeading": "Affinage perceptuel",
  "score.refineDescription":
    "Lisse la progression de la clarté, équilibre le chroma et répartit les paliers de façon régulière dans OKLAB. Le CSS exporté reste en sRGB standard.",
  "dim.lightness": "Progression de la clarté",
  "dim.hue": "Arc de teinte",
  "dim.chroma": "Équilibre du chroma",
  "dim.rhythm": "Rythme des paliers",
  "severity.error": "forte déduction",
  "severity.warning": "déduction moyenne",
  "severity.info": "faible déduction",
  "ledger.label": "Où sont passés les points",
  "ledger.start": "Tout dégradé démarre à",
  "ledger.total": "Score de régularité",
  "ledger.floor": "{label} : plancher 0",
  "ledger.floorNote": "{nominal} déduits d’un budget de {weight} ; une dimension ne peut pas descendre sous 0",
  "ledger.empty": "Aucune déduction : aucune des règles ci-dessous n’a rien relevé.",
  "ledger.minusSr": "moins",
  "ledger.plusSr": "plus",
  "ledger.equationFloor": "+ {absorbed} ({label}, plancher 0)",
  "ledger.sentenceNone": "{start} points, aucune déduction.",
  "ledger.sentenceMinus": "moins {points} pour {name}",
  "ledger.sentenceGiven": "plus {absorbed} rendus, car {label} ne peut pas descendre sous 0",
  "ledger.sentence": "{start} {parts}, égale {total}.",
  "ledger.whatItMeasures": "Ce que la règle mesure",
  "ledger.where": "Où",
  "ledger.fix": "Correction",
  "ledger.fixLine": "{label} (score +{gain})",
  "ledger.copyLink": "Copier le lien de cette règle",
  "ledger.copyLinkTitle": "Copier un lien qui ouvre un exemple de « {name} »",
  "ledger.linkCopiedSr": "Lien de la règle copié dans le presse-papiers",
  "ledger.dimsLabel": "Points conservés par dimension",
  "ledger.dimTitle":
    "{label} : {kept} points conservés sur {weight}. Cette dimension représente {weight} % du score.",
  "fix.button": "Corriger",
  "fix.apply": "Appliquer",
  "fix.aria": "{action} (+{gain}) : {label}",
  "fix.title": "{label} (score +{gain}). Survolez ou donnez le focus pour prévisualiser.",
  "fix.cancelAria": "Annuler l’aperçu de la correction",
  "fix.cancelTitle": "Annuler l’aperçu",
  "fix.stripNow": "Actuel",
  "fix.stripFixed": "Avec correction",
  "fix.stripNote": "{label}. Touchez Appliquer pour la garder.",
  "fix.label.lightnessMany": "Ajuster la clarté {who}",
  "fix.label.lighter": "Éclaircir {who}",
  "fix.label.darker": "Assombrir {who}",
  "fix.label.hueMany": "Rapprocher les teintes {who}",
  "fix.label.hueOne": "Décaler la teinte {who}",
  "fix.label.chromaMany": "Uniformiser la saturation {who}",
  "fix.label.chromaRaise": "Augmenter la saturation {who}",
  "fix.label.chromaLower": "Réduire la saturation {who}",
  "fix.label.positionMany": "Redistribuer {who}",
  "fix.label.positionOne": "Déplacer {who} à {position}",
  "fix.label.mixed": "Affiner {who}",

  // ── Voie des problèmes, exemples, courbes ───────────────────────────────────
  "lane.group": "Problèmes sur le dégradé",
  "lane.markAria":
    "{name} : moins {points, plural, one {# point} other {# points}}{where}. Afficher dans le décompte du score",
  "lane.markTitle": "{name} (−{points}){where}",
  "lane.overflow": "{count} de plus dans le décompte du score",
  "examples.title": "Exemples",
  "examples.hint": "un dégradé par règle",
  "examples.note":
    "Chaque lien remplace votre dégradé par un petit dégradé qui déclenche cette règle (Annuler restaure le vôtre).",
  "curves.title": "Courbes",
  "curves.hint": "clarté, chroma et teinte le long du dégradé",
  "curves.lightness": "Clarté",
  "curves.chroma": "Chroma",
  "curves.hue": "Teinte",
  "curves.hueSpan": "écart de {span}°",
  "curves.note":
    "Telles que le CSS exporté est peint (mélange sRGB entre les paliers), mesurées en OKLCH. Les traits fins sont vos paliers ; les zones ombrées correspondent aux problèmes listés dans le score.",
  "curves.summary": "{label} : {trend}, de {min} à {max}.",
  "curves.summaryUndefined": "{label} : indéfinie (toutes les couleurs du dégradé sont grises).",
  "trend.undefined": "indéfinie",
  "trend.flat": "constante",
  "trend.rises": "croissante",
  "trend.falls": "décroissante",
  "trend.dipsRises": "baisse puis remonte",
  "trend.peaksFalls": "monte puis redescend",
  "trend.changes": "change de sens {count} fois",

  // ── Règles ──────────────────────────────────────────────────────────────────
  "rule.fallback.name": "déduction",
  "rule.fallback.measures": "Une déduction du score de régularité.",
  "rule.lightness/reversal.name": "inversion de clarté",
  "rule.lightness/reversal.measures":
    "Compte les paliers plus sombres, ou plus clairs, que leurs deux voisins : le dégradé s’éclaircit et s’assombrit au lieu d’aller dans un seul sens.",
  "rule.lightness/perceived-reversal.name": "clarté apparente instable",
  "rule.lightness/perceived-reversal.measures":
    "Repère un palier si vif qu’il paraît plus lumineux que ses deux voisins, alors que sa clarté mesurée est dans l’ordre.",
  "rule.lightness/low-contrast.name": "contraste faible",
  "rule.lightness/low-contrast.measures":
    "Mesure la plus grande différence de couleur entre deux paliers ; si elle est minime, le dégradé se lit comme un aplat.",
  "rule.lightness/abrupt-jump.name": "saut brusque",
  "rule.lightness/abrupt-jump.measures":
    "Repère un fort changement de couleur comprimé entre deux paliers distants de 10 % ou moins, qui se voit comme une arête.",
  "rule.lightness/uneven-speed.name": "vitesse inégale",
  "rule.lightness/uneven-speed.measures":
    "Compare la vitesse de changement de la couleur dans chaque segment ; un grand écart signifie que le dégradé s’emballe à un endroit et stagne à un autre.",
  "rule.hue/wide-arc.name": "grand arc de teinte",
  "rule.hue/wide-arc.measures":
    "Mesure le plus petit arc du cercle chromatique qui contient tous les paliers colorés ; au-delà de 120°, les couleurs intermédiaires tendent à virer au gris.",
  "rule.hue/narrow-arc.name": "teinte unique",
  "rule.hue/narrow-arc.measures":
    "Mesure ce même arc du cercle chromatique ; sous 15°, tous les paliers ont pratiquement la même teinte.",
  "rule.hue/direction-reversal.name": "teinte qui change de sens",
  "rule.hue/direction-reversal.measures":
    "Suit la teinte de palier en palier et note où elle fait demi-tour sur le cercle chromatique.",
  "rule.chroma/saturation-range.name": "écart de saturation",
  "rule.chroma/saturation-range.measures":
    "Compare le palier le plus saturé et le moins saturé ; un grand écart se lit comme un pic ou une extrémité délavée.",
  "rule.chroma/dead-zone.name": "gris parmi des couleurs vives",
  "rule.chroma/dead-zone.measures":
    "Repère un palier presque gris dans un dégradé qui contient aussi des paliers vifs, ce qui laisse une zone sans couleur.",
  "rule.chroma/muddy-midpoint.name": "milieu terne",
  "rule.chroma/muddy-midpoint.measures":
    "Vérifie la couleur que le navigateur peint à mi-chemin entre deux paliers (il mélange en sRGB) et la saturation qui s’y perd.",
  "rule.chroma/banding.name": "risque de bandes",
  "rule.chroma/banding.measures":
    "Compte les niveaux de couleur 8 bits disponibles sur un segment ; trop peu sur une longue distance peut faire apparaître des bandes visibles.",
  "rule.rhythm/edge-gap.name": "paliers loin des bords",
  "rule.rhythm/edge-gap.measures":
    "Additionne la part du dégradé avant le premier palier et après le dernier, qui est peinte en aplat.",
  "rule.rhythm/narrow-span.name": "transition étroite",
  "rule.rhythm/narrow-span.measures":
    "Mesure la distance entre le premier et le dernier palier ; toute la transition est concentrée dans cet intervalle.",
  "rule.rhythm/uneven-gaps.name": "espacement irrégulier",
  "rule.rhythm/uneven-gaps.measures":
    "Compare les intervalles entre paliers voisins ; des intervalles très différents donnent un dégradé aux paliers groupés.",

  // ── Constats : un message par palier (code, gravité) du modèle v1 ───────────
  "finding.lightness/reversal.error":
    "La clarté fluctue ({count, plural, one {# inversion} other {# inversions}}) — crée du bruit visuel",
  "finding.lightness/perceived-reversal.warning":
    "Des paliers saturés créent des inversions de luminosité perçue (effet Helmholtz–Kohlrausch)",
  "finding.lightness/low-contrast.error": "Les paliers sont presque identiques — le dégradé est invisible",
  "finding.lightness/low-contrast.warning": "Contraste très faible entre les paliers — le dégradé se voit à peine",
  "finding.lightness/abrupt-jump.warning": "Saut de couleur brusque entre des paliers très rapprochés",
  "finding.lightness/uneven-speed.warning":
    "Vitesse perceptuelle inégale — certaines transitions s’emballent tandis que d’autres traînent",
  "finding.lightness/uneven-speed.info": "Vitesse de transition légèrement inégale le long du dégradé",
  "finding.hue/wide-arc.error": "L’arc de teinte dépasse 180° — les couleurs jurent de façon inattendue",
  "finding.hue/wide-arc.warning": "Arc de teinte large (>120°) — risque de milieux ternes",
  "finding.hue/narrow-arc.info": "Arc de teinte très étroit (<15°) — le dégradé se lit comme une seule teinte",
  "finding.hue/direction-reversal.warning":
    "Le trajet de la teinte change de sens — risque de tons intermédiaires ternes",
  "finding.chroma/saturation-range.error": "La saturation explose — cela paraît involontaire",
  "finding.chroma/saturation-range.info": "Saturation inégale selon les paliers",
  "finding.chroma/dead-zone.warning": "Palier gris ou désaturé parmi des couleurs vives — crée une zone morte",
  "finding.chroma/dead-zone.info": "Écart de saturation sensible entre certains paliers",
  "finding.chroma/muddy-midpoint.warning": "Le mélange des couleurs donne un milieu terne ou grisâtre",
  "finding.chroma/muddy-midpoint.info": "Légère désaturation au milieu du dégradé",
  "finding.chroma/banding.warning":
    "Faible résolution de couleur entre les paliers — des bandes visibles sont probables",
  "finding.chroma/banding.info": "Une transition subtile peut produire des bandes à l’écran",
  "finding.rhythm/edge-gap.error": "Les paliers sont regroupés au milieu — de grands aplats sur les bords",
  "finding.rhythm/edge-gap.warning": "Les paliers n’atteignent pas les bords — des aplats sont visibles",
  "finding.rhythm/edge-gap.info": "Les paliers s’arrêtent un peu avant les bords — de petits aplats",
  "finding.rhythm/narrow-span.warning": "Transition comprimée dans une bande étroite",
  "finding.rhythm/narrow-span.info": "La transition couvre moins de 40 % du dégradé",
  "finding.rhythm/uneven-gaps.warning": "Les positions des paliers sont groupées de façon inégale",
  "finding.rhythm/uneven-gaps.info": "L’espacement des paliers est légèrement inégal",

  // ── Comparaison de la suggestion ────────────────────────────────────────────
  "suggest.button": "Suggérer",
  "suggest.previewLabel": "Aperçu",
  "suggest.original": "Original",
  "suggest.suggested": "Suggéré",
  "suggest.score": "Score",
  "suggest.selectedOnly": " · sélection seule : {score}",
  "suggest.listLabel": "Modifications suggérées par palier",
  "suggest.applyChange": "Appliquer la modification du palier {n}",
  "suggest.stop": "Palier {n}",
  "suggest.unchanged": " (inchangé)",
  "suggest.applySelected": "Appliquer la sélection ({count})",
  "suggest.applyAll": "Tout appliquer",
  "suggest.decline.unscorable": "Ce dégradé ne peut pas être évalué, il n’y a donc rien à affiner.",
  "suggest.decline.singlePosition":
    "Tous les paliers sont à la même position (un palier net), il n’y a donc rien à redistribuer.",
  "suggest.decline.wouldLower":
    "Aucun affinage n’obtient un meilleur score que votre dégradé ({score}), il reste donc tel quel.",
  "suggest.decline.already": "Vos paliers sont déjà là où l’affinage les placerait.",

  // ── Boîte d’import et messages de l’analyseur ───────────────────────────────
  "import.title": "Importer du CSS",
  "import.intro": "Cela ressemble à un dégradé complet - l’importer ?",
  "import.label": "Collez un <code>linear-gradient(…)</code> ou une déclaration <code>background:</code>",
  "import.summary": "{count, plural, one {# palier} other {# paliers}}, {angle}°",
  "import.submit": "Importer",
  "import.done": "{count, plural, one {# palier importé} other {# paliers importés}}, {angle}°",
  "import.hint.pasteResolved": "Collez plutôt le dégradé avec ses valeurs calculées.",
  "import.hint.plainColours": "Utilisez plutôt hex, rgb(), hsl(), oklab(), oklch() ou un nom de couleur.",
  "import.err.noGradient": "Cela ne ressemble pas à un linear-gradient() CSS.",
  "import.err.nothing": "Rien à importer.",
  "import.err.tooLong": "Ce texte est trop long pour être un seul dégradé.",
  "import.err.expected": "linear-gradient(…) attendu.",
  "import.err.repeating":
    "repeating-*-gradient() n’est pas pris en charge : le score porte sur une seule suite de paliers. Utilisez plutôt un dégradé simple.",
  "import.err.legacy":
    "Les dégradés préfixés (-webkit-, -moz-, …) utilisent une ancienne convention d’angle. Collez plutôt la forme standard linear-gradient(…).",
  "import.err.radial":
    "Les dégradés radiaux ne sont pas encore pris en charge ; seul linear-gradient() peut être importé.",
  "import.err.conic":
    "Les dégradés coniques ne sont pas encore pris en charge ; seul linear-gradient() peut être importé.",
  "import.err.var": "var() ne peut pas être importé : sa valeur n’est pas dans le texte collé.",
  "import.err.calc":
    "calc(), min(), max() et clamp() ne peuvent pas être importés : le résultat dépend de l’élément.",
  "import.err.env": "env() ne peut pas être importé : sa valeur vient de l’appareil.",
  "import.err.currentColor":
    "currentColor dépend de la couleur du texte de la page et ne peut pas être importé.",
  "import.err.systemColor":
    "La couleur système {name} dépend de la plateforme, elle ne peut donc pas être importée.",
  "import.err.colorMix": "Les couleurs color-mix() ne sont pas encore prises en charge.",
  "import.err.relativeColor": "Les couleurs relatives (rgb(from …)) ne sont pas encore prises en charge.",
  "import.err.wideColour":
    "Les couleurs {fn}() ne peuvent pas être jugées en sRGB et ne sont pas encore prises en charge.",
  "import.err.notColour": "{what} n’est pas une couleur reconnue.",
  "import.err.badHex": "{what} n’est pas une couleur hexadécimale valide (3, 4, 6 ou 8 chiffres).",
  "import.err.malformedFn": "{fn}() est mal formé.",
  "import.err.unsupportedFn": "{fn}() n’est pas une fonction de couleur prise en charge.",
  "import.err.unknownColor": "{reason}.",
  "import.err.lengthPosition":
    "Seules les positions de palier en pourcentage sont prises en charge : les positions en {unit} dépendent de la taille de l’élément.",
  "import.err.interpolation": "L’interpolation dans {space} n’est pas prise en charge.",
  "import.err.preprocessor":
    "Les variables Sass/Less et les expressions de gabarit ne peuvent pas être importées.",
  "import.err.unbalanced": "Les parenthèses ne sont pas équilibrées : le dégradé n’est jamais refermé.",
  "import.err.tooDeep": "Ce dégradé est imbriqué trop profondément pour être importé.",
  "import.err.tooManyStops": "Ce dégradé a trop de paliers ; l’éditeur en accepte jusqu’à {max}.",
  "import.err.syntax": "Ce n’est pas un linear-gradient() valide : {reason}.",
  "import.err.stopCount": "Ce dégradé a {count} paliers ; l’éditeur en accepte jusqu’à {max}.",
  "import.err.trimmedStopCount":
    "Après rognage à 0–100 %, ce dégradé a {count} paliers ; l’éditeur en accepte jusqu’à {max}.",
  "import.err.twoStops": "Un dégradé a besoin d’au moins deux paliers de couleur.",
  "import.err.allTransparent": "Tous les paliers sont transparents, il n’y a donc aucune couleur à importer.",
  "import.reason.notAngle": "la direction du dégradé n’est pas un angle",
  "import.reason.toSide": "'to' doit être suivi d’un côté",
  "import.reason.notCorner": "'to {sides}' n’est pas un coin",
  "import.reason.inSpace": "'in' doit être suivi d’un espace colorimétrique",
  "import.reason.notSpace": "'{name}' n’est pas un espace colorimétrique",
  "import.reason.hueMethod": "méthode d’interpolation de teinte mal formée",
  "import.reason.direction": "direction de dégradé mal formée",
  "import.reason.number": "nombre mal formé",
  "import.reason.noUnit": "la position de palier {value} n’a pas d’unité",
  "import.reason.badUnit": "'{unit}' n’est pas une unité de position",
  "import.reason.nested": "un dégradé ne peut pas en contenir un autre",
  "import.reason.emptyArg": "argument vide",
  "import.reason.hintPlace": "un repère de couleur doit se trouver entre deux paliers de couleur",
  "import.reason.stopShape": "un palier de couleur est une couleur et au plus deux positions",
  "import.reason.noStops": "aucun palier de couleur",
  "import.warn.layers": "{count} couches d’arrière-plan trouvées ; seule la première a été importée.",
  "import.warn.interpolation":
    "L’interpolation « in {space} » a été écartée : l’éditeur exporte l’interpolation sRGB standard et le score la suppose, les tons intermédiaires peuvent donc différer.",
  "import.warn.corner":
    "« to {corner} » dépend du rapport d’aspect de l’élément ; importé comme {angle}° (exact pour une boîte carrée).",
  "import.warn.angleRounded": "L’angle {from}° a été arrondi à {to}°.",
  "import.warn.hints":
    "{count, plural, one {# repère de couleur ignoré} other {# repères de couleur ignorés}} (milieux de transition) ; les transitions sont maintenant linéaires.",
  "import.warn.gamut": "{color} est hors du gamut sRGB et a été ramenée dans le gamut vers {hex}.",
  "import.warn.alpha":
    "La transparence a été retirée {count, plural, one {du palier} other {des paliers}} {list} : les paliers de l’éditeur sont opaques.",
  "import.warn.transparentStop":
    "Le palier {n} était transparent ; il reprend la couleur {hex} de son voisin (les paliers sont opaques).",
  "import.warn.reordered":
    "{count, plural, one {Le palier {list} précédait un palier antérieur et a été remonté jusqu’à lui} other {Les paliers {list} précédaient un palier antérieur et ont été remontés jusqu’à lui}}, comme le font les navigateurs.",
  "import.warn.trimmed":
    "Les paliers hors de 0–100 % ont été rognés à la plage visible ; les couleurs aux bords sont conservées.",

  // ── Export ──────────────────────────────────────────────────────────────────
  "export.title": "Export",
  "export.titleSuggested": "Export suggéré",
  "export.copy": "Copier {label}",
  "export.copyTitle": "Copier l’export {label} dans le presse-papiers",
  "export.copiedSr": "{label} copié dans le presse-papiers",
  "export.tabs": "Format d’export",
  "export.tab.css": "CSS",
  "export.tab.css-oklab": "CSS (OKLAB)",
  "export.tab.tailwind": "Tailwind",
  "export.tab.scss": "SCSS",
  "export.tab.css-variables": "Variables CSS",
  "export.tab.svg": "SVG",
  "export.tab.swiftui": "SwiftUI",
  "export.tab.compose": "Compose",
  "export.tab.flutter": "Flutter",
  "export.tab.godot": "Godot",
  "export.tab.android": "XML Android",
  "export.tab.dtcg": "JSON DTCG",
  "export.tab.figma": "Figma",
  "export.untested": "Non testé sur appareil",
  "export.codeLabel": "Export {label}",
  "export.codeLabelSuggested": "Export {label} suggéré",
  "export.unsupported": "Ce format ne peut pas exporter le dégradé actuel : {reason}",
  "export.suggestedNote":
    "Il s’agit du dégradé suggéré affiché dans l’aperçu, pas encore appliqué à vos paliers.",
  "export.unsupported.invalid-document": "Le dégradé est illisible.",
  "export.reason.notDocument": "Ce n’est pas un document de dégradé.",
  "export.reason.angle": "L’angle n’est pas un nombre fini.",
  "export.reason.twoStops": "Un dégradé a besoin d’au moins deux paliers.",
  "export.reason.badStop": "Un palier a une couleur ou un alpha invalide.",
  "export.reason.stopPosition": "La position d’un palier n’est pas un nombre fini.",
  "export.reason.noCss": "Le document n’a pas de forme CSS.",
  "export.unsupported.unsupported-kind": "Seuls les dégradés linéaires peuvent être exportés.",
  "export.unsupported.repeating": "Ce format n’a pas de dégradé répété ; exportez plutôt le CSS.",
  "export.unsupported.invalid-input": "L’entrée est illisible.",
  "export.unsupported.unsupported-paint": "Seuls les remplissages en dégradé linéaire peuvent être lus.",
  "export.scope.none":
    "Aucune direction n’est activée, l’onglet CSS est donc un aplat. Cet onglet exporte les paliers à l’angle CSS par défaut, 180°.",
  "export.scope.layers":
    "Ce rendu superpose {count} directions{blend, select, normal {} other { avec le mode de fusion {blend}}}. Seul l’onglet CSS peut l’exprimer. Cet onglet exporte le dégradé de base : les mêmes paliers à {angle}°, la première direction activée.",
  "export.note.css":
    "CSS standard : les navigateurs interpolent entre les paliers en sRGB, pas en OKLAB.",
  "export.note.oklab1":
    "Deux déclarations. La première est un dégradé sRGB simple, pré-échantillonné le long d’OKLAB, pour les navigateurs sans prise en charge. La seconde utilise la clause in oklab.",
  "export.note.oklab2":
    "Un navigateur n’interpole en OKLAB que s’il prend en charge la clause in ; sinon il garde la première déclaration. L’aperçu ci-dessus est le dégradé sRGB simple.",
  "export.note.squareBox":
    "Les points de départ et d’arrivée supposent une boîte carrée (rapport d’aspect 1:1) ; indiquez un rapport d’aspect pour d’autres boîtes.",
  "export.note.aspectBox":
    "Les points de départ et d’arrivée sont prévus pour une boîte de rapport d’aspect {ratio}:1 (largeur:hauteur).",
  "export.note.clipped": "Les paliers hors de 0 %-100 % ont été ramenés sur la ligne du dégradé.",
  "export.note.presampled":
    "Pré-échantillonné en {count} paliers ({space}, alpha prémultiplié) afin que {target} approche le rendu CSS.",
  "export.note.interpolates":
    "Le document interpole dans {space} ; {target} interpolera en sRGB entre ces paliers. Utilisez l’option de pré-échantillonnage pour l’approcher.",
  "export.note.tailwindArbitrary":
    "La valeur arbitraire est exacte. Les tirets bas représentent des espaces, comme Tailwind l’attend.",
  "export.note.tailwindNative":
    "Les utilitaires natifs sont exacts pour deux ou trois paliers ; le modificateur /srgb, /oklab ou /oklch correspond au document.",
  "export.note.tailwindNoNative":
    "Les utilitaires natifs from/via/to expriment trois paliers au plus ; seules la valeur arbitraire et les formes de thème sont donc fournies.",
  "export.note.svgGeometry":
    "La géométrie du dégradé est exacte pour une forme dont la boîte englobante mesure {width} x {height} (rapport d’aspect {ratio}).",
  "export.note.composeOffsets":
    "Les décalages sont en pixels pour une boîte de {width} x {height} ; la variante ShaderBrush s’adapte à toute taille.",
  "export.note.dtcgUnverified":
    "Non vérifié par rapport au texte normatif DTCG : le tableau de paliers \\{ color, position \\} couramment implémenté.",
  "export.note.dtcgAngle": "Les dégradés DTCG n’ont pas d’angle ; il est conservé dans $extensions.",
  "export.note.figmaPaste":
    "À coller dans un plugin sous la forme node.fills = [paint]. Figma n’interpole pas en OKLAB ; utilisez l’option de pré-échantillonnage pour l’approcher.",
  "export.note.figmaTransform":
    "La convention de gradientTransform est déduite, non vérifiée auprès de Figma.",

  // ── Directions ──────────────────────────────────────────────────────────────
  "directions.title": "Directions",
  "directions.summaryOne": "Direction {angle}° · 1 calque",
  "directions.summaryMany": "{count} directions · {angles} · {blend}",
  "directions.hint":
    "{count}/{max} calques. Faites glisser la boussole pour orienter. Les directions et le mode de fusion ne sont pas évalués.",
  "directions.compass": "Boussole de direction du dégradé",
  "directions.angle": "Angle de la direction {n}",
  "directions.angleValue": "{angle, plural, one {# degré} other {# degrés}}",
  "directions.angleSlider": "Curseur d’angle de la direction {n}",
  "directions.active": "Direction {n} active",
  "directions.mute": "Désactiver cette direction",
  "directions.activate": "Activer cette direction",
  "directions.keepOne": "Au moins une direction doit rester active",
  "directions.removeTitle": "Supprimer cette direction",
  "directions.remove": "Supprimer la direction {n}",
  "directions.weight": "Poids",
  "directions.weightAria": "Poids de la direction {n}",
  "directions.add": "Direction",
  "directions.spreadEvenly": "Répartir",
  "directions.spread": "Répartir :",
  "directions.spreadGroup": "Répartir : nombre de directions régulièrement espacées",
  "directions.spreadAria": "Répartir : {count, plural, one {# direction} other {# directions}}",
  "directions.spreadTitle":
    "Répartir : {count, plural, one {# direction} other {# directions régulièrement espacées}}",
  "directions.blend": "Fusion",
  "directions.blendAria": "Mode de fusion des directions",
  "blend.normal.name": "Moyenne (pondérée)",
  "blend.normal.hint": "moyenne pondérée",
  "blend.screen.name": "Écran (screen)",
  "blend.screen.hint": "lueur additive",
  "blend.multiply.name": "Produit (multiply)",
  "blend.multiply.hint": "assombrit",
  "blend.overlay.name": "Superposition (overlay)",
  "blend.overlay.hint": "contraste",
  "blend.soft-light.name": "Lumière douce (soft-light)",
  "blend.soft-light.hint": "subtil",
  "blend.hard-light.name": "Lumière crue (hard-light)",
  "blend.hard-light.hint": "marqué",
  "blend.lighten.name": "Éclaircir (lighten)",
  "blend.lighten.hint": "maximum",
  "blend.darken.name": "Obscurcir (darken)",
  "blend.darken.hint": "minimum",
  "blend.difference.name": "Différence (difference)",
  "blend.difference.hint": "inverse",

  // ── Barre d’onglets mobile ──────────────────────────────────────────────────
  "tabs.panels": "Panneaux",
  "tabs.stops": "Paliers",
  "tabs.score": "Score",
  "tabs.directions": "Directions",
  "tabs.export": "Export",
  "tabs.issues": ", {count, plural, one {# problème} other {# problèmes}}",

  // ── Pied de page ────────────────────────────────────────────────────────────
  "footer.theory": "Comment ça marche ?",
  "footer.scoringLabel": "Score : ",
  "footer.scoring":
    "un score de régularité selon la définition propre à cette application, et non une mesure validée de qualité. La progression de la clarté ({lightness} pts) pénalise les inversions, l’instabilité de luminosité apparente (H-K) et la vitesse perceptuelle inégale. L’arc de teinte ({hue} pts) récompense les arcs <120° et une direction de teinte constante. L’équilibre du chroma ({chroma} pts) pénalise les pics de saturation, la désaturation au milieu et le risque de bandes. Le rythme des paliers ({rhythm} pts) pénalise les regroupements inégaux. La suggestion rapproche les couleurs d’une harmonie perceptuelle par un lissage <accent>OKLAB→LCH</accent>.",
  "footer.multiLabel": "Multi-angle : ",
  "footer.multi":
    "jusqu’à {max} directions projettent les mêmes paliers en calques superposés. En mode <accent>moyenne</accent>, l’alpha de chaque calque vaut <accent>wₖ / (w₁+…+wₖ)</accent>, si bien que le résultat est exactement la moyenne pondérée de toutes les directions ; les autres modes confient les calques à <accent>background-blend-mode</accent> avec un alpha proportionnel à la direction la plus lourde.",
  "footer.complementsLabel": "Complémentaires : ",
  "footer.complements":
    "la teinte <accent>OKLCH</accent> opposée à clarté et chroma identiques, ramenée dans le gamut en réduisant le chroma pour que la teinte ne dérive jamais.",
  "footer.workLabel": "Votre travail : ",
  "footer.work":
    "le dégradé est conservé dans l’adresse de la page (partagez-le avec Copier le lien) et enregistré automatiquement dans ce navigateur. Ctrl/Cmd+Z annule, Maj+Ctrl/Cmd+Z ou Ctrl+Y rétablit (les champs de texte gardent leur propre historique). Collez un linear-gradient CSS n’importe où hors d’un champ de texte pour l’importer.",
  "footer.local": "Fonctionne entièrement dans votre navigateur. Rien n’est envoyé.",
};
