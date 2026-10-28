import unittest
from app.services.lote_acc import planificar_lote


def fila(n, cantidad):
    return {'_hoja':'OCTUBRE 2026','_fila':n,'cliente':'DUGOTEX','orden_compra':'57564','referencia':'99131','acabado_talla':'ZAMAC','color_codigo':'NEGRO','fecha_pedido':'2026-09-25','cantidad_solicitada':cantidad,'cantidad_entregada_acumulada':0}

class GruposPaso14Test(unittest.TestCase):
    def setUp(self):
        self.filas=[fila(604,8000),fila(605,8000)]
    def test_distinta_cantidad_no_ambiguas(self):
        p = planificar_lote([fila(604,8000),fila(605,2000)], [])
        self.assertEqual(p['resumen'].get('nuevo'), 2)
        self.assertFalse(p['bloqueado'])

    def test_todas_ambiguas_sin_decisiones(self):
        p=planificar_lote(self.filas,[])
        self.assertEqual(p['resumen'].get('ambiguo'),2)
        self.assertTrue(p['bloqueado'])
    def test_separar_ambas(self):
        p=planificar_lote(self.filas,[],{'OCTUBRE 2026:604':'NUEVO','OCTUBRE 2026:605':'NUEVO'})
        self.assertEqual(p['resumen'].get('nuevo'),2)
        self.assertFalse(p['bloqueado'])
    def test_conservar_una_excluir_otra(self):
        p=planificar_lote(self.filas,[],{'OCTUBRE 2026:604':'NUEVO','OCTUBRE 2026:605':'EXCLUIR'})
        self.assertEqual(p['resumen'].get('nuevo'),1)
        self.assertEqual(p['resumen'].get('excluido'),1)
        self.assertFalse(p['bloqueado'])
    def test_no_decidir_solo_una(self):
        p=planificar_lote(self.filas,[],{'OCTUBRE 2026:604':'NUEVO'})
        self.assertTrue(p['bloqueado'])
        self.assertEqual(p['resumen'].get('ambiguo'),1)

if __name__=='__main__': unittest.main()
