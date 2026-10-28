import axios from 'axios'
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'

import api from '../services/api'

interface RespuestaHojas {
  archivo: string
  total_hojas_validas: number
  hojas_validas: string[]
}

interface HojaExportable {
  nombre: string
  registros: number
}

interface RespuestaHojasExportacion {
  hojas: HojaExportable[]
  total_hojas: number
  total_registros: number
}

interface ResultadoHoja {
  hoja: string
  filas_leidas: number
  filas_rechazadas: number
  filas_corregidas: number
  registros_insertados: number
  registros_actualizados: number
  registros_sin_cambios: number
  claves_asignadas: number
  detalles_rechazos: DetalleRechazo[]
}

interface DetalleRechazo {
  hoja: string
  fila: number | null
  motivo: string
  cliente: string | null
  orden_compra: string | null
  area: string | null
  referencia: string | null
  talla: string | null
  cantidad: number | null
}

interface ResultadoImportacion {
  mensaje: string
  archivo: string
  lote_importacion: string
  hojas_procesadas: ResultadoHoja[]
  total_insertados: number
  total_actualizados: number
  total_sin_cambios: number
  total_claves_asignadas: number
  total_rechazados: number
  total_corregidos: number
  filas_rechazadas: DetalleRechazo[]
}

type OperacionExcel = 'importar' | 'exportar'

type OrganizacionExportacion =
  | 'por_hoja'
  | 'una_hoja'

function obtenerMensajeError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Ocurrió un error inesperado.'
  }

  const detalle = error.response?.data?.detail

  if (typeof detalle === 'string') {
    return detalle
  }

  if (detalle?.mensaje) {
    const columnasFaltantes =
      detalle.columnas_faltantes?.join(', ')

    if (columnasFaltantes) {
      return (
        `${detalle.mensaje}. Columnas faltantes: ` +
        columnasFaltantes
      )
    }

    return detalle.mensaje
  }

  return 'No fue posible completar la operación.'
}


async function obtenerMensajeErrorDescarga(
  error: unknown,
): Promise<string> {
  if (
    axios.isAxiosError(error) &&
    error.response?.data instanceof Blob
  ) {
    try {
      const contenido = await error.response.data.text()
      const respuesta = JSON.parse(contenido)
      const detalle = respuesta?.detail

      if (typeof detalle === 'string') {
        return detalle
      }

      if (detalle?.mensaje) {
        return detalle.mensaje
      }
    } catch {
      return 'No fue posible generar el archivo Excel.'
    }
  }

  return obtenerMensajeError(error)
}

