"""Consultas de pedidos ACC y evolución. Solo lectura, paginación del lado servidor."""
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from app.routers.configuracion import obtener_dias_entrega_proxima
import re
from fastapi import APIRouter, Query
from app.database import database

router = APIRouter(prefix='/api/consultas-acc', tags=['Consultas ACC'])


ESTADOS_PEDIDO = ['En proceso', 'Entrega próxima', 'Vencido sin entregar', 'Entregado',
                  'Entregado a tiempo', 'Entregado tarde', 'Entregado sin fecha']

def estado_pedido(d, dias=None, hoy=None):
    """Reproduce la clasificación de arcoline-radicados, con las fechas ACC en ISO."""
    if dias is None: dias = obtener_dias_entrega_proxima()
    if hoy is None: hoy = datetime.now(ZoneInfo('America/Bogota')).date()
    cantidad = float(d.get('cantidad_solicitada') or 0)
    despachadas = float(d.get('cantidad_entregada_acumulada') or 0)
    def fecha(valor):
        if isinstance(valor, datetime): return valor.date()
        if isinstance(valor, date): return valor
        try: return date.fromisoformat(str(valor)[:10]) if valor else None
        except ValueError: return None
    limite = fecha(d.get('fecha_comprometida'))
    entrega = fecha(d.get('fecha_ultima_entrega'))
    if cantidad > 0 and despachadas >= cantidad:
        if limite is None: return 'Entregado'
        if entrega is None: return 'Entregado sin fecha'
        return 'Entregado a tiempo' if entrega <= limite else 'Entregado tarde'
    if limite is None: return 'En proceso'
    restantes = (limite - hoy).days
    if restantes < 0: return 'Vencido sin entregar'
    if restantes <= dias: return 'Entrega próxima'
    return 'En proceso'

def filtros_pedidos(cliente=None, referencia=None, fecha_inicio=None, fecha_fin=None, estado=None,
                    orden_compra=None, acabado_talla=None, color_codigo=None, comercial=None):
    f = {}
    for campo,valor in [('cliente',cliente),('referencia',referencia),('orden_compra',orden_compra),
                        ('acabado_talla',acabado_talla),('color_codigo',color_codigo),('comercial',comercial)]:
        if valor: f['datos.'+campo] = {'$regex': re.escape(str(valor)[:80]), '$options': 'i'}
    rango = {}
    if fecha_inicio: rango['$gte'] = str(fecha_inicio)
    if fecha_fin: rango['$lte'] = str(fecha_fin)
    if rango: f['datos.fecha_pedido'] = rango
    return f

@router.get('/opciones-filtros')
def opciones_filtros():
    coll=database['pedidos_acc']
    campos=['cliente','comercial','orden_compra','referencia','acabado_talla','color_codigo']
    return {**{k: sorted((str(v) for v in coll.distinct('datos.'+k) if v is not None and str(v).strip()), key=str.casefold) for k in campos},
            'estados': ESTADOS_PEDIDO, 'dias_entrega_proxima': obtener_dias_entrega_proxima()}

@router.get('/pedidos')
def listar_pedidos(pagina:int=Query(1,ge=1),por_pagina:int=Query(50,ge=1,le=200),
                   cliente:str|None=None, referencia:str|None=None,orden_compra:str|None=None,
                   acabado_talla:str|None=None,color_codigo:str|None=None,comercial:str|None=None,
                   fecha_inicio:date|None=None,fecha_fin:date|None=None,estado:str|None=None,
                   ordenar:str='fecha_pedido',direccion:str='desc'):
    if estado and estado not in ESTADOS_PEDIDO: raise HTTPException(422,'Estado desconocido')
    campos={'fecha_pedido','fecha_solicitada','fecha_comprometida','cliente','comercial','orden_compra',
            'referencia','acabado_talla','color_codigo','cantidad_solicitada','cantidad_entregada_acumulada'}
    if ordenar not in campos: raise HTTPException(422,'Campo de ordenamiento desconocido')
    if direccion not in ('asc','desc'): raise HTTPException(422,'Dirección inválida')
    filtro=filtros_pedidos(cliente,referencia,fecha_inicio,fecha_fin,None,orden_compra,acabado_talla,color_codigo,comercial)
    coll=database['pedidos_acc']; dias=obtener_dias_entrega_proxima()
    # Estados calculados según la fecha de hoy y la fecha comprometida.
    # Un estado requiere filtrar antes de paginar para devolver contadores exactos.
    if estado:
        encontrados=[]
        for d in coll.find(filtro, {'datos':1,'revision':1}).sort([('datos.'+ordenar,1 if direccion=='asc' else -1),('_id',-1)]):
            dat=d.get('datos') or {}
            if estado_pedido(dat,dias)==estado: encontrados.append({'id':str(d['_id']),'revision':d.get('revision',1),**dat,'estado':estado})
        total=len(encontrados); docs=encontrados[(pagina-1)*por_pagina:pagina*por_pagina]
    else:
        total=coll.count_documents(filtro)
        cursor=coll.find(filtro,{'datos':1,'revision':1}).sort([('datos.'+ordenar,1 if direccion=='asc' else -1),('_id',-1)]).skip((pagina-1)*por_pagina).limit(por_pagina)
        docs=[{'id':str(d['_id']),'revision':d.get('revision',1),**d.get('datos',{}),'estado':estado_pedido(d.get('datos') or {},dias)} for d in cursor]
    return {'total':total,'pagina':pagina,'por_pagina':por_pagina,'pedidos':docs}

