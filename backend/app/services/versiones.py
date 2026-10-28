"""Proyección pura de cambios de pedidos ACC para construir futuras versiones.

La escritura transaccional y el número consecutivo se implementarán con MongoDB.
"""
from __future__ import annotations
from typing import Mapping
from .identificacion import diferencias


def construir_cambios(actual: Mapping[str, object], previo: Mapping[str, object]) -> dict:
    return diferencias(actual, previo)


def requiere_version(actual: Mapping[str, object], previo: Mapping[str, object]) -> bool:
    return bool(construir_cambios(actual, previo))
