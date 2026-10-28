import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'

import api from '../services/api'


const TODAS_LAS_REFERENCIAS = '__todas__'


interface Metadatos {
  archivo_origen?: string
  hoja_origen?: string
  fila_origen?: number
  fecha_importacion?: string
  lote_importacion?: string
}

interface Radicado {
  _id: string
  'Fecha ingreso': string | null
  'Fecha limite': string | null
  'Fecha entrega final': string | null
  Cliente: string | null
  'Orden de compra': string | number | null
  Area: string | null
  Referencia: string | null
  Talla: string | number | null
  Tipo: string | null
  Cantidad: number | null
  'Unidades despachadas': number | null
  'Unidades pendientes': number
  Estado: string
  _metadatos?: Metadatos
}

interface RespuestaRadicados {
  pagina: number
  limite: number
  total_registros: number
  total_paginas: number
  dias_entrega_proxima: number
  registros: Radicado[]
}

interface OpcionesFiltros {
  clientes: string[]
  areas: string[]
  referencias: string[]
  hojas: string[]
  tallas: string[]
  tipos: string[]
  estados: string[]
}

interface ConfiguracionEntregas {
  dias_entrega_proxima: number
}

interface Filtros {
  fechaInicial: string
  fechaFinal: string
  cliente: string
  area: string
  referencia: string
  ordenCompra: string
  hojaOrigen: string
  talla: string
  tipo: string
  estado: string
  ordenarPor: string
  direccion: string
  limite: number
}

const filtrosIniciales: Filtros = {
  fechaInicial: '',
  fechaFinal: '',
  cliente: '',
  area: '',
  referencia: '',
  ordenCompra: '',
  hojaOrigen: '',
  talla: '',
  tipo: '',
  estado: '',
  ordenarPor: 'fecha_ingreso',
  direccion: 'desc',
  limite: 20,
}


function formatearFecha(fecha: string | null) {
  if (!fecha) return '—'

  return new Date(fecha).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}


function claseEstado(estado: string) {
  const clases: Record<string, string> = {
    'En proceso': 'estado-en-proceso',
    'Entrega próxima': 'estado-entrega-proxima',
    'Entregado': 'estado-entregado',
    'Entregado a tiempo': 'estado-entregado-tiempo',
    'Entregado tarde': 'estado-entregado-tarde',
    'Entregado sin fecha': 'estado-entregado-sin-fecha',
    'Vencido sin entregar': 'estado-vencido',
  }

  return clases[estado] ?? 'estado-desconocido'
}


