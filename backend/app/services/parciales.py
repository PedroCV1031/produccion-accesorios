"""Cálculo puro de movimientos a partir de totales acumulados.

No escribe en MongoDB. Las escrituras deben ser atómicas y asociadas al
pedido/importación desde el importador (se implementará en otro paso).
"""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal


@dataclass(frozen=True)
class ComparacionEntrega:
    accion: Literal['sin_cambio', 'nuevo_parcial', 'revision_disminucion']
    acumulado_anterior: Decimal
    acumulado_nuevo: Decimal
    diferencia: Decimal


def _cantidad(valor: int | float | str | Decimal) -> Decimal:
    try:
        cantidad = Decimal(str(valor))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError('La cantidad debe ser numérica') from exc
    if not cantidad.is_finite() or cantidad < 0:
        raise ValueError('La cantidad debe ser finita y no negativa')
    if cantidad != cantidad.to_integral_value():
        raise ValueError('Las cantidades deben expresarse en unidades enteras')
    return cantidad


def comparar_entrega(acumulado_anterior: int | float | str | Decimal,
                     acumulado_nuevo: int | float | str | Decimal) -> ComparacionEntrega:
    anterior, nuevo = _cantidad(acumulado_anterior), _cantidad(acumulado_nuevo)
    diferencia = nuevo - anterior
    if diferencia > 0:
        accion = 'nuevo_parcial'
    elif diferencia < 0:
        accion = 'revision_disminucion'
    else:
        accion = 'sin_cambio'
    return ComparacionEntrega(accion, anterior, nuevo, diferencia)
