from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.database import configuracion_collection


router = APIRouter(
    prefix="/api/configuracion",
    tags=["Configuración"],
)


CLAVE_CONFIGURACION = "entregas"
DIAS_ENTREGA_PROXIMA_PREDETERMINADOS = 3


class ConfiguracionEntregas(BaseModel):
    dias_entrega_proxima: int = Field(
        ge=0,
        le=365,
    )


def obtener_dias_entrega_proxima() -> int:
    configuracion = configuracion_collection.find_one(
        {
            "_id": CLAVE_CONFIGURACION,
        }
    )

    if not configuracion:
        return DIAS_ENTREGA_PROXIMA_PREDETERMINADOS

    return int(
        configuracion.get(
            "dias_entrega_proxima",
            DIAS_ENTREGA_PROXIMA_PREDETERMINADOS,
        )
    )


@router.get("/entregas")
def consultar_configuracion_entregas():
    return {
        "dias_entrega_proxima": (
            obtener_dias_entrega_proxima()
        ),
    }


@router.put("/entregas")
def actualizar_configuracion_entregas(
    configuracion: ConfiguracionEntregas,
):
    configuracion_collection.update_one(
        {
            "_id": CLAVE_CONFIGURACION,
        },
        {
            "$set": {
                "dias_entrega_proxima": (
                    configuracion.dias_entrega_proxima
                ),
            }
        },
        upsert=True,
    )

    return {
        "mensaje": "Configuración actualizada correctamente",
        "dias_entrega_proxima": (
            configuracion.dias_entrega_proxima
        ),
    }