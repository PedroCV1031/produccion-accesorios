import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal
from uuid import uuid4

import numpy as np
import openpyxl
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from pydantic import BaseModel
from pymongo import InsertOne, UpdateOne

from app.database import radicados_collection


router = APIRouter(
    prefix="/api/importaciones",
    tags=["Importaciones"],
)


EXTENSIONES_PERMITIDAS = {".xlsx", ".xlsm"}
TAMANO_MAXIMO = 20 * 1024 * 1024
MAXIMO_FILAS_EXCEL = 1_048_576
TAMANO_LOTE_MONGODB = 500

COLUMNAS_ESPERADAS = [
    "Fecha ingreso",
    "Fecha limite",
    "Cliente",
    "Orden de compra",
    "Area",
    "Referencia",
    "Talla",
    "Tipo",
    "Cantidad",
    "Unidades despachadas",
    "Fecha entrega final",
]

COLUMNAS_OBLIGATORIAS_FILA = [
    "Fecha ingreso",
    "Cliente",
    "Area",
    "Referencia",
    "Talla",
    "Cantidad",
]

CAMPOS_IDENTIDAD = [
    "Fecha ingreso",
    "Cliente",
    "Orden de compra",
    "Referencia",
    "Talla",
    "Cantidad",
]

COLUMNAS_TEXTO = {
    "Cliente",
    "Orden de compra",
    "Area",
    "Referencia",
    "Talla",
    "Tipo",
}

COLUMNAS_FECHA = {
    "Fecha ingreso",
    "Fecha limite",
    "Fecha entrega final",
}

COLUMNAS_NUMERO = {
    "Cantidad",
    "Unidades despachadas",
}

COLUMNAS_EXPORTACION_CONSOLIDADA = [
    "Hoja de origen",
    *COLUMNAS_ESPERADAS,
]

ANCHOS_COLUMNAS_EXPORTACION = {
    "Hoja de origen": 22,
    "Fecha ingreso": 15,
    "Fecha limite": 15,
    "Cliente": 32,
    "Orden de compra": 19,
    "Area": 20,
    "Referencia": 18,
    "Talla": 12,
    "Tipo": 20,
    "Cantidad": 16,
    "Unidades despachadas": 22,
    "Fecha entrega final": 20,
}


class SolicitudExportacion(BaseModel):
    hojas: list[str]
    organizacion: Literal[
        "una_hoja",
        "por_hoja",
    ] = "por_hoja"


def obtener_columnas_hoja(hoja) -> list[str]:
    if not hasattr(hoja, "iter_rows"):
        return []

    primera_fila = next(
        hoja.iter_rows(
            min_row=1,
            max_row=1,
            values_only=True,
        ),
        (),
    )

    columnas = [
        str(valor).strip()
        if valor is not None
        else None
        for valor in primera_fila
    ]

    while columnas and columnas[-1] is None:
        columnas.pop()

    return columnas


def es_hoja_valida(hoja) -> bool:
    return obtener_columnas_hoja(hoja) == COLUMNAS_ESPERADAS


def normalizar_hojas_seleccionadas(
    hojas: list[str],
) -> list[str]:
    return list(
        dict.fromkeys(
            hoja.strip()
            for hoja in hojas
            if hoja and hoja.strip()
        )
    )


def crear_nombre_hoja_excel(
    nombre_original: str,
    nombres_usados: set[str],
) -> str:
    nombre_base = re.sub(
        r"[\\/*?:\[\]]",
        "-",
        nombre_original,
    ).strip()

    if not nombre_base:
        nombre_base = "Hoja"

    nombre_base = nombre_base[:31]
    nombre_candidato = nombre_base
    consecutivo = 2

    while nombre_candidato.casefold() in nombres_usados:
        sufijo = f"-{consecutivo}"
        nombre_candidato = (
            nombre_base[: 31 - len(sufijo)]
            + sufijo
        )
        consecutivo += 1

    nombres_usados.add(nombre_candidato.casefold())
    return nombre_candidato


def convertir_valor_excel(valor):
    if isinstance(valor, datetime):
        return valor.replace(tzinfo=None)

    return valor


