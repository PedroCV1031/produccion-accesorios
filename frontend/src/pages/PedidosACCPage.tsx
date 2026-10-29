import { useEffect, useState } from 'react'
import api from '../services/api'
import { Link } from 'react-router-dom'
import './ConsultasACC.css'

type Pedido = Record<string, string | number | null>
const claseEstado = (estado: string) => {
  const e = estado.toLocaleLowerCase('es').trim()
  if (e === 'entregado a tiempo') return 'estado-exito'
  if (e === 'entregado tarde' || e === 'vencido sin entregar') return 'estado-alerta'
  if (e === 'entrega próxima') return 'estado-proximo'
  if (e === 'entregado' || e === 'entregado sin fecha') return 'estado-entregado'
  return 'estado-proceso'
}
const columnas: [string, string][] = [
  ['fecha_pedido', 'Fecha pedido'], ['fecha_solicitada', 'Solicitada'], ['fecha_comprometida', 'Comprometida'],
  ['cliente', 'Cliente'], ['comercial', 'Comercial'], ['orden_compra', 'Orden compra'], ['referencia', 'Referencia'],
  ['acabado_talla', 'Acabado/talla'], ['color_codigo', 'Color/código'], ['cantidad_solicitada', 'Cantidad solicitada'],
  ['fecha_ultima_entrega', 'Última entrega'], ['cantidad_entregada_acumulada', 'Entregado'], ['factura', 'Factura'],
]
type Filtros = { cliente: string; referencia: string; orden: string; comercial: string; acabado: string; color: string; desde: string; hasta: string; estado: string }
type Preferencias = { pagina: number; porPagina: number; ordenar: string; direccion: string }
const inicialFiltros: Filtros = { cliente:'', referencia:'', orden:'', comercial:'', acabado:'', color:'', desde:'', hasta:'', estado:'' }
const inicialPreferencias: Preferencias = { pagina:1, porPagina:50, ordenar:'fecha_pedido', direccion:'desc' }
const CLAVE_GUARDADO = 'acc.pedidos.filtros'
const CLAVE_BORRADOR = 'acc.pedidos.borrador'
function restaurar(clave: string) {
  try { return JSON.parse(sessionStorage.getItem(clave) || '{}') as Partial<Filtros & Preferencias> } catch { return {} }
}

