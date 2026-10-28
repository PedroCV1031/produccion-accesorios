import unittest
from app.services.identificacion import conciliar, conciliar_lote, identidad_normalizada
from app.services.versiones import construir_cambios, requiere_version


def pedido(**cambios):
    datos = {'cliente':'CONFECCIONES A', 'orden_compra':None, 'referencia':'R-1',
             'acabado_talla':'NIQUEL', 'color_codigo':'NEGRO', 'fecha_pedido':'2026-10-01',
             'cantidad_solicitada':1000, 'cantidad_entregada_acumulada':100,
             'factura':'FA-1'}
    datos.update(cambios)
    return datos


class IdentificacionVersionesTest(unittest.TestCase):
    def test_sin_candidatos_nuevo(self):
        self.assertEqual(conciliar(pedido(), []).accion, 'nuevo')

    def test_cambio_cantidad_solicitada_necesita_revision(self):
        r = conciliar(pedido(cantidad_solicitada=1500), [{'_id':'abc', 'datos':pedido()}])
        self.assertEqual(r.accion, 'ambiguo')
        self.assertEqual(r.candidatos_ids, ('abc',))

    def test_dos_indistinguibles_ambiguos(self):
        r = conciliar(pedido(), [{'_id':'1','datos':pedido()}, {'_id':'2','datos':pedido()}])
        self.assertEqual(r.accion, 'ambiguo')
        self.assertEqual(r.candidatos_ids, ('1','2'))

    def test_fecha_unica_desempata(self):
        r = conciliar(pedido(), [{'_id':'1','datos':pedido(fecha_pedido='2026-09-01')},
                                {'_id':'2','datos':pedido()}])
        self.assertEqual(r.candidato_id,'2')

    def test_fecha_vacia_no_desempata(self):
        r = conciliar(pedido(fecha_pedido=None), [{'_id':'1','datos':pedido(fecha_pedido=None)},
                                              {'_id':'2','datos':pedido(fecha_pedido=None)}])
        self.assertEqual(r.accion, 'ambiguo')

    def test_dos_filas_mismo_pedido_ambiguas(self):
        res = conciliar_lote([pedido(),pedido()], [{'_id':'1','datos':pedido()}])
        self.assertEqual([x.accion for x in res], ['ambiguo','ambiguo'])

    def test_dos_filas_nuevas_iguales_ambiguas(self):
        res=conciliar_lote([pedido(),pedido()], [])
        self.assertEqual([x.accion for x in res], ['ambiguo','ambiguo'])

    def test_mover_fila_no_cambia_version(self):
        self.assertFalse(requiere_version(pedido(), {**pedido(), '_hoja':'SEPTIEMBRE', '_fila':21}))

    def test_cambio_fecha_crea_version(self):
        self.assertIn('fecha_comprometida', construir_cambios(pedido(fecha_comprometida='2026-10-08'), pedido()))

    def test_normalizacion_tildes(self):
        self.assertEqual(identidad_normalizada(pedido(cliente='Confecciónes A'))['cliente'], 'CONFECCIONES A')

    def test_cantidad_entregada_no_desempata(self):
        res=conciliar(pedido(cantidad_entregada_acumulada=500),
            [{'_id':'1','datos':pedido(cantidad_entregada_acumulada=500)},
             {'_id':'2','datos':pedido(cantidad_entregada_acumulada=10)}])
        self.assertEqual(res.accion, 'ambiguo')

if __name__ == '__main__': unittest.main()