def preparar_hoja_exportacion(
    hoja,
    columnas: list[str],
) -> None:
    hoja.append(columnas)
    hoja.freeze_panes = "A2"
    hoja.sheet_view.showGridLines = False

    for indice, columna in enumerate(columnas, start=1):
        letra = get_column_letter(indice)
        hoja.column_dimensions[letra].width = (
            ANCHOS_COLUMNAS_EXPORTACION.get(
                columna,
                18,
            )
        )


def agregar_registro_exportacion(
    hoja,
    documento: dict,
    columnas: list[str],
) -> None:
    origen = documento.get("_metadatos", {}).get(
        "hoja_origen"
    )

    valores = []

    for columna in columnas:
        if columna == "Hoja de origen":
            valor = origen
        else:
            valor = documento.get(columna)

        valores.append(convertir_valor_excel(valor))

    hoja.append(valores)
    numero_fila = hoja.max_row

    for indice, columna in enumerate(columnas, start=1):
        celda = hoja.cell(
            row=numero_fila,
            column=indice,
        )

        if columna in COLUMNAS_FECHA:
            celda.number_format = "dd/mm/yyyy"
        elif columna in COLUMNAS_NUMERO:
            celda.number_format = "#,##0"
        elif celda.value is not None:
            celda.data_type = "s"
            celda.number_format = "@"


def convertir_rango_en_tabla(
    hoja,
    numero_tabla: int,
) -> None:
    ultima_columna = get_column_letter(
        hoja.max_column
    )

    tabla = Table(
        displayName=f"TablaRadicados{numero_tabla}",
        ref=(
            f"A1:{ultima_columna}"
            f"{hoja.max_row}"
        ),
    )

    tabla.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium4",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )

    hoja.add_table(tabla)


def validar_archivo(
    nombre_archivo: str,
    contenido: bytes,
) -> None:
    extension = Path(nombre_archivo).suffix.lower()

    if extension not in EXTENSIONES_PERMITIDAS:
        raise HTTPException(
            status_code=400,
            detail="Solo se permiten archivos .xlsx o .xlsm",
        )

    if not contenido:
        raise HTTPException(
            status_code=400,
            detail="El archivo está vacío",
        )

    if len(contenido) > TAMANO_MAXIMO:
        raise HTTPException(
            status_code=413,
            detail="El archivo supera el límite de 20 MB",
        )


def normalizar_valor(valor):
    if valor is None:
        return None

    try:
        if pd.isna(valor):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(valor, pd.Timestamp):
        return valor.to_pydatetime()

    if isinstance(valor, np.generic):
        return valor.item()

    if isinstance(valor, str):
        valor = valor.strip()
        return valor if valor else None

    return valor


def convertir_identificador_a_texto(valor):
    valor = normalizar_valor(valor)

    if valor is None:
        return None

    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))

    return str(valor).strip() or None


def convertir_fecha(valor):
    valor = normalizar_valor(valor)

    if valor is None:
        return None

    if isinstance(valor, datetime):
        return valor

    try:
        fecha = pd.to_datetime(
            valor,
            dayfirst=True,
            errors="coerce",
        )
    except (TypeError, ValueError):
        return None

    if pd.isna(fecha):
        return None

    if isinstance(fecha, pd.Timestamp):
        return fecha.to_pydatetime()

    return fecha


def convertir_numero(valor):
    valor = normalizar_valor(valor)

    if valor is None:
        return None

    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(numero):
        return None

    if numero.is_integer():
        return int(numero)

    return numero


def valor_vacio(valor) -> bool:
    return normalizar_valor(valor) is None


def normalizar_para_firma(valor):
    valor = normalizar_valor(valor)

    if valor is None:
        return None

    if isinstance(valor, datetime):
        return valor.isoformat()

    if isinstance(valor, str):
        return valor.strip().upper()

    if isinstance(valor, float) and valor.is_integer():
        return int(valor)

    return valor


def normalizar_campo_para_firma(
    campo: str,
    valor,
):
    if campo in COLUMNAS_TEXTO:
        texto = convertir_identificador_a_texto(valor)
        return texto.upper() if texto is not None else None

    if campo in COLUMNAS_FECHA:
        fecha = convertir_fecha(valor)
        return fecha.date().isoformat() if fecha is not None else None

    if campo in COLUMNAS_NUMERO:
        return convertir_numero(valor)

    return normalizar_para_firma(valor)