export default function PedidosACCPage() {
  // La consulta aplicada se recuerda incluso cuando la página se desmonta al navegar a Parciales.
  const [filtrosAplicados, setFiltrosAplicados] = useState<Filtros>(() => ({ ...inicialFiltros, ...restaurar(CLAVE_GUARDADO) }))
  const [filtros, setFiltros] = useState<Filtros>(() => ({ ...inicialFiltros, ...restaurar(CLAVE_GUARDADO), ...restaurar(CLAVE_BORRADOR) }))
  const [prefs, setPrefs] = useState<Preferencias>(() => ({ ...inicialPreferencias, ...restaurar(CLAVE_GUARDADO) }))
  const [datos, setDatos] = useState<Pedido[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [opciones, setOpciones] = useState<Record<string, string[]>>({})

  useEffect(() => {
    sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ ...filtrosAplicados, ...prefs }))
  }, [filtrosAplicados, prefs])
  useEffect(() => { sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify(filtros)) }, [filtros])
  useEffect(() => { void api.get('/api/consultas-acc/opciones-filtros').then(r => setOpciones(r.data)).catch(() => {}) }, [])

  useEffect(() => {
    let activo = true
    async function cargar() {
      setCargando(true)
      setError('')
      try {
        const { data } = await api.get('/api/consultas-acc/pedidos', {
          params: {
            pagina: prefs.pagina, por_pagina: prefs.porPagina,
            cliente: filtrosAplicados.cliente || undefined,
            referencia: filtrosAplicados.referencia || undefined,
            orden_compra: filtrosAplicados.orden || undefined,
            comercial: filtrosAplicados.comercial || undefined,
            acabado_talla: filtrosAplicados.acabado || undefined,
            color_codigo: filtrosAplicados.color || undefined,
            fecha_inicio: filtrosAplicados.desde || undefined,
            fecha_fin: filtrosAplicados.hasta || undefined,
            estado: filtrosAplicados.estado || undefined,
            ordenar: prefs.ordenar, direccion: prefs.direccion,
          },
        })
        if (activo) { setDatos(data.pedidos); setTotal(data.total) }
      } catch { if (activo) setError('No fue posible cargar los pedidos.') }
      finally { if (activo) setCargando(false) }
    }
    void cargar()
    return () => { activo = false }
  }, [filtrosAplicados, prefs])

  const actualizarFiltro = (clave: keyof Filtros, valor: string) => setFiltros(anterior => ({ ...anterior, [clave]: valor }))
  function aplicar(e: React.FormEvent) {
    e.preventDefault()
    setFiltrosAplicados({ ...filtros })
    setPrefs(p => ({ ...p, pagina: 1 }))
  }
  function limpiar() {
    setFiltros({ ...inicialFiltros })
    setFiltrosAplicados({ ...inicialFiltros })
    setPrefs({ ...inicialPreferencias })
  }
  const paginas = Math.max(1, Math.ceil(total / prefs.porPagina))

  return <section className="consultas-acc consultas-pedidos">
    <header className="cabecera-consulta"><div><h1>Pedidos</h1><p>Tabla completa de pedidos almacenados en MongoDB.</p></div><strong>{total.toLocaleString('es-CO')} pedidos</strong></header>
    <form className="filtros-consulta filtros-pedidos-acc" onSubmit={aplicar}>
      <label>Cliente<select value={filtros.cliente} onChange={e => actualizarFiltro('cliente', e.target.value)}><option value="">Todos</option>{(opciones.cliente || []).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Orden de compra<input value={filtros.orden} onChange={e => actualizarFiltro('orden', e.target.value)} placeholder="N.º de orden" /></label>
      <label>Comercial<select value={filtros.comercial} onChange={e => actualizarFiltro('comercial', e.target.value)}><option value="">Todos</option>{(opciones.comercial || []).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Referencia<select value={filtros.referencia} onChange={e => actualizarFiltro('referencia', e.target.value)}><option value="">Todas</option>{(opciones.referencia || []).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Acabado/talla<select value={filtros.acabado} onChange={e => actualizarFiltro('acabado', e.target.value)}><option value="">Todos</option>{(opciones.acabado_talla || []).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Color<select value={filtros.color} onChange={e => actualizarFiltro('color', e.target.value)}><option value="">Todos</option>{(opciones.color_codigo || []).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Estado<select value={filtros.estado} onChange={e => actualizarFiltro('estado', e.target.value)}><option value="">Todos</option>{(opciones.estados || []).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Fecha inicial<input type="date" value={filtros.desde} onChange={e => actualizarFiltro('desde', e.target.value)} /></label>
      <label>Fecha final<input type="date" value={filtros.hasta} onChange={e => actualizarFiltro('hasta', e.target.value)} /></label>
      <label>Ordenar<select value={prefs.ordenar} onChange={e => setPrefs(p => ({ ...p, ordenar:e.target.value, pagina:1 }))}>{columnas.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      <label>Dirección<select value={prefs.direccion} onChange={e => setPrefs(p => ({ ...p, direccion:e.target.value, pagina:1 }))}><option value="desc">Descendente</option><option value="asc">Ascendente</option></select></label>
      <label>Por página<select value={prefs.porPagina} onChange={e => setPrefs(p => ({ ...p, porPagina:Number(e.target.value), pagina:1 }))}>{[5,10,20,50,100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button type="submit">Aplicar filtros</button><button type="button" className="boton-limpiar-filtros" onClick={limpiar}>Limpiar</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {cargando ? <p>Cargando pedidos…</p> : <div className="tabla-scroll"><table className="tabla-pedidos-acc"><thead><tr><th>ID</th>{columnas.map(([clave, nombre]) => <th key={clave}>{nombre}</th>)}<th>Pendiente</th><th>Estado</th><th>Historial</th></tr></thead>
      <tbody>{datos.map(p => <tr key={String(p.id)}><td title={String(p.id)}>{String(p.id).slice(-8)}</td>{columnas.map(([clave]) => <td key={clave}>{p[clave] == null ? '—' : typeof p[clave] === 'number' ? Number(p[clave]).toLocaleString('es-CO') : String(p[clave])}</td>)}<td>{(Number(p.cantidad_solicitada || 0) - Number(p.cantidad_entregada_acumulada || 0)).toLocaleString('es-CO')}</td><td><span className={`estado-pedido-acc ${claseEstado(String(p.estado || ''))}`}>{String(p.estado || '—')}</span></td><td><Link to={`/parciales/${p.id}`}>Ver parciales</Link></td></tr>)}</tbody>
    </table>{datos.length === 0 && <p>Sin pedidos para estos filtros.</p>}</div>}
    <div className="paginacion"><button disabled={prefs.pagina <= 1 || cargando} onClick={() => setPrefs(p => ({ ...p, pagina:p.pagina - 1 }))}>Anterior</button><span>Página {prefs.pagina} de {paginas}</span><button disabled={prefs.pagina >= paginas || cargando} onClick={() => setPrefs(p => ({ ...p, pagina:p.pagina + 1 }))}>Siguiente</button></div>
  </section>
}
