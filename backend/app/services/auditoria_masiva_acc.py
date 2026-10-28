"""Auditoria de importacion ACC. Solo lectura; no autoriza confirmaciones."""
from collections import defaultdict, Counter

from app.services.identificacion import clave_distincion


def resumir_auditoria(analisis, plan, *, max_muestras=30):
    filas = analisis.get('registros', [])
    hojas = analisis.get('hojas', [])
    errores = [dict(hoja=h['hoja'], **err) for h in hojas for err in h.get('errores', [])]
    grupos = defaultdict(list)
    for fila in filas:
        llave = clave_distincion(fila)
        grupos[llave].append(f"{fila['_hoja']}:{fila['_fila']}")
    repetidos = [g for g in grupos.values() if len(g) > 1]
    items = plan.get('items', [])
    conteos = Counter(i['accion'] for i in items)
    movimientos = Counter(i.get('movimiento', {}).get('tipo') for i in items if i.get('movimiento'))
    formatos_incorrectos = [h['hoja'] for h in hojas if not h.get('formato_valido')]
    return {
        'modo': 'auditoria_solo_lectura',
        'confirmacion_habilitada': False,
        'filas_validas': len(filas),
        'filas_invalidas': len(errores),
        'hojas_formato_invalido': formatos_incorrectos,
        'acciones': dict(conteos),
        'movimientos_previstos': dict(movimientos),
        'grupos_identidad_repetida': len(repetidos),
        'filas_en_grupos_repetidos': sum(map(len, repetidos)),
        'muestras_grupos': [dict(filas=g) for g in repetidos[:max_muestras]],
        'muestras_errores': errores[:max_muestras],
        'bloqueos': {
            'coincidencias_o_revisiones': conteos['ambiguo'] + conteos['revision'],
            'filas_invalidas_sin_excluir': len(errores),
            'hojas_formato_invalido': len(formatos_incorrectos),
        },
        'nota': 'La auditoria no guarda decisiones ni modifica MongoDB. No habilita carga masiva.',
    }
