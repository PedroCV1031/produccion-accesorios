"""Pruebas de consulta acotada sin acceso real a MongoDB."""
import sys
import types
import unittest
from unittest.mock import MagicMock

# app.database exige URI en importación: inyectamos una colección ficticia.
claves = ('app.database',)
respaldo = {k: sys.modules.get(k) for k in claves}
mock_db = types.ModuleType('app.database')
mock_db.pedidos_acc_collection = MagicMock()
sys.modules['app.database'] = mock_db
try:
    from app.routers.conciliacion_acc import consultar_candidatos  # noqa: E402
    DEPENDENCIAS_DISPONIBLES = True
except ModuleNotFoundError:
    DEPENDENCIAS_DISPONIBLES = False
for k, v in respaldo.items():
    if v is None:
        sys.modules.pop(k, None)
    else:
        sys.modules[k] = v

@unittest.skipUnless(DEPENDENCIAS_DISPONIBLES, "Requiere dependencias de backend instaladas")
class ConsultaPruebas(unittest.TestCase):
    def test_consulta_en_bloques_y_sin_escrituras(self):
        coleccion = MagicMock()
        coleccion.find.return_value = [{'_id': 'id1', 'datos': {'cliente': 'A'}}]
        filas = [{'cliente': 'A', 'orden_compra': 'OC', 'referencia': 'R',
                  'acabado_talla': 'A', 'color_codigo': 'N'},
                 {'cliente': 'B', 'orden_compra': None, 'referencia': 'R',
                  'acabado_talla': 'A', 'color_codigo': 'N'}]
        resultados = consultar_candidatos(filas, coleccion, tamano_lote=1)
        self.assertEqual(len(resultados), 1)
        self.assertEqual(coleccion.find.call_count, 2)
        coleccion.insert_one.assert_not_called()
        coleccion.update_one.assert_not_called()

    def test_identidades_repetidas_se_consultan_una_vez(self):
        coleccion = MagicMock()
        coleccion.find.return_value = []
        fila = {'cliente': 'A', 'referencia': 'R'}
        consultar_candidatos([fila, dict(fila)], coleccion)
        self.assertEqual(coleccion.find.call_count, 1)
        self.assertEqual(len(coleccion.find.call_args.args[0]['$or']), 1)

if __name__ == '__main__':
    unittest.main()
