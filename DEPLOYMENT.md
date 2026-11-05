# PA Copper / Preform CAD deployment

The full application is in `cad-app/`. The native Creo target is Creo Parametric 7.0.10.0 / Windows 11. Native PRT production still requires the local runner and real parametric master models; no native PRT output has been validated yet.

## Published source

Repository: `Tedus-AI/pa-solder-copper-auto-draw`

Branch: `deploy/pa-copper-preform-cad`

Application entry point: `cad-app/app.py`

GitHub hosts this source and its CI workflow. GitHub Pages cannot execute the Python / CadQuery / Streamlit server, so the repository URL is not an interactive application URL.

## Streamlit Community Cloud configuration

After signing in to Streamlit Community Cloud with the authorized GitHub account, create an app with:

| Setting | Value |
|---|---|
| Repository | `Tedus-AI/pa-solder-copper-auto-draw` |
| Branch | `deploy/pa-copper-preform-cad` |
| Main file | `cad-app/app.py` |
| Python | `3.12` |
| Secrets | None required for geometry generation |

The root `requirements.txt` installs the verified dependency versions and the editable UI package from `cad-app`. `packages.txt` provides the OpenGL / font libraries needed by the CAD runtime. The app slug and actual URL are assigned by the hosting platform; no hosted app URL has been created or verified from this workspace.

## Local development

```bash
cd cad-app
bash scripts/install.sh
source scripts/env.sh
python -m pytest -q
streamlit run app.py --server.headless true --browser.gatherUsageStats false
```

The development tests passed in the managed Linux environment. The GitHub Actions workflow runs the test suite and example export. These checks do not replace platform startup validation or native Creo acceptance on Windows.
