import unittest
from app.services.identificacion import clave_candidatos
from app.services.parciales import comparar_entrega


class ReglasACCTest(unittest.TestCase):
    def test_aumento(self):
        r = comparar_entrega(3000, 5500)
        self.assertEqual(r.accion, 'nuevo_parcial')
        self.assertEqual(r.diferencia, 2500)

    def test_sin_cambio(self):
        self.assertEqual(comparar_entrega(5500, 5500).accion, 'sin_cambio')

    def test_disminucion(self):
        self.assertEqual(comparar_entrega(5500, 4000).accion, 'revision_disminucion')

    def test_negativos_prohibidos(self):
        with self.assertRaises(ValueError):
            comparar_entrega(0, -1)

    def test_normalizacion_identidad(self):
        fila = {'cliente': '  Confección  A  ', 'orden_compra': ' OC-8 ',
                'referencia': 'ab  21', 'acabado_talla': 'NIQUEL', 'color_codigo': 'NEGRO'}
        self.assertEqual(clave_candidatos(fila)[0], 'CONFECCION A')


if __name__ == '__main__':
    unittest.main()
