# Changelog

All notable changes to Gradient Studio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org) loosely while the project is 0.x.

## [0.1.0] - 2026-10-17

The first tagged version, published with an MIT licence. It covers everything since the project
started on 2026-03-11.

### Added

- **The gradient editor** (11 March 2026): colour stops on a draggable bar, an angle control, a
  live 0–100 quality score in four perceptual dimensions (lightness flow, hue arc, chroma
  balance, stop rhythm) with named issues, and **Suggest**, an OKLAB-based refinement with an
  Original/Suggested toggle and **Apply**.
- **Every colour format and complements** (27 August): each stop is editable through the colour
  picker, hex, RGB, HSL and the nearest of 148 CSS colour names, with paste (any notation) and
  copy on every field, plus its OKLCH complement, one click to swap in.
- **Multi-angle gradients** (27 August): up to seven directions aimed with a draggable compass,
  per-direction angle, weight and mute, presets and **Spread evenly**, blended as an exact
  weighted mean or through eight `background-blend-mode`s.
- **Export CSS and the header score** (27 August): a copy-ready `background` declaration (with
  `background-blend-mode` when needed), the live score chip in the header, and the
  **How does this work?** note.
- **Icons and link previews** (27 August): SVG and PNG favicons, app icons, a web manifest, a
  meta description, and Open Graph and Twitter Card tags with a 1200×630 preview image.
- **Open-source release** (17 October): MIT licence, a full README with screenshots, this
  changelog, contributing and security guides, a code of conduct, issue and pull request
  templates, and a CI workflow that lints and builds every push and pull request.

### Changed

- **Suggestion engine** (26 April): **Suggest** keeps the stops in their position order and
  compresses a wide hue arc to 80° around the stops' circular mean hue, for cleaner midpoints.
  The layout was refreshed at the same time.
- **Self-hosted fonts** (9 October): Space Grotesk and JetBrains Mono are bundled through
  Fontsource, so the app loads everything from its own origin.
- **Default gradient** (27 August): the editor opens on a navy-to-violet gradient.

### Removed

- The early single-file `gradient-studio.jsx` prototype, superseded by the TypeScript app
  (9 October).

[0.1.0]: https://github.com/LightSeek3r/gradient-studio/releases/tag/v0.1.0
