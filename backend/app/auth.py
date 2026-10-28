import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from pwdlib import PasswordHash


load_dotenv()

APP_USERNAME = os.getenv("APP_USERNAME")
APP_PASSWORD_HASH = os.getenv("APP_PASSWORD_HASH")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "8"))
COOKIE_SECURE = (
    os.getenv("COOKIE_SECURE", "false").lower() == "true"
)

COOKIE_SAMESITE = os.getenv(
    "COOKIE_SAMESITE",
    "lax",
).lower()

if COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    raise RuntimeError(
        "COOKIE_SAMESITE debe ser lax, strict o none"
    )

if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
    raise RuntimeError(
        "COOKIE_SECURE debe ser true cuando "
        "COOKIE_SAMESITE es none"
    )

ALGORITHM = "HS256"
COOKIE_NAME = "arcoline_session"

if not APP_USERNAME:
    raise RuntimeError("No se encontró APP_USERNAME")

if not APP_PASSWORD_HASH:
    raise RuntimeError("No se encontró APP_PASSWORD_HASH")

if not JWT_SECRET_KEY:
    raise RuntimeError("No se encontró JWT_SECRET_KEY")


password_hash = PasswordHash.recommended()

router = APIRouter(
    prefix="/api/auth",
    tags=["Autenticación"],
)


class CredencialesLogin(BaseModel):
    usuario: str
    contrasena: str


def crear_token_sesion(usuario: str) -> str:
    vencimiento = datetime.now(timezone.utc) + timedelta(
        hours=SESSION_HOURS
    )

    contenido = {
        "sub": usuario,
        "exp": vencimiento,
    }

    return jwt.encode(
        contenido,
        JWT_SECRET_KEY,
        algorithm=ALGORITHM,
    )


def obtener_usuario_actual(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Debes iniciar sesión.",
        )

    try:
        contenido = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
        )

        usuario = contenido.get("sub")

        if not usuario:
            raise HTTPException(
                status_code=401,
                detail="La sesión no es válida.",
            )

        return str(usuario)

    except jwt.InvalidTokenError as error:
        raise HTTPException(
            status_code=401,
            detail="La sesión venció o no es válida.",
        ) from error


@router.post("/login")
def iniciar_sesion(
    credenciales: CredencialesLogin,
    response: Response,
):
    usuario_valido = secrets.compare_digest(
        credenciales.usuario.strip(),
        APP_USERNAME,
    )

    try:
        contrasena_valida = password_hash.verify(
            credenciales.contrasena,
            APP_PASSWORD_HASH,
        )
    except Exception:
        contrasena_valida = False

    if not usuario_valido or not contrasena_valida:
        raise HTTPException(
            status_code=401,
            detail="Usuario o contraseña incorrectos.",
        )

    token = crear_token_sesion(APP_USERNAME)

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=SESSION_HOURS * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )

    return {
        "mensaje": "Inicio de sesión correcto.",
        "usuario": APP_USERNAME,
    }


@router.get("/me")
def consultar_sesion(
    usuario: str = Depends(obtener_usuario_actual),
):
    return {
        "autenticado": True,
        "usuario": usuario,
    }


@router.post("/logout")
def cerrar_sesion(response: Response):
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        httponly=True,
        samesite=COOKIE_SAMESITE,
    )

    return {
        "mensaje": "Sesión cerrada correctamente.",
    }