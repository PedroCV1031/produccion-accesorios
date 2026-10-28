import unittest
from app.services.auditoria_masiva_acc import resumir_auditoria

class AuditoriaMasivaTest(unittest.TestCase):
    def test_resumen_repetidos_y_errores(self):
        def fila(numero):
            return {'_hoja':'OCTUBRE 2026','_fila':numero,'cliente':'TEST','orden_compra':'1',
                    'referencia':'A','acabado_talla':'ZAMAC','color_codigo':'NEGRO'}
        analisis={'registros':[fila(3), fila(4)], 'hojas':[
            {'hoja':'OCTUBRE 2026','formato_valido':True,'errores':[{'fila':8,'motivo':'fecha inválida'}]}]}
        plan={'items':[{'accion':'ambiguo','movimiento':None}, {'accion':'ambiguo','movimiento':None}]}
        r=resumir_auditoria(analisis,plan)
        self.assertEqual(r['grupos_identidad_repetida'],1)
        self.assertEqual(r['filas_en_grupos_repetidos'],2)
        self.assertEqual(r['filas_invalidas'],1)
        self.assertEqual(r['bloqueos']['coincidencias_o_revisiones'],2)
        self.assertFalse(r['confirmacion_habilitada'])

    def test_vacio(self):
        r=resumir_auditoria({'registros':[],'hojas':[]},{'items':[]})
        self.assertEqual(r['filas_validas'],0)
        self.assertFalse(r['confirmacion_habilitada'])
