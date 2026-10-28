from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from typing import Literal

from fastapi import APIRouter, HTTPException

from app.database import radicados_collection
from app.routers.configuracion import obtener_dias_entrega_proxima


router = APIRouter(
    prefix="/api/ventas",
    tags=["Ventas"],
)


TODAS_LAS_REFERENCIAS = "__todas__"


def expresion_texto_normalizado(campo: str) -> dict:
    return {
        "$toUpper": {
            "$trim": {
                "input": {
                    "$convert": {
                        "input": f"${campo}",
                        "to": "string",
                        "onError": "",
                        "onNull": "",
                    }
                }
            }
        }
    }


def expresion_igualdad(campo: str, valor: str) -> dict:
    return {
        "$eq": [
            expresion_texto_normalizado(campo),
            valor.strip().upper(),
        ]
    }


def expresion_categoria_normalizada(
    campo: str,
    valor_vacio: str,
) -> dict:
    return {
        "$let": {
            "vars": {
                "valor": expresion_texto_normalizado(campo),
            },
            "in": {
                "$cond": [
                    {"$eq": ["$$valor", ""]},
                    valor_vacio,
                    "$$valor",
                ]
            },
        }
    }



def expresion_estado(dias_entrega_proxima: int) -> dict:
    fecha_actual = datetime.now(
        ZoneInfo("America/Bogota")
    ).date()

    inicio_hoy = datetime.combine(
        fecha_actual,
        time.min,
    )

    limite_entrega_proxima = datetime.combine(
        fecha_actual + timedelta(days=dias_entrega_proxima),
        time.max,
    )

    cantidad = {
        "$convert": {
            "input": "$Cantidad",
            "to": "double",
            "onError": 0,
            "onNull": 0,
        }
    }

    despachadas = {
        "$convert": {
            "input": "$Unidades despachadas",
            "to": "double",
            "onError": 0,
            "onNull": 0,
        }
    }

    fecha_limite_valida = {
        "$eq": [
            {"$type": "$Fecha limite"},
            "date",
        ]
    }

    fecha_entrega_valida = {
        "$eq": [
            {"$type": "$Fecha entrega final"},
            "date",
        ]
    }

    entregado = {
        "$and": [
            {"$gt": [cantidad, 0]},
            {"$gte": [despachadas, cantidad]},
        ]
    }

    return {
        "$switch": {
            "branches": [
                {
                    "case": {
                        "$and": [
                            entregado,
                            {"$not": [fecha_limite_valida]},
                        ]
                    },
                    "then": "Entregado",
                },
                {
                    "case": {
                        "$and": [
                            entregado,
                            fecha_limite_valida,
                            {"$not": [fecha_entrega_valida]},
                        ]
                    },
                    "then": "Entregado sin fecha",
                },
                {
                    "case": {
                        "$and": [
                            entregado,
                            fecha_limite_valida,
                            fecha_entrega_valida,
                            {
                                "$lte": [
                                    "$Fecha entrega final",
                                    "$Fecha limite",
                                ]
                            },
                        ]
                    },
                    "then": "Entregado a tiempo",
                },
                {
                    "case": entregado,
                    "then": "Entregado tarde",
                },
                {
                    "case": {"$not": [fecha_limite_valida]},
                    "then": "En proceso",
                },
                {
                    "case": {
                        "$lt": [
                            "$Fecha limite",
                            inicio_hoy,
                        ]
                    },
                    "then": "Vencido sin entregar",
                },
                {
                    "case": {
                        "$lte": [
                            "$Fecha limite",
                            limite_entrega_proxima,
                        ]
                    },
                    "then": "Entrega próxima",
                },
            ],
            "default": "En proceso",
        }
    }

def normalizar_numero(valor):
    if isinstance(valor, float) and valor.is_integer():
        return int(valor)

    return valor


def obtener_lunes(fecha: date) -> date:
    return fecha - timedelta(days=fecha.weekday())


def generar_semanas(
    fecha_inicial: date | None,
    fecha_final: date | None,
    semanas_con_datos: set[str],
) -> list[str]:
    fechas_con_datos = sorted(
        date.fromisoformat(semana)
        for semana in semanas_con_datos
    )

    if fecha_inicial:
        primera_semana = obtener_lunes(fecha_inicial)
    elif fechas_con_datos:
        primera_semana = fechas_con_datos[0]
    else:
        return []

    if fecha_final:
        ultima_semana = obtener_lunes(fecha_final)
    elif fechas_con_datos:
        ultima_semana = fechas_con_datos[-1]
    else:
        return []

    if ultima_semana < primera_semana:
        return []

    semanas = []
    semana_actual = primera_semana

    while semana_actual <= ultima_semana:
        semanas.append(semana_actual.isoformat())
        semana_actual += timedelta(days=7)

    return semanas