def crear_hash(valores: list) -> str:
    contenido = json.dumps(
        valores,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )

    return hashlib.sha256(
        contenido.encode("utf-8")
    ).hexdigest()


def crear_clave_registro(
    registro: dict,
    nombre_hoja: str,
) -> str:
    valores = [
        normalizar_para_firma(nombre_hoja),
        *(
            normalizar_campo_para_firma(
                campo,
                registro.get(campo),
            )
            for campo in CAMPOS_IDENTIDAD
        ),
    ]

    return crear_hash(valores)


def crear_clave_con_ocurrencia(
    clave_base: str,
    ocurrencia: int,
) -> str:
    if ocurrencia <= 1:
        return clave_base

    return f"{clave_base}::dup::{ocurrencia}"


def obtener_ocurrencia_clave(
    clave_base: str,
    clave_actual,
) -> int | None:
    if clave_actual == clave_base:
        return 1

    if not isinstance(clave_actual, str):
        return None

    prefijo = f"{clave_base}::dup::"

    if not clave_actual.startswith(prefijo):
        return None

    try:
        ocurrencia = int(clave_actual[len(prefijo):])
    except ValueError:
        return None

    return ocurrencia if ocurrencia >= 2 else None


def crear_firma_contenido(registro: dict) -> str:
    valores = [
        normalizar_campo_para_firma(
            columna,
            registro.get(columna),
        )
        for columna in COLUMNAS_ESPERADAS
    ]

    return crear_hash(valores)


def crear_rechazo(
    nombre_hoja: str,
    fila: int | None,
    motivo: str,
    registro: dict | None = None,
) -> dict:
    registro = registro or {}

    return {
        "hoja": nombre_hoja,
        "fila": fila,
        "motivo": motivo,
        "cliente": convertir_identificador_a_texto(
            registro.get("Cliente")
        ),
        "orden_compra": convertir_identificador_a_texto(
            registro.get("Orden de compra")
        ),
        "area": convertir_identificador_a_texto(
            registro.get("Area")
        ),
        "referencia": convertir_identificador_a_texto(
            registro.get("Referencia")
        ),
        "talla": convertir_identificador_a_texto(
            registro.get("Talla")
        ),
        "cantidad": convertir_numero(
            registro.get("Cantidad")
        ),
    }


