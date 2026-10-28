import unittest
from app.services.identificacion import clave_unica, conciliar_lote
from app.services.lote_acc import planificar_lote

BASE = dict(cliente='ABC', orden_compra='OC-1', referencia='R-1', acabado_talla='ZAMAC', color_codigo='NEGRO', fecha_pedido='2026-10-01', cantidad_solicitada=100, cantidad_entregada_acumulada=0, fecha_solicitada=None, fecha_comprometida=None, fecha_ultima_entrega=None, factura=None)

class ClaveUnicaTest(unittest.TestCase):
    def test_campos_variables_no_cambian_clave(self):
        b = {**BASE, 'cantidad_solicitada':200, 'cantidad_entregada_acumulada':70, 'fecha_comprometida':'2026-11-01'}
        self.assertEqual(clave_unica(BASE), clave_unica(b))
    def test_fecha_pedido_si_distingue(self):
        self.assertNotEqual(clave_unica(BASE), clave_unica({**BASE, 'fecha_pedido':'2026-10-02'}))
    def test_rechaza_ambas_filas_repetidas_aunque_cambie_cantidad(self):
        f1={**BASE,'_hoja':'OCT','_fila':3}
        f2={**BASE,'_hoja':'OCT','_fila':4,'cantidad_solicitada':200}
        r=conciliar_lote([f1,f2],[])
        self.assertEqual([x.accion for x in r], ['duplicado','duplicado'])
        p=planificar_lote([f1,f2],[])
        self.assertFalse(p['bloqueado'])
        self.assertEqual(p['resumen']['duplicado'],2)
    def test_coincidencia_db_update(self):
        doc={'_id':'abc123','clave_unica':clave_unica(BASE),'datos':BASE}
        f={**BASE,'cantidad_entregada_acumulada':30,'_hoja':'OCT','_fila':3}
        r=conciliar_lote([f],[doc]);self.assertEqual(r[0].accion,'existente');self.assertEqual(r[0].candidato_id,'abc123')
if __name__=='__main__': unittest.main()
