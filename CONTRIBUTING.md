# How we ship

This is a static GitHub Pages app. No build step, no backend. Two people. Keep the process light.

## The bar

1. Don't commit to `main`. Short-lived branch, then a PR. Self-merge is fine after a pass.
2. Branch names: `feat/...` or `fix/...`.
3. PR title is the user-visible change. If it's a ship, include the version (`v0.24`).
4. PR body says what changed and how to check it in the browser.
5. Don't land leftover test pages, API keys, or large media (host media elsewhere, or Git LFS).
6. `main` deploys to GitHub Pages. Treat a merge as a ship.

## Review

A PR needs a look, even if you wrote it. Check:

- Does any hub or index page still make sense?
- Secrets stay in the browser (localStorage), never in the repo.
- The live page still loads after the change.

## Pages

`.github/workflows/deploy-pages.yml` deploys the site whenever `main` is updated.
