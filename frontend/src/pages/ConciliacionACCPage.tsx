import { useEffect, useState } from 'react'
import api from '../services/api'
import './ConciliacionACCPage.css'

type Datos = Record<string, unknown>
type HojaSeleccion = { hoja: string; formato_valido: boolean; motivo?: string | null }
type FilaError = { fila: number; motivo: string; datos_originales?: Datos }
type Item = { origen: string; accion: string; motivo: string; datos_fila?: Datos }
type Vista = {
  confirmacion_habilitada: boolean
  permiso_servidor?: boolean
  tipo_confirmacion?: 'piloto' | 'masiva'
  validacion: { total_validas: number; total_invalidas: number; hojas: { hoja: string; errores?: FilaError[] }[] }
  conciliacion: { items: Item[]; resumen: Record<string, number>; bloqueado: boolean }
}
type ResumenImportacion = { nuevos?: number; actualizados?: number; sin_cambios?: number; excluidos?: number; saldos_iniciales?: number; parciales?: number; filas_invalidas_excluidas?: number }
const numero = (n: number) => new Intl.NumberFormat('es-CO').format(n)
const campos = ['cliente', 'orden_compra', 'referencia', 'acabado_talla', 'color_codigo', 'fecha_pedido', 'cantidad_solicitada', 'cantidad_entregada_acumulada']
function csvDescarga(nombre: string, filas: unknown[][]) {
  const seguro = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    const valor = /^\s*[=+@]/.test(s) || /^\s*-(?!\d)/.test(s) ? "'" + s : s
    return '"' + valor.replaceAll('"', '""') + '"'
  }
  const contenido = '\uFEFF' + filas.map(f => f.map(seguro).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
function descripcionError(e: unknown): string {
  const fallo = e as { response?: { data?: { detail?: string | { msg?: string } } }; message?: string }
  const detalle = fallo.response?.data?.detail
  return typeof detalle === 'string' ? detalle : detalle?.msg || fallo.message || 'No fue posible completar la operación'
}

export default function ConciliacionACCPage() {
  const [instancia, setInstancia] = useState(0)
  return <ConciliacionFormulario key={instancia} reiniciar={() => setInstancia(n => n + 1)} />
}

function ConciliacionFormulario({ reiniciar }: { reiniciar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vista, setVista] = useState<Vista | null>(null)
  const [hojas, setHojas] = useState<HojaSeleccion[]>([])
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [detectando, setDetectando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<ResumenImportacion | null>(null)
  const [detalle, setDetalle] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [avance, setAvance] = useState<{ procesados: number; total: number; estado?: string } | null>(null)

  useEffect(() => {
    if (!confirmando) return
    let activo = true
    const consultar = async () => {
      try {
        const r = await api.get('/api/consultas-acc/estado-importacion')
        if (activo && r.data?.en_curso && Number(r.data.total) > 0) {
          setAvance({ procesados: r.data.procesados || 0, total: r.data.total, estado: r.data.estado })
        }
      } catch { /* El resultado principal de la importación sigue siendo la fuente definitiva. */ }
    }
    void consultar()
    const temporizador = window.setInterval(() => void consultar(), 1800)
    return () => { activo = false; window.clearInterval(temporizador) }
  }, [confirmando])
  const rechazados = (vista?.conciliacion.items || []).filter(i => i.accion === 'duplicado' || i.accion === 'revision')
  const errores = vista?.validacion.hojas.flatMap(h => (h.errores || []).map(e => ({ ...e, hoja: h.hoja }))) || []
  const totalErrores = errores.length + rechazados.length
  const ocupado = detectando || cargando || confirmando

  function descargarErrores() {
    csvDescarga('ACC_corregir_excel.csv', [['Tipo', 'Hoja/Fila', 'Motivo', ...campos],
      ...errores.map(e => ['Inválido', `${e.hoja}:${e.fila}`, e.motivo, ...campos.map(c => e.datos_originales?.[c] ?? '')]),
      ...rechazados.map(i => [i.accion, i.origen, i.motivo, ...campos.map(c => i.datos_fila?.[c] ?? '')])])
  }

  async function elegirArchivo(nuevo: File | null) {
    setArchivo(nuevo)
    setVista(null)
    setResultado(null)
    setError('')
    setHojas([])
    setSeleccion([])
    setDetalle(false)
    if (!nuevo) return
    setDetectando(true)
    try {
      const form = new FormData()
      form.append('file', nuevo)
      const respuesta = await api.post('/api/conciliacion-acc/hojas', form)
      setHojas(respuesta.data.hojas || [])
      setSeleccion(respuesta.data.seleccion_inicial || [])
    } catch (e: unknown) {
      setError(descripcionError(e))
    } finally {
      setDetectando(false)
    }
  }

  function cambiarHoja(nombre: string, activada: boolean) {
    setSeleccion(actual => activada ? [...actual, nombre] : actual.filter(x => x !== nombre))
    setVista(null)
    setResultado(null)
  }

  async function solicitar(confirmar: boolean) {
    if (!archivo || seleccion.length === 0 || ocupado) return
    // No hay ventana emergente: la acción explícita del botón confirma la operación.
    setError('')
    if (confirmar) {
      setAvance(null)
      setConfirmando(true)
      window.dispatchEvent(new CustomEvent('acc-importacion-activa', { detail: { activo: true } }))
    } else { setCargando(true); setResultado(null) }
    try {
      const form = new FormData()
      form.append('file', archivo)
      seleccion.forEach(hoja => form.append('hojas', hoja))
      form.append('resoluciones_json', '{}')
      form.append('exclusiones_invalidas_json', 'null')
      const ruta = confirmar
        ? (vista?.tipo_confirmacion === 'masiva' ? '/api/conciliacion-acc/confirmar-masivo' : '/api/conciliacion-acc/confirmar-piloto')
        : '/api/conciliacion-acc/previsualizar'
      const resp = await api.post(ruta, form)
      if (confirmar) {
        setResultado(resp.data.resumen || {})
        setVista(null)
        setAvance(null)
        window.dispatchEvent(new CustomEvent('acc-importacion-activa', { detail: { activo: false } }))
      } else {
        setVista(resp.data)
        setPagina(1)
      }
    } catch (e: unknown) {
      setError(descripcionError(e))
      if (confirmar) {
        // Sólo desbloquear si el servidor confirma que no queda trabajo pendiente.
        try {
          const r = await api.get('/api/consultas-acc/estado-importacion')
          if (!r.data?.en_curso) {
            window.dispatchEvent(new CustomEvent('acc-importacion-activa', { detail: { activo: false } }))
          }
        } catch { /* Mantener el bloqueo hasta conocer el estado del lote. */ }
      }
    } finally {
      setCargando(false)
      setConfirmando(false)
    }
  }

  const listadoRechazos = [
    ...rechazados.map(i => ({ origen: i.origen, motivo: i.motivo, datos: i.datos_fila || {} })),
    ...errores.map(e => ({ origen: `${e.hoja}:${e.fila}`, motivo: e.motivo, datos: e.datos_originales || {} }))
  ]

  return <section className="acc-page acc-page-inicial">
    <header className="acc-heading">
      <div>
        <p className="acc-eyebrow">PRODUCCIÓN ACCESORIOS / IMPORTACIÓN</p>
        <h1>Importar pedidos</h1>
        <p>Selecciona el archivo y las hojas. El sistema valida los pedidos antes de guardarlos.</p>
      </div>
      <button type="button" className="acc-secondary acc-reiniciar" onClick={reiniciar} disabled={confirmando}>Reiniciar proceso</button>
    </header>

    <div className="acc-import acc-paso-bloque">
      <h2 className="acc-paso-titulo"><span>1</span> Elegir archivo Excel</h2>
      <div className="acc-import-row">
        <input id="excel-acc" aria-label="Archivo Excel" type="file" accept=".xlsx,.xlsm" disabled={ocupado} onChange={e => void elegirArchivo(e.target.files?.[0] || null)} />
      </div>
      <p className="acc-ayuda">El archivo original no se modifica. Se admiten archivos .xlsx y .xlsm.</p>
    </div>

    <div className="acc-import acc-paso-bloque" aria-label="Selección de hojas">
      <h2 className="acc-paso-titulo"><span>2</span> Seleccionar hojas para importar</h2>
      <p className="acc-ayuda">Las hojas con formato válido se marcan automáticamente; puedes elegir cuáles incluir.</p>
      {detectando && <p role="status">Identificando hojas del archivo…</p>}
      {!archivo && <p className="acc-instruccion">Elige primero un archivo para ver sus hojas.</p>}
      {archivo && !detectando && hojas.length === 0 && <p className="acc-instruccion">No se encontraron hojas disponibles.</p>}
      {hojas.length > 0 && <div className="acc-hojas">
        {hojas.map(h => <label key={h.hoja} className={`acc-hoja ${!h.formato_valido ? 'acc-hoja-invalida' : ''}`}>
          <input type="checkbox" disabled={!h.formato_valido || ocupado} checked={seleccion.includes(h.hoja)} onChange={e => cambiarHoja(h.hoja, e.target.checked)} />
          <span><strong>{h.hoja}</strong><small>{h.formato_valido ? 'Formato válido' : h.motivo || 'Formato inválido'}</small></span>
        </label>)}
      </div>}
      <div className="acc-paso-acciones">
        <span>{seleccion.length} {seleccion.length === 1 ? 'hoja seleccionada' : 'hojas seleccionadas'}</span>
        <button type="button" disabled={!archivo || !seleccion.length || ocupado} onClick={() => void solicitar(false)}>{cargando ? 'Validando…' : 'Confirmar selección'}</button>
      </div>
    </div>

    {confirmando && <div className="acc-progreso" role="status" aria-live="polite">
      <strong>Importando pedidos a MongoDB</strong>
      <p>{avance && avance.total > 0
        ? `${numero(avance.procesados)} de ${numero(avance.total)} registros procesados (${Math.round(100 * avance.procesados / avance.total)} %)`
        : 'Preparando la importación y comprobando los registros…'}</p>
      <progress value={avance?.procesados || 0} max={avance?.total || 1} aria-label="Progreso de importación" />
      <small>Mientras se procesa el archivo, las otras pestañas quedan desactivadas.</small>
    </div>}
    {error && <div className="acc-error" role="alert">{error}</div>}
    {resultado && <div className="acc-resultado" role="status">
      <h2>Importación completada</h2>
      <p>La información fue procesada por MongoDB.</p>
      <div className="acc-resultado-cifras">
        <div><span>Nuevos</span><strong>{numero(resultado.nuevos || 0)}</strong></div>
        <div><span>Actualizados</span><strong>{numero(resultado.actualizados || 0)}</strong></div>
        <div><span>Sin cambios</span><strong>{numero(resultado.sin_cambios || 0)}</strong></div>
        <div><span>Saldos iniciales</span><strong>{numero(resultado.saldos_iniciales || 0)}</strong></div>
        <div><span>Parciales</span><strong>{numero(resultado.parciales || 0)}</strong></div>
      </div>
      <p>Para importar otro archivo, pulsa <strong>Reiniciar proceso</strong>.</p>
    </div>}

    {vista && <>
      <div className="acc-stats" aria-label="Resultado de la validación">
        <div><span>Pedidos nuevos</span><strong>{numero(vista.conciliacion.resumen.nuevo || 0)}</strong></div>
        <div><span>Pedidos existentes</span><strong>{numero(vista.conciliacion.resumen.existente || 0)}</strong></div>
        <div><span>Duplicados rechazados</span><strong>{numero(vista.conciliacion.resumen.duplicado || 0)}</strong></div>
        <div><span>Filas inválidas</span><strong>{numero(vista.validacion.total_invalidas)}</strong></div>
        <div><span>Requieren corrección</span><strong>{numero(vista.conciliacion.resumen.revision || 0)}</strong></div>
      </div>
      <div className="acc-toolbar">
        <button type="button" className="acc-secondary" disabled={totalErrores === 0} onClick={descargarErrores}>Descargar errores y duplicados ({numero(totalErrores)})</button>
        {totalErrores > 0 && <button type="button" className="acc-secondary" onClick={() => setDetalle(!detalle)}>{detalle ? 'Ocultar detalle' : 'Ver detalle'}</button>}
      </div>
      {(vista.conciliacion.resumen.revision || 0) > 0 && <div className="acc-error">Hay cambios que requieren corregir el Excel antes de confirmar la importación.</div>}
      {detalle && <div className="acc-errors">
        <h2>Registros rechazados</h2><p>Corrige los registros en el informe original y vuelve a validar el archivo.</p>
        <div className="acc-detalle-scroll"><table><thead><tr><th>Hoja / fila</th><th>Motivo</th><th>Cliente</th><th>Referencia</th></tr></thead>
          <tbody>{listadoRechazos.slice((pagina - 1) * 30, pagina * 30).map((i, index) => <tr key={i.origen + index}><td>{i.origen}</td><td>{i.motivo}</td><td>{String(i.datos.cliente ?? '—')}</td><td>{String(i.datos.referencia ?? '—')}</td></tr>)}</tbody></table></div>
        <div className="acc-detalle-paginacion"><button className="acc-secondary" type="button" disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button><span>Página {pagina} de {Math.max(1, Math.ceil(totalErrores / 30))}</span><button className="acc-secondary" type="button" disabled={pagina * 30 >= totalErrores} onClick={() => setPagina(p => p + 1)}>Siguiente</button></div>
      </div>}
      <div className="acc-import acc-paso-bloque acc-import-confirmacion">
        <h2 className="acc-paso-titulo"><span>3</span> Importar a MongoDB</h2>
        <p className="acc-ayuda">Se importarán los pedidos válidos. Los duplicados y errores quedarán excluidos y disponibles en el reporte.</p>
        {!vista.permiso_servidor && <p className="acc-instruccion">La escritura está desactivada en el servidor. Verifica ACC_CONFIRMACION_MASIVA.</p>}
        <div className="acc-paso-acciones"><span>{numero(vista.validacion.total_validas)} filas válidas examinadas</span><button type="button" disabled={!vista.confirmacion_habilitada || ocupado} onClick={() => void solicitar(true)}>{confirmando ? 'Importando a MongoDB…' : 'Confirmar importación'}</button></div>
      </div>
    </>}
  </section>
}
