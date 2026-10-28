import axios from 'axios'
import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import api from '../services/api'


const TODAS_LAS_REFERENCIAS = '__todas__'
const TODO_EL_PERIODO = '__todo_el_periodo__'
const FILAS_POR_PAGINA = 8
const ALTURA_GRAFICA = 598
const COLOR_OTRAS = '#6b7280'

const COLORES_GRAFICA = [
  '#08783f',
  '#c0007f',
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#dc2626',
  '#92400e',
]


interface DatoSemanal {
  semana: string
  categoria: string
  unidades: number
}

interface ResumenCategoria {
  categoria: string
  unidades: number
}

interface RespuestaVentas {
  filtros: {
    fecha_inicial: string | null
    fecha_final: string | null
    cliente: string | null
    area: string | null
    referencia: string | null
    talla: string | null
    tipo: string | null
    estado: string | null
    agrupar_por: Agrupacion
  }
  total_unidades: number
  total_semanas: number
  total_categorias: number
  semanas: string[]
  categorias: ResumenCategoria[]
  datos: DatoSemanal[]
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

interface FiltrosVentas {
  fechaInicial: string
  fechaFinal: string
  cliente: string
  area: string
  referencia: string
  talla: string
  tipo: string
  estado: string
}

interface PuntoGrafica {
  semana: string
  [categoria: string]: string | number
}

interface PuntoTorta {
  categoria: string
  unidades: number
}

type Agrupacion =
  | 'referencia'
  | 'cliente'
  | 'area'
  | 'estado'

type TipoGrafica =
  | 'barras-apiladas'
  | 'barras-agrupadas'
  | 'lineas'
  | 'torta'


function fechaLocalParaInput(fecha: Date): string {
  const anio = fecha.getFullYear()
  const mes = String(
    fecha.getMonth() + 1,
  ).padStart(2, '0')
  const dia = String(
    fecha.getDate(),
  ).padStart(2, '0')

  return `${anio}-${mes}-${dia}`
}


function crearFiltrosIniciales(): FiltrosVentas {
  const hoy = new Date()

  const primerDiaDelMes = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    1,
  )

  return {
    fechaInicial: fechaLocalParaInput(
      primerDiaDelMes,
    ),
    fechaFinal: fechaLocalParaInput(hoy),
    cliente: '',
    area: '',
    referencia: '',
    talla: '',
    tipo: '',
    estado: '',
  }
}


function formatearSemana(fecha: string): string {
  const [anio, mes, dia] = fecha
    .split('-')
    .map(Number)

  const fechaInicial = new Date(Date.UTC(
    anio,
    mes - 1,
    dia,
  ))

  const fechaFinal = new Date(fechaInicial)
  fechaFinal.setUTCDate(
    fechaFinal.getUTCDate() + 6,
  )

  function formatearFechaCorta(
    fechaActual: Date,
  ): string {
    const diaActual = String(
      fechaActual.getUTCDate(),
    ).padStart(2, '0')

    const mesActual = String(
      fechaActual.getUTCMonth() + 1,
    ).padStart(2, '0')

    const anioActual = String(
      fechaActual.getUTCFullYear(),
    ).slice(-2)

    return `${diaActual}/${mesActual}/${anioActual}`
  }

  return (
    `${formatearFechaCorta(fechaInicial)}–` +
    formatearFechaCorta(fechaFinal)
  )
}


function colorDeCategoria(
  categoria: string,
  indice: number,
  categoriaOtras: string,
): string {
  if (categoria === categoriaOtras) {
    return COLOR_OTRAS
  }

  return COLORES_GRAFICA[
    indice % COLORES_GRAFICA.length
  ]
}


function obtenerMensajeError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Ocurrió un error inesperado.'
  }

  const detalle = error.response?.data?.detail

  if (typeof detalle === 'string') {
    return detalle
  }

  return 'No fue posible consultar la producción.'
}


