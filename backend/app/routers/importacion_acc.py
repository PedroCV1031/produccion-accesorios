"""Vista previa de importación ACC; no inserta ni modifica registros."""
from pathlib import Path
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.services.lector_excel_acc import analizar_archivo

router = APIRouter(prefix="/api/importacion-acc", tags=["Importación ACC"])

@router.post("/previsualizar")
async def previsualizar(file: UploadFile = File(...), hojas: list[str] | None = Form(None)):
    if Path(file.filename or "").suffix.lower() not in (".xlsx", ".xlsm"):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .xlsx o .xlsm")
    contenido = await file.read(20 * 1024 * 1024 + 1)
    try: return analizar_archivo(contenido, hojas=hojas)
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
