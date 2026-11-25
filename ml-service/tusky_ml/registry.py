"""Versioned model registry with a single "production" pointer.

Layout, per model key ("football", "basketball", "cricket/T20", ...):

    artifacts/registry/<key>/registry.json          state + decision history
    artifacts/registry/<key>/versions/<version>/    model.joblib, report.json (an immutable copy)
    artifacts/<key>/model.joblib, report.json       the production copy that `predict` already loads

Promoting copies a version into the production location, rolling back copies the previous
production version back. Nothing in the database is touched and no model file is ever
overwritten in place (copies are written next to the target and swapped in atomically).
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

MODEL, REPORT = "model.joblib", "report.json"


def _atomic_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Registry:
    def __init__(self, artifacts_dir: Path, key: str):
        self.key = key
        self.root = Path(artifacts_dir) / "registry" / key
        self.live = Path(artifacts_dir) / key
        self.state_path = self.root / "registry.json"

    # ---- state ----------------------------------------------------------------------------------------------

    def state(self) -> dict:
        if self.state_path.exists():
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        return {"key": self.key, "production": None, "lineage": [], "history": []}

    def _write(self, st: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_name("registry.json.tmp")
        tmp.write_text(json.dumps(st, indent=2, default=str), encoding="utf-8")
        os.replace(tmp, self.state_path)

    def version_dir(self, version: str) -> Path:
        return self.root / "versions" / version

    def versions(self) -> list[str]:
        d = self.root / "versions"
        return sorted(p.name for p in d.iterdir()) if d.exists() else []

    def record(self, action: str, version: str | None, reason: str, **extra) -> dict:
        """Append a decision to the history (every cycle is recorded, including rejections and skips)."""
        st = self.state()
        entry = {"at": _now(), "action": action, "version": version, "reason": reason, **extra}
        st["history"].append(entry)
        self._write(st)
        return entry

    # ---- versions -------------------------------------------------------------------------------------------

    def unique_version(self, version: str) -> str:
        v, n = version, 2
        while self.version_dir(v).exists():
            v, n = f"{version}-{n}", n + 1
        return v

    def add_version(self, version: str, model_path: Path, report_path: Path) -> str:
        if self.version_dir(version).exists():
            raise FileExistsError(f"{self.key}: version {version} already registered (versions are immutable)")
        _atomic_copy(model_path, self.version_dir(version) / MODEL)
        _atomic_copy(report_path, self.version_dir(version) / REPORT)
        return version

    def set_production(self, version: str, reason: str, action: str = "promote", **extra) -> None:
        src = self.version_dir(version)
        if not (src / MODEL).exists():
            raise FileNotFoundError(f"{self.key}: unknown version {version}")
        _atomic_copy(src / MODEL, self.live / MODEL)
        _atomic_copy(src / REPORT, self.live / REPORT)
        st = self.state()
        previous = st["production"]
        st["production"] = version
        if not st["lineage"] or st["lineage"][-1] != version:
            st["lineage"].append(version)
        st["history"].append({"at": _now(), "action": action, "version": version, "previous": previous, "reason": reason, **extra})
        self._write(st)

    def bootstrap(self) -> str | None:
        """Adopt the model already in the production location as the first version (never overwrites it)."""
        st = self.state()
        if st["production"] is not None:
            return st["production"]
        mp, rp = self.live / MODEL, self.live / REPORT
        if not mp.exists() or not rp.exists():
            return None
        report = json.loads(rp.read_text(encoding="utf-8"))
        version = self.unique_version(str(report.get("version") or f"{self.key.replace('/', '-')}-legacy"))
        self.add_version(version, mp, rp)
        st = self.state()
        st["production"] = version
        st["lineage"] = [version]
        st["history"].append({"at": _now(), "action": "bootstrap", "version": version, "reason": "existing production model adopted as the first version"})
        self._write(st)
        return version

    def rollback(self) -> str:
        st = self.state()
        if len(st["lineage"]) < 2:
            raise RuntimeError(f"{self.key}: no earlier production version to roll back to")
        current, previous = st["lineage"][-1], st["lineage"][-2]
        st["lineage"] = st["lineage"][:-2]  # set_production appends `previous` back as the newest entry
        self._write(st)
        self.set_production(previous, f"rolled back from {current}", action="rollback")
        return previous
