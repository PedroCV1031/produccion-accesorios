import unittest
from io import BytesIO
from openpyxl import Workbook
from app.services.lector_excel_acc import analizar_archivo
try:
    from app.routers.conciliacion_acc import construir_previsualizacion
except (ImportError, RuntimeError):
    construir_previsualizacion = None

ENCABEZADOS = ["FECHA EN LA QUE EL CLIENTE COLOCA EL PEDIDO", "FECHA PARA LA QUE EL CLIENTE NECESITA EL DESPACHO", "FECHA EN LA QUE ARCOLINE SE COMPROMETE A ENTREGAR", "CLIENTE", "COMERCIAL", "ORDEN DE COMPRA", "REFERENCIA", "ACABADO / TALLA", "COLOR Y CODIGO", "CANTIDAD TOTAL", "Total entregado", None, None]

def crear():
    wb=Workbook(); ws=wb.active; ws.title='OCTUBRE'
    ws.append(ENCABEZADOS)
    ws.append([None]*10+['Fecha ultima entrega','Cantidad entregada','Factura'])
    for cant in (100,120):
        ws.append(['2026-10-01',None,None,'CLIENTE',None,'OC','REF','ZAMAC','NEGRO',cant,None,0,None])
    ws.append(['2026-10-01',None,None,'CLIENTE',None,'OC','OTRA','ZAMAC','NEGRO','error',None,0,None])
    buf=BytesIO();wb.save(buf);return buf.getvalue()

class ColeccionSimulada:
    def find(self, *a, **kw):
        return []

class DetalleTest(unittest.TestCase):
    def test_contexto_errores_sin_limite_de_ejemplos(self):
        r=analizar_archivo(crear(),limite_ejemplos=0)
        self.assertEqual(r['total_invalidas'],1)
        self.assertEqual(r['hojas'][0]['errores'][0]['datos_originales']['cliente'],'CLIENTE')
    @unittest.skipIf(construir_previsualizacion is None, "Dependencias FastAPI/PyMongo no disponibles")
    def test_ambiguos_contienen_filas_relacionadas(self):
        r=construir_previsualizacion(crear(),None,ColeccionSimulada())
        primer=r['conciliacion']['items'][0]
        self.assertEqual(primer['datos_fila']['cantidad_solicitada'],100)
        self.assertEqual(primer['filas_relacionadas'][0]['origen'],'OCTUBRE:4')
        self.assertFalse(r['confirmacion_habilitada'])