def procesar_hoja(
    contenido: bytes,
    nombre_archivo: str,
    nombre_hoja: str,
    lote_importacion: str,
) -> dict:
    try:
        dataframe = pd.read_excel(
            BytesIO(contenido),
            sheet_name=nombre_hoja,
            engine="openpyxl",
        )
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No fue posible procesar la hoja "
                f"'{nombre_hoja}': {error}"
            ),
        )

    if dataframe.empty:
        raise HTTPException(
            status_code=400,
            detail=f"La hoja '{nombre_hoja}' está vacía",
        )

    dataframe.columns = [
        str(columna).strip()
        for columna in dataframe.columns
    ]

    if dataframe.columns.tolist() != COLUMNAS_ESPERADAS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"La hoja '{nombre_hoja}' no tiene "
                "la estructura requerida"
            ),
        )

    dataframe = dataframe[COLUMNAS_ESPERADAS]
    dataframe = dataframe.dropna(how="all")

    if dataframe.empty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"La hoja '{nombre_hoja}' no contiene "
                "registros para importar"
            ),
        )

    registros = []
    detalles_rechazos = []
    filas_corregidas = 0
    fecha_importacion = datetime.now(timezone.utc)

    for indice, fila in dataframe.iterrows():
        numero_fila = int(indice) + 2
        registro = {
            columna: normalizar_valor(fila[columna])
            for columna in COLUMNAS_ESPERADAS
        }

        columnas_faltantes = [
            columna
            for columna in COLUMNAS_OBLIGATORIAS_FILA
            if valor_vacio(registro[columna])
        ]

        if columnas_faltantes:
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    (
                        "Faltan campos obligatorios: "
                        + ", ".join(columnas_faltantes)
                    ),
                    registro,
                )
            )
            continue

        fecha_ingreso = convertir_fecha(
            registro["Fecha ingreso"]
        )

        if fecha_ingreso is None:
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "La fecha de ingreso no es válida",
                    registro,
                )
            )
            continue

        fecha_limite_original = registro["Fecha limite"]
        fecha_entrega_original = registro[
            "Fecha entrega final"
        ]

        fecha_limite = convertir_fecha(
            fecha_limite_original
        )

        fecha_entrega = convertir_fecha(
            fecha_entrega_original
        )

        if (
            not valor_vacio(fecha_limite_original)
            and fecha_limite is None
        ):
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "La fecha límite no es válida",
                    registro,
                )
            )
            continue

        if (
            not valor_vacio(fecha_entrega_original)
            and fecha_entrega is None
        ):
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "La fecha de entrega final no es válida",
                    registro,
                )
            )
            continue

        cantidad = convertir_numero(
            registro["Cantidad"]
        )

        if cantidad is None or cantidad <= 0:
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "La cantidad debe ser un número mayor que cero",
                    registro,
                )
            )
            continue

        despachadas_original = registro[
            "Unidades despachadas"
        ]

        unidades_despachadas = convertir_numero(
            despachadas_original
        )

        if (
            not valor_vacio(despachadas_original)
            and unidades_despachadas is None
        ):
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "Las unidades despachadas no son un número válido",
                    registro,
                )
            )
            continue

        if (
            unidades_despachadas is not None
            and unidades_despachadas < 0
        ):
            detalles_rechazos.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    "Las unidades despachadas no pueden ser negativas",
                    registro,
                )
            )
            continue

        if (
            unidades_despachadas is not None
            and unidades_despachadas > cantidad
        ):
            unidades_despachadas = cantidad
            filas_corregidas += 1

        registro["Fecha ingreso"] = fecha_ingreso
        registro["Fecha limite"] = fecha_limite
        registro["Fecha entrega final"] = fecha_entrega

        registro["Cliente"] = (
            convertir_identificador_a_texto(
                registro["Cliente"]
            )
        )

        registro["Orden de compra"] = (
            convertir_identificador_a_texto(
                registro["Orden de compra"]
            )
        )

        area = convertir_identificador_a_texto(
            registro["Area"]
        )
        registro["Area"] = (
            area.upper()
            if area is not None
            else None
        )

        registro["Referencia"] = (
            convertir_identificador_a_texto(
                registro["Referencia"]
            )
        )

        registro["Talla"] = (
            convertir_identificador_a_texto(
                registro["Talla"]
            )
        )

        registro["Tipo"] = (
            convertir_identificador_a_texto(
                registro["Tipo"]
            )
        )

        registro["Cantidad"] = cantidad
        registro["Unidades despachadas"] = (
            unidades_despachadas
        )

        registro["_metadatos"] = {
            "archivo_origen": nombre_archivo,
            "hoja_origen": nombre_hoja,
            "fila_origen": numero_fila,
            "fecha_importacion": fecha_importacion,
            "lote_importacion": lote_importacion,
        }

        registro["_clave_registro"] = crear_clave_registro(
            registro,
            nombre_hoja,
        )
        registro["_firma_contenido"] = crear_firma_contenido(
            registro
        )

        registros.append(registro)

    ocurrencias_por_clave = defaultdict(int)
    primera_fila_por_clave = {}
    detalles_advertencias = []

    for registro in registros:
        clave_base = registro["_clave_registro"]
        numero_fila = registro["_metadatos"]["fila_origen"]
        ocurrencias_por_clave[clave_base] += 1
        ocurrencia = ocurrencias_por_clave[clave_base]

        if ocurrencia == 1:
            primera_fila_por_clave[clave_base] = numero_fila
        else:
            detalles_advertencias.append(
                crear_rechazo(
                    nombre_hoja,
                    numero_fila,
                    (
                        "Coincide con la fila "
                        f"{primera_fila_por_clave[clave_base]}; "
                        "se importará como pedido independiente "
                        f"#{ocurrencia}"
                    ),
                    registro,
                )
            )

        registro["_clave_registro"] = (
            crear_clave_con_ocurrencia(
                clave_base,
                ocurrencia,
            )
        )

    return {
        "registros": registros,
        "filas_leidas": len(dataframe),
        "filas_rechazadas": len(detalles_rechazos),
        "detalles_rechazos": detalles_rechazos,
        "filas_advertidas": len(detalles_advertencias),
        "detalles_advertencias": detalles_advertencias,
        "filas_corregidas": filas_corregidas,
    }


