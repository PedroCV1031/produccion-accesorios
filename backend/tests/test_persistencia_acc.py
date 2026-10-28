import unittest
from app.services.persistencia_acc import preparar_cambio, RevisionRequerida

BASE = {'fecha_pedido':'2026-10-01', 'fecha_solicitada':'2026-10-10',
        'fecha_comprometida':'2026-10-10', 'cliente':'Cliente Uno', 'comercial':'Ana',
        'orden_compra':'C001', 'referencia':'ABC', 'acabado_talla':'Niquel',
        'color_codigo':'Negro', 'cantidad_solicitada':10000,
        'fecha_ultima_entrega':'2026-10-05', 'cantidad_entregada_acumulada':3000,
        'factura':'F123'}

class PersistenciaPlanTests(unittest.TestCase):
    def plan(self, fila, previo=None):
        return preparar_cambio(fila, previo, 'pedido1', importacion_id='import1',
                               fecha_deteccion='2026-10-28')

    def test_nuevo_saldo_inicial(self):
        r=self.plan(BASE)
        self.assertEqual(r['accion_movimiento'], 'saldo_inicial')
        self.assertEqual(r['movimiento']['cantidad'], 3000)

    def test_incremento(self):
        nuevo={**BASE, 'cantidad_entregada_acumulada':5500}
        r=self.plan(nuevo, {'datos':BASE})
        self.assertEqual(r['accion_movimiento'], 'nuevo_parcial')
        self.assertEqual(r['movimiento']['cantidad'], 2500)

    def test_mismo_acumulado_sin_movimiento(self):
        r=self.plan(BASE, {'datos':BASE})
        self.assertEqual(r['accion_movimiento'], 'sin_cambio')
        self.assertFalse(r['cambios'])

    def test_cambio_fecha_sin_parcial(self):
        nuevo={**BASE, 'fecha_comprometida':'2026-10-15'}
        r=self.plan(nuevo, {'datos':BASE})
        self.assertEqual(r['accion_movimiento'], 'sin_cambio')
        self.assertIn('fecha_comprometida',r['cambios'])

    def test_disminucion_bloqueada(self):
        with self.assertRaises(RevisionRequerida):
            self.plan({**BASE, 'cantidad_entregada_acumulada':1000}, {'datos':BASE})

    def test_factura_no_genera_parcial(self):
        r=self.plan({**BASE, 'factura':'F124'}, {'datos':BASE})
        self.assertEqual(r['accion_movimiento'], 'sin_cambio')
        self.assertIn('factura',r['cambios'])

if __name__=='__main__': unittest.main()
