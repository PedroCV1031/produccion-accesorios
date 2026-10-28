import unittest
from io import BytesIO
from openpyxl import Workbook
from app.services.lector_excel_acc import analizar_archivo

class LectorExcelACCTest(unittest.TestCase):
    def crear(self, mal=False):
        wb=Workbook();ws=wb.active;ws.title="OCTUBRE"
        ws.append(["FECHA EN LA QUE EL CLIENTE COLOCA EL PEDIDO", "FECHA PARA LA QUE EL CLIENTE NECESITA EL DESPACHO", "FECHA EN LA QUE ARCOLINE SE COMPROMETE A ENTREGAR", "CLIENTE", "COMERCIAL", "ORDEN DE COMPRA", "REFERENCIA", "ACABADO / TALLA", "COLOR Y CODIGO", "CANTIDAD TOTAL", "Total entregado", None,None,"PENDIENTES"])
        ws.append([None]*10+["Fecha ultima entrega","Cantidad entregada","Factura"])
        ws.append(["2026-10-01",None,None,"CLIENTE A","ABC","000123","REF01","ZAMAC","NEGRO",1000,"2026-10-05",300,"F001"])
        if mal: ws.append([None,None,None,"CLIENTE A",None,None,"REF02",None,None,"error",None,None,None])
        buf=BytesIO();wb.save(buf);return buf.getvalue()
    def test_lectura(self):
        salida=analizar_archivo(self.crear());self.assertEqual(salida["total_validas"],1)
        fila=salida["hojas"][0]["ejemplos"][0];self.assertEqual(fila["cantidad_pendiente"],700)
        self.assertEqual(fila["orden_compra"],"000123")
    def test_fila_invalida(self):
        salida=analizar_archivo(self.crear(True));self.assertEqual(salida["total_invalidas"],1)
    def test_hoja_inexistente(self):
        with self.assertRaises(ValueError): analizar_archivo(self.crear(),["NOVIEMBRE"])