@router.get("/exportacion/hojas")
def consultar_hojas_para_exportar():
    pipeline = [
        {
            "$match": {
                "_metadatos.hoja_origen": {
                    "$type": "string",
                    "$ne": "",
                }
            }
        },
        {
            "$group": {
                "_id": "$_metadatos.hoja_origen",
                "registros": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]

    resultado = list(
        radicados_collection.aggregate(pipeline)
    )

    hojas = [
        {
            "nombre": registro["_id"],
            "registros": registro["registros"],
        }
        for registro in resultado
    ]

    return {
        "hojas": hojas,
        "total_hojas": len(hojas),
        "total_registros": sum(
            hoja["registros"]
            for hoja in hojas
        ),
    }


@router.post("/exportar")
def exportar_radicados(
    solicitud: SolicitudExportacion,
):
    hojas_seleccionadas = (
        normalizar_hojas_seleccionadas(
            solicitud.hojas
        )
    )

    if not hojas_seleccionadas:
        raise HTTPException(
            status_code=400,
            detail=(
                "Debe seleccionar al menos una hoja "
                "para exportar"
            ),
        )

    resultado_conteos = list(
        radicados_collection.aggregate([
            {
                "$match": {
                    "_metadatos.hoja_origen": {
                        "$in": hojas_seleccionadas,
                    }
                }
            },
            {
                "$group": {
                    "_id": "$_metadatos.hoja_origen",
                    "registros": {"$sum": 1},
                }
            },
        ])
    )

    conteos_por_hoja = {
        registro["_id"]: registro["registros"]
        for registro in resultado_conteos
    }

    hojas_inexistentes = [
        hoja
        for hoja in hojas_seleccionadas
        if hoja not in conteos_por_hoja
    ]

    if hojas_inexistentes:
        raise HTTPException(
            status_code=400,
            detail={
                "mensaje": (
                    "Hay hojas que ya no existen "
                    "en la base de datos"
                ),
                "hojas_inexistentes": (
                    hojas_inexistentes
                ),
            },
        )

    total_registros = sum(
        conteos_por_hoja.values()
    )

    if (
        solicitud.organizacion == "una_hoja"
        and total_registros + 1
        > MAXIMO_FILAS_EXCEL
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "La selección supera el límite de filas "
                "de una hoja de Excel. Use la opción "
                "'Una hoja por cada origen'."
            ),
        )

    hojas_demasiado_grandes = [
        hoja
        for hoja, cantidad in conteos_por_hoja.items()
        if cantidad + 1 > MAXIMO_FILAS_EXCEL
    ]

    if hojas_demasiado_grandes:
        raise HTTPException(
            status_code=400,
            detail={
                "mensaje": (
                    "Hay hojas que superan el límite "
                    "de filas permitido por Excel"
                ),
                "hojas": hojas_demasiado_grandes,
            },
        )

    libro = openpyxl.Workbook()
    libro.remove(libro.active)
    libro.properties.creator = "Arcoline"
    libro.properties.title = "Exportación de radicados"

    hojas_excel = {}
    columnas_por_hoja = {}
    nombres_usados: set[str] = set()

    if solicitud.organizacion == "una_hoja":
        hoja_excel = libro.create_sheet(
            "Radicados"
        )
        preparar_hoja_exportacion(
            hoja_excel,
            COLUMNAS_EXPORTACION_CONSOLIDADA,
        )
        hojas_excel["__consolidado__"] = hoja_excel
        columnas_por_hoja["__consolidado__"] = (
            COLUMNAS_EXPORTACION_CONSOLIDADA
        )
    else:
        for nombre_origen in hojas_seleccionadas:
            nombre_excel = crear_nombre_hoja_excel(
                nombre_origen,
                nombres_usados,
            )
            hoja_excel = libro.create_sheet(
                nombre_excel
            )
            preparar_hoja_exportacion(
                hoja_excel,
                COLUMNAS_ESPERADAS,
            )
            hojas_excel[nombre_origen] = hoja_excel
            columnas_por_hoja[nombre_origen] = (
                COLUMNAS_ESPERADAS
            )

    proyeccion = {
        columna: 1
        for columna in COLUMNAS_ESPERADAS
    }
    proyeccion.update({
        "_id": 0,
        "_metadatos.hoja_origen": 1,
    })

    try:
        cursor = (
            radicados_collection.find(
                {
                    "_metadatos.hoja_origen": {
                        "$in": hojas_seleccionadas,
                    }
                },
                proyeccion,
            )
            .sort([
                ("_metadatos.hoja_origen", 1),
                ("Fecha ingreso", 1),
                ("Cliente", 1),
            ])
            .batch_size(1000)
        )

        for documento in cursor:
            if solicitud.organizacion == "una_hoja":
                clave_hoja = "__consolidado__"
            else:
                clave_hoja = documento.get(
                    "_metadatos",
                    {},
                ).get("hoja_origen")

            hoja_excel = hojas_excel.get(clave_hoja)

            if hoja_excel is None:
                continue

            agregar_registro_exportacion(
                hoja_excel,
                documento,
                columnas_por_hoja[clave_hoja],
            )

        for numero_tabla, hoja_excel in enumerate(
            libro.worksheets,
            start=1,
        ):
            convertir_rango_en_tabla(
                hoja_excel,
                numero_tabla,
            )

        salida = BytesIO()
        libro.save(salida)
        salida.seek(0)

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "No fue posible generar el archivo Excel: "
                f"{error}"
            ),
        )

    finally:
        libro.close()

    marca_tiempo = datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )
    nombre_archivo = (
        f"radicados_arcoline_{marca_tiempo}.xlsx"
    )

    return StreamingResponse(
        salida,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": (
                f'attachment; filename="{nombre_archivo}"'
            ),
            "X-Total-Registros": str(total_registros),
        },
    )