@router.get("/semanales")
def consultar_ventas_semanales(
    fecha_inicial: date | None = None,
    fecha_final: date | None = None,
    cliente: str | None = None,
    area: str | None = None,
    referencia: str | None = None,
    talla: str | None = None,
    tipo: str | None = None,
    estado: str | None = None,
    agrupar_por: Literal[
        "referencia",
        "cliente",
        "area",
        "estado",
    ] = "referencia",
):
    if (
        fecha_inicial
        and fecha_final
        and fecha_final < fecha_inicial
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "La fecha final no puede ser anterior "
                "a la fecha inicial"
            ),
        )

    referencia_es_todas = (
        referencia == TODAS_LAS_REFERENCIAS
    )

    if talla and (
        not referencia
        or referencia_es_todas
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Para filtrar por talla debe seleccionar "
                "una referencia específica"
            ),
        )

    if tipo and not referencia:
        raise HTTPException(
            status_code=400,
            detail=(
                "Para filtrar por tipo debe seleccionar "
                "una referencia o todas las referencias"
            ),
        )

    filtro_fecha: dict = {
        "$type": "date",
    }

    if fecha_inicial:
        filtro_fecha["$gte"] = datetime.combine(
            fecha_inicial,
            time.min,
        )

    if fecha_final:
        filtro_fecha["$lt"] = datetime.combine(
            fecha_final + timedelta(days=1),
            time.min,
        )

    filtros: dict = {
        "Fecha ingreso": filtro_fecha,
    }

    expresiones: list[dict] = []

    if cliente:
        expresiones.append(
            expresion_igualdad(
                "Cliente",
                cliente,
            )
        )

    if area:
        filtros["Area"] = area.strip().upper()

    if referencia and not referencia_es_todas:
        expresiones.append(
            expresion_igualdad(
                "Referencia",
                referencia,
            )
        )

    if talla:
        expresiones.append(
            expresion_igualdad(
                "Talla",
                talla,
            )
        )

    if tipo:
        expresiones.append(
            expresion_igualdad(
                "Tipo",
                tipo,
            )
        )

    if expresiones:
        filtros["$expr"] = (
            expresiones[0]
            if len(expresiones) == 1
            else {"$and": expresiones}
        )

    campos_agrupacion = {
        "referencia": "Referencia",
        "cliente": "Cliente",
        "area": "Area",
        "estado": None,
    }

    etiquetas_sin_valor = {
        "referencia": "SIN REFERENCIA",
        "cliente": "SIN CLIENTE",
        "area": "SIN ÁREA",
        "estado": "SIN ESTADO",
    }

    campo_agrupacion = campos_agrupacion[
        agrupar_por
    ]

    etiqueta_sin_valor = etiquetas_sin_valor[
        agrupar_por
    ]

    dias_entrega_proxima = obtener_dias_entrega_proxima()

    requiere_estado = bool(estado) or agrupar_por == "estado"

    pipeline = [
        {
            "$match": filtros,
        },
    ]

    if requiere_estado:
        pipeline.append({
            "$set": {
                "estado_pedido": expresion_estado(
                    dias_entrega_proxima
                ),
            }
        })

    if estado:
        pipeline.append({
            "$match": {
                "estado_pedido": estado.strip(),
            }
        })

    expresion_categoria = (
        "$estado_pedido"
        if agrupar_por == "estado"
        else expresion_categoria_normalizada(
            campo_agrupacion,
            etiqueta_sin_valor,
        )
    )

    pipeline.extend([
        {
            "$set": {
                "categoria_normalizada": expresion_categoria,
                "cantidad_numerica": {
                    "$round": [
                        {
                            "$convert": {
                                "input": "$Cantidad",
                                "to": "double",
                                "onError": 0,
                                "onNull": 0,
                            }
                        },
                        0,
                    ]
                },
            }
        },
        {
            "$set": {
                "inicio_semana": {
                    "$dateTrunc": {
                        "date": "$Fecha ingreso",
                        "unit": "week",
                        "startOfWeek": "monday",
                        "timezone": "UTC",
                    }
                }
            }
        },
        {
            "$group": {
                "_id": {
                    "semana": "$inicio_semana",
                    "categoria": (
                        "$categoria_normalizada"
                    ),
                },
                "unidades": {
                    "$sum": "$cantidad_numerica",
                },
            }
        },
        {
            "$sort": {
                "_id.semana": 1,
                "_id.categoria": 1,
            }
        },
    ])

    resultado = list(
        radicados_collection.aggregate(pipeline)
    )

    datos = []
    totales_categoria = defaultdict(float)
    semanas_con_datos: set[str] = set()
    total_unidades = 0.0

    for registro in resultado:
        semana = registro["_id"]["semana"]
        categoria_actual = (
            registro["_id"]["categoria"]
        )

        unidades = normalizar_numero(
            registro["unidades"]
        )

        semana_texto = semana.date().isoformat()

        datos.append({
            "semana": semana_texto,
            "categoria": categoria_actual,
            "referencia": categoria_actual,
            "unidades": unidades,
        })

        semanas_con_datos.add(semana_texto)

        totales_categoria[
            categoria_actual
        ] += unidades

        total_unidades += unidades

    semanas = generar_semanas(
        fecha_inicial=fecha_inicial,
        fecha_final=fecha_final,
        semanas_con_datos=semanas_con_datos,
    )

    resumen_categorias = [
        {
            "categoria": categoria_actual,
            "unidades": normalizar_numero(unidades),
        }
        for categoria_actual, unidades in sorted(
            totales_categoria.items(),
            key=lambda elemento: elemento[1],
            reverse=True,
        )
    ]

    return {
        "filtros": {
            "fecha_inicial": fecha_inicial,
            "fecha_final": fecha_final,
            "cliente": cliente,
            "area": area,
            "referencia": referencia,
            "talla": talla,
            "tipo": tipo,
            "estado": estado,
            "agrupar_por": agrupar_por,
        },
        "total_unidades": normalizar_numero(
            total_unidades
        ),
        "total_semanas": len(semanas),
        "total_categorias": len(
            totales_categoria
        ),
        "total_referencias": len(
            totales_categoria
        ),
        "semanas": semanas,
        "categorias": resumen_categorias,
        "referencias": [
            {
                "referencia": item["categoria"],
                "unidades": item["unidades"],
            }
            for item in resumen_categorias
        ],
        "datos": datos,
    }
