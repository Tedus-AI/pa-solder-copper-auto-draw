"""讀取 YAML 設定。"""
from __future__ import annotations

from pathlib import Path

import yaml

from .models import CopperCoinSpec, DesignInput, PAPackage, SolderSpec


def load_design(path: str | Path) -> DesignInput:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return DesignInput(
        package=PAPackage(**data["package"]),
        solder=SolderSpec(**data.get("solder", {})),
        coin=CopperCoinSpec(**data.get("coin", {})),
    )
