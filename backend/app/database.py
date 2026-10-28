
import os

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

# Configuración exclusiva de Produccion accesorios
MONGODB_URI = os.getenv("MONGO_URL")
MONGODB_DATABASE = os.getenv("DB_NAME", "produccion_accesorios")

if not MONGODB_URI:
    raise RuntimeError(
        "No se encontro MONGO_URL en las variables de entorno"
    )

client = MongoClient(
    MONGODB_URI,
    tls=True,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=10000,
)

database = client[MONGODB_DATABASE]

# Colecciones principales
pedidos_acc_collection = database["pedidos_acc"]
entregas_parciales_collection = database["entregas_parciales"]
versiones_pedidos_collection = database["versiones_pedidos"]
importaciones_acc_collection = database["importaciones_acc"]

# Configuración de la aplicación
configuracion_collection = database["configuracion"]


def asegurar_indices_acc() -> None:
    pedidos_acc_collection.create_index("clave_unica", unique=True, name="uq_clave_unica_acc")

    pedidos_acc_collection.create_index(
        "codigo_interno",
        unique=True,
        sparse=True,
        name="uq_codigo_interno",
    )

    pedidos_acc_collection.create_index(
        [
            ("identidad.cliente", 1),
            ("identidad.orden_compra", 1),
            ("identidad.referencia", 1),
            ("identidad.acabado_talla", 1),
            ("identidad.color_codigo", 1),
        ],
        name="idx_candidatos_no_unico",
    )

    entregas_parciales_collection.create_index(
        [
            ("pedido_id", 1),
            ("numero", 1),
        ],
        unique=True,
        name="uq_parcial_por_pedido",
    )

    entregas_parciales_collection.create_index(
        [
            ("pedido_id", 1),
            ("importacion_id", 1),
        ],
        name="idx_parciales_importacion",
    )

    versiones_pedidos_collection.create_index(
        [
            ("pedido_id", 1),
            ("numero", 1),
        ],
        unique=True,
        name="uq_version_por_pedido",
    )

    importaciones_acc_collection.create_index(
        "creado_en",
        name="idx_importacion_fecha",
    )
