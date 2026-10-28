import unittest
from unittest.mock import patch

try:
    from app.routers.conciliacion_acc import construir_previsualizacion
    from app.services.lote_acc import planificar_lote
    DISPONIBLE = True
except ImportError:
    DISPONIBLE = False

@unittest.skipUnless(DISPONIBLE, 'Dependencias FastAPI requeridas')
class PruebasResoluciones(unittest.TestCase):
    def test_resolucion_invalida_bloquea(self):
        fila = {'_hoja':'OCT','_fila':3, 'cliente':'C', 'orden_compra':'1', 'referencia':'R', 'acabado_talla':'A', 'color_codigo':'NEGRO','cantidad_entregada_acumulada':0, 'cantidad_solicitada':10}
        plan = planificar_lote([fila], [], {'OCT:3':'id_inexistente'})
        self.assertTrue(plan['bloqueado'])
        self.assertEqual(plan['items'][0]['accion'],'revision')
