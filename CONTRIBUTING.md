# Contributing to Gradient Studio

Thanks for taking an interest. Gradient Studio is a small, one-person project, so the process is
light.

## Reporting a problem

- **A bug or an idea:** open an [issue](https://github.com/LightSeek3r/gradient-studio/issues/new/choose)
  and pick the matching template. For a bug in the score or a suggestion, include the stop colours
  and positions (the **Export CSS** panel has them all).
- **A security problem:** do not use an issue. See [SECURITY.md](SECURITY.md).

## Running it locally

See **Getting started** in the [README](README.md). In short: `npm ci`, then `npm run dev`.

## Sending a pull request

1. Open an issue first for anything larger than a fix, so we agree on the direction.
2. Branch from `master`, keep the change small and focused.
3. Run the checks CI runs:

   ```bash
   npm run lint     # ESLint
   npm run build    # type-check (tsc -b) and production build
   ```

4. Put the reason in the PR description. For UI changes, add a before/after screenshot.

### House rules

- **Colour maths lives in `src/gradient-engine.ts` and `src/color-formats.ts`**, as pure functions
  with no React in them; components only call them.
- **Scores and suggestions are computed in OKLAB/OKLCH.** A change to the scorer should say which
  gradients score differently and why.
- **No network requests and no tracking.** The app is a static page and stays one.
- **No new runtime dependency** without a good reason in the PR.
- **Comments say why, not what.**

By contributing you agree that your contribution is released under the [MIT licence](LICENSE).
This project follows the [Code of Conduct](CODE_OF_CONDUCT.md): be kind, this is a place for people who like colour and code.
