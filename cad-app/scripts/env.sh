# Usage: source scripts/env.sh (Linux/macOS development shells).
PA_CAD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -x "$PA_CAD_ROOT/.venv/bin/python" ]; then
  echo "Run bash scripts/install.sh first." >&2
  return 1
fi
export XDG_CACHE_HOME="$PA_CAD_ROOT/.venv/cache"
export XDG_CONFIG_HOME="$PA_CAD_ROOT/.venv/config"
export MPLCONFIGDIR="$PA_CAD_ROOT/.venv/config/matplotlib"
export PIP_CACHE_DIR="$PA_CAD_ROOT/.venv/cache/pip"
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$MPLCONFIGDIR" "$PIP_CACHE_DIR"
source "$PA_CAD_ROOT/.venv/bin/activate"