@router.post("/hojas")
async def consultar_hojas(
    archivo: UploadFile = File(...),
):
    nombre_archivo = Path(archivo.filename or "").name
    contenido = await archivo.read()

    validar_archivo(nombre_archivo, contenido)

    libro = None

    try:
        libro = openpyxl.load_workbook(
            BytesIO(contenido),
            read_only=True,
            data_only=True,
        )

        hojas_validas = [
            nombre_hoja
            for nombre_hoja in libro.sheetnames
            if es_hoja_valida(libro[nombre_hoja])
        ]

        if not hojas_validas:
            raise HTTPException(
                status_code=400,
                detail=(
                    "El archivo no contiene hojas con "
                    "la estructura requerida"
                ),
            )

        return {
            "archivo": nombre_archivo,
            "total_hojas_validas": len(hojas_validas),
            "hojas_validas": hojas_validas,
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible leer el archivo: {error}",
        )

    finally:
        if libro is not None:
            libro.close()


@router.post("/cargar")
async def cargar_hojas(
    archivo: UploadFile = File(...),
    hojas: list[str] = Form(...),
    confirmar: bool = Form(False),
):
    if not confirmar:
        raise HTTPException(
            status_code=400,
            detail="Debe confirmar la actualización de las hojas",
        )

    nombre_archivo = Path(archivo.filename or "").name
    contenido = await archivo.read()

    validar_archivo(nombre_archivo, contenido)

    hojas_separadas = []

    for valor in hojas:
        hojas_separadas.extend(
            hoja.strip()
            for hoja in valor.split(",")
            if hoja.strip()
        )

    hojas_seleccionadas = list(
        dict.fromkeys(hojas_separadas)
    )

    if not hojas_seleccionadas:
        raise HTTPException(
            status_code=400,
            detail="Debe seleccionar al menos una hoja",
        )

    libro = None

    try:
        libro = openpyxl.load_workbook(
            BytesIO(contenido),
            read_only=True,
            data_only=True,
        )

        hojas_disponibles = set(libro.sheetnames)

        hojas_validas = {
            nombre_hoja
            for nombre_hoja in libro.sheetnames
            if es_hoja_valida(libro[nombre_hoja])
        }

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible abrir el archivo: {error}",
        )

    finally:
        if libro is not None:
            libro.close()

    hojas_invalidas = [
        hoja
        for hoja in hojas_seleccionadas
        if (
            hoja not in hojas_disponibles
            or hoja not in hojas_validas
        )
    ]

    if hojas_invalidas:
        raise HTTPException(
            status_code=400,
            detail={
                "mensaje": (
                    "Hay hojas inexistentes o no permitidas"
                ),
                "hojas_invalidas": hojas_invalidas,
            },
        )

    lote_importacion = str(uuid4())
    resultados_por_hoja = {}

    # Primero procesa todo. MongoDB todavía no se modifica.
    for hoja in hojas_seleccionadas:
        resultados_por_hoja[hoja] = procesar_hoja(
            contenido=contenido,
            nombre_archivo=nombre_archivo,
            nombre_hoja=hoja,
            lote_importacion=lote_importacion,
        )

    resultado_hojas = []

    try:
        # Las hojas se escriben de forma independiente, sin mantener una
        # transacción multidocumento abierta durante toda la importación.
        # Cada bulk_write se divide en lotes pequeños para reducir el tiempo
        # de cada interacción con MongoDB y permitir reanudar la importación
        # simplemente ejecutándola de nuevo si una escritura falla.
        for hoja, resultado in resultados_por_hoja.items():
            registros = resultado["registros"]
            detalles_rechazos = list(
                resultado["detalles_rechazos"]
            )

            documentos_existentes = list(
                radicados_collection.find(
                    {
                        "_metadatos.hoja_origen": hoja,
                    }
                )
            )

            documentos_por_base = defaultdict(list)

            for documento in documentos_existentes:
                clave_base = crear_clave_registro(
                    documento,
                    hoja,
                )
                documentos_por_base[clave_base].append(
                    documento
                )

            documentos_por_clave = defaultdict(list)

            for clave_base, documentos_base in (
                documentos_por_base.items()
            ):
                documentos_asignados = {}
                documentos_pendientes = []

                for documento in documentos_base:
                    ocurrencia = obtener_ocurrencia_clave(
                        clave_base,
                        documento.get("_clave_registro"),
                    )

                    if (
                        ocurrencia is not None
                        and ocurrencia not in documentos_asignados
                    ):
                        documentos_asignados[ocurrencia] = documento
                    else:
                        documentos_pendientes.append(documento)

                documentos_pendientes.sort(
                    key=lambda documento: (
                        documento.get("_metadatos", {}).get(
                            "fila_origen",
                            10**12,
                        ),
                        str(documento.get("_id", "")),
                    )
                )

                siguiente_ocurrencia = 1

                for documento in documentos_pendientes:
                    while (
                        siguiente_ocurrencia
                        in documentos_asignados
                    ):
                        siguiente_ocurrencia += 1

                    documentos_asignados[
                        siguiente_ocurrencia
                    ] = documento
                    siguiente_ocurrencia += 1

                for ocurrencia, documento in (
                    documentos_asignados.items()
                ):
                    clave = crear_clave_con_ocurrencia(
                        clave_base,
                        ocurrencia,
                    )
                    documentos_por_clave[clave].append(
                        documento
                    )

            operaciones = []
            claves_importadas = set()
            registros_insertados = 0
            registros_actualizados = 0
            registros_sin_cambios = 0
            claves_asignadas = 0

            for registro in registros:
                clave = registro["_clave_registro"]
                claves_importadas.add(clave)
                coincidencias = documentos_por_clave.get(
                    clave,
                    [],
                )

                if len(coincidencias) > 1:
                    detalles_rechazos.append(
                        crear_rechazo(
                            hoja,
                            registro["_metadatos"][
                                "fila_origen"
                            ],
                            (
                                "La fila coincide con "
                                f"{len(coincidencias)} registros "
                                "duplicados que ya existen en "
                                "MongoDB"
                            ),
                            registro,
                        )
                    )
                    continue

                if not coincidencias:
                    operaciones.append(
                        InsertOne(registro)
                    )
                    registros_insertados += 1
                    continue

                documento = coincidencias[0]
                firma_existente = crear_firma_contenido(
                    documento
                )
                requiere_clave = (
                    documento.get("_clave_registro")
                    != clave
                    or documento.get("_firma_contenido")
                    != firma_existente
                )

                if (
                    firma_existente
                    == registro["_firma_contenido"]
                ):
                    registros_sin_cambios += 1

                    if requiere_clave:
                        operaciones.append(
                            UpdateOne(
                                {"_id": documento["_id"]},
                                {
                                    "$set": {
                                        "_clave_registro": clave,
                                        "_firma_contenido": (
                                            firma_existente
                                        ),
                                    }
                                },
                            )
                        )
                        claves_asignadas += 1

                    continue

                campos_actualizados = {
                    columna: registro.get(columna)
                    for columna in COLUMNAS_ESPERADAS
                }
                campos_actualizados.update({
                    "_clave_registro": clave,
                    "_firma_contenido": registro[
                        "_firma_contenido"
                    ],
                    "_metadatos.archivo_origen": (
                        nombre_archivo
                    ),
                    "_metadatos.fila_origen": registro[
                        "_metadatos"
                    ]["fila_origen"],
                    "_metadatos.fecha_ultima_actualizacion": (
                        datetime.now(timezone.utc)
                    ),
                    "_metadatos.lote_ultima_actualizacion": (
                        lote_importacion
                    ),
                })

                operaciones.append(
                    UpdateOne(
                        {"_id": documento["_id"]},
                        {"$set": campos_actualizados},
                    )
                )
                registros_actualizados += 1

                if requiere_clave:
                    claves_asignadas += 1

            for clave, coincidencias in (
                documentos_por_clave.items()
            ):
                if (
                    clave in claves_importadas
                    or len(coincidencias) != 1
                ):
                    continue

                documento = coincidencias[0]
                firma_existente = crear_firma_contenido(
                    documento
                )

                if (
                    documento.get("_clave_registro") == clave
                    and documento.get("_firma_contenido")
                    == firma_existente
                ):
                    continue

                operaciones.append(
                    UpdateOne(
                        {"_id": documento["_id"]},
                        {
                            "$set": {
                                "_clave_registro": clave,
                                "_firma_contenido": (
                                    firma_existente
                                ),
                            }
                        },
                    )
                )
                claves_asignadas += 1

            for inicio in range(
                0,
                len(operaciones),
                TAMANO_LOTE_MONGODB,
            ):
                lote_operaciones = operaciones[
                    inicio: inicio + TAMANO_LOTE_MONGODB
                ]
                radicados_collection.bulk_write(
                    lote_operaciones,
                    ordered=False,
                )

            resultado_hojas.append({
                "hoja": hoja,
                "filas_leidas": (
                    resultado["filas_leidas"]
                ),
                "filas_rechazadas": len(
                    detalles_rechazos
                ),
                "detalles_rechazos": detalles_rechazos,
                "filas_advertidas": resultado.get(
                    "filas_advertidas",
                    0,
                ),
                "detalles_advertencias": resultado.get(
                    "detalles_advertencias",
                    [],
                ),
                "filas_corregidas": (
                    resultado["filas_corregidas"]
                ),
                "registros_insertados": (
                    registros_insertados
                ),
                "registros_actualizados": (
                    registros_actualizados
                ),
                "registros_sin_cambios": (
                    registros_sin_cambios
                ),
                "claves_asignadas": claves_asignadas,
            })

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "No fue posible actualizar las hojas en "
                f"MongoDB: {error}"
            ),
        )

    return {
        "mensaje": "Actualización selectiva completada",
        "archivo": nombre_archivo,
        "lote_importacion": lote_importacion,
        "hojas_procesadas": resultado_hojas,
        "total_insertados": sum(
            resultado["registros_insertados"]
            for resultado in resultado_hojas
        ),
        "total_actualizados": sum(
            resultado["registros_actualizados"]
            for resultado in resultado_hojas
        ),
        "total_sin_cambios": sum(
            resultado["registros_sin_cambios"]
            for resultado in resultado_hojas
        ),
        "total_claves_asignadas": sum(
            resultado["claves_asignadas"]
            for resultado in resultado_hojas
        ),
        "total_rechazados": sum(
            resultado["filas_rechazadas"]
            for resultado in resultado_hojas
        ),
        "total_advertidos": sum(
            resultado.get("filas_advertidas", 0)
            for resultado in resultado_hojas
        ),
        "total_corregidos": sum(
            resultado["filas_corregidas"]
            for resultado in resultado_hojas
        ),
        "filas_rechazadas": [
            rechazo
            for resultado in resultado_hojas
            for rechazo in resultado["detalles_rechazos"]
        ],
        "filas_advertidas": [
            advertencia
            for resultado in resultado_hojas
            for advertencia in resultado.get(
                "detalles_advertencias",
                [],
            )
        ],
    }