function RadicadosPage() {
  const [registros, setRegistros] = useState<Radicado[]>([])
  const [pagina, setPagina] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(0)
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [eliminandoId, setEliminandoId] = useState('')

  const [filtros, setFiltros] =
    useState<Filtros>(filtrosIniciales)

  const [filtrosAplicados, setFiltrosAplicados] =
    useState<Filtros>(filtrosIniciales)

  const [opciones, setOpciones] = useState<OpcionesFiltros>({
    clientes: [],
    areas: [],
    referencias: [],
    hojas: [],
    tallas: [],
    tipos: [],
    estados: [],
  })

  const [diasEntregaProxima, setDiasEntregaProxima] =
    useState(3)

  const [
    guardandoConfiguracion,
    setGuardandoConfiguracion,
  ] = useState(false)

  const [
    mensajeConfiguracion,
    setMensajeConfiguracion,
  ] = useState('')


  function actualizarFiltro<K extends keyof Filtros>(
    campo: K,
    valor: Filtros[K],
  ) {
    setFiltros((anteriores) => ({
      ...anteriores,
      [campo]: valor,
    }))
  }


  useEffect(() => {
    async function cargarInformacionInicial() {
      try {
        const [respuestaOpciones, respuestaConfiguracion] =
          await Promise.all([
            api.get<OpcionesFiltros>(
              '/api/radicados/opciones-filtros',
            ),
            api.get<ConfiguracionEntregas>(
              '/api/configuracion/entregas',
            ),
          ])

        setOpciones({
          ...respuestaOpciones.data,
          tallas: [],
          tipos: [],
        })

        setDiasEntregaProxima(
          respuestaConfiguracion.data
            .dias_entrega_proxima,
        )
      } catch (errorInicial) {
        console.error(
          'No fue posible cargar la información inicial:',
          errorInicial,
        )
      }
    }

    cargarInformacionInicial()
  }, [])


  useEffect(() => {
    const referenciaSeleccionada = filtros.referencia
    const tallaSeleccionada = filtros.talla
    let consultaCancelada = false

    if (!referenciaSeleccionada) {
      setOpciones((actuales) => ({
        ...actuales,
        tallas: [],
        tipos: [],
      }))

      return undefined
    }

    async function consultarOpcionesDependientes() {
      try {
        const respuesta = await api.get<OpcionesFiltros>(
          '/api/radicados/opciones-filtros',
          {
            params: {
              referencia: referenciaSeleccionada,
              talla: tallaSeleccionada || undefined,
            },
          },
        )

        if (consultaCancelada) return

        const tallasDisponibles =
          respuesta.data.tallas

        const tiposDisponibles =
          respuesta.data.tipos

        setOpciones((actuales) => ({
          ...actuales,
          tallas: tallasDisponibles,
          tipos: tiposDisponibles,
        }))

        setFiltros((actuales) => {
          const tallaSigueDisponible =
            !actuales.talla ||
            tallasDisponibles.includes(actuales.talla)

          const tipoSigueDisponible =
            !actuales.tipo ||
            tiposDisponibles.includes(actuales.tipo)

          if (
            tallaSigueDisponible &&
            tipoSigueDisponible
          ) {
            return actuales
          }

          return {
            ...actuales,
            talla: tallaSigueDisponible
              ? actuales.talla
              : '',
            tipo: tipoSigueDisponible
              ? actuales.tipo
              : '',
          }
        })
      } catch (errorOpciones) {
        if (consultaCancelada) return

        console.error(
          'No fue posible cargar tallas y tipos:',
          errorOpciones,
        )

        setOpciones((actuales) => ({
          ...actuales,
          tallas: [],
          tipos: [],
        }))
      }
    }

    consultarOpcionesDependientes()

    return () => {
      consultaCancelada = true
    }
  }, [filtros.referencia, filtros.talla])


  useEffect(() => {
    async function consultarRadicados() {
      try {
        setCargando(true)
        setError('')

        const respuesta = await api.get<RespuestaRadicados>(
          '/api/radicados',
          {
            params: {
              pagina,
              limite: filtrosAplicados.limite,
              fecha_inicial:
                filtrosAplicados.fechaInicial || undefined,
              fecha_final:
                filtrosAplicados.fechaFinal || undefined,
              cliente:
                filtrosAplicados.cliente || undefined,
              area:
                filtrosAplicados.area || undefined,
              referencia:
                filtrosAplicados.referencia || undefined,
              talla:
                filtrosAplicados.talla || undefined,
              tipo:
                filtrosAplicados.tipo || undefined,
              estado:
                filtrosAplicados.estado || undefined,
              orden_compra:
                filtrosAplicados.ordenCompra || undefined,
              hoja_origen:
                filtrosAplicados.hojaOrigen || undefined,
              ordenar_por:
                filtrosAplicados.ordenarPor,
              direccion:
                filtrosAplicados.direccion,
            },
          },
        )

        setRegistros(respuesta.data.registros)
        setTotalPaginas(respuesta.data.total_paginas)
        setTotalRegistros(respuesta.data.total_registros)
        setDiasEntregaProxima(
          respuesta.data.dias_entrega_proxima,
        )
      } catch (errorConsulta) {
        console.error(errorConsulta)

        setError(
          'No fue posible consultar los radicados.',
        )
      } finally {
        setCargando(false)
      }
    }

    consultarRadicados()
  }, [pagina, filtrosAplicados])


  function aplicarFiltros(
    evento: SubmitEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()
    setPagina(1)
    setFiltrosAplicados({ ...filtros })
  }


  function limpiarFiltros() {
    setPagina(1)
    setFiltros({ ...filtrosIniciales })
    setFiltrosAplicados({ ...filtrosIniciales })
  }


  async function eliminarRadicado(registro: Radicado) {
    const descripcion = [
      registro.Cliente ?? 'Sin cliente',
      registro['Orden de compra']
        ? `OC ${registro['Orden de compra']}`
        : 'Sin orden de compra',
      registro.Referencia ?? 'Sin referencia',
      registro.Cantidad != null
        ? `${registro.Cantidad.toLocaleString('es-CO')} unidades`
        : 'Sin cantidad',
    ].join(' · ')

    const confirmado = window.confirm(
      `¿Eliminar este radicado?\n\n${descripcion}\n\nEsta acción no se puede deshacer.`,
    )

    if (!confirmado) return

    try {
      setEliminandoId(registro._id)
      setError('')

      await api.delete(`/api/radicados/${registro._id}`)

      if (registros.length === 1 && pagina > 1) {
        setPagina((actual) => actual - 1)
      } else {
        setFiltrosAplicados((actuales) => ({
          ...actuales,
        }))
      }
    } catch (errorEliminacion) {
      console.error(errorEliminacion)
      setError('No fue posible eliminar el radicado.')
    } finally {
      setEliminandoId('')
    }
  }


  async function guardarConfiguracion() {
    if (
      !Number.isInteger(diasEntregaProxima) ||
      diasEntregaProxima < 0 ||
      diasEntregaProxima > 365
    ) {
      setMensajeConfiguracion(
        'El número de días debe estar entre 0 y 365.',
      )
      return
    }

    try {
      setGuardandoConfiguracion(true)
      setMensajeConfiguracion('')

      await api.put(
        '/api/configuracion/entregas',
        {
          dias_entrega_proxima:
            diasEntregaProxima,
        },
      )

      setMensajeConfiguracion(
        'Configuración guardada.',
      )

      setFiltrosAplicados((actuales) => ({
        ...actuales,
      }))
    } catch (errorConfiguracion) {
      console.error(errorConfiguracion)

      setMensajeConfiguracion(
        'No fue posible guardar la configuración.',
      )
    } finally {
      setGuardandoConfiguracion(false)
    }
  }


  const referenciaEspecifica = (
    filtros.referencia &&
    filtros.referencia !== TODAS_LAS_REFERENCIAS
  )

  const tipoHabilitado = Boolean(
    filtros.referencia,
  )


  return (
    <section className="pagina-radicados">
      <div className="titulo-pagina">
        <div>
          <h2>Radicados</h2>
          <p>
            Información almacenada actualmente en la base
            de datos
          </p>
        </div>

        <div className="cabecera-radicados">
          <div className="configuracion-entregas">
            <label htmlFor="diasEntregaProxima">
              Entregas proximas
            </label>

            <input
              id="diasEntregaProxima"
              type="number"
              min={0}
              max={365}
              value={diasEntregaProxima}
              onChange={(evento) =>
                setDiasEntregaProxima(
                  Number(evento.target.value),
                )
              }
            />

            <span>días</span>

            <button
              type="button"
              className="boton-secundario"
              disabled={guardandoConfiguracion}
              onClick={guardarConfiguracion}
            >
              {guardandoConfiguracion
                ? 'Guardando...'
                : 'Guardar'}
            </button>
          </div>

          {mensajeConfiguracion && (
            <small className="mensaje-configuracion">
              {mensajeConfiguracion}
            </small>
          )}

          <div className="contador-registros">
            {totalRegistros.toLocaleString('es-CO')}{' '}
            registros
          </div>
        </div>
      </div>

      <form
        className="panel-filtros"
        onSubmit={aplicarFiltros}
      >
        <div className="contenido-filtros">
          <div className="fila-filtros fila-negocio">
            <div className="campo-filtro">
              <label htmlFor="cliente">Cliente</label>

              <select
                id="cliente"
                value={filtros.cliente}
                onChange={(evento) =>
                  actualizarFiltro(
                    'cliente',
                    evento.target.value,
                  )
                }
              >
                <option value="">Todos</option>

                {opciones.clientes.map((cliente) => (
                  <option key={cliente} value={cliente}>
                    {cliente}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="ordenCompra">
                Orden de compra
              </label>

              <input
                id="ordenCompra"
                type="text"
                placeholder="Ejemplo: 11048"
                value={filtros.ordenCompra}
                onChange={(evento) =>
                  actualizarFiltro(
                    'ordenCompra',
                    evento.target.value,
                  )
                }
              />
            </div>

            <div className="campo-filtro">
              <label htmlFor="area">Área</label>

              <select
                id="area"
                value={filtros.area}
                onChange={(evento) =>
                  actualizarFiltro(
                    'area',
                    evento.target.value,
                  )
                }
              >
                <option value="">Todas</option>

                {opciones.areas.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="referencia">
                Referencia
              </label>

              <select
                id="referencia"
                value={filtros.referencia}
                onChange={(evento) =>
                  setFiltros((actuales) => ({
                    ...actuales,
                    referencia: evento.target.value,
                    talla: '',
                    tipo: '',
                  }))
                }
              >
                <option value="">
                  Seleccione una referencia
                </option>

                <option value={TODAS_LAS_REFERENCIAS}>
                  Todas las referencias
                </option>

                {opciones.referencias.map((referencia) => (
                  <option
                    key={referencia}
                    value={referencia}
                  >
                    {referencia}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="talla">Talla</label>

              <select
                id="talla"
                value={filtros.talla}
                disabled={!referenciaEspecifica}
                onChange={(evento) =>
                  setFiltros((actuales) => ({
                    ...actuales,
                    talla: evento.target.value,
                    tipo: '',
                  }))
                }
              >
                <option value="">
                  {referenciaEspecifica
                    ? 'Todas'
                    : 'Seleccione una referencia específica'}
                </option>

                {opciones.tallas.map((talla) => (
                  <option key={talla} value={talla}>
                    {talla}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="tipo">Tipo</label>

              <select
                id="tipo"
                value={filtros.tipo}
                disabled={!tipoHabilitado}
                onChange={(evento) =>
                  actualizarFiltro(
                    'tipo',
                    evento.target.value,
                  )
                }
              >
                <option value="">
                  {tipoHabilitado
                    ? 'Todos'
                    : 'Seleccione una referencia'}
                </option>

                {opciones.tipos.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="estado">Estado</label>

              <select
                id="estado"
                value={filtros.estado}
                onChange={(evento) =>
                  actualizarFiltro(
                    'estado',
                    evento.target.value,
                  )
                }
              >
                <option value="">Todos</option>

                {opciones.estados.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="hojaOrigen">
                Hoja de origen
              </label>

              <select
                id="hojaOrigen"
                value={filtros.hojaOrigen}
                onChange={(evento) =>
                  actualizarFiltro(
                    'hojaOrigen',
                    evento.target.value,
                  )
                }
              >
                <option value="">Todas</option>

                {opciones.hojas.map((hoja) => (
                  <option key={hoja} value={hoja}>
                    {hoja}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="fila-filtros fila-consulta">
            <div className="campo-filtro">
              <label htmlFor="fechaInicial">
                Fecha de ingreso inicial
              </label>

              <input
                id="fechaInicial"
                type="date"
                value={filtros.fechaInicial}
                onChange={(evento) =>
                  actualizarFiltro(
                    'fechaInicial',
                    evento.target.value,
                  )
                }
              />
            </div>

            <div className="campo-filtro">
              <label htmlFor="fechaFinal">
                Fecha de ingreso final
              </label>

              <input
                id="fechaFinal"
                type="date"
                value={filtros.fechaFinal}
                onChange={(evento) =>
                  actualizarFiltro(
                    'fechaFinal',
                    evento.target.value,
                  )
                }
              />
            </div>

            <div className="campo-filtro">
              <label htmlFor="ordenarPor">
                Ordenar por
              </label>

              <select
                id="ordenarPor"
                value={filtros.ordenarPor}
                onChange={(evento) =>
                  actualizarFiltro(
                    'ordenarPor',
                    evento.target.value,
                  )
                }
              >
                <option value="fecha_ingreso">
                  Fecha de ingreso
                </option>

                <option value="fecha_limite">
                  Fecha límite
                </option>

                <option value="fecha_entrega">
                  Fecha de entrega
                </option>

                <option value="cliente">Cliente</option>
                <option value="area">Área</option>
                <option value="referencia">
                  Referencia
                </option>
                <option value="tipo">Tipo</option>
                <option value="cantidad">Cantidad</option>
                <option value="orden_compra">
                  Orden de compra
                </option>
                <option value="talla">Talla</option>
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="direccion">
                Dirección
              </label>

              <select
                id="direccion"
                value={filtros.direccion}
                onChange={(evento) =>
                  actualizarFiltro(
                    'direccion',
                    evento.target.value,
                  )
                }
              >
                <option value="desc">
                  Mayor a menor
                </option>
                <option value="asc">
                  Menor a mayor
                </option>
              </select>
            </div>

            <div className="campo-filtro">
              <label htmlFor="limite">
                Registros por página
              </label>

              <select
                id="limite"
                value={filtros.limite}
                onChange={(evento) =>
                  actualizarFiltro(
                    'limite',
                    Number(evento.target.value),
                  )
                }
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="acciones-filtros">
              <button
                type="submit"
                className="boton-principal"
              >
                Aplicar filtros
              </button>

              <button
                type="button"
                className="boton-secundario"
                onClick={limpiarFiltros}
              >
                Limpiar
              </button>
            </div>
          </div>
        </div>
      </form>

      {cargando && (
        <div className="mensaje-estado">
          Consultando información...
        </div>
      )}

      {error && (
        <div className="mensaje-error">
          {error}
        </div>
      )}

      {!cargando && !error && (
        <>
          <div className="contenedor-tabla">
            <table className="tabla-radicados tabla-estados">
              <thead>
                <tr>
                  <th>Ingreso</th>
                  <th>Cliente</th>
                  <th>OC</th>
                  <th>Área</th>
                  <th>Referencia</th>
                  <th>Talla</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Despachadas</th>
                  <th>Pendientes</th>
                  <th>Estado</th>
                  <th>Límite</th>
                  <th>Entrega</th>
                  <th>Hoja</th>
                  <th>Acción</th>
                </tr>
              </thead>

              <tbody>
                {registros.map((registro) => (
                  <tr key={registro._id}>
                    <td>
                      {formatearFecha(
                        registro['Fecha ingreso'],
                      )}
                    </td>

                    <td>{registro.Cliente ?? '—'}</td>

                    <td>
                      {registro[
                        'Orden de compra'
                      ] ?? '—'}
                    </td>

                    <td>{registro.Area ?? 'SIN ÁREA'}</td>

                    <td>
                      {registro.Referencia ?? '—'}
                    </td>

                    <td>{registro.Talla ?? '—'}</td>
                    <td>{registro.Tipo ?? '—'}</td>

                    <td>
                      {registro.Cantidad?.toLocaleString(
                        'es-CO',
                      ) ?? '—'}
                    </td>

                    <td>
                      {registro[
                        'Unidades despachadas'
                      ]?.toLocaleString('es-CO') ?? '—'}
                    </td>

                    <td>
                      {registro[
                        'Unidades pendientes'
                      ].toLocaleString('es-CO')}
                    </td>

                    <td>
                      <span
                        className={
                          `estado-entrega ` +
                          claseEstado(registro.Estado)
                        }
                      >
                        {registro.Estado}
                      </span>
                    </td>

                    <td>
                      {formatearFecha(
                        registro['Fecha limite'],
                      )}
                    </td>

                    <td>
                      {formatearFecha(
                        registro[
                          'Fecha entrega final'
                        ],
                      )}
                    </td>

                    <td>
                      {registro._metadatos
                        ?.hoja_origen ?? '—'}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="boton-eliminar-radicado"
                        disabled={eliminandoId === registro._id}
                        onClick={() => eliminarRadicado(registro)}
                      >
                        {eliminandoId === registro._id
                          ? '...'
                          : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                ))}

                {registros.length === 0 && (
                  <tr>
                    <td
                      colSpan={15}
                      className="sin-resultados"
                    >
                      No se encontraron registros con
                      los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="paginacion">
            <button
              type="button"
              disabled={pagina === 1}
              onClick={() =>
                setPagina((actual) => actual - 1)
              }
            >
              Anterior
            </button>

            <span>
              Página {pagina} de{' '}
              {Math.max(totalPaginas, 1)}
            </span>

            <button
              type="button"
              disabled={
                totalPaginas === 0 ||
                pagina >= totalPaginas
              }
              onClick={() =>
                setPagina((actual) => actual + 1)
              }
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </section>
  )
}


export default RadicadosPage
