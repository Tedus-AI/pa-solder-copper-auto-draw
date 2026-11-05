# GitHub Pages deployment

The website is plain HTML, CSS and JavaScript in `web/`. CAD modelling runs in an OpenCascade WebAssembly worker in the browser; there is no Python server or Streamlit frontend.

The GitHub Pages project URL is https://tedus-ai.github.io/pa-solder-copper-auto-draw/ . Deployment and live-browser verification are performed by `.github/workflows/pages.yml` after pushes to `main`.

## GitHub configuration

In repository Settings → Pages, set Source to **GitHub Actions** (already configured by the user). The workflow builds the static assets, tests the browser tool, uploads `web/dist` and publishes it with the official GitHub Pages deployment action. A final job opens the actual deployed URL and tests 3D generation, STEP roundtrips, downloads, parameter changes, input rejection and mobile layout.

## Development

```bash
cd web
npm ci
npm test
npm run build
npm run dev
```

`npm run test:browser` uses Playwright. Set `CHROMIUM_PATH` to a local Chromium executable, or run `npx playwright install --with-deps chromium`. GitHub Actions installs a managed Chromium automatically.

All production assets, including the CAD WebAssembly binary, are served from this repository's Pages site. The build copies the native Creo runner and guide from `cad-app/src/pa_cad/` into the static download assets; keep that single source up to date.

The browser can export copper/preform STEP, STL, DXF, parameters, calculation reports and a native Creo job. PRT itself still requires real native parametric masters and licensed Creo Parametric 7.0.10.0 / Windows 11 execution. No native PRT has been generated or validated by the website.

`cad-app/` contains the optional earlier Python CLI and local UI; it is not used to serve the public website.
