import { useMemo, useRef, useState } from 'react'
import api from '../services/api'
import './ConciliacionACCPage.css'

type Datos = Record<string, unknown>
type Movimiento = { tipo: string; cantidad: number } | null
type Relacionada = { origen: string; datos: Datos }
type Item = {
  origen: string; accion: string; pedido_id: string | null;
  candidatos_ids: string[]; candidatos_detalle?: {id: string; datos: Datos; identidad: Datos}[];
  datos_fila?: Datos; filas_relacionadas?: Relacionada[];
  motivo: string; cambios: Record<string, unknown>;
  movimiento: Movimiento; advertencias: string[]
}
type ErrorFila = { fila: number; motivo: string; datos_originales?: Datos; excluida?: boolean }
type Preview = {
  modo: string; confirmacion_habilitada: boolean; permiso_servidor?: boolean; exclusiones_invalidas_aplicadas?: string[]; tipo_confirmacion?: 'piloto' | 'masiva';
  validacion: {hojas_disponibles: string[]; total_validas: number; total_invalidas: number;
    hojas: {hoja: string; errores?: ErrorFila[]}[]};
  conciliacion: {items: Item[]; resumen: Record<string, number>; bloqueado: boolean};
  mensaje: string;
  resumen_definitivo?: {pedidos_nuevos:number;pedidos_existentes:number;filas_excluidas:number;filas_invalidas_excluidas:number;filas_invalidas_pendientes:number;casos_sin_resolver:number;saldos_iniciales:number;parciales_nuevos:number};
  listo_para_futura_confirmacion?: boolean
}
const numerar = (n: number) => new Intl.NumberFormat('es-CO').format(n)
const valor = (v: unknown) => v === null || v === undefined || v === '' ? '—' : String(v)
const campos: [string,string][] = [
  ['cliente','Cliente'], ['orden_compra','Orden de compra'], ['referencia','Referencia'],
  ['acabado_talla','Acabado / talla'], ['color_codigo','Color'], ['fecha_pedido','Fecha pedido'],
  ['cantidad_solicitada','Solicitado'], ['cantidad_entregada_acumulada','Entregado'],
  ['fecha_ultima_entrega','Última entrega'], ['factura','Factura']
]
function descargarCSV(nombre: string, encabezados: string[], filas: unknown[][]) {
  const celda = (v: unknown) => {
    const texto = v === null || v === undefined ? '' : String(v)
    // Evita que Excel interprete como formulas los valores de origen.
    const seguro = /^[\s]*[=+@]/.test(texto) || /^[\s]*-(?!\d)/.test(texto) ? "'" + texto : texto
    return '"' + seguro.replaceAll('"', '""') + '"'
  }
  const csv = '\uFEFF' + [encabezados, ...filas].map(f => f.map(celda).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}))
  const link = document.createElement('a'); link.href = url; link.download = nombre; link.click()
  URL.revokeObjectURL(url)
}
const etiqueta = (clave: string) => campos.find(([k]) => k === clave)?.[1] || clave.replaceAll('_',' ')
function DetalleDatos({datos}: {datos: Datos}) {
  return <div className="acc-detail-grid">{campos.map(([k,n]) => <div key={k}><span>{n}</span><strong>{valor(datos[k])}</strong></div>)}</div>
}
export default function ConciliacionACCPage() {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vista, setVista] = useState<Preview | null>(null)
  const [resoluciones, setResoluciones] = useState<Record<string,string>>({})
  const [exclusionesInvalidas, setExclusionesInvalidas] = useState<string[]>([])
  const [cambiosPendientes, setCambiosPendientes] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [resultadoConfirmacion, setResultadoConfirmacion] = useState('')
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('ambiguo')
  const [mostrarDetalle, setMostrarDetalle] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [mostrarErrores, setMostrarErrores] = useState(false)
  const [detalle, setDetalle] = useState<string | null>(null)
  const [erroresAbiertos, setErroresAbiertos] = useState<Record<string,boolean>>({})
  const [archivoAnterior, setArchivoAnterior] = useState('')
  const evaluacionActual = useRef(0)
  const claveArchivo = (f:File) => `${f.name}:${f.size}:${f.lastModified}`
  async function confirmarPiloto() {
    if (!archivo || !vista?.confirmacion_habilitada || cambiosPendientes) return
    if (!window.confirm('¿Guardar los pedidos revisados en MongoDB? Los registros inválidos se omiten automáticamente.')) return
    setConfirmando(true); setError(''); setResultadoConfirmacion('')
    try {
      const form = new FormData()
      form.append('file', archivo)
      form.append('resoluciones_json', JSON.stringify(resoluciones))
      form.append('exclusiones_invalidas_json', JSON.stringify(exclusionesInvalidas))
      const respuesta = await api.post<{confirmado:boolean; resumen:Record<string,number>}>((vista?.tipo_confirmacion === 'masiva' ? '/api/conciliacion-acc/confirmar-masivo' : '/api/conciliacion-acc/confirmar-piloto'), form)
      setResultadoConfirmacion('Importación completada. ' + JSON.stringify(respuesta.data.resumen))
      setVista(null)
    } catch (err: unknown) {
      const fallo = err as {response?: {data?: {detail?: string}}; message?: string}
      setError((fallo.response?.data?.detail || fallo.message || 'No se completó la confirmación') + '. Si se interrumpió, vuelve a confirmar el mismo archivo y las mismas decisiones para reanudar.')
    } finally { setConfirmando(false) }
  }
  async function previsualizar(decisiones: Record<string,string> = {}, exclusiones: string[] | null = null) {
    if (!archivo) return
    const numeroEvaluacion = ++evaluacionActual.current
    setCargando(true); setError(''); setCambiosPendientes(true)
    try {
      const form = new FormData()
      form.append('file', archivo)
      form.append('resoluciones_json', JSON.stringify(decisiones))
      form.append('exclusiones_invalidas_json', JSON.stringify(exclusiones))
      const respuesta = await api.post<Preview>('/api/conciliacion-acc/previsualizar', form)
      if (numeroEvaluacion !== evaluacionActual.current) return
      setVista(respuesta.data); if ((respuesta.data.resumen_definitivo?.casos_sin_resolver || 0) > 0) { setMostrarDetalle(true); setFiltro('ambiguo') }; setResoluciones(decisiones); setExclusionesInvalidas(respuesta.data.exclusiones_invalidas_aplicadas || []); setCambiosPendientes(false); setPagina(1)
      setArchivoAnterior(claveArchivo(archivo))
    } catch (err: unknown) {
      const fallo = err as {response?: {data?: {detail?: string}}; message?: string}
      if (numeroEvaluacion === evaluacionActual.current) setError(fallo.response?.data?.detail || fallo.message || 'No fue posible previsualizar el Excel')
    } finally { if (numeroEvaluacion === evaluacionActual.current) setCargando(false) }
  }
  const items = vista?.conciliacion.items || []
  const gruposRepetidos = useMemo(() => {
    const vistos = new Set<string>()
    const grupos: Item[] = []
    for (const item of items) {
      const claves = [item.origen, ...(item.filas_relacionadas || []).map(f => f.origen)]
      if (claves.length < 2) continue
      const clave = [...claves].sort().join('|')
      if (!vistos.has(clave)) { vistos.add(clave); grupos.push(item) }
    }
    return grupos
  }, [items])
  function exportarInvalidas() {
    if (!vista) return
    const filas = vista.validacion.hojas.flatMap(h => (h.errores || []).map(e => [
      h.hoja, e.fila, e.motivo, ...campos.map(([c]) => e.datos_originales?.[c] ?? ''),
      exclusionesInvalidas.includes(`${h.hoja}:${e.fila}`) ? 'EXCLUIDA' : 'PENDIENTE'
    ]))
    descargarCSV('ACC_filas_invalidas.csv', ['Hoja','Fila','Motivo',...campos.map(([,t])=>t),'Estado'], filas)
  }
  function exportarGrupos() {
    const filas = gruposRepetidos.flatMap((grupo, index) => [grupo.origen, ...(grupo.filas_relacionadas||[]).map(f=>f.origen)].map(origen => {
      const item = items.find(i => i.origen === origen)
      return [index+1, origen, ...campos.map(([c]) => item?.datos_fila?.[c] ?? ''), item?.accion || '', resoluciones[origen] || 'PENDIENTE']
    }))
    descargarCSV('ACC_grupos_ambiguos.csv', ['Grupo','Origen',...campos.map(([,t])=>t),'Clasificacion','Decision'], filas)
  }
  const filtrados = useMemo(() => items.filter(i =>
    (filtro === 'todos' || (filtro === 'grupos' ? (i.filas_relacionadas || []).length > 0 : i.accion === filtro)) &&
    (!busqueda || [i.origen,i.motivo,i.pedido_id,...Object.values(i.datos_fila || {})].join(' ').toLowerCase().includes(busqueda.toLowerCase()))
  ), [items, filtro, busqueda])
  const paginas = Math.max(1, Math.ceil(filtrados.length / 50))
  const visibles = filtrados.slice((Math.min(pagina,paginas) - 1) * 50, Math.min(pagina,paginas) * 50)
  function clavesGrupo(item:Item):string[] {
    return [item.origen,...(item.filas_relacionadas||[]).map(x=>x.origen)]
  }
  const pendientesResolucion = items.filter(i => (i.accion === 'ambiguo' || i.accion === 'revision') && !resoluciones[i.origen])
  function decidirTodos(opcion: 'NUEVO' | 'EXCLUIR') {
    if (!pendientesResolucion.length) return
    if (opcion === 'EXCLUIR' && !window.confirm(`Se excluirán ${pendientesResolucion.length} filas ambiguas pendientes. ¿Continuar?`)) return
    const siguiente = {...resoluciones}
    pendientesResolucion.forEach(i => { siguiente[i.origen] = opcion })
    setResoluciones(siguiente)
    void previsualizar(siguiente, exclusionesInvalidas)
  }
  function decidirGrupo(item:Item, opcion:'separados'|'duplicado'|'pendiente') {
    const claves=clavesGrupo(item)
    const siguiente={...resoluciones}
    if(opcion==='separados') claves.forEach(c=>siguiente[c]='NUEVO')
    if(opcion==='pendiente') claves.forEach(c=>delete siguiente[c])
    if(opcion==='duplicado') {
      // De manera explícita se conserva la fila seleccionada y se excluyen las restantes.
      claves.forEach(c=>siguiente[c]= c===item.origen?'NUEVO':'EXCLUIR')
    }
    setResoluciones(siguiente);void previsualizar(siguiente, exclusionesInvalidas)
  }
  return <section className="acc-page">
    <header className="acc-heading"><div><p className="acc-eyebrow">PRODUCCION ACCESORIOS / IMPORTACIÓN</p><h1>Importar pedidos</h1><p>Selecciona el Excel, resuelve solo las excepciones y confirma.</p></div><span className="acc-mode">{vista?.confirmacion_habilitada ? 'Modo de confirmación habilitado' : 'Modo seguro · Solo lectura'}</span></header>
    <div className="acc-import"><label htmlFor="archivo-acc">Archivo Excel (.xlsx o .xlsm)</label><div className="acc-import-row"><input id="archivo-acc" type="file" accept=".xlsx,.xlsm" onChange={e => {
      const f = e.target.files?.[0] || null
      evaluacionActual.current += 1;setArchivo(f);setResultadoConfirmacion('');setVista(null);setResoluciones({});setExclusionesInvalidas([]);setCambiosPendientes(false);setDetalle(null);setErroresAbiertos({});setArchivoAnterior('')
    }}/><button type="button" disabled={!archivo || cargando} onClick={()=>previsualizar(resoluciones, null)}>{cargando?'Analizando...':'Previsualizar Excel'}</button></div><p>Consulta MongoDB, pero no crea ni modifica registros. Las decisiones se conservan durante la revisión de este archivo.</p>{error&&<div role="alert" className="acc-error">{error}</div>}{resultadoConfirmacion&&<div role="status" className="acc-notice">{resultadoConfirmacion}</div>}</div>
    {vista&&<>
      <div className="acc-stats"><div><span>Pedidos válidos</span><strong>{numerar(vista.validacion.total_validas)}</strong></div><div><span>Por revisar</span><strong>{numerar(vista.resumen_definitivo?.casos_sin_resolver||0)}</strong></div><div><span>Excluidos por error</span><strong>{numerar(vista.validacion.total_invalidas)}</strong></div></div>
      {vista.permiso_servidor === false && <div className="acc-notice">La confirmación está desactivada en el servidor. Verifica ACC_CONFIRMACION_MASIVA=true y reinicia FastAPI.</div>}
      <div className="acc-toolbar"><button type="button" className="acc-secondary" onClick={()=>setMostrarDetalle(v=>!v)}>{mostrarDetalle?'Ocultar listado':'Ver listado completo'}</button><button type="button" className="acc-secondary" onClick={()=>setMostrarErrores(v=>!v)}>{mostrarErrores?'Ocultar errores':'Ver errores'} ({vista.validacion.total_invalidas})</button><button type="button" className="acc-secondary" onClick={exportarInvalidas} disabled={!vista.validacion.total_invalidas}>Descargar errores CSV</button></div>
      {mostrarErrores&&<div className="acc-errors"><h2>Filas inválidas</h2><p>Las filas inválidas se excluyen automáticamente de la importación. Puedes consultar los motivos o descargar el CSV para corregir el informe original.</p>{vista.validacion.hojas.flatMap(h=>(h.errores||[]).map(e=>({ ...e, hoja:h.hoja }))).map(e=>{
        const id=`${e.hoja}:${e.fila}`
        return <div className="acc-error-row" key={id}><button type="button" className="acc-secondary" aria-expanded={!!erroresAbiertos[id]} onClick={()=>setErroresAbiertos(prev=>({...prev,[id]:!prev[id]}))}>Fila {e.fila} · {e.hoja}: {e.motivo} {erroresAbiertos[id]?'−':'+'}</button><span className="acc-exclude">Excluida automáticamente</span>{erroresAbiertos[id]&&<div className="acc-raw-grid">{Object.entries(e.datos_originales||{}).map(([k,v])=><div key={k}><span>{etiqueta(k)}</span><strong>{valor(v)}</strong></div>)}</div>}</div>
      })}</div>}
      {pendientesResolucion.length > 0 && <div className="acc-group-actions"><strong>Resolver ambigüedades en bloque ({pendientesResolucion.length} pendientes)</strong><p>Aplica solo a las filas sin decisión. Puedes cambiar después cada fila individualmente. El resumen se actualiza automáticamente.</p><button type="button" onClick={()=>decidirTodos('NUEVO')}>Marcar pendientes como pedidos independientes</button><button type="button" className="acc-secondary" onClick={()=>decidirTodos('EXCLUIR')}>Excluir todas las pendientes</button></div>}
      {mostrarDetalle && <div className="acc-toolbar"><label>Mostrar <select value={filtro} onChange={e=>{setFiltro(e.target.value);setPagina(1);setDetalle(null)}}><option value="todos">Todos</option><option value="grupos">Grupos repetidos</option><option value="nuevo">Nuevos</option><option value="existente">Existentes</option><option value="ambiguo">Ambiguos</option><option value="revision">Revisión</option></select></label><input value={busqueda} onChange={e=>{setBusqueda(e.target.value);setPagina(1)}} placeholder="Buscar cliente, orden, referencia, fila..."/><button type="button" className="acc-secondary" onClick={exportarGrupos} disabled={!gruposRepetidos.length}>Exportar grupos ({gruposRepetidos.length})</button></div>}
      {mostrarDetalle && <div className="acc-tablewrap"><table className="acc-table"><thead><tr><th>Origen</th><th>Cliente / orden</th><th>Referencia / variante</th><th>Cantidades</th><th>Clasificación</th><th>Comparación</th><th>Decisión</th></tr></thead><tbody>{visibles.map(i=><tr key={i.origen}><td>{i.origen}</td><td><strong>{valor(i.datos_fila?.cliente)}</strong><small>OC: {valor(i.datos_fila?.orden_compra)}</small></td><td><strong>{valor(i.datos_fila?.referencia)}</strong><small>{valor(i.datos_fila?.acabado_talla)} · {valor(i.datos_fila?.color_codigo)}</small></td><td>{valor(i.datos_fila?.cantidad_solicitada)}<small>Entregado: {valor(i.datos_fila?.cantidad_entregada_acumulada)}</small></td><td><span className={'acc-tag acc-'+i.accion}>{i.accion}</span><small>{i.motivo}</small></td><td><button type="button" className="acc-secondary" onClick={()=>setDetalle(detalle===i.origen?null:i.origen)}>{detalle===i.origen?'Cerrar':'Comparar'} ({(i.filas_relacionadas||[]).length+(i.candidatos_detalle||[]).length})</button></td><td>{i.accion==='ambiguo'||i.accion==='revision'||resoluciones[i.origen]?<select aria-label={'Decisión para '+i.origen} value={resoluciones[i.origen]||''} onChange={e=>{const siguiente={...resoluciones};if(e.target.value)siguiente[i.origen]=e.target.value;else delete siguiente[i.origen];setResoluciones(siguiente);void previsualizar(siguiente, exclusionesInvalidas)}}><option value="">Sin resolver</option><option value="NUEVO">Es otro pedido nuevo</option><option value="EXCLUIR">Excluir esta fila</option>{i.candidatos_ids.map(id=><option value={id} key={id}>Asociar a {id}</option>)}</select>:'—'}</td></tr>).flatMap(i=>[i, ...(detalle===i.key?[]:[])])}</tbody></table></div>}
      {mostrarDetalle && detalle&&(()=>{const i=items.find(x=>x.origen===detalle);if(!i)return null;return <section className="acc-compare"><div className="acc-compare-head"><h2>Comparación · {detalle}</h2><button type="button" className="acc-secondary" onClick={()=>setDetalle(null)}>Cerrar</button></div><p>{i.motivo}. Compara los campos antes de elegir una resolución.</p>{(i.filas_relacionadas||[]).length>0&&<div className="acc-group-actions"><strong>Resolver este grupo completo</strong><p>Las opciones afectan a todas las filas relacionadas. Si son duplicados, se conserva la fila seleccionada ({i.origen}) y se excluyen las demás.</p><button type="button" onClick={()=>decidirGrupo(i,'separados')}>Son pedidos distintos</button><button type="button" className="acc-secondary" onClick={()=>decidirGrupo(i,'duplicado')}>Conservar esta fila y excluir duplicadas</button><button type="button" className="acc-secondary" onClick={()=>decidirGrupo(i,'pendiente')}>Dejar sin resolver</button></div>}
      <div className="acc-compare-cards"><article><h3>Fila seleccionada · {i.origen}</h3><DetalleDatos datos={i.datos_fila||{}}/></article>{(i.filas_relacionadas||[]).map(r=><article key={r.origen}><h3>Fila relacionada · {r.origen}</h3><DetalleDatos datos={r.datos}/></article>)}{(i.candidatos_detalle||[]).map(c=><article key={c.id}><h3>Pedido en MongoDB · {c.id}</h3><DetalleDatos datos={{...c.identidad,...c.datos}}/></article>)}</div></section>})()}
      {mostrarDetalle && <div className="acc-footer"><span>{numerar(filtrados.length)} registros · Página {Math.min(pagina,paginas)} de {paginas}</span><div><button type="button" className="acc-secondary" disabled={pagina<=1} onClick={()=>setPagina(p=>p-1)}>Anterior</button><button type="button" className="acc-secondary" disabled={pagina>=paginas} onClick={()=>setPagina(p=>p+1)}>Siguiente</button></div></div>}
      <section className="acc-summary" aria-label="Resumen del lote"><h2>Resumen antes de guardar</h2><p>{numerar(vista.resumen_definitivo?.pedidos_nuevos||0)} nuevos · {numerar(vista.resumen_definitivo?.pedidos_existentes||0)} existentes · {numerar(vista.resumen_definitivo?.saldos_iniciales||0)} saldos iniciales · {numerar(vista.resumen_definitivo?.filas_excluidas||0)} excluidos por decisión.</p><p>{cambiosPendientes?'Actualizando decisiones…':vista.listo_para_futura_confirmacion?'Listo para confirmar.':'Hay coincidencias pendientes de revisión.'}</p></section>
      <div className="acc-actions"><span>{Object.keys(resoluciones).length} decisiones temporales · {exclusionesInvalidas.length} errores excluidos {archivoAnterior!==claveArchivo(archivo!)?'(archivo modificado)':''}</span><button type="button" disabled={!vista.confirmacion_habilitada || cambiosPendientes || confirmando || cargando || archivoAnterior!==claveArchivo(archivo!)} onClick={confirmarPiloto}>{confirmando ? 'Importando en MongoDB (no cierres la página)…' : (vista.tipo_confirmacion === 'masiva' ? 'Importar pedidos a MongoDB' : 'Confirmar lote piloto (máx. 10)')}</button></div>
    </>}
  </section>
}
