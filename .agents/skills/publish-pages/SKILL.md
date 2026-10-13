---
name: publish-pages
description: Publish the game to GitHub Pages so friends can play it ("publish to pages", "deploy the game", "update the public build").
---

# Publish to GitHub Pages

* Pages serves the `gh-pages` branch; there is no GitHub Actions deploy, so it
  costs nothing. The build happens on this machine.
* Run `node --run deploy:pages` from the main checkout (dependencies installed,
  `PATH="$HOME/.cargo/bin:$PATH"` for wasm-pack). It builds the WASM and data,
  runs `vite build --base=/<repo>/`, and force-pushes a one-commit orphan
  `gh-pages` branch.
* It deploys the working tree it runs in: switch to an up-to-date `main` first
  unless the owner asks for another branch. Uncommitted changes are included
  and noted in the commit message.
* Public URL: `https://pikilon.github.io/red-line/` (can lag a minute). Check it
  with `curl -sI` and report the commit that was deployed.
* Publishing makes the game public: only run it when the owner asks.
