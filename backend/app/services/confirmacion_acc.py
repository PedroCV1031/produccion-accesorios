"""Confirmación transaccional del lote completo ACC (sin endpoint público).

Solo para usarse tras verificar que el despliegue MongoDB soporta transacciones.
Relee y reconcilia el archivo original en el servidor; nunca confía en el plan del navegador.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Mapping


from app.services.identificacion import clave_unica
from app.services.lector_excel_acc import analizar_archivo
from app.services.lote_acc import planificar_lote
from app.services.persistencia_acc import preparar_cambio


class LoteNoConfirmable(ValueError):
    pass


class LoteYaImportado(LoteNoConfirmable):
    pass


def identificar_lote(contenido: bytes, hojas: list[str] | None) -> str:
    """Hash del archivo + selección de hojas; resoluciones no alteran la identidad del lote."""
    seleccion = json.dumps(sorted(set(hojas)) if hojas is not None else None,
                           ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(contenido + b'\x00' + seleccion).hexdigest()


def validar_decisiones(analisis: Mapping, resoluciones: Mapping[str, str],
                       exclusiones_invalidas: list[str]) -> list[dict]:
    """Valida antes de escribir, incluso si la UI fue manipulada."""
    if not isinstance(resoluciones, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) for k, v in resoluciones.items()
    ):
        raise LoteNoConfirmable('Resoluciones mal formadas')
    if exclusiones_invalidas is None:
        exclusiones_invalidas = []
    if not isinstance(exclusiones_invalidas, list) or any(
        not isinstance(x, str) for x in exclusiones_invalidas
    ) or len(set(exclusiones_invalidas)) != len(exclusiones_invalidas):
        raise LoteNoConfirmable('Exclusiones inválidas mal formadas')
    filas = analisis['registros']
    claves = {f"{f['_hoja']}:{f['_fila']}" for f in filas}
    desconocidas = set(resoluciones) - claves
    if desconocidas:
        raise LoteNoConfirmable('Resoluciones de filas inexistentes')
    errores = {f"{h['hoja']}:{e['fila']}" for h in analisis['hojas']
               for e in h.get('errores', [])}
    if any(not h['formato_valido'] for h in analisis['hojas']):
        raise LoteNoConfirmable('Hay hojas con formato inválido')
    if set(exclusiones_invalidas) - errores:
        raise LoteNoConfirmable('Exclusiones inválidas desconocidas')
    return filas


def buscar_candidatos_en_sesion(filas, coleccion, session, *, tamano=500):
    claves = list({clave_unica(f) for f in filas})
    encontrados = {}
    for inicio in range(0, len(claves), tamano):
        for doc in coleccion.find({'clave_unica': {'$in': claves[inicio:inicio + tamano]}}, session=session):
            encontrados[str(doc['_id'])] = doc
    return list(encontrados.values())


def preparar_confirmacion(analisis, candidatos, resoluciones, exclusiones):
    filas = validar_decisiones(analisis, resoluciones, exclusiones)
    plan = planificar_lote(filas, candidatos, resoluciones=resoluciones)
    if plan['bloqueado'] or any(i['accion'] not in ('nuevo', 'existente', 'excluido', 'duplicado')
                               for i in plan['items']):
        raise LoteNoConfirmable('Existen coincidencias sin resolver o cantidades por revisar')
    return plan


def confirmar_lote(*, contenido: bytes, hojas: list[str] | None,
                   resoluciones: dict[str, str], exclusiones_invalidas: list[str],
                   client, database, max_filas: int = 10) -> dict:
    """Importa todo el archivo en UNA transacción; jamás confirma parcialmente.

    Debe ejecutarse solo desde una ruta protegida, con permisos y activación
    explícita. Requiere índices de database.py y una instancia Atlas compatible.
    """
    from bson import ObjectId
    from pymongo.errors import DuplicateKeyError

    # Analizar ANTES de comenzar la transacción para acortar su duración.
    exclusiones_invalidas = exclusiones_invalidas or []
    analisis = analizar_archivo(contenido, hojas=hojas, incluir_registros=True)
    filas = validar_decisiones(analisis, resoluciones, exclusiones_invalidas)
    if len(filas) > max_filas:
        raise LoteNoConfirmable(f'El lote excede el límite permitido de {max_filas} filas válidas')
    digest = identificar_lote(contenido, hojas)
    importacion_id = 'archivo:' + digest
    pedidos = database['pedidos_acc']
    entregas = database['entregas_parciales']
    versiones = database['versiones_pedidos']
    importaciones = database['importaciones_acc']
    ahora = datetime.now(timezone.utc)
    resultados = {'nuevos': 0, 'actualizados': 0, 'sin_cambios': 0,
                  'excluidos': 0, 'saldos_iniciales': 0, 'parciales': 0,
                  'filas_invalidas_excluidas': analisis['total_invalidas']}
    # No usar confirmaciones anidadas por pedido: la transacción debe cubrir todo.
    try:
        with client.start_session() as session:
            with session.start_transaction():
                # Serialización de confirmaciones (también para archivos distintos).
                # Todas las escrituras ACC deben pasar por este mecanismo.
                importaciones.update_one(
                    {'_id': '__ACC_LOCK__'},
                    {'$inc': {'revision': 1}}, upsert=True, session=session,
                )
                if importaciones.find_one({'_id': importacion_id}, session=session):
                    raise LoteYaImportado('Este mismo archivo y selección de hojas ya fue confirmado')
                candidatos = buscar_candidatos_en_sesion(filas, pedidos, session)
                plan = preparar_confirmacion(analisis, candidatos, resoluciones,
                                            exclusiones_invalidas)
                por_id = {str(c['_id']): c for c in candidatos}
                por_origen = {f"{f['_hoja']}:{f['_fila']}": f for f in filas}
                for item in plan['items']:
                    if item['accion'] in ('excluido', 'duplicado'):
                        resultados['excluidos'] += 1
                        continue
                    fila = por_origen[item['origen']]
                    if item['accion'] == 'existente':
                        previo = por_id[item['pedido_id']]
                        pid = previo['_id']
                        revision = previo.get('revision', 1)
                    else:
                        previo = None
                        pid = ObjectId()
                        revision = 0
                    cambio = preparar_cambio(
                        fila, previo, str(pid), importacion_id=importacion_id,
                        fecha_deteccion=ahora.date().isoformat(),
                    )
                    if previo is not None and not cambio['cambios']:
                        resultados['sin_cambios'] += 1
                        continue
                    nueva_revision = revision + 1
                    if previo is None:
                        pedidos.insert_one({
                            '_id': pid, 'datos': cambio['datos'],
                            'identidad': cambio['identidad'], 'clave_unica': clave_unica(fila), 'revision': nueva_revision,
                            'creado_en': ahora, 'actualizado_en': ahora,
                        }, session=session)
                        resultados['nuevos'] += 1
                    else:
                        actualizacion = pedidos.update_one(
                            {'_id': pid, 'revision': revision},
                            {'$set': {'datos': cambio['datos'], 'identidad': cambio['identidad'],
                                      'clave_unica': clave_unica(fila), 'actualizado_en': ahora}, '$inc': {'revision': 1}},
                            session=session,
                        )
                        if actualizacion.matched_count != 1:
                            raise LoteNoConfirmable('El pedido cambió; vuelva a previsualizar')
                        resultados['actualizados'] += 1
                    versiones.insert_one({
                        'pedido_id': pid, 'numero': nueva_revision,
                        'cambios': cambio['cambios'], 'datos': cambio['datos'],
                        'importacion_id': importacion_id, 'creado_en': ahora,
                    }, session=session)
                    if cambio['movimiento']:
                        movimiento = dict(cambio['movimiento'])
                        movimiento.update({'pedido_id': pid, 'numero': nueva_revision,
                                           'creado_en': ahora})
                        entregas.insert_one(movimiento, session=session)
                        if cambio['accion_movimiento'] == 'saldo_inicial':
                            resultados['saldos_iniciales'] += 1
                        elif cambio['accion_movimiento'] == 'nuevo_parcial':
                            resultados['parciales'] += 1
                importaciones.insert_one({
                    '_id': importacion_id, 'hash': digest,
                    'hojas': hojas, 'resoluciones': resoluciones,
                    'exclusiones_invalidas': exclusiones_invalidas,
                    'resumen': resultados, 'creado_en': ahora,
                    'estado': 'confirmado',
                }, session=session)
    except DuplicateKeyError as exc:
        raise LoteYaImportado('Posible importación repetida; vuelva a consultar') from exc
    return {'importacion_id': importacion_id, 'resumen': resultados,
            'confirmado': True}


def confirmar_lote_por_bloques(*, contenido: bytes, hojas: list[str] | None,
                               resoluciones: dict[str, str], exclusiones_invalidas: list[str],
                               client, database, tamano_bloque: int = 40,
                               max_filas: int = 2000) -> dict:
    """Confirma por transacciones pequeñas; guarda avance y permite reanudar el MISMO archivo.

    El candado global se mantiene entre transacciones: un segundo lote no puede
    comenzar hasta terminar el primero. No se altera el Excel.
    """
    from bson import ObjectId
    from pymongo.errors import DuplicateKeyError, PyMongoError

    exclusiones_invalidas = exclusiones_invalidas or []
    analisis = analizar_archivo(contenido, hojas=hojas, incluir_registros=True)
    filas = validar_decisiones(analisis, resoluciones, exclusiones_invalidas)
    if len(filas) > max_filas:
        raise LoteNoConfirmable(f'Se superó el máximo de {max_filas} filas')
    if not 1 <= tamano_bloque <= 100:
        raise ValueError('Tamaño de bloque no permitido')
    digest = identificar_lote(contenido, hojas)
    importacion_id = 'archivo:' + digest
    importaciones = database['importaciones_acc']
    pedidos = database['pedidos_acc']
    entregas = database['entregas_parciales']
    versiones = database['versiones_pedidos']
    bloqueo_id = '__ACC_IMPORTACION_ACTIVA__'
    decisiones = {'resoluciones': resoluciones, 'exclusiones_invalidas': sorted(exclusiones_invalidas)}
    firma_decisiones = hashlib.sha256(json.dumps(decisiones, sort_keys=True,
                                                  ensure_ascii=False).encode()).hexdigest()
    activo = importaciones.find_one({'_id': bloqueo_id})
    if activo and activo.get('importacion_id') != importacion_id:
        raise LoteNoConfirmable('Existe otra importación incompleta. Finalízala antes de iniciar otra.')
    registro = importaciones.find_one({'_id': importacion_id})
    if registro and registro.get('estado') == 'confirmado':
        raise LoteYaImportado('Este archivo ya fue confirmado; no se duplicaron pedidos')
    if registro and registro.get('estado') != 'en_curso':
        raise LoteNoConfirmable('La importación tiene un estado que necesita revisión')
    if registro and registro.get('firma_decisiones') != firma_decisiones:
        raise LoteNoConfirmable('Para reanudar debes conservar las mismas decisiones del lote original')

    if registro is None:
        # Crear candado primero. El índice único de _id impide dos importaciones simultáneas.
        if not activo:
            try:
                importaciones.insert_one({'_id': bloqueo_id, 'importacion_id': importacion_id,
                                          'creado_en': datetime.now(timezone.utc)})
            except DuplicateKeyError as exc:
                raise LoteNoConfirmable('Otra importación está en ejecución') from exc
        try:
            # Planificar una sola vez, antes de escribir; congelar asignaciones de IDs.
            candidatos = buscar_candidatos_en_sesion(filas, pedidos, None)
            plan = preparar_confirmacion(analisis, candidatos, resoluciones, exclusiones_invalidas)
            previstos = {str(c['_id']): c for c in candidatos}
            tareas = []
            for item in plan['items']:
                tarea = {'origen': item['origen'], 'accion': item['accion']}
                if item['accion'] == 'nuevo':
                    tarea['pedido_id'] = str(ObjectId())
                if item['accion'] == 'existente':
                    pid = item['pedido_id']
                    tarea['pedido_id'] = pid
                    tarea['revision_original'] = previstos[pid].get('revision', 1)
                tareas.append(tarea)
            importaciones.insert_one({
                '_id': importacion_id, 'hash': digest, 'hojas': hojas,
                'firma_decisiones': firma_decisiones, 'resoluciones': resoluciones,
                'exclusiones_invalidas': exclusiones_invalidas, 'tareas': tareas,
                'tamano_bloque': tamano_bloque, 'siguiente': 0,
                'resumen': {'nuevos': 0, 'actualizados': 0, 'sin_cambios': 0,
                            'excluidos': 0, 'saldos_iniciales': 0, 'parciales': 0,
                            'filas_invalidas_excluidas': analisis['total_invalidas']},
                'estado': 'en_curso', 'creado_en': datetime.now(timezone.utc),
            })
            registro = importaciones.find_one({'_id': importacion_id})
        except Exception:
            # Sólo liberar si el manifiesto no llegó a crearse.
            if importaciones.find_one({'_id': importacion_id}) is None:
                importaciones.delete_one({'_id': bloqueo_id, 'importacion_id': importacion_id})
            raise
    elif not activo:
        # Permite recuperarse si se perdió el candado, sin mezclar importaciones.
        otros = importaciones.count_documents({'estado': 'en_curso', '_id': {'$ne': importacion_id}})
        if otros:
            raise LoteNoConfirmable('Otra importación incompleta requiere revisión')
        try:
            importaciones.insert_one({'_id': bloqueo_id, 'importacion_id': importacion_id,
                                      'creado_en': datetime.now(timezone.utc)})
        except DuplicateKeyError as exc:
            raise LoteNoConfirmable('Hay otra importación en proceso') from exc

    tareas = registro['tareas']
    por_origen = {f"{f['_hoja']}:{f['_fila']}": f for f in filas}
    total = len(tareas)
    paso = registro['tamano_bloque']
    while True:
        # Leer el progreso persistido ANTES de cada bloque; nunca confiar en memoria.
        registro = importaciones.find_one({'_id': importacion_id})
        inicio = registro['siguiente']
        if inicio >= total:
            break
        fin = min(total, inicio + paso)
        ahora = datetime.now(timezone.utc)

        def escribir_bloque(session):
            actual = importaciones.find_one({'_id': importacion_id}, session=session)
            if actual is None or actual.get('siguiente') != inicio:
                raise LoteNoConfirmable('El avance cambió; consulta el estado del lote')
            if not importaciones.find_one({'_id': bloqueo_id, 'importacion_id': importacion_id}, session=session):
                raise LoteNoConfirmable('Se perdió el bloqueo exclusivo de importación')
            conteos = {'nuevos': 0, 'actualizados': 0, 'sin_cambios': 0,
                       'excluidos': 0, 'saldos_iniciales': 0, 'parciales': 0}
            # Preparar los documentos y escribirlos en grupos para reducir viajes a Atlas.
            # El manifiesto conserva IDs permanentes; el avance se confirma en esta transacción.
            nuevos, actualizados, nuevas_versiones, nuevos_movimientos = [], [], [], []
            from pymongo import UpdateOne
            for tarea in tareas[inicio:fin]:
                if tarea['accion'] in ('excluido', 'duplicado'):
                    conteos['excluidos'] += 1
                    continue
                fila = por_origen[tarea['origen']]
                pid = ObjectId(tarea['pedido_id'])
                previo = pedidos.find_one({'_id': pid}, session=session) if tarea['accion'] == 'existente' else None
                if tarea['accion'] == 'existente':
                    if previo is None or previo.get('revision', 1) != tarea['revision_original']:
                        raise LoteNoConfirmable('Un pedido fue modificado; revisa antes de continuar')
                revision = previo.get('revision', 1) if previo else 0
                cambio = preparar_cambio(fila, previo, str(pid), importacion_id=importacion_id,
                                         fecha_deteccion=ahora.date().isoformat())
                if previo is not None and not cambio['cambios']:
                    conteos['sin_cambios'] += 1
                    continue
                nueva_revision = revision + 1
                if previo is None:
                    nuevos.append({'_id': pid, 'datos': cambio['datos'],
                                   'identidad': cambio['identidad'], 'clave_unica': clave_unica(fila), 'revision': nueva_revision,
                                   'creado_en': ahora, 'actualizado_en': ahora})
                    conteos['nuevos'] += 1
                else:
                    actualizados.append(UpdateOne(
                        {'_id': pid, 'revision': revision},
                        {'$set': {'datos': cambio['datos'], 'identidad': cambio['identidad'],
                                  'clave_unica': clave_unica(fila), 'actualizado_en': ahora}, '$inc': {'revision': 1}}))
                    conteos['actualizados'] += 1
                nuevas_versiones.append({'pedido_id': pid, 'numero': nueva_revision,
                                         'cambios': cambio['cambios'], 'datos': cambio['datos'],
                                         'importacion_id': importacion_id, 'creado_en': ahora})
                if cambio['movimiento']:
                    movimiento = dict(cambio['movimiento'])
                    movimiento.update({'pedido_id': pid, 'numero': nueva_revision, 'creado_en': ahora})
                    nuevos_movimientos.append(movimiento)
                    if cambio['accion_movimiento'] == 'saldo_inicial':
                        conteos['saldos_iniciales'] += 1
                    elif cambio['accion_movimiento'] == 'nuevo_parcial':
                        conteos['parciales'] += 1
            if nuevos:
                pedidos.insert_many(nuevos, ordered=True, session=session)
            if actualizados:
                resultado = pedidos.bulk_write(actualizados, ordered=True, session=session)
                if resultado.matched_count != len(actualizados):
                    raise LoteNoConfirmable('Revisión de pedidos modificada; requiere conciliación')
            if nuevas_versiones:
                versiones.insert_many(nuevas_versiones, ordered=True, session=session)
            if nuevos_movimientos:
                entregas.insert_many(nuevos_movimientos, ordered=True, session=session)
            # Avance y escritura forman parte de la MISMA transacción pequeña.
            update = {'$inc': {'siguiente': fin - inicio,
                               **{f'resumen.{k}': v for k, v in conteos.items()}},
                      '$set': {'actualizado_en': ahora}}
            if fin == total:
                update['$set']['estado'] = 'confirmado'
                update['$set']['confirmado_en'] = ahora
            importaciones.update_one({'_id': importacion_id, 'siguiente': inicio},
                                     update, session=session)
            if fin == total:
                importaciones.delete_one({'_id': bloqueo_id, 'importacion_id': importacion_id}, session=session)
        with client.start_session() as session:
            # PyMongo reintenta transacciones con error TransientTransactionError.
            session.with_transaction(escribir_bloque)
    registro = importaciones.find_one({'_id': importacion_id})
    return {'importacion_id': importacion_id, 'resumen': registro['resumen'],
            'confirmado': registro['estado'] == 'confirmado',
            'procesados': registro['siguiente'], 'total': total}
