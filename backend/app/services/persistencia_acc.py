"""Persistencia transaccional ACC, independiente de las rutas heredadas.

No abre conexiones ni confirma lotes automáticamente. Requiere MongoDB con
transacciones (Atlas o replica set) y colecciones ACC proporcionadas por caller.
La conciliación de candidatos / revisión de casos ambiguos es previa.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping

from .identificacion import diferencias, identidad_normalizada
from .movimientos_acc import planificar_desde_registro


class RevisionRequerida(ValueError):
    pass


class ConflictoConcurrente(RuntimeError):
    pass


def _datos(fila: Mapping) -> dict:
    campos = (
        'fecha_pedido', 'fecha_solicitada', 'fecha_comprometida', 'cliente',
        'comercial', 'orden_compra', 'referencia', 'acabado_talla', 'color_codigo',
        'cantidad_solicitada', 'fecha_ultima_entrega',
        'cantidad_entregada_acumulada', 'factura',
    )
    return {campo: fila.get(campo) for campo in campos}


def preparar_cambio(fila: Mapping, pedido_previo: Mapping | None, pedido_id: str,
                    *, importacion_id: str, fecha_deteccion: str) -> dict:
    """Plan sin efectos secundarios: seguro para pruebas y previsualización."""
    if not importacion_id:
        raise ValueError('Falta identificador de importación')
    datos = _datos(fila)
    if not datos['cliente'] or not datos['referencia']:
        raise ValueError('Cliente y referencia requeridos')
    if not type(datos['cantidad_solicitada']) is int or datos['cantidad_solicitada'] <= 0:
        raise ValueError('Cantidad solicitada inválida')
    if not type(datos['cantidad_entregada_acumulada']) is int or datos['cantidad_entregada_acumulada'] < 0:
        raise ValueError('Cantidad acumulada inválida')
    previo = pedido_previo.get('datos', pedido_previo) if pedido_previo is not None else None
    movimiento = planificar_desde_registro(
        pedido_id=pedido_id, fila=datos, pedido_previo=pedido_previo,
        fecha_deteccion=fecha_deteccion, importacion_id=importacion_id,
    )
    if movimiento.accion == 'revision_disminucion':
        raise RevisionRequerida('Disminución de acumulado: requiere resolución explícita')
    return {
        'pedido_id': pedido_id, 'datos': datos,
        'identidad': identidad_normalizada(datos),
        'cambios': diferencias(datos, previo) if previo is not None else {},
        'movimiento': movimiento.movimiento,
        'accion_movimiento': movimiento.accion,
        'advertencias': list(movimiento.advertencias),
    }


def confirmar_pedido(*, client, pedidos, entregas, versiones,
                     fila: Mapping, pedido_id: ObjectId | None,
                     importacion_id: str, fecha_deteccion: str) -> dict:
    """Confirma UNA línea, de manera atómica, en una transacción.

    Solo debe llamarse una vez resuelta la identificación del pedido. No usar
    este método como sustituto de la conciliación del lote. No borrar pedidos.
    """
    from bson import ObjectId

    ahora = datetime.now(timezone.utc)
    with client.start_session() as session:
        with session.start_transaction():
            if pedido_id is not None:
                previo = pedidos.find_one({'_id': pedido_id}, session=session)
                if previo is None:
                    raise ConflictoConcurrente('El pedido seleccionado ya no existe')
                identificador = str(pedido_id)
                plan = preparar_cambio(fila, previo, identificador,
                                       importacion_id=importacion_id,
                                       fecha_deteccion=fecha_deteccion)
                if not plan['cambios']:
                    return {'pedido_id': identificador, 'estado': 'sin_cambios'}
                rev = previo.get('revision', 1)
                result = pedidos.update_one(
                    {'_id': pedido_id, 'revision': rev},
                    {'$set': {'datos': plan['datos'], 'identidad': plan['identidad'],
                              'actualizado_en': ahora}, '$inc': {'revision': 1}},
                    session=session,
                )
                if result.matched_count != 1:
                    raise ConflictoConcurrente('El pedido cambió durante la importación')
                version_num = rev + 1
            else:
                pedido_id = ObjectId()
                identificador = str(pedido_id)
                plan = preparar_cambio(fila, None, identificador,
                                       importacion_id=importacion_id,
                                       fecha_deteccion=fecha_deteccion)
                pedidos.insert_one({
                    '_id': pedido_id, 'datos': plan['datos'], 'identidad': plan['identidad'],
                    'revision': 1, 'creado_en': ahora, 'actualizado_en': ahora,
                }, session=session)
                version_num = 1

            versiones.insert_one({
                'pedido_id': pedido_id, 'numero': version_num,
                'cambios': plan['cambios'] if version_num > 1 else {},
                'datos': plan['datos'], 'importacion_id': importacion_id,
                'creado_en': ahora,
            }, session=session)
            if plan['movimiento']:
                mov = dict(plan['movimiento'])
                mov['pedido_id'] = pedido_id
                mov['numero'] = version_num  # único por pedido y revisión de origen
                mov['creado_en'] = ahora
                entregas.insert_one(mov, session=session)
            return {
                'pedido_id': identificador,
                'estado': 'creado' if version_num == 1 else 'actualizado',
                'version': version_num,
                'movimiento': plan['accion_movimiento'],
                'advertencias': plan['advertencias'],
            }
