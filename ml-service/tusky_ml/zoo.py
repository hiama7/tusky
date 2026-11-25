"""Model families for outcome classification (Phase 2) with Optuna search spaces.

Every family returns `predict_proba` columns in class order (0 = home/team 1, [1 = draw,] last =
away/team 2). `Symmetric` adds the orientation augmentation the cricket models use: train on both
orientations of every match and average the prediction with the mirrored one, so swapping the two
teams exactly mirrors the probabilities.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

MODELS = ("logreg", "rf", "hgb", "xgb", "lgbm", "cat")
SEED = 0


def suggest(name: str, trial, k: int) -> dict:
    """Optuna search space per family. Ranges are deliberately modest: small data punishes huge models."""
    if name == "logreg":
        return {"C": trial.suggest_float("C", 1e-3, 10.0, log=True)}
    if name == "rf":
        return {"n_estimators": trial.suggest_int("n_estimators", 150, 500), "max_depth": trial.suggest_int("max_depth", 3, 12),
                "min_samples_leaf": trial.suggest_int("min_samples_leaf", 5, 80, log=True),
                "max_features": trial.suggest_categorical("max_features", ["sqrt", 0.5])}
    if name == "hgb":
        return {"learning_rate": trial.suggest_float("learning_rate", 0.01, 0.15, log=True), "max_iter": trial.suggest_int("max_iter", 100, 500),
                "max_leaf_nodes": trial.suggest_int("max_leaf_nodes", 4, 31), "min_samples_leaf": trial.suggest_int("min_samples_leaf", 20, 150),
                "l2_regularization": trial.suggest_float("l2_regularization", 1e-2, 10.0, log=True)}
    if name == "xgb":
        return {"n_estimators": trial.suggest_int("n_estimators", 100, 500), "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
                "max_depth": trial.suggest_int("max_depth", 2, 6), "subsample": trial.suggest_float("subsample", 0.6, 1.0),
                "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
                "reg_lambda": trial.suggest_float("reg_lambda", 0.1, 20.0, log=True), "min_child_weight": trial.suggest_int("min_child_weight", 1, 20)}
    if name == "lgbm":
        return {"n_estimators": trial.suggest_int("n_estimators", 100, 500), "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
                "num_leaves": trial.suggest_int("num_leaves", 4, 31), "min_child_samples": trial.suggest_int("min_child_samples", 20, 150),
                "subsample": trial.suggest_float("subsample", 0.6, 1.0), "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
                "reg_lambda": trial.suggest_float("reg_lambda", 0.01, 20.0, log=True)}
    if name == "cat":
        return {"iterations": trial.suggest_int("iterations", 100, 500), "depth": trial.suggest_int("depth", 3, 7),
                "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True), "l2_leaf_reg": trial.suggest_float("l2_leaf_reg", 1.0, 20.0, log=True)}
    raise ValueError(f"unknown model family '{name}'")


def build(name: str, params: dict, k: int, seed: int = SEED):
    """An sklearn-style classifier for `k` classes (2 or 3)."""
    if name == "logreg":
        return make_pipeline(StandardScaler(), LogisticRegression(C=params["C"], max_iter=3000))
    if name == "rf":
        return RandomForestClassifier(**params, n_jobs=-1, random_state=seed)
    if name == "hgb":
        return HistGradientBoostingClassifier(**params, early_stopping=True, validation_fraction=0.15, random_state=seed)
    if name == "xgb":
        from xgboost import XGBClassifier

        return XGBClassifier(**params, tree_method="hist", n_jobs=4, random_state=seed, verbosity=0,
                             objective="binary:logistic" if k == 2 else "multi:softprob")
    if name == "lgbm":
        from lightgbm import LGBMClassifier

        return LGBMClassifier(**params, subsample_freq=1, n_jobs=4, random_state=seed, verbose=-1)
    if name == "cat":
        from catboost import CatBoostClassifier

        return CatBoostClassifier(**params, verbose=0, random_seed=seed, thread_count=4, allow_writing_files=False)
    raise ValueError(f"unknown model family '{name}'")


class Fitted:
    """A built classifier that takes DataFrames and always returns (n, k) probabilities."""

    def __init__(self, name: str, params: dict, k: int, seed: int = SEED):
        self.name, self.params, self.k, self.seed = name, params, k, seed
        self.model = build(name, params, k, seed)

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> "Fitted":
        self.model.fit(X.to_numpy(dtype="float64"), y)
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        p = np.asarray(self.model.predict_proba(X.to_numpy(dtype="float64")))
        classes = list(getattr(self.model, "classes_", range(p.shape[1])))
        out = np.zeros((len(X), self.k))
        for j, c in enumerate(classes):  # a class absent from the training window gets probability 0
            out[:, int(c)] = p[:, j]
        return out / np.clip(out.sum(axis=1, keepdims=True), 1e-12, None)


class Symmetric:
    """Orientation augmentation: fit on both team orders, predict as the average of both views."""

    def __init__(self, inner_factory: Callable[[], Fitted], swap_x: Callable[[pd.DataFrame], pd.DataFrame], k: int):
        self.inner, self.swap_x, self.k = inner_factory(), swap_x, k

    def _flip_y(self, y: np.ndarray) -> np.ndarray:
        return (1 - y) if self.k == 2 else (2 - y)

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> "Symmetric":
        self.inner.fit(pd.concat([X, self.swap_x(X)], ignore_index=True), np.concatenate([y, self._flip_y(y)]))
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        p = self.inner.predict_proba(X)
        q = self.inner.predict_proba(self.swap_x(X))[:, ::-1]  # mirrored view, columns back in our order
        return (p + q) / 2