@router.get('/pedidos/{pedido_id}/parciales')
def detalle_parciales(pedido_id:str):
    try: oid=ObjectId(pedido_id)
    except (InvalidId,TypeError): raise HTTPException(422,'ID de pedido inválido')
    doc=database['pedidos_acc'].find_one({'_id':oid},{'datos':1,'revision':1})
    if not doc: raise HTTPException(404,'Pedido no encontrado')
    movimientos=[]
    for mov in database['entregas_parciales'].find({'pedido_id':oid}).sort([('numero',1),('_id',1)]):
        movimientos.append({k:(str(v) if isinstance(v,ObjectId) else v.isoformat() if isinstance(v,datetime) else v)
                           for k,v in mov.items() if k!='pedido_id'})
    d=doc.get('datos') or {}
    return {'id':str(oid),'pedido':d,'revision':doc.get('revision',1),'estado':estado_pedido(d),
            'movimientos':movimientos,'total_movimientos':len(movimientos)}

@router.get('/estadisticas')
def estadisticas(fecha_inicio:date|None=None,fecha_fin:date|None=None,
                 agrupar:str=Query('mes',pattern='^(dia|semana|mes)$'),cliente:str|None=None,
                 referencia:str|None=None,estado:str|None=None,orden_compra:str|None=None,
                 agrupar_grafica:str=Query('referencia',pattern='^(periodo|referencia|referencia_color|cliente|comercial|acabado_talla|color_codigo|estado)$')):
    from collections import defaultdict
    if estado and estado not in ESTADOS_PEDIDO: raise HTTPException(422,'Estado desconocido')
    filtro=filtros_pedidos(cliente,referencia,fecha_inicio,fecha_fin,None,orden_compra)
    puntos=defaultdict(lambda:{'pedidos':0,'solicitadas':0,'entregadas':0,'pendientes':0})
    totales={'pedidos':0,'solicitadas':0,'entregadas':0,'pendientes':0}
    estados={e:0 for e in ESTADOS_PEDIDO}; referencias=defaultdict(lambda:{'pedidos':0,'solicitadas':0,'entregadas':0,'pendientes':0})
    grupos=defaultdict(lambda:{'pedidos':0,'solicitadas':0,'entregadas':0,'pendientes':0})
    grupos_periodo=defaultdict(lambda:{'pedidos':0,'solicitadas':0,'entregadas':0,'pendientes':0})
    dias=obtener_dias_entrega_proxima()
    for doc in database['pedidos_acc'].find(filtro,{'datos':1}):
        d=doc.get('datos') or {}; st=estado_pedido(d,dias)
        if estado and estado!=st: continue
        try: dt=date.fromisoformat(str(d.get('fecha_pedido'))[:10])
        except (TypeError,ValueError): continue
        clave=dt.isoformat() if agrupar=='dia' else (dt-timedelta(days=dt.weekday())).isoformat() if agrupar=='semana' else dt.strftime('%Y-%m')
        solicitado=float(d.get('cantidad_solicitada') or 0);entregado=float(d.get('cantidad_entregada_acumulada') or 0)
        valores={'pedidos':1,'solicitadas':solicitado,'entregadas':entregado,'pendientes':max(0,solicitado-entregado)}
        ref=str(d.get('referencia') or 'SIN REFERENCIA')
        if agrupar_grafica == 'periodo': grupo=clave
        elif agrupar_grafica == 'estado': grupo=st
        elif agrupar_grafica == 'referencia_color': grupo=ref+' · '+str(d.get('color_codigo') or 'SIN COLOR')
        else: grupo=str(d.get(agrupar_grafica) or 'SIN DATO')
        for k,v in valores.items(): puntos[clave][k]+=v;totales[k]+=v;referencias[ref][k]+=v;grupos[grupo][k]+=v;grupos_periodo[(clave,grupo)][k]+=v
        estados[st]+=1
    return {'agrupacion':agrupar,'totales':totales,'estados':estados,
            'serie':[{'periodo':k,**v} for k,v in sorted(puntos.items())],
            'referencias':[{'referencia':k,**v} for k,v in sorted(referencias.items(),key=lambda x:-x[1]['solicitadas'])],
            'grupos':[{'nombre':k,**v} for k,v in sorted(grupos.items(),key=lambda x:-x[1]['solicitadas'])],
            'series_por_grupo':[{'periodo':p,'nombre':g,**v} for (p,g),v in sorted(grupos_periodo.items())]}

@router.get('/estado-importacion')
def estado_importacion():
    importaciones = database['importaciones_acc']
    activo = importaciones.find_one({'_id': '__ACC_IMPORTACION_ACTIVA__'}, {'importacion_id': 1})
    if not activo or not activo.get('importacion_id'):
        return {'en_curso': False}
    doc = importaciones.find_one({'_id': activo['importacion_id']},
                                  {'estado': 1, 'siguiente': 1, 'tareas': 1, 'resumen': 1, 'actualizado_en': 1})
    if not doc:
        return {'en_curso': True, 'requiere_revision': True}
    return {'en_curso': doc.get('estado') == 'en_curso', 'estado': doc.get('estado'),
            'procesados': doc.get('siguiente', 0), 'total': len(doc.get('tareas', [])),
            'resumen': doc.get('resumen', {}), 'actualizado_en': doc.get('actualizado_en')}