function VentasSemanalesPage() {
  const [filtros, setFiltros] =
    useState<FiltrosVentas>(
      crearFiltrosIniciales,
    )

  const [filtrosAplicados, setFiltrosAplicados] =
    useState<FiltrosVentas>(
      crearFiltrosIniciales,
    )

  const [opciones, setOpciones] =
    useState<OpcionesFiltros>({
      clientes: [],
      areas: [],
      referencias: [],
      hojas: [],
      tallas: [],
      tipos: [],
      estados: [],
    })

  const [resultado, setResultado] =
    useState<RespuestaVentas | null>(null)

  const [
    cantidadCategorias,
    setCantidadCategorias,
  ] = useState(5)

  const [tipoGrafica, setTipoGrafica] =
    useState<TipoGrafica>(
      'torta',
    )

  const [agruparPor, setAgruparPor] =
    useState<Agrupacion>('area')

  const [semanaTorta, setSemanaTorta] =
    useState(TODO_EL_PERIODO)

  const [paginaDetalle, setPaginaDetalle] =
    useState(1)

  const [
    paginaCategorias,
    setPaginaCategorias,
  ] = useState(1)

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] = useState('')


  useEffect(() => {
    async function consultarOpciones() {
      try {
        const respuesta = await api.get<OpcionesFiltros>(
          '/api/radicados/opciones-filtros',
        )

        setOpciones({
          ...respuesta.data,
          tallas: [],
          tipos: [],
        })
      } catch (errorOpciones) {
        console.error(
          'No fue posible cargar las opciones:',
          errorOpciones,
        )
      }
    }

    consultarOpciones()
  }, [])


  useEffect(() => {
    const referenciaSeleccionada =
      filtros.referencia

    const tallaSeleccionada =
      filtros.talla

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
              referencia:
                referenciaSeleccionada,
              talla:
                tallaSeleccionada ||
                undefined,
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
          const tallaValida =
            !actuales.talla ||
            tallasDisponibles.includes(
              actuales.talla,
            )

          const tipoValido =
            !actuales.tipo ||
            tiposDisponibles.includes(
              actuales.tipo,
            )

          if (tallaValida && tipoValido) {
            return actuales
          }

          return {
            ...actuales,
            talla: tallaValida
              ? actuales.talla
              : '',
            tipo: tipoValido
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
    async function consultarVentas() {
      try {
        setCargando(true)
        setError('')

        const respuesta =
          await api.get<RespuestaVentas>(
            '/api/ventas/semanales',
            {
              params: {
                fecha_inicial:
                  filtrosAplicados
                    .fechaInicial ||
                  undefined,
                fecha_final:
                  filtrosAplicados
                    .fechaFinal ||
                  undefined,
                cliente:
                  filtrosAplicados.cliente ||
                  undefined,
                area:
                  filtrosAplicados.area ||
                  undefined,
                referencia:
                  filtrosAplicados
                    .referencia ||
                  undefined,
                talla:
                  filtrosAplicados.talla ||
                  undefined,
                tipo:
                  filtrosAplicados.tipo ||
                  undefined,
                estado:
                  filtrosAplicados.estado ||
                  undefined,
                agrupar_por: agruparPor,
              },
            },
          )

        setResultado(respuesta.data)
      } catch (errorConsulta) {
        setResultado(null)
        setError(
          obtenerMensajeError(errorConsulta),
        )
      } finally {
        setCargando(false)
      }
    }

    consultarVentas()
  }, [filtrosAplicados, agruparPor])


  useEffect(() => {
    if (!resultado) return

    setPaginaDetalle(1)
    setPaginaCategorias(1)

    const maximo = Math.max(
      resultado.total_categorias,
      1,
    )

    setCantidadCategorias(
      (cantidadActual) =>
        Math.min(
          Math.max(cantidadActual, 1),
          maximo,
        ),
    )

    setSemanaTorta((semanaActual) =>
      semanaActual === TODO_EL_PERIODO ||
      resultado.semanas.includes(semanaActual)
        ? semanaActual
        : TODO_EL_PERIODO,
    )
  }, [resultado])


  useEffect(() => {
    setPaginaCategorias(1)
  }, [semanaTorta, tipoGrafica])


  function aplicarFiltros(
    evento: SubmitEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()

    if (
      filtros.fechaInicial &&
      filtros.fechaFinal &&
      filtros.fechaFinal <
        filtros.fechaInicial
    ) {
      setError(
        'La fecha final no puede ser anterior a la fecha inicial.',
      )
      return
    }

    setFiltrosAplicados({
      ...filtros,
    })
  }


  function limpiarFiltros() {
    const filtrosLimpios: FiltrosVentas = {
      fechaInicial: '',
      fechaFinal: '',
      cliente: '',
      area: '',
      referencia: '',
      talla: '',
      tipo: '',
      estado: '',
    }

    setFiltros(filtrosLimpios)
    setFiltrosAplicados(filtrosLimpios)
    setAgruparPor('area')
    setCantidadCategorias(5)
    setTipoGrafica('torta')
    setSemanaTorta(TODO_EL_PERIODO)
  }


  const referenciaSeleccionadaEspecifica =
    Boolean(
      filtros.referencia &&
      filtros.referencia !==
        TODAS_LAS_REFERENCIAS,
    )

  const referenciaAplicadaEspecifica =
    Boolean(
      filtrosAplicados.referencia &&
      filtrosAplicados.referencia !==
        TODAS_LAS_REFERENCIAS,
    )

  const categoriaSeleccionadaEspecifica =
    agruparPor === 'cliente'
      ? Boolean(filtros.cliente)
      : agruparPor === 'area'
        ? Boolean(filtros.area)
        : agruparPor === 'referencia'
          ? referenciaSeleccionadaEspecifica
          : agruparPor === 'estado'
            ? Boolean(filtros.estado)
            : false

  const categoriaAplicadaEspecifica =
    agruparPor === 'cliente'
      ? Boolean(filtrosAplicados.cliente)
      : agruparPor === 'area'
        ? Boolean(filtrosAplicados.area)
        : agruparPor === 'referencia'
          ? referenciaAplicadaEspecifica
          : agruparPor === 'estado'
            ? Boolean(filtrosAplicados.estado)
            : false

  const categoriaPlural =
    agruparPor === 'cliente'
      ? 'clientes'
      : agruparPor === 'area'
        ? 'áreas'
        : agruparPor === 'estado'
          ? 'estados'
          : 'referencias'

  const articuloCategorias =
    agruparPor === 'cliente' ||
    agruparPor === 'estado'
      ? 'los'
      : 'las'

  const categoriaSingular =
    agruparPor === 'cliente'
      ? 'Cliente'
      : agruparPor === 'area'
        ? 'Área'
        : agruparPor === 'estado'
          ? 'Estado'
          : 'Referencia'

  const categoriaSingularMinuscula =
    categoriaSingular.toLocaleLowerCase(
      'es-CO',
    )

  const categoriaOtras =
    agruparPor === 'cliente' ||
    agruparPor === 'estado'
      ? 'OTROS'
      : 'OTRAS'

  const maximoCategorias = Math.max(
    resultado?.total_categorias ?? 1,
    1,
  )

  const cantidadCategoriasAplicada =
    categoriaAplicadaEspecifica
      ? 1
      : Math.min(
          cantidadCategorias,
          maximoCategorias,
        )

  const semanasDisponibles =
    resultado?.semanas ?? []

  const tortaTodoElPeriodo =
    semanaTorta === TODO_EL_PERIODO

  const categoriasOrdenadasTorta =
    tortaTodoElPeriodo
      ? resultado?.categorias ?? []
      : resultado?.datos
          .filter(
            (dato) =>
              dato.semana === semanaTorta,
          )
          .sort(
            (primero, segundo) =>
              segundo.unidades -
              primero.unidades,
          ) ?? []

  const categoriasGrafica =
    tipoGrafica === 'torta'
      ? categoriasOrdenadasTorta
          .slice(
            0,
            cantidadCategoriasAplicada,
          )
          .map(
            (item) => item.categoria,
          )
      : (
          resultado?.categorias
            .slice(
              0,
              cantidadCategoriasAplicada,
            )
            .map(
              (item) => item.categoria,
            ) ?? []
        )

  const semanasGrafica =
    tipoGrafica === 'torta'
      ? [semanaTorta]
      : semanasDisponibles

  const datosPorSemana =
    new Map<string, PuntoGrafica>()

  let existenOtras = false

  semanasGrafica.forEach((semana) => {
    datosPorSemana.set(semana, {
      semana,
    })
  })

  resultado?.datos.forEach((dato) => {
    if (
      tipoGrafica === 'torta' &&
      !tortaTodoElPeriodo &&
      dato.semana !== semanaTorta
    ) {
      return
    }

    const claveSemana =
      tipoGrafica === 'torta' &&
      tortaTodoElPeriodo
        ? TODO_EL_PERIODO
        : dato.semana

    const puntoExistente =
      datosPorSemana.get(claveSemana) ?? {
        semana: claveSemana,
      }

    const categoriaGrafica =
      categoriasGrafica.includes(
        dato.categoria,
      )
        ? dato.categoria
        : categoriaOtras

    if (categoriaGrafica === categoriaOtras) {
      existenOtras = true
    }

    puntoExistente[categoriaGrafica] =
      Number(
        puntoExistente[
          categoriaGrafica
        ] ?? 0,
      ) + dato.unidades

    datosPorSemana.set(
      claveSemana,
      puntoExistente,
    )
  })

  const seriesGrafica = existenOtras
    ? [...categoriasGrafica, categoriaOtras]
    : categoriasGrafica

  const datosGrafica = Array.from(
    datosPorSemana.values(),
  )
    .map((punto) => {
      const puntoCompleto = {
        ...punto,
      }

      seriesGrafica.forEach(
        (categoria) => {
          puntoCompleto[categoria] ??= 0
        },
      )

      return puntoCompleto
    })
    .sort((primero, segundo) =>
      String(primero.semana).localeCompare(
        String(segundo.semana),
      ),
    )

  const datosTorta: PuntoTorta[] =
    seriesGrafica
      .map((categoria) => ({
        categoria,
        unidades: Number(
          datosGrafica[0]?.[
            categoria
          ] ?? 0,
        ),
      }))
      .filter(
        (dato) => dato.unidades > 0,
      )

  const totalUnidadesTorta =
    datosTorta.reduce(
      (total, dato) =>
        total + dato.unidades,
      0,
    )

  const totalPaginasDetalle =
    Math.max(
      Math.ceil(
        (resultado?.datos.length ?? 0) /
          FILAS_POR_PAGINA,
      ),
      1,
    )

  const datosDetallePagina =
    resultado?.datos.slice(
      (paginaDetalle - 1) *
        FILAS_POR_PAGINA,
      paginaDetalle *
        FILAS_POR_PAGINA,
    ) ?? []

  const categoriasResumenVista =
    tipoGrafica === 'torta' &&
    !tortaTodoElPeriodo
      ? categoriasOrdenadasTorta
      : resultado?.categorias ?? []

  const totalPaginasCategorias =
    Math.max(
      Math.ceil(
        categoriasResumenVista.length /
          FILAS_POR_PAGINA,
      ),
      1,
    )

  const categoriasPagina =
    categoriasResumenVista.slice(
      (paginaCategorias - 1) *
        FILAS_POR_PAGINA,
      paginaCategorias *
        FILAS_POR_PAGINA,
    )


  return (
    <section className="pagina-ventas">
      <div className="titulo-pagina">
        <div>
          <h2>Estadísticas de pedidos</h2>

          <p>
            Unidades radicadas agrupadas
            según los filtros seleccionados
          </p>
        </div>
      </div>

      <div className="distribucion-ventas">
        <div className="columna-ventas-principal">
          <form
            className={
              'panel-filtros ' +
              'panel-filtros-ventas'
            }
            onSubmit={aplicarFiltros}
          >
            <div className="contenido-filtros">
              <div
                className={
                  'fila-filtros ' +
                  'fila-filtros-ventas-principal'
                }
              >
                <div className="campo-filtro">
                  <label htmlFor="ventaFechaInicial">
                    Fecha inicial
                  </label>

                  <input
                    id="ventaFechaInicial"
                    type="date"
                    value={
                      filtros.fechaInicial
                    }
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          fechaInicial:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  />
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaFechaFinal">
                    Fecha final
                  </label>

                  <input
                    id="ventaFechaFinal"
                    type="date"
                    value={
                      filtros.fechaFinal
                    }
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          fechaFinal:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  />
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaEstado">
                    Estado del pedido
                  </label>

                  <select
                    id="ventaEstado"
                    value={filtros.estado}
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          estado:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  >
                    <option value="">
                      Todos
                    </option>

                    {opciones.estados.map(
                      (estado) => (
                        <option
                          key={estado}
                          value={estado}
                        >
                          {estado}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaCliente">
                    Cliente
                  </label>

                  <select
                    id="ventaCliente"
                    value={filtros.cliente}
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          cliente:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  >
                    <option value="">
                      Todos
                    </option>

                    {opciones.clientes.map(
                      (cliente) => (
                        <option
                          key={cliente}
                          value={cliente}
                        >
                          {cliente}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaArea">
                    Área
                  </label>

                  <select
                    id="ventaArea"
                    value={filtros.area}
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          area:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  >
                    <option value="">
                      Todas
                    </option>

                    {opciones.areas.map(
                      (area) => (
                        <option
                          key={area}
                          value={area}
                        >
                          {area}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaReferencia">
                    Referencia
                  </label>

                  <select
                    id="ventaReferencia"
                    value={
                      filtros.referencia
                    }
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          referencia:
                            evento.target
                              .value,
                          talla: '',
                          tipo: '',
                        }),
                      )
                    }
                  >
                    <option value="">
                      Seleccione una referencia
                    </option>

                    <option
                      value={
                        TODAS_LAS_REFERENCIAS
                      }
                    >
                      Todas las referencias
                    </option>

                    {opciones.referencias.map(
                      (referencia) => (
                        <option
                          key={referencia}
                          value={referencia}
                        >
                          {referencia}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaTalla">
                    Talla
                  </label>

                  <select
                    id="ventaTalla"
                    value={filtros.talla}
                    disabled={
                      !referenciaSeleccionadaEspecifica
                    }
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          talla:
                            evento.target
                              .value,
                          tipo: '',
                        }),
                      )
                    }
                  >
                    <option value="">
                      {referenciaSeleccionadaEspecifica
                        ? 'Todas'
                        : 'Seleccione una referencia específica'}
                    </option>

                    {opciones.tallas.map(
                      (talla) => (
                        <option
                          key={talla}
                          value={talla}
                        >
                          {talla}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="ventaTipo">
                    Tipo
                  </label>

                  <select
                    id="ventaTipo"
                    value={filtros.tipo}
                    disabled={
                      !filtros.referencia
                    }
                    onChange={(evento) =>
                      setFiltros(
                        (actuales) => ({
                          ...actuales,
                          tipo:
                            evento.target
                              .value,
                        }),
                      )
                    }
                  >
                    <option value="">
                      {filtros.referencia
                        ? 'Todos'
                        : 'Seleccione una referencia'}
                    </option>

                    {opciones.tipos.map(
                      (tipo) => (
                        <option
                          key={tipo}
                          value={tipo}
                        >
                          {tipo}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              <div
                className={
                  'fila-filtros ' +
                  'fila-filtros-ventas-grafica'
                }
              >
                <div className="campo-filtro">
                  <label htmlFor="agruparPor">
                    Agrupar gráfica por
                  </label>

                  <select
                    id="agruparPor"
                    value={agruparPor}
                    onChange={(evento) =>
                      setAgruparPor(
                        evento.target
                          .value as Agrupacion,
                      )
                    }
                  >
                    <option value="referencia">
                      Referencia
                    </option>

                    <option value="cliente">
                      Cliente
                    </option>

                    <option value="area">
                      Área
                    </option>

                    <option value="estado">
                      Estado del pedido
                    </option>
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="tipoGrafica">
                    Tipo de gráfica
                  </label>

                  <select
                    id="tipoGrafica"
                    value={tipoGrafica}
                    onChange={(evento) =>
                      setTipoGrafica(
                        evento.target
                          .value as TipoGrafica,
                      )
                    }
                  >
                    <option value="barras-apiladas">
                      Barras apiladas
                    </option>

                    <option value="barras-agrupadas">
                      Barras agrupadas
                    </option>

                    <option value="lineas">
                      Líneas
                    </option>

                    <option value="torta">
                      Torta
                    </option>
                  </select>
                </div>

                <div className="campo-filtro">
                  <label htmlFor="cantidadCategorias">
                    {categoriaSingular}s en gráfica
                  </label>

                  <input
                    id="cantidadCategorias"
                    type="number"
                    min={1}
                    max={maximoCategorias}
                    value={
                      categoriaSeleccionadaEspecifica
                        ? 1
                        : cantidadCategorias
                    }
                    disabled={
                      categoriaSeleccionadaEspecifica
                    }
                    onChange={(evento) => {
                      const cantidad = Number(
                        evento.target.value,
                      )

                      setCantidadCategorias(
                        Math.min(
                          Math.max(
                            cantidad || 1,
                            1,
                          ),
                          maximoCategorias,
                        ),
                      )
                    }}
                  />

                  <small>
                    Máximo disponible:{' '}
                    {maximoCategorias}
                  </small>
                </div>

                {tipoGrafica === 'torta' && (
                  <div className="campo-filtro">
                    <label htmlFor="semanaTorta">
                      Periodo para la torta
                    </label>

                    <select
                      id="semanaTorta"
                      value={semanaTorta}
                      onChange={(evento) =>
                        setSemanaTorta(
                          evento.target.value,
                        )
                      }
                    >
                      <option value={TODO_EL_PERIODO}>
                        Todo el periodo
                      </option>

                      {semanasDisponibles.map(
                        (semana) => (
                          <option
                            key={semana}
                            value={semana}
                          >
                            {formatearSemana(
                              semana,
                            )}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div
              className={
                'acciones-filtros ' +
                'acciones-filtros-ventas'
              }
            >
              <button
                type="submit"
                className="boton-principal"
              >
                Consultar
              </button>

              <button
                type="button"
                className="boton-secundario"
                onClick={limpiarFiltros}
              >
                Limpiar
              </button>
            </div>
          </form>

          {cargando && (
            <div className="mensaje-estado">
              Consultando producción...
            </div>
          )}

          {error && (
            <div className="mensaje-error">
              {error}
            </div>
          )}

          {!cargando &&
            !error &&
            resultado && (
              <>
                <div className="resumen-ventas">
                  <div className="tarjeta-indicador">
                    <span>
                      Total de unidades
                    </span>

                    <strong>
                      {resultado.total_unidades
                        .toLocaleString(
                          'es-CO',
                        )}
                    </strong>
                  </div>

                  <div className="tarjeta-indicador">
                    <span>
                      Semanas del periodo
                    </span>

                    <strong>
                      {resultado.total_semanas}
                    </strong>
                  </div>

                  <div className="tarjeta-indicador">
                    <span>
                      {categoriaSingular}s
                    </span>

                    <strong>
                      {
                        resultado
                          .total_categorias
                      }
                    </strong>
                  </div>
                </div>

                {resultado.datos.length >
                0 ? (
                  <div className="grafica-ventas">
                    <div className="encabezado-grafica">
                      <h3>
                        {tipoGrafica ===
                        'torta'
                          ? (
                              'Distribución de ' +
                              'unidades por ' +
                              `${categoriaSingularMinuscula} — ` +
                              (
                                tortaTodoElPeriodo
                                  ? 'Todo el periodo'
                                  : formatearSemana(
                                      semanaTorta,
                                    )
                              )
                            )
                          : (
                              'Unidades por semana y ' +
                              categoriaSingularMinuscula
                            )}
                      </h3>

                      <p>
                        Se muestran {articuloCategorias}{' '}
                        {Math.min(
                          cantidadCategoriasAplicada,
                          categoriasGrafica.length,
                        )}{' '}
                        {categoriaPlural} con más
                        unidades
                        {existenOtras
                          ? (
                              ' y las restantes ' +
                              `se agrupan como ${categoriaOtras}.`
                            )
                          : '.'}
                      </p>
                    </div>

                    {tipoGrafica ===
                    'torta' ? (
                      datosTorta.length >
                      0 ? (
                        <ResponsiveContainer
                          width="100%"
                          height={
                            ALTURA_GRAFICA
                          }
                        >
                          <PieChart>
                            <Pie
                              data={datosTorta}
                              dataKey="unidades"
                              nameKey="categoria"
                              cx="48%"
                              cy="50%"
                              outerRadius={285}
                              paddingAngle={1}
                            >
                              {datosTorta.map(
                                (
                                  dato,
                                  indice,
                                ) => (
                                  <Cell
                                    key={
                                      dato.categoria
                                    }
                                    fill={
                                      colorDeCategoria(
                                        dato.categoria,
                                        indice,
                                        categoriaOtras,
                                      )
                                    }
                                  />
                                ),
                              )}
                            </Pie>

                            <Tooltip
                              formatter={(
                                valor,
                              ) =>
                                Number(
                                  valor ??
                                    0,
                                ).toLocaleString(
                                  'es-CO',
                                )
                              }
                            />

                            <Legend
                              layout="vertical"
                              align="right"
                              verticalAlign="middle"
                              iconType="square"
                              wrapperStyle={{
                                width: '38%',
                                paddingLeft: 24,
                                lineHeight: '2.2',
                                fontSize: '0.88rem',
                              }}
                              formatter={(valor) => {
                                const dato =
                                  datosTorta.find(
                                    (item) =>
                                      item.categoria ===
                                      String(valor),
                                  )

                                if (!dato) {
                                  return String(valor)
                                }

                                const porcentaje =
                                  totalUnidadesTorta > 0
                                    ? (
                                        dato.unidades /
                                        totalUnidadesTorta
                                      ) * 100
                                    : 0

                                return (
                                  `${dato.categoria}: ` +
                                  `${porcentaje.toFixed(1)}% · ` +
                                  dato.unidades.toLocaleString(
                                    'es-CO',
                                  ) +
                                  ' unidades'
                                )
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="sin-datos-ventas">
                          Esta semana no
                          contiene unidades.
                        </div>
                      )
                    ) : tipoGrafica ===
                      'lineas' ? (
                      <ResponsiveContainer
                        width="100%"
                        height={
                          ALTURA_GRAFICA
                        }
                      >
                        <LineChart
                          data={datosGrafica}
                          margin={{
                            top: 20,
                            right: 20,
                            left: 20,
                            bottom: 10,
                          }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#b6b09f"
                          />

                          <XAxis
                            dataKey="semana"
                            tickFormatter={
                              formatearSemana
                            }
                            minTickGap={28}
                            tickMargin={6}
                          />

                          <YAxis
                            tickFormatter={(
                              valor,
                            ) =>
                              Number(
                                valor,
                              ).toLocaleString(
                                'es-CO',
                              )
                            }
                          />

                          <Tooltip
                            labelFormatter={(
                              valor,
                            ) =>
                              `Semana: ${formatearSemana(
                                String(
                                  valor,
                                ),
                              )}`
                            }
                            formatter={(
                              valor,
                            ) =>
                              Number(
                                valor ??
                                  0,
                              ).toLocaleString(
                                'es-CO',
                              )
                            }
                          />

                          <Legend />

                          {seriesGrafica.map(
                            (
                              categoria,
                              indice,
                            ) => (
                              <Line
                                key={
                                  categoria
                                }
                                type="linear"
                                dataKey={
                                  categoria
                                }
                                stroke={
                                  colorDeCategoria(
                                    categoria,
                                    indice,
                                    categoriaOtras,
                                  )
                                }
                                strokeDasharray={
                                  categoria ===
                                  categoriaOtras
                                    ? '7 5'
                                    : undefined
                                }
                                strokeWidth={2}
                                dot={
                                  resultado.total_semanas <=
                                  20
                                }
                                connectNulls={
                                  false
                                }
                              />
                            ),
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <ResponsiveContainer
                        width="100%"
                        height={
                          ALTURA_GRAFICA
                        }
                      >
                        <BarChart
                          data={datosGrafica}
                          margin={{
                            top: 20,
                            right: 20,
                            left: 20,
                            bottom: 20,
                          }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#b6b09f"
                          />

                          <XAxis
                            dataKey="semana"
                            tickFormatter={
                              formatearSemana
                            }
                            minTickGap={28}
                          />

                          <YAxis
                            tickFormatter={(
                              valor,
                            ) =>
                              Number(
                                valor,
                              ).toLocaleString(
                                'es-CO',
                              )
                            }
                          />

                          <Tooltip
                            labelFormatter={(
                              valor,
                            ) =>
                              `Semana: ${formatearSemana(
                                String(
                                  valor,
                                ),
                              )}`
                            }
                            formatter={(
                              valor,
                            ) =>
                              Number(
                                valor ??
                                  0,
                              ).toLocaleString(
                                'es-CO',
                              )
                            }
                          />

                          <Legend />

                          {seriesGrafica.map(
                            (
                              categoria,
                              indice,
                            ) => (
                              <Bar
                                key={
                                  categoria
                                }
                                dataKey={
                                  categoria
                                }
                                stackId={
                                  tipoGrafica ===
                                  'barras-apiladas'
                                    ? 'unidades'
                                    : undefined
                                }
                                fill={
                                  colorDeCategoria(
                                    categoria,
                                    indice,
                                    categoriaOtras,
                                  )
                                }
                              />
                            ),
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                ) : (
                  <div className="sin-datos-ventas">
                    No se encontraron registros
                    para los filtros
                    seleccionados.
                  </div>
                )}
              </>
            )}
        </div>

        <aside className="columna-ventas-detalle">
          {!cargando &&
            !error &&
            resultado &&
            resultado.datos.length >
              0 && (
              <>
                <div
                  className={
                    'bloque-tabla-ventas ' +
                    'tabla-detalle-semanal'
                  }
                >
                  <h3>Detalle semanal</h3>

                  <div className="contenedor-tabla">
                    <table className="tabla-radicados">
                      <thead>
                        <tr>
                          <th>Semana</th>
                          <th>
                            {categoriaSingular}
                          </th>
                          <th>Unidades</th>
                        </tr>
                      </thead>

                      <tbody>
                        {datosDetallePagina.map(
                          (dato) => (
                            <tr
                              key={
                                `${dato.semana}-` +
                                dato.categoria
                              }
                            >
                              <td>
                                {formatearSemana(
                                  dato.semana,
                                )}
                              </td>

                              <td>
                                {dato.categoria}
                              </td>

                              <td>
                                {dato.unidades
                                  .toLocaleString(
                                    'es-CO',
                                  )}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>

                  {totalPaginasDetalle >
                    1 && (
                    <div className="paginacion-tabla">
                      <button
                        type="button"
                        disabled={
                          paginaDetalle ===
                          1
                        }
                        onClick={() =>
                          setPaginaDetalle(
                            (actual) =>
                              actual - 1,
                          )
                        }
                      >
                        ← Anterior
                      </button>

                      <span>
                        {paginaDetalle} de{' '}
                        {
                          totalPaginasDetalle
                        }
                      </span>

                      <button
                        type="button"
                        disabled={
                          paginaDetalle >=
                          totalPaginasDetalle
                        }
                        onClick={() =>
                          setPaginaDetalle(
                            (actual) =>
                              actual + 1,
                          )
                        }
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className={
                    'bloque-tabla-ventas ' +
                    'tabla-total-referencias'
                  }
                >
                  <h3>
                    Total por{' '}
                    {categoriaSingularMinuscula}
                    {tipoGrafica === 'torta'
                      ? (
                          ' — ' +
                          (tortaTodoElPeriodo
                            ? 'Todo el periodo'
                            : formatearSemana(
                                semanaTorta,
                              ))
                        )
                      : ''}
                  </h3>

                  <div className="contenedor-tabla">
                    <table className="tabla-radicados">
                      <thead>
                        <tr>
                          <th>
                            {categoriaSingular}
                          </th>
                          <th>
                            Total de unidades
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {categoriasPagina.map(
                          (item) => (
                            <tr
                              key={
                                item.categoria
                              }
                            >
                              <td>
                                {
                                  item.categoria
                                }
                              </td>

                              <td>
                                {item.unidades
                                  .toLocaleString(
                                    'es-CO',
                                  )}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>

                  {totalPaginasCategorias >
                    1 && (
                    <div className="paginacion-tabla">
                      <button
                        type="button"
                        disabled={
                          paginaCategorias ===
                          1
                        }
                        onClick={() =>
                          setPaginaCategorias(
                            (actual) =>
                              actual - 1,
                          )
                        }
                      >
                        ← Anterior
                      </button>

                      <span>
                        {paginaCategorias} de{' '}
                        {
                          totalPaginasCategorias
                        }
                      </span>

                      <button
                        type="button"
                        disabled={
                          paginaCategorias >=
                          totalPaginasCategorias
                        }
                        onClick={() =>
                          setPaginaCategorias(
                            (actual) =>
                              actual + 1,
                          )
                        }
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
        </aside>
      </div>
    </section>
  )
}


export default VentasSemanalesPage
