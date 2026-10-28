"""Plan automático por clave única. No hay resoluciones manuales."""
from __future__ import annotations
from collections import Counter
from datetime import date
from typing import Mapping, Sequence
from .identificacion import conciliar_lote
from .movimientos_acc import planificar_desde_registro


def planificar_lote(filas: Sequence[Mapping], candidatos: Sequence[Mapping],
                    resoluciones: Mapping[str, str] | None = None,
                    *, importacion_id: str = 'PREVIEW') -> dict:
    if resoluciones:
        raise ValueError('La versión de clave única no admite resoluciones manuales')
    matches = conciliar_lote(filas, candidatos)
    por_id = {str(c.get('_id', c.get('id'))): c for c in candidatos}
    items = []
    for i, (fila, match) in enumerate(zip(filas, matches)):
        origen = f"{fila.get('_hoja', '')}:{fila.get('_fila', i + 1)}"
        item = {'origen': origen, 'accion': match.accion, 'pedido_id': match.candidato_id,
                'candidatos_ids': [], 'motivo': match.motivo,
                'cambios': match.cambios or {}, 'movimiento': None, 'advertencias': []}
        if match.accion in ('nuevo', 'existente'):
            try:
                plan = planificar_desde_registro(
                    pedido_id=match.candidato_id or f'PREVIEW:{origen}', fila=fila,
                    pedido_previo=por_id.get(match.candidato_id),
                    fecha_deteccion=date.today(), importacion_id=importacion_id)
                item['movimiento'] = {'tipo': plan.accion, 'cantidad': plan.incremento}
                item['advertencias'] = list(plan.advertencias)
                if plan.accion == 'revision_disminucion':
                    item['accion'] = 'revision'
                    item['motivo'] = 'El acumulado entregado disminuyó; corregir el Excel antes de importar'
            except ValueError as exc:
                item['accion'] = 'revision'
                item['motivo'] = str(exc)
        items.append(item)
    conteos = Counter(x['accion'] for x in items)
    # Los duplicados se excluyen automáticamente; las disminuciones impiden escribir.
    return {'items': items, 'resumen': dict(conteos),
            'bloqueado': any(x['accion'] == 'revision' for x in items),
            'solo_planificacion': True}
