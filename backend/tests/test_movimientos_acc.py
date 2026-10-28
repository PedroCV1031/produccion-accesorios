import unittest
from app.services.movimientos_acc import planificar_movimiento, planificar_desde_registro


class MovimientosACCTest(unittest.TestCase):
    def base(self, **kwargs):
        datos = dict(pedido_id="ped-1", acumulado_anterior=3000,
                     acumulado_nuevo=5500, fecha_ultima_entrega="2026-10-15",
                     fecha_deteccion="2026-10-16", importacion_id="imp-1")
        datos.update(kwargs)
        return planificar_movimiento(**datos)

    def test_incremento_es_diferencia(self):
        p = self.base()
        self.assertEqual(p.accion, "nuevo_parcial")
        self.assertEqual(p.incremento, 2500)
        self.assertEqual(p.movimiento["acumulado_nuevo"], 5500)
        self.assertEqual(p.movimiento["fecha_entrega"], "2026-10-15")
        self.assertEqual(p.movimiento["fecha_deteccion"], "2026-10-16")

    def test_reimportacion_no_genera_parcial(self):
        self.assertEqual(self.base(acumulado_anterior=5500).accion, "sin_cambio")
        self.assertIsNone(self.base(acumulado_anterior=5500).movimiento)

    def test_disminucion_no_genera_movimiento(self):
        p = self.base(acumulado_nuevo=2500)
        self.assertEqual(p.accion, "revision_disminucion")
        self.assertEqual(p.incremento, 0)
        self.assertIsNone(p.movimiento)

    def test_primera_importacion_es_saldo_inicial(self):
        p = self.base(acumulado_anterior=None)
        self.assertEqual(p.accion, "saldo_inicial")
        self.assertEqual(p.movimiento["historico_sin_desglose"], True)
        self.assertEqual(p.movimiento["cantidad"], 5500)

    def test_nuevo_pedido_sin_entregas(self):
        self.assertEqual(self.base(acumulado_anterior=None,
                                   acumulado_nuevo=0).accion, "sin_cambio")

    def test_sin_fecha_advertencia(self):
        p = self.base(fecha_ultima_entrega=None)
        self.assertEqual(p.accion, "nuevo_parcial")
        self.assertTrue(p.advertencias)
        self.assertIsNone(p.movimiento["fecha_entrega"])

    def test_fecha_invalida(self):
        with self.assertRaises(ValueError):
            self.base(fecha_ultima_entrega="32/10/2026")

    def test_cantidad_negativa(self):
        with self.assertRaises(ValueError):
            self.base(acumulado_nuevo=-1)

    def test_cantidad_decimal(self):
        with self.assertRaises(ValueError):
            self.base(acumulado_nuevo="2.5")

    def test_booleano_rechazado(self):
        with self.assertRaises(ValueError):
            self.base(acumulado_nuevo=True)

    def test_registro_anidado(self):
        fila = {"cantidad_entregada_acumulada": 9000, "fecha_ultima_entrega": "2026-10-20"}
        previo = {"datos": {"cantidad_entregada_acumulada": 5500}}
        p = planificar_desde_registro(pedido_id="ped-1", fila=fila,
                                     pedido_previo=previo)
        self.assertEqual(p.incremento, 3500)

    def test_no_asumir_cero_si_falta_acumulado_previo(self):
        with self.assertRaises(ValueError):
            planificar_desde_registro(pedido_id="p", fila={"cantidad_entregada_acumulada": 100},
                                     pedido_previo={"datos": {}})

    def test_no_asumir_cero_si_falta_campo_fila(self):
        with self.assertRaises(ValueError):
            planificar_desde_registro(pedido_id="p", fila={}, pedido_previo=None)

    def test_no_admitir_id_vacio(self):
        with self.assertRaises(ValueError):
            self.base(pedido_id="")


if __name__ == "__main__":
    unittest.main()
