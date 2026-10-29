"""Consulta de candidatos y planificación de importación ACC. SIN escrituras.

La confirmación de lotes se habilitará solamente tras incorporar
transacciones de lote, persistencia de resoluciones y controles concurrentes.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from pymongo.errors import PyMongoError

from app.database import pedidos_acc_collection, client, database
from app.routers.consultas_acc import invalidar_opciones_filtros
from app.services.identificacion import clave_unica, clave_distincion
from app.services.lector_excel_acc import analizar_archivo, detectar_hojas_validas
from app.services.lote_acc import planificar_lote
from app.services.auditoria_masiva_acc import resumir_auditoria
from app.services.confirmacion_acc import confirmar_lote, confirmar_lote_por_bloques, LoteNoConfirmable, LoteYaImportado

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/conciliacion-acc', tags=['Conciliación ACC'])
MAX_ARCHIVO = 20 * 1024 * 1024


def consultar_candidatos(filas, coleccion, *, tamano_lote=500):
    """Una consulta $in por lote de claves; índice único asegura búsqueda eficiente."""
    claves = list({clave_unica(f) for f in filas})
    encontrados = {}
    for inicio in range(0, len(claves), tamano_lote):
        for doc in coleccion.find({'clave_unica': {'$in': claves[inicio:inicio + tamano_lote]}},
                                  {'datos': 1, 'identidad': 1, 'clave_unica': 1, 'revision': 1}):
            encontrados[str(doc['_id'])] = doc
    return list(encontrados.values())


def construir_previsualizacion(contenido, hojas, coleccion, resoluciones=None, exclusiones_invalidas=None):
    analisis = analizar_archivo(contenido, hojas=hojas, incluir_registros=True)
    filas = analisis.pop('registros')
    errores = {f"{hoja['hoja']}:{e['fila']}" for hoja in analisis['hojas'] for e in hoja.get('errores', [])}
    # Sin selección explícita: todas las filas inválidas se excluyen por defecto.
    exclusiones_invalidas = errores if exclusiones_invalidas is None else set(exclusiones_invalidas)
    no_reconocidas = exclusiones_invalidas - errores
    if no_reconocidas:
        raise ValueError('Exclusiones inválidas no reconocidas: ' + ', '.join(sorted(no_reconocidas)[:5]))
    for hoja in analisis['hojas']:
        for error in hoja.get('errores', []):
            error['excluida'] = f"{hoja['hoja']}:{error['fila']}" in exclusiones_invalidas
    candidatos = consultar_candidatos(filas, coleccion)
    plan = planificar_lote(filas, candidatos, resoluciones=resoluciones, importacion_id=f'PREVIEW-{uuid4()}')
    # Contexto visual por cada fila; los datos aquí provienen del Excel validado.
    indice = {f"{fila['_hoja']}:{fila['_fila']}": fila for fila in filas}
    grupos = {}
    for clave, fila in indice.items():
        identidad = clave_distincion(fila)
        grupos.setdefault(identidad, []).append(clave)
    for item in plan['items']:
        fila = indice.get(item['origen'], {})
        identidad = clave_distincion(fila)
        item['datos_fila'] = {k: v for k, v in fila.items() if not k.startswith('_')}
        item['filas_relacionadas'] = [
            {'origen': otra, 'datos': {k: v for k, v in indice[otra].items() if not k.startswith('_')}}
            for otra in grupos.get(identidad, []) if otra != item['origen']
        ]
        item['candidatos_detalle'] = [
            {'id': str(doc['_id']), 'datos': doc.get('datos', {}), 'identidad': doc.get('identidad', {})}
            for doc in candidatos if str(doc['_id']) in item['candidatos_ids']
        ]
    acciones = plan['resumen']
    pendientes_invalidas = len(errores - exclusiones_invalidas)
    resumen_final = {
        'pedidos_nuevos': acciones.get('nuevo', 0),
        'pedidos_existentes': acciones.get('existente', 0),
        'filas_excluidas': acciones.get('excluido', 0) + acciones.get('duplicado', 0),
        'filas_invalidas_excluidas': len(exclusiones_invalidas),
        'filas_invalidas_pendientes': pendientes_invalidas,
        'casos_sin_resolver': acciones.get('revision', 0),
        'duplicados_rechazados': acciones.get('duplicado', 0),
        'saldos_iniciales': sum(1 for item in plan['items'] if item.get('movimiento') and item['movimiento']['tipo'] == 'saldo_inicial'),
        'parciales_nuevos': sum(1 for item in plan['items'] if item.get('movimiento') and item['movimiento']['tipo'] == 'parcial'),
    }
    return {
        'modo': 'solo_lectura',
        'exclusiones_invalidas_aplicadas': sorted(exclusiones_invalidas),
        'permiso_servidor': ((os.getenv('ACC_CONFIRMACION_PILOTO', 'false').lower() == 'true' and len(filas) <= 10) or (os.getenv('ACC_CONFIRMACION_MASIVA', 'false').lower() == 'true' and 10 < len(filas) <= 2000)),
        'resumen_definitivo': resumen_final,
        'listo_para_futura_confirmacion': pendientes_invalidas == 0 and resumen_final['casos_sin_resolver'] == 0,
        'confirmacion_habilitada': ((os.getenv('ACC_CONFIRMACION_PILOTO', 'false').lower() == 'true'
            and len(filas) <= 10) or (os.getenv('ACC_CONFIRMACION_MASIVA', 'false').lower() == 'true'
            and len(filas) <= 2000)) and pendientes_invalidas == 0
            and resumen_final['casos_sin_resolver'] == 0
            and not plan['bloqueado'] and all(h.get('formato_valido') for h in analisis['hojas']),
        'tipo_confirmacion': ('masiva' if len(filas)>10 else 'piloto'),
        'validacion': analisis,
        'conciliacion': plan,
        'candidatos_encontrados': len(candidatos),
        'mensaje': 'Validación automática por clave única. No se realizaron escrituras en MongoDB',
    }


@router.post('/hojas')
async def hojas_para_importar(file: UploadFile = File(...)):
    """Detecta hojas seleccionables antes de hacer consultas a MongoDB."""
    if Path(file.filename or '').suffix.lower() not in ('.xlsx', '.xlsm'):
        raise HTTPException(400, 'Solo archivos Excel .xlsx o .xlsm')
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, 'Archivo superior a 20 MB')
    try:
        resultado = await run_in_threadpool(detectar_hojas_validas, contenido)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"hojas": resultado, "seleccion_inicial": [h["hoja"] for h in resultado if h["formato_valido"]]}


def validar_seleccion_hojas(contenido: bytes, hojas: list[str] | None):
    if not hojas:
        raise ValueError('Selecciona al menos una hoja válida para importar')
    disponibilidad = {h['hoja']: h['formato_valido'] for h in detectar_hojas_validas(contenido)}
    if any(not disponibilidad.get(h, False) for h in hojas):
        raise ValueError('Se seleccionaron hojas inexistentes o con formato inválido')


@router.post('/previsualizar')
async def previsualizar_conciliacion(
    file: UploadFile = File(...), hojas: list[str] | None = Form(None),
    resoluciones_json: str = Form("{}"), exclusiones_invalidas_json: str = Form("null")
):
    if Path(file.filename or '').suffix.lower() not in ('.xlsm', '.xlsx'):
        raise HTTPException(400, 'Solo se aceptan archivos .xlsx o .xlsm')
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, 'El archivo supera 20 MB')
    try:
        await run_in_threadpool(validar_seleccion_hojas, contenido, hojas)
        resoluciones = json.loads(resoluciones_json)
        if not isinstance(resoluciones, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in resoluciones.items()
        ):
            raise ValueError("Las resoluciones deben ser un objeto de texto a texto")
        exclusiones = json.loads(exclusiones_invalidas_json)
        if exclusiones is not None and (not isinstance(exclusiones, list) or not all(isinstance(x, str) for x in exclusiones)):
            raise ValueError('Las exclusiones inválidas deben ser una lista de identificadores')
        return await run_in_threadpool(construir_previsualizacion, contenido, hojas, pedidos_acc_collection, resoluciones, exclusiones)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "Resoluciones JSON inválidas") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(503, 'No fue posible consultar MongoDB de pruebas') from exc


@router.post('/confirmar-piloto')
async def confirmar_piloto(
    file: UploadFile = File(...), hojas: list[str] | None = Form(None),
    resoluciones_json: str = Form('{}'), exclusiones_invalidas_json: str = Form('null'),
):
    """Confirmación restringida. Revalida todo dentro de una transacción MongoDB."""
    if database['importaciones_acc'].find_one({'_id': '__ACC_IMPORTACION_ACTIVA__'}):
        raise HTTPException(409, 'Hay una importación masiva incompleta; termina esa carga antes de usar el piloto')
    if os.getenv('ACC_CONFIRMACION_PILOTO', 'false').lower() != 'true':
        raise HTTPException(403, 'Confirmación piloto desactivada en el servidor')
    if Path(file.filename or '').suffix.lower() not in ('.xlsx', '.xlsm'):
        raise HTTPException(400, 'Solo archivos Excel .xlsx o .xlsm')
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, 'Archivo superior a 20 MB')
    try:
        await run_in_threadpool(validar_seleccion_hojas, contenido, hojas)
        resoluciones = json.loads(resoluciones_json)
        exclusiones = json.loads(exclusiones_invalidas_json)
        # El servicio comprueba las decisiones y repite la conciliación bajo sesión.
        resultado = await run_in_threadpool(
            confirmar_lote, contenido=contenido, hojas=hojas, resoluciones=resoluciones,
            exclusiones_invalidas=exclusiones, client=client, database=database,
        )
        invalidar_opciones_filtros()
        return resultado
    except (ValueError, LoteNoConfirmable) as exc:
        raise HTTPException(409, str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(503, 'No fue posible confirmar en MongoDB') from exc


@router.post('/confirmar-masivo')
async def confirmar_masivo(
    file: UploadFile = File(...), hojas: list[str] | None = Form(None),
    resoluciones_json: str = Form('{}'), exclusiones_invalidas_json: str = Form('null'),
):
    """Confirmación transaccional completa, protegida por bandera explícita.

    Cada bloque es transaccional, con progreso persistido y reanudación segura.
    """
    if os.getenv('ACC_CONFIRMACION_MASIVA', 'false').lower() != 'true':
        raise HTTPException(403, 'Confirmación masiva desactivada en el servidor')
    if Path(file.filename or '').suffix.lower() not in ('.xlsx', '.xlsm'):
        raise HTTPException(400, 'Solo archivos Excel .xlsx o .xlsm')
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, 'Archivo superior a 20 MB')
    try:
        await run_in_threadpool(validar_seleccion_hojas, contenido, hojas)
        resultado = await run_in_threadpool(
            confirmar_lote_por_bloques,
            contenido=contenido, hojas=hojas,
            resoluciones=json.loads(resoluciones_json),
            exclusiones_invalidas=json.loads(exclusiones_invalidas_json),
            client=client, database=database, max_filas=2000, tamano_bloque=80,
        )
        invalidar_opciones_filtros()
        return resultado
    except (ValueError, LoteNoConfirmable) as exc:
        raise HTTPException(409, str(exc)) from exc
    except PyMongoError as exc:
        logger.exception('ACC confirmar-masivo: error de MongoDB, verificar resultado antes de reintentar')
        raise HTTPException(503, 'MongoDB rechazó la operación. Revisa el traceback de FastAPI y verifica si se escribió el lote antes de reintentar.') from exc


@router.post('/auditar-masivo')
async def auditar_masivo(
    file: UploadFile = File(...), hojas: list[str] | None = Form(None)
):
    """Auditoria compacta de pedidos ACC; NUNCA escribe en MongoDB."""
    if Path(file.filename or '').suffix.lower() not in ('.xlsx', '.xlsm'):
        raise HTTPException(400, 'Solo se aceptan archivos .xlsx o .xlsm')
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, 'El archivo supera 20 MB')
    try:
        analisis = analizar_archivo(contenido, hojas=hojas, incluir_registros=True)
        candidatos = consultar_candidatos(analisis['registros'], pedidos_acc_collection)
        plan = planificar_lote(analisis['registros'], candidatos)
        resultado = resumir_auditoria(analisis, plan)
        resultado['candidatos_encontrados'] = len(candidatos)
        return resultado
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(503, 'No fue posible consultar MongoDB') from exc
