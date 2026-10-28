import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.auth import (
    obtener_usuario_actual,
    router as auth_router,
)
from app.database import asegurar_indices_acc, client
from app.routers import conciliacion_acc, consultas_acc


load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    asegurar_indices_acc()
    yield

app = FastAPI(
    title="API Produccion accesorios",
    version="1.0.0",
    lifespan=lifespan
)

frontend_url = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

if os.getenv("ENABLE_LEGACY_ROUTES", "false").lower() == "true":
    raise RuntimeError("Las rutas heredadas no están disponibles en Produccion accesorios")

app.include_router(
    conciliacion_acc.router,
    dependencies=[Depends(obtener_usuario_actual)],
)

app.include_router(consultas_acc.router, dependencies=[Depends(obtener_usuario_actual)])

@app.get("/")
def inicio():
    return {
        "aplicacion": "Produccion accesorios",
        "estado": "activa",
    }


@app.get(
    "/api/health",
    dependencies=[Depends(obtener_usuario_actual)],
)
def verificar_conexion():
    client.admin.command("ping")

    return {
        "api": "activa",
        "mongodb": "conectado",
    }