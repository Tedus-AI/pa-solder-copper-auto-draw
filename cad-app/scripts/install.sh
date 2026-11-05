#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
source scripts/env.sh
python -m pip install --disable-pip-version-check -r requirements.lock -e '.[ui,dev]'
python -m pip check
