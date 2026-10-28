import unittest
from app.services.confirmacion_acc import (
    LoteNoConfirmable, identificar_lote, validar_decisiones, preparar_confirmacion,
)


class ConfirmacionSeguraTest(unittest.TestCase):
    def test_identificador_archivo_estable(self):
        a=identificar_lote(b'archivo', ['OCTUBRE 2026'])
        self.assertEqual(a, identificar_lote(b'archivo', ['OCTUBRE 2026']))
        self.assertNotEqual(a, identificar_lote(b'archivo modificado', ['OCTUBRE 2026']))
        self.assertNotEqual(a, identificar_lote(b'archivo', ['NOVIEMBRE 2026']))

    def test_errores_obligan_exclusion(self):
        a={'registros': [], 'hojas':[{'hoja':'OCTUBRE 2026','formato_valido':True,
                                   'errores':[{'fila':10}]}]}
        with self.assertRaises(LoteNoConfirmable): validar_decisiones(a,{},[])
        self.assertEqual(validar_decisiones(a,{},['OCTUBRE 2026:10']), [])

    def test_resolucion_desconocida_bloqueada(self):
        a={'registros':[], 'hojas':[{'hoja':'OCTUBRE 2026','formato_valido':True,'errores':[]}]}
        with self.assertRaises(LoteNoConfirmable):
            validar_decisiones(a, {'OCTUBRE 2026:100':'NUEVO'}, [])

    def test_bloquea_grupos_no_resueltos(self):
        fila=lambda n:{'_hoja':'OCTUBRE 2026','_fila':n,'cliente':'DUGOTEX',
            'orden_compra':'57564','referencia':'99131','acabado_talla':'ZAMAC',
            'color_codigo':'NEGRO','fecha_pedido':'2026-09-25',
            'cantidad_solicitada':1000,'cantidad_entregada_acumulada':0}
        a={'registros':[fila(1),fila(2)],'hojas':[{'hoja':'OCTUBRE 2026',
                                                 'formato_valido':True,'errores':[]}]}
        with self.assertRaises(LoteNoConfirmable): preparar_confirmacion(a,[],{},[])
        p=preparar_confirmacion(a,[],{'OCTUBRE 2026:1':'NUEVO',
                                     'OCTUBRE 2026:2':'EXCLUIR'},[])
        self.assertFalse(p['bloqueado'])

if __name__=='__main__': unittest.main()
