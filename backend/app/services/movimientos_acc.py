"""Planificador puro de entregas ACC: no escribe ni consulta MongoDB.

`acumulado_anterior` es el último acumulado CONFIRMADO de un pedido
identificado de forma inequívoca. El llamador debe garantizar exclusión
concurrente / transacción al aplicar el plan y persistir la versión base.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Mapping

from .parciales import comparar_entrega, _cantidad

AccionMovimiento = Literal[
    "saldo_inicial", "nuevo_parcial", "sin_cambio", "revision_disminucion"
]


@dataclass(frozen=True)
class PlanMovimiento:
    accion: AccionMovimiento
    acumulado_anterior: int | None
    acumulado_nuevo: int
    incremento: int
    movimiento: dict | None
    advertencias: tuple[str, ...] = ()


def _fecha_iso(valor: object) -> str | None:
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        return valor.date().isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, str):
        try:
            return date.fromisoformat(valor.strip()).isoformat()
        except ValueError as exc:
            raise ValueError("La fecha debe estar en formato AAAA-MM-DD") from exc
    raise ValueError("Fecha de entrega inválida")


def _entero(valor: object) -> int:
    if isinstance(valor, bool):
        raise ValueError("La cantidad no puede ser booleana")
    return int(_cantidad(valor))


def planificar_movimiento(
    *,
    pedido_id: str,
    acumulado_nuevo: int | str | Decimal,
    acumulado_anterior: int | str | Decimal | None,
    fecha_ultima_entrega: str | date | datetime | None = None,
    fecha_deteccion: str | date | datetime | None = None,
    importacion_id: str | None = None,
) -> PlanMovimiento:
    """Devuelve un plan sin efectos secundarios.

    Primera importación: un acumulado positivo se registra como saldo inicial
    conocido, NO como entrega parcial con fecha de despacho inventada.
    Si el total baja, se solicita revisión sin generar movimiento negativo.
    Para una nueva entrega, `fecha_ultima_entrega` es un dato proporcionado
    por Excel y `fecha_deteccion` debe asignarlo el importador.
    """
    if not pedido_id or not str(pedido_id).strip():
        raise ValueError("Se requiere un pedido inequívocamente identificado")
    nuevo = _entero(acumulado_nuevo)
    fecha_entrega = _fecha_iso(fecha_ultima_entrega)
    fecha_revision = _fecha_iso(fecha_deteccion)
    avisos = []
    if acumulado_anterior is None:
        if nuevo == 0:
            return PlanMovimiento("sin_cambio", None, 0, 0, None)
        movimiento = {
            "pedido_id": str(pedido_id), "tipo": "saldo_inicial",
            "cantidad": nuevo, "acumulado_anterior": 0, "acumulado_nuevo": nuevo,
            "fecha_entrega_referencial": fecha_entrega,
            "fecha_deteccion": fecha_revision, "importacion_id": importacion_id,
            "historico_sin_desglose": True,
        }
        avisos.append("Saldo inicial; no permite reconstruir entregas anteriores")
        return PlanMovimiento("saldo_inicial", None, nuevo, nuevo, movimiento, tuple(avisos))

    anterior = _entero(acumulado_anterior)
    comparacion = comparar_entrega(anterior, nuevo)
    if comparacion.accion == "sin_cambio":
        return PlanMovimiento("sin_cambio", anterior, nuevo, 0, None)
    if comparacion.accion == "revision_disminucion":
        return PlanMovimiento("revision_disminucion", anterior, nuevo, 0, None,
                              ("El acumulado disminuyó; requiere ajuste explícito antes de actualizar",))
    incremento = int(comparacion.diferencia)
    if fecha_entrega is None:
        avisos.append("Aumento sin fecha real de entrega")
    movimiento = {
        "pedido_id": str(pedido_id), "tipo": "parcial",
        "cantidad": incremento, "acumulado_anterior": anterior,
        "acumulado_nuevo": nuevo, "fecha_entrega": fecha_entrega,
        "fecha_deteccion": fecha_revision, "importacion_id": importacion_id,
    }
    return PlanMovimiento("nuevo_parcial", anterior, nuevo, incremento,
                          movimiento, tuple(avisos))


def planificar_desde_registro(
    *, pedido_id: str, fila: Mapping[str, object],
    pedido_previo: Mapping[str, object] | None,
    fecha_deteccion: str | date | datetime | None = None,
    importacion_id: str | None = None,
) -> PlanMovimiento:
    """Usa los nombres normalizados del lector del paso 3.

    Se rechazan pedidos sin un campo de acumulado, en lugar de confundir
    una omisión de datos con una disminución de entregas.
    """
    if "cantidad_entregada_acumulada" not in fila:
        raise ValueError("Falta cantidad_entregada_acumulada")
    acumulado = fila["cantidad_entregada_acumulada"]
    if acumulado is None:
        raise ValueError("Acumulado no informado")
    datos = (pedido_previo.get("datos", pedido_previo)
             if pedido_previo is not None else None)
    anterior = None
    if datos is not None:
        if "cantidad_entregada_acumulada" not in datos:
            raise ValueError("Pedido existente sin acumulado confirmado; requiere conciliación")
        anterior = datos["cantidad_entregada_acumulada"]
        if anterior is None:
            raise ValueError("Pedido existente sin acumulado confirmado")
    return planificar_movimiento(
        pedido_id=pedido_id, acumulado_nuevo=acumulado,
        acumulado_anterior=anterior,
        fecha_ultima_entrega=fila.get("fecha_ultima_entrega"),
        fecha_deteccion=fecha_deteccion, importacion_id=importacion_id,
    )
