import unittest
from app.services.lote_acc import planificar_lote


def fila(i=1, acum=300):
    return {'_hoja':'OCTUBRE', '_fila':i, 'cliente':'ABC', 'orden_compra':'1',
            'referencia':'R1','acabado_talla':'NIQUEL','color_codigo':'NEGRO',
            'fecha_pedido':'2026-10-01', 'cantidad_entregada_acumulada':acum,
            'fecha_ultima_entrega':'2026-10-20'}

class LoteTest(unittest.TestCase):
    def test_nuevo_saldo(self):
        p=planificar_lote([fila()], [])
        self.assertFalse(p['bloqueado'])
        self.assertEqual(p['items'][0]['movimiento']['tipo'],'saldo_inicial')
    def test_reimportar_sin_parcial(self):
        p=planificar_lote([fila()], [{'_id':'a','datos':fila()}])
        self.assertEqual(p['items'][0]['movimiento']['tipo'],'sin_cambio')
    def test_incremento(self):
        p=planificar_lote([fila(acum=500)], [{'_id':'a','datos':fila()}])
        self.assertEqual(p['items'][0]['movimiento']['cantidad'],200)
    def test_disminucion_bloqueada(self):
        p=planificar_lote([fila(acum=100)], [{'_id':'a','datos':fila()}])
        self.assertTrue(p['bloqueado'])
    def test_ambiguos(self):
        p=planificar_lote([fila()], [{'_id':'a','datos':fila()},{'_id':'b','datos':fila()}])
        self.assertTrue(p['bloqueado'])
        self.assertEqual(p['items'][0]['accion'],'ambiguo')
    def test_resolver_ambiguo(self):
        p=planificar_lote([fila()], [{'_id':'a','datos':fila()},{'_id':'b','datos':fila()}], {'OCTUBRE:1':'b'})
        self.assertFalse(p['bloqueado'])
        self.assertEqual(p['items'][0]['pedido_id'],'b')
    def test_no_reutilizar_pedido(self):
        p=planificar_lote([fila(1),fila(2)], [{'_id':'a','datos':fila()}], {'OCTUBRE:1':'a','OCTUBRE:2':'a'})
        self.assertTrue(p['bloqueado'])
    def test_resolucion_invalida(self):
        p=planificar_lote([fila()], [{'_id':'a','datos':fila()},{'_id':'b','datos':fila()}], {'OCTUBRE:1':'x'})
        self.assertTrue(p['bloqueado'])
