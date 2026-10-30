from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Mapping, Sequence, Literal

CAMPOS_IDENTIDAD = ('cliente', 'orden_compra', 'referencia', 'acabado_talla', 'color_codigo', 'fecha_pedido')

CAMPOS_MUTABLES = (
    'fecha_pedido', 'fecha_solicitada', 'fecha_comprometida',
    'cliente', 'comercial', 'orden_compra', 'referencia', 'acabado_talla',
    'color_codigo', 'cantidad_solicitada', 'fecha_ultima_entrega',
    'cantidad_entregada_acumulada', 'factura',
)


def normalizar_texto(value: object) -> str:
    if value is None:
        return ''
    raw = unicodedata.normalize('NFKD', str(value))
    raw = ''.join(c for c in raw if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', raw).strip().upper()


def clave_candidatos(fila: Mapping[str, object]) -> tuple[str, ...]:
    return tuple(normalizar_texto(fila.get(k)) for k in CAMPOS_IDENTIDAD)


def identidad_normalizada(fila: Mapping[str, object]) -> dict[str, str]:
    return dict(zip(CAMPOS_IDENTIDAD, clave_candidatos(fila)))


def diferencias(registro: Mapping[str, object], previo: Mapping[str, object]) -> dict[str, dict[str, object]]:
    """Diferencias de negocio, sin datos derivados ni ubicación de fila/hoja."""
    salida = {}
    for campo in CAMPOS_MUTABLES:
        antes, despues = previo.get(campo), registro.get(campo)
        # Comparar cadenas normalizadas en identificación, guardar originales en versiones.
        iguales = (normalizar_texto(antes) == normalizar_texto(despues)
                   if campo in CAMPOS_IDENTIDAD or campo in ('comercial', 'factura')
                   else antes == despues)
        if not iguales:
            salida[campo] = {'anterior': antes, 'nuevo': despues}
    return salida


@dataclass(frozen=True)
class ResultadoConciliacion:
    accion: Literal['nuevo', 'existente', 'duplicado']
    candidato_id: str | None = None
    candidatos_ids: tuple[str, ...] = ()
    motivo: str = ''
    cambios: dict | None = None


def clave_unica(fila: Mapping[str, object]) -> str:
    """Clave estable versionada; nunca incluye fechas de compromiso ni cantidades."""
    import hashlib
    import json
    valores = clave_candidatos(fila)
    if any(not valor for campo, valor in zip(CAMPOS_IDENTIDAD, valores) if campo != 'orden_compra'):
        raise ValueError('Falta un campo de identidad obligatorio (orden de compra es opcional)')
    return 'ACC1:' + hashlib.sha256(json.dumps(valores, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def clave_distincion(fila: Mapping[str, object]) -> tuple:
    return clave_candidatos(fila)


def conciliar(fila: Mapping[str, object], candidatos: Sequence[Mapping[str, object]]) -> ResultadoConciliacion:
    clave = clave_unica(fila)
    compatibles = [c for c in candidatos if (c.get('clave_unica') or clave_unica(c.get('datos', c))) == clave]
    if not compatibles:
        return ResultadoConciliacion('nuevo', motivo='Clave única no registrada')
    if len(compatibles) != 1:
        return ResultadoConciliacion('duplicado', motivo='La base contiene claves repetidas; revisar en MongoDB')
    doc = compatibles[0]
    return ResultadoConciliacion('existente', candidato_id=str(doc.get('_id',doc.get('id'))),
                                motivo='Pedido existente identificado por su clave única',
                                cambios=diferencias(fila, doc.get('datos', doc)))


def conciliar_lote(filas: Sequence[Mapping[str, object]], candidatos: Sequence[Mapping[str, object]]) -> list[ResultadoConciliacion]:
    """Rechaza TODAS las filas del archivo que compartan clave comercial."""
    from collections import Counter
    claves = [clave_unica(f) for f in filas]
    conteo = Counter(claves)
    resultados = [conciliar(f, candidatos) for f in filas]
    return [ResultadoConciliacion('duplicado', motivo='Clave repetida en el Excel; corregir todas las filas del grupo')
            if conteo[clave] > 1 else r for clave, r in zip(claves, resultados)]