function ImportacionPage() {
  const [operacion, setOperacion] =
    useState<OperacionExcel>('importar')

  const [archivo, setArchivo] = useState<File | null>(null)
  const [informacionHojas, setInformacionHojas] =
    useState<RespuestaHojas | null>(null)

  const [hojasSeleccionadas, setHojasSeleccionadas] =
    useState<string[]>([])

  const [confirmarActualizacion, setConfirmarActualizacion] =
    useState(false)

  const [consultando, setConsultando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] =
    useState<ResultadoImportacion | null>(null)

  const [hojasExportables, setHojasExportables] =
    useState<HojaExportable[]>([])

  const [hojasParaExportar, setHojasParaExportar] =
    useState<string[]>([])

  const [organizacionExportacion, setOrganizacionExportacion] =
    useState<OrganizacionExportacion>('por_hoja')

  const [consultandoExportacion, setConsultandoExportacion] =
    useState(false)

  const [exportando, setExportando] = useState(false)
  const [mensajeExportacion, setMensajeExportacion] =
    useState('')

  useEffect(() => {
    if (operacion !== 'exportar') return

    let consultaCancelada = false

    async function consultarHojasExportables() {
      try {
        setConsultandoExportacion(true)
        setError('')
        setMensajeExportacion('')

        const respuesta =
          await api.get<RespuestaHojasExportacion>(
            '/api/importaciones/exportacion/hojas',
          )

        if (consultaCancelada) return

        setHojasExportables(respuesta.data.hojas)
        setHojasParaExportar([])
      } catch (errorConsulta) {
        if (consultaCancelada) return

        setHojasExportables([])
        setHojasParaExportar([])
        setError(obtenerMensajeError(errorConsulta))
      } finally {
        if (!consultaCancelada) {
          setConsultandoExportacion(false)
        }
      }
    }

    consultarHojasExportables()

    return () => {
      consultaCancelada = true
    }
  }, [operacion])

  function cambiarOperacion(
    nuevaOperacion: OperacionExcel,
  ) {
    setOperacion(nuevaOperacion)
    setError('')
    setMensajeExportacion('')
    setResultado(null)
  }

  function cambiarSeleccionExportacion(
    hoja: string,
  ) {
    setHojasParaExportar((seleccionActual) => {
      if (seleccionActual.includes(hoja)) {
        return seleccionActual.filter(
          (nombre) => nombre !== hoja,
        )
      }

      return [...seleccionActual, hoja]
    })

    setMensajeExportacion('')
  }

  function seleccionarTodasParaExportar() {
    setHojasParaExportar(
      hojasExportables.map((hoja) => hoja.nombre),
    )
    setMensajeExportacion('')
  }

  function quitarSeleccionExportacion() {
    setHojasParaExportar([])
    setMensajeExportacion('')
  }

  async function exportarExcel() {
    if (hojasParaExportar.length === 0) {
      setError(
        'Debes seleccionar al menos una hoja para exportar.',
      )
      return
    }

    try {
      setExportando(true)
      setError('')
      setMensajeExportacion('')

      const respuesta = await api.post<Blob>(
        '/api/importaciones/exportar',
        {
          hojas: hojasParaExportar,
          organizacion: organizacionExportacion,
        },
        {
          responseType: 'blob',
        },
      )

      const disposicion = String(
        respuesta.headers['content-disposition'] ?? '',
      )

      const coincidenciaNombre = disposicion.match(
        /filename="?([^";]+)"?/i,
      )

      const nombreArchivo =
        coincidenciaNombre?.[1] ??
        'radicados_arcoline.xlsx'

      const urlDescarga = URL.createObjectURL(
        respuesta.data,
      )

      const enlace = document.createElement('a')
      enlace.href = urlDescarga
      enlace.download = nombreArchivo
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(urlDescarga)

      setMensajeExportacion(
        'El archivo Excel fue generado correctamente.',
      )
    } catch (errorExportacion) {
      setError(
        await obtenerMensajeErrorDescarga(
          errorExportacion,
        ),
      )
    } finally {
      setExportando(false)
    }
  }

  const totalRegistrosSeleccionados =
    hojasExportables
      .filter((hoja) =>
        hojasParaExportar.includes(hoja.nombre),
      )
      .reduce(
        (total, hoja) => total + hoja.registros,
        0,
      )

  function seleccionarArchivo(
    evento: ChangeEvent<HTMLInputElement>,
  ) {
    const archivoSeleccionado =
      evento.target.files?.[0] ?? null

    setArchivo(archivoSeleccionado)
    setInformacionHojas(null)
    setHojasSeleccionadas([])
    setConfirmarActualizacion(false)
    setResultado(null)
    setError('')
  }

  async function consultarHojas() {
    if (!archivo) {
      setError('Debes seleccionar un archivo Excel.')
      return
    }

    try {
      setConsultando(true)
      setError('')
      setResultado(null)

      const formulario = new FormData()
      formulario.append('archivo', archivo)

      const respuesta = await api.post<RespuestaHojas>(
        '/api/importaciones/hojas',
        formulario,
      )

      setInformacionHojas(respuesta.data)
      setHojasSeleccionadas([])
      setConfirmarActualizacion(false)
    } catch (errorConsulta) {
      setInformacionHojas(null)
      setHojasSeleccionadas([])
      setError(obtenerMensajeError(errorConsulta))
    } finally {
      setConsultando(false)
    }
  }

  function cambiarSeleccionHoja(hoja: string) {
    setHojasSeleccionadas((seleccionActual) => {
      if (seleccionActual.includes(hoja)) {
        return seleccionActual.filter(
          (hojaSeleccionada) =>
            hojaSeleccionada !== hoja,
        )
      }

      return [...seleccionActual, hoja]
    })

    setConfirmarActualizacion(false)
    setResultado(null)
  }

  function seleccionarTodasLasHojas() {
    if (!informacionHojas) return

    setHojasSeleccionadas([
      ...informacionHojas.hojas_validas,
    ])

    setConfirmarActualizacion(false)
  }

  function quitarSeleccion() {
    setHojasSeleccionadas([])
    setConfirmarActualizacion(false)
  }

  async function importarHojas() {
    if (!archivo) {
      setError('Debes seleccionar un archivo Excel.')
      return
    }

    if (hojasSeleccionadas.length === 0) {
      setError('Debes seleccionar al menos una hoja.')
      return
    }

    if (!confirmarActualizacion) {
      setError(
        'Debes confirmar la actualización de las hojas seleccionadas.',
      )
      return
    }

    try {
      setImportando(true)
      setError('')
      setResultado(null)

      const formulario = new FormData()
      formulario.append('archivo', archivo)

      hojasSeleccionadas.forEach((hoja) => {
        formulario.append('hojas', hoja)
      })

      formulario.append('confirmar', 'true')

      const respuesta = await api.post<ResultadoImportacion>(
        '/api/importaciones/cargar',
        formulario,
      )

      setResultado(respuesta.data)
      setConfirmarActualizacion(false)
    } catch (errorImportacion) {
      setError(obtenerMensajeError(errorImportacion))
    } finally {
      setImportando(false)
    }
  }

  return (
    <section>
      <div className="titulo-pagina">
        <div>
          <h2>Importar y exportar Excel</h2>
          <p>
            {operacion === 'importar'
              ? 'Seleccionar las hojas para importar en la base de datos'
              : 'Exportar las hojas almacenadas actualmente en la base de datos'}
          </p>
        </div>

        <div className="acciones-titulo-intercambio">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => window.location.reload()}
          >
            Reiniciar
          </button>

          <div className="selector-operacion">
            <label htmlFor="operacionExcel">
              Operación
            </label>

            <select
              id="operacionExcel"
              value={operacion}
              onChange={(evento) =>
                cambiarOperacion(
                  evento.target.value as OperacionExcel,
                )
              }
            >
              <option value="importar">Importar</option>
              <option value="exportar">Exportar</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="mensaje-error">{error}</div>}

      {operacion === 'importar' && (
        <>
          <div className="zona-archivo">
        <div className="campo-archivo">
          <label htmlFor="archivoExcel">
            Archivo Excel
          </label>

          <div className="fila-seleccion-archivo">
            <input
              id="archivoExcel"
              type="file"
              accept=".xlsx,.xlsm"
              onChange={seleccionarArchivo}
            />

            <button
              type="button"
              className="boton-principal"
              disabled={!archivo || consultando}
              onClick={consultarHojas}
            >
              {consultando
                ? 'Consultando hojas...'
                : 'Consultar hojas'}
            </button>
          </div>

          <small>
            Formatos permitidos: .xlsx y .xlsm. Tamaño máximo:
            20 MB.
          </small>
        </div>
      </div>

      {archivo && (
        <div className="archivo-seleccionado">
          <strong>Archivo seleccionado:</strong>{' '}
          {archivo.name}
        </div>
      )}

      {informacionHojas && (
        <div className="bloque-hojas">
          <div className="encabezado-hojas">
            <div>
              <h3>Hojas válidas</h3>
              <p>
                Selecciona las hojas que deseas actualizar. Solo
                se escribirán los registros nuevos o modificados.
              </p>
            </div>

            <div className="acciones-hojas">
              <button
                type="button"
                className="boton-secundario"
                onClick={seleccionarTodasLasHojas}
              >
                Seleccionar todas
              </button>

              <button
                type="button"
                className="boton-secundario"
                onClick={quitarSeleccion}
              >
                Quitar selección
              </button>
            </div>
          </div>

          <div className="lista-hojas">
            {informacionHojas.hojas_validas.map((hoja) => (
              <label key={hoja} className="opcion-hoja">
                <input
                  type="checkbox"
                  checked={hojasSeleccionadas.includes(hoja)}
                  onChange={() => cambiarSeleccionHoja(hoja)}
                />

                <span>{hoja}</span>
              </label>
            ))}
          </div>

          <label className="confirmacion-reemplazo">
            <input
              type="checkbox"
              checked={confirmarActualizacion}
              disabled={hojasSeleccionadas.length === 0}
              onChange={(evento) =>
                setConfirmarActualizacion(
                  evento.target.checked,
                )
              }
            />

            <span>
              Confirmo que deseo actualizar en MongoDB las hojas
              seleccionadas. Las filas inválidas no modificarán
              sus registros anteriores.
            </span>
          </label>

          <div className="pie-importacion">
            <span>
              {hojasSeleccionadas.length}{' '}
              {hojasSeleccionadas.length === 1
                ? 'hoja seleccionada'
                : 'hojas seleccionadas'}
            </span>

            <button
              type="button"
              className="boton-importar"
              disabled={
                importando ||
                hojasSeleccionadas.length === 0 ||
                !confirmarActualizacion
              }
              onClick={importarHojas}
            >
              {importando
                ? 'Importando información...'
                : 'Importar y actualizar'}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="resultado-importacion">
          <h3>{resultado.mensaje}</h3>

          {resultado.total_rechazados > 0 && (
            <div className="mensaje-advertencia">
              Se rechazaron{' '}
              <strong>
                {resultado.total_rechazados.toLocaleString(
                  'es-CO',
                )}
              </strong>{' '}
              filas. No se escribieron en MongoDB y sus registros
              anteriores, si existían, permanecieron intactos.
            </div>
          )}

          {resultado.total_claves_asignadas > 0 && (
            <div className="mensaje-informativo">
              Se asignó identidad interna a{' '}
              <strong>
                {resultado.total_claves_asignadas.toLocaleString(
                  'es-CO',
                )}
              </strong>{' '}
              registros existentes sin cambiar sus identificadores.
            </div>
          )}

          {resultado.total_corregidos > 0 && (
            <div className="mensaje-informativo">
              Se corrigieron automáticamente{' '}
              <strong>
                {resultado.total_corregidos.toLocaleString(
                  'es-CO',
                )}
              </strong>{' '}
              filas en las que las unidades despachadas superaban
              la cantidad recibida.
            </div>
          )}

          <div className="resumen-importacion">
            <div className="tarjeta-resumen">
              <span>Registros insertados</span>
              <strong>
                {resultado.total_insertados.toLocaleString(
                  'es-CO',
                )}
              </strong>
            </div>

            <div className="tarjeta-resumen">
              <span>Registros actualizados</span>
              <strong>
                {resultado.total_actualizados.toLocaleString(
                  'es-CO',
                )}
              </strong>
            </div>

            <div className="tarjeta-resumen">
              <span>Sin cambios</span>
              <strong>
                {resultado.total_sin_cambios.toLocaleString(
                  'es-CO',
                )}
              </strong>
            </div>

            <div className="tarjeta-resumen">
              <span>Filas rechazadas</span>
              <strong>
                {resultado.total_rechazados.toLocaleString(
                  'es-CO',
                )}
              </strong>
            </div>

            <div className="tarjeta-resumen">
              <span>Filas corregidas</span>
              <strong>
                {resultado.total_corregidos.toLocaleString(
                  'es-CO',
                )}
              </strong>
            </div>
          </div>

          <div className="contenedor-tabla">
            <table className="tabla-radicados">
              <thead>
                <tr>
                  <th>Hoja</th>
                  <th>Filas leídas</th>
                  <th>Rechazadas</th>
                  <th>Corregidas</th>
                  <th>Insertadas</th>
                  <th>Actualizadas</th>
                  <th>Sin cambios</th>
                  <th>Claves asignadas</th>
                </tr>
              </thead>

              <tbody>
                {resultado.hojas_procesadas.map((hoja) => (
                  <tr key={hoja.hoja}>
                    <td>{hoja.hoja}</td>

                    <td>
                      {hoja.filas_leidas.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.filas_rechazadas.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.filas_corregidas.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.registros_insertados.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.registros_actualizados.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.registros_sin_cambios.toLocaleString(
                        'es-CO',
                      )}
                    </td>

                    <td>
                      {hoja.claves_asignadas.toLocaleString(
                        'es-CO',
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resultado.filas_rechazadas.length > 0 && (
            <>
              <h3>Detalle de filas rechazadas</h3>

              <div className="contenedor-tabla">
                <table className="tabla-radicados">
                  <thead>
                    <tr>
                      <th>Hoja</th>
                      <th>Fila</th>
                      <th>Motivo</th>
                      <th>Cliente</th>
                      <th>Orden de compra</th>
                      <th>Área</th>
                      <th>Referencia</th>
                      <th>Talla</th>
                      <th>Cantidad</th>
                    </tr>
                  </thead>

                  <tbody>
                    {resultado.filas_rechazadas.map(
                      (rechazo, indice) => (
                        <tr
                          key={
                            `${rechazo.hoja}-` +
                            `${rechazo.fila ?? 'bd'}-${indice}`
                          }
                        >
                          <td>{rechazo.hoja}</td>
                          <td>{rechazo.fila ?? '—'}</td>
                          <td>{rechazo.motivo}</td>
                          <td>{rechazo.cliente ?? '—'}</td>
                          <td>
                            {rechazo.orden_compra ?? '—'}
                          </td>
                          <td>{rechazo.area ?? '—'}</td>
                          <td>{rechazo.referencia ?? '—'}</td>
                          <td>{rechazo.talla ?? '—'}</td>
                          <td>
                            {rechazo.cantidad?.toLocaleString(
                              'es-CO',
                            ) ?? '—'}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="lote-importacion">
            Lote de importación:{' '}
            <code>{resultado.lote_importacion}</code>
          </p>
        </div>
      )}
        </>
      )}

      {operacion === 'exportar' && (
        <div className="bloque-hojas panel-exportacion">
          <div className="encabezado-hojas">
            <div>
              <h3>Hojas a exportar</h3>
              <p>
                Selecciona las hojas de origen que deseas incluir
                en el archivo Excel.
              </p>
            </div>

            <div className="acciones-hojas">
              <button
                type="button"
                className="boton-secundario"
                disabled={
                  consultandoExportacion ||
                  hojasExportables.length === 0
                }
                onClick={seleccionarTodasParaExportar}
              >
                Seleccionar todas
              </button>

              <button
                type="button"
                className="boton-secundario"
                disabled={hojasParaExportar.length === 0}
                onClick={quitarSeleccionExportacion}
              >
                Quitar selección
              </button>
            </div>
          </div>

          {consultandoExportacion ? (
            <div className="mensaje-estado">
              Consultando hojas disponibles...
            </div>
          ) : hojasExportables.length === 0 ? (
            <div className="sin-datos-exportacion">
              No hay hojas de origen disponibles para exportar.
            </div>
          ) : (
            <>
              <div className="lista-hojas">
                {hojasExportables.map((hoja) => (
                  <label
                    key={hoja.nombre}
                    className="opcion-hoja opcion-hoja-exportacion"
                  >
                    <input
                      type="checkbox"
                      checked={hojasParaExportar.includes(
                        hoja.nombre,
                      )}
                      onChange={() =>
                        cambiarSeleccionExportacion(
                          hoja.nombre,
                        )
                      }
                    />

                    <span>
                      <strong>{hoja.nombre}</strong>
                      <small>
                        {hoja.registros.toLocaleString('es-CO')}{' '}
                        {hoja.registros === 1
                          ? 'registro'
                          : 'registros'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>

              <div className="bloque-organizacion-exportacion">
                <h3>Organización del libro</h3>

                <div className="opciones-organizacion-exportacion">
                  <label className="opcion-organizacion-exportacion">
                    <input
                      type="radio"
                      name="organizacionExportacion"
                      value="por_hoja"
                      checked={
                        organizacionExportacion === 'por_hoja'
                      }
                      onChange={() =>
                        setOrganizacionExportacion('por_hoja')
                      }
                    />

                    <span>
                      <strong>Una hoja por cada origen</strong>
                      <small>
                        Conserva el formato requerido y puede
                        importarse nuevamente.
                      </small>
                    </span>
                  </label>

                  <label className="opcion-organizacion-exportacion">
                    <input
                      type="radio"
                      name="organizacionExportacion"
                      value="una_hoja"
                      checked={
                        organizacionExportacion === 'una_hoja'
                      }
                      onChange={() =>
                        setOrganizacionExportacion('una_hoja')
                      }
                    />

                    <span>
                      <strong>Todo en una sola hoja</strong>
                      <small>
                        Incluye la columna Hoja de origen y es
                        únicamente para consulta y análisis.
                      </small>
                    </span>
                  </label>
                </div>
              </div>

              {organizacionExportacion === 'una_hoja' && (
                <div className="mensaje-advertencia advertencia-exportacion">
                  El archivo consolidado no podrá importarse
                  nuevamente porque contiene la columna adicional
                  Hoja de origen.
                </div>
              )}

              {mensajeExportacion && (
                <div className="mensaje-informativo mensaje-exportacion">
                  {mensajeExportacion}
                </div>
              )}

              <div className="pie-importacion pie-exportacion">
                <span>
                  <strong>
                    {hojasParaExportar.length.toLocaleString(
                      'es-CO',
                    )}
                  </strong>{' '}
                  {hojasParaExportar.length === 1
                    ? 'hoja seleccionada'
                    : 'hojas seleccionadas'}
                  {' · '}
                  <strong>
                    {totalRegistrosSeleccionados.toLocaleString(
                      'es-CO',
                    )}
                  </strong>{' '}
                  registros
                </span>

                <button
                  type="button"
                  className="boton-importar"
                  disabled={
                    exportando ||
                    hojasParaExportar.length === 0
                  }
                  onClick={exportarExcel}
                >
                  {exportando
                    ? 'Generando archivo...'
                    : 'Exportar Excel'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default ImportacionPage
