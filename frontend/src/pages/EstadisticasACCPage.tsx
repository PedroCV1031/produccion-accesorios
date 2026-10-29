import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../services/api'
import './ConsultasACC.css'

type Medida = 'pedidos' | 'solicitadas' | 'entregadas' | 'pendientes'
type Valores = Record<Medida, number>
type Grupo = Valores & { nombre: string }
type Punto = Valores & { periodo: string }
type PuntoGrupo = Valores & { periodo: string; nombre: string }
type Respuesta = { totales: Valores; serie: Punto[]; grupos: Grupo[]; series_por_grupo: PuntoGrupo[] }
const medidas: {id: Medida; nombre: string}[] = [
 {id:'solicitadas',nombre:'Unidades solicitadas'}, {id:'entregadas',nombre:'Entregadas acumuladas'},
 {id:'pendientes',nombre:'Unidades pendientes'}, {id:'pedidos',nombre:'Pedidos'}]
const dimensiones: [string,string][] = [
 ['referencia','Referencia'], ['referencia_color','Referencia y color'], ['cliente','Cliente'],
 ['comercial','Comercial'], ['acabado_talla','Acabado / talla'], ['color_codigo','Color'],
 ['estado','Estado de entrega'], ['periodo','Total por período']]
const colores = ['#007b45','#c0007f','#2663d7','#d67700','#7651c9','#199ba2','#7d5b61','#849342','#b29927','#536579']
const formato = (n:number) => Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2})
const vacio = ():Valores => ({pedidos:0,solicitadas:0,entregadas:0,pendientes:0})
const sumar = (a:Valores,b:Valores) => {for (const k of ['pedidos','solicitadas','entregadas','pendientes'] as Medida[]) a[k]+=b[k]||0;return a}
export default function EstadisticasACCPage(){
 const [fechaInicio,setFechaInicio]=useState(''),[fechaFin,setFechaFin]=useState(''),[cliente,setCliente]=useState(''),[referencia,setReferencia]=useState(''),[estado,setEstado]=useState('')
 const [periodicidad,setPeriodicidad]=useState('semana'),[dimension,setDimension]=useState('referencia'),[medida,setMedida]=useState<Medida>('solicitadas'),[grafica,setGrafica]=useState('torta'),[cantidad,setCantidad]=useState(7)
 const [periodoSeleccionado,setPeriodoSeleccionado]=useState(''),[opciones,setOpciones]=useState<Record<string,string[]>>({}),[datos,setDatos]=useState<Respuesta|null>(null),[error,setError]=useState(''),[cargando,setCargando]=useState(false),[revision,setRevision]=useState(0),[pagina,setPagina]=useState(1),[mostrarOtras,setMostrarOtras]=useState(true)
 const principalRef=useRef<HTMLElement|null>(null)
 const [filasPorPagina,setFilasPorPagina]=useState(28)
 useEffect(()=>{
  const elemento=principalRef.current
  if(!elemento)return
  const medir=()=>{
   // El panel derecho comparte altura con filtros, indicadores y gráfica del izquierdo.
   // Las filas mantienen su tamaño habitual; solo aumenta la paginación.
   const ancho=document.documentElement.clientWidth
   // Usar la altura natural de los contenidos, no la altura estirada por
   // la tabla lateral; evita un bucle que aumentaría las filas sin límite.
   const alto=[...elemento.children].reduce((suma,nodo)=>{
    const el=nodo as HTMLElement
    const estilo=window.getComputedStyle(el)
    const superior=parseFloat(estilo.marginTop)||0
    const inferior=parseFloat(estilo.marginBottom)||0
    return suma+el.getBoundingClientRect().height+superior+inferior
   },0)
   const calculadas=ancho<=1100?20:Math.max(20,Math.min(55,Math.floor((alto-120)/31)))
   setFilasPorPagina(anterior=>anterior===calculadas?anterior:calculadas)
  }
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(medir):null
  observer?.observe(elemento)
  window.addEventListener('resize',medir)
  medir()
  return()=>{observer?.disconnect();window.removeEventListener('resize',medir)}
 },[])
 useEffect(()=>{void api.get('/api/consultas-acc/opciones-filtros').then(r=>setOpciones(r.data)).catch(()=>{})},[])
 useEffect(()=>{let activo=true;setCargando(true);void api.get<Respuesta>('/api/consultas-acc/estadisticas',{params:{agrupar:periodicidad,agrupar_grafica:dimension,fecha_inicio:fechaInicio||undefined,fecha_fin:fechaFin||undefined,cliente:cliente||undefined,referencia:referencia||undefined,estado:estado||undefined}}).then(r=>{if(activo){setDatos(r.data);setError('');setPagina(1);setPeriodoSeleccionado('')}}).catch(()=>{if(activo)setError('No fue posible consultar los datos.')}).finally(()=>{if(activo)setCargando(false)});return()=>{activo=false}},[revision])
 const periodos=useMemo(()=>datos?.serie.map(v=>v.periodo)||[],[datos])
 const gruposActuales=useMemo(()=>{
  if(!datos) return [] as Grupo[]
  if(dimension==='periodo') return datos.serie.filter(v=>!periodoSeleccionado||v.periodo===periodoSeleccionado).map(v=>({nombre:v.periodo,...v}))
  if(!periodoSeleccionado)return datos.grupos
  const porNombre=new Map<string,Grupo>()
  for(const p of datos.series_por_grupo||[])if(p.periodo===periodoSeleccionado){const actual=porNombre.get(p.nombre)||{nombre:p.nombre,...vacio()};sumar(actual,p);porNombre.set(p.nombre,actual)}
  return [...porNombre.values()]
 },[datos,dimension,periodoSeleccionado])
 const ordenados=useMemo(()=>[...gruposActuales].sort((a,b)=>b[medida]-a[medida]),[gruposActuales,medida])
 const nombres=ordenados.slice(0,cantidad).map(x=>x.nombre)
 const gruposPie=useMemo(()=>{const primeros=ordenados.slice(0,cantidad);const resto=ordenados.slice(cantidad);return mostrarOtras&&resto.length?[...primeros,{nombre:'OTRAS',...resto.reduce((a,v)=>sumar(a,v),vacio())}]:primeros},[ordenados,cantidad,mostrarOtras])
 const datosTemporales=useMemo(()=>{
  if(!datos)return [] as Record<string,string|number>[]
  if(dimension==='periodo')return datos.serie.map(p=>({periodo:p.periodo, 'Total':p[medida]}))
  const seleccion=new Set(nombres)
  // Una sola pasada: antes se recorrían todas las series por cada período.
  const porPeriodo=new Map<string, PuntoGrupo[]>()
  for(const item of datos.series_por_grupo||[]){
   const grupo=porPeriodo.get(item.periodo)||[]
   grupo.push(item)
   porPeriodo.set(item.periodo,grupo)
  }
  return datos.serie.map(p=>{
   const fila:Record<string,string|number>={periodo:p.periodo};let otros=0
   for(const nombre of nombres)fila[nombre]=0
   for(const item of porPeriodo.get(p.periodo)||[]){
    if(seleccion.has(item.nombre))fila[item.nombre]=Number(fila[item.nombre]||0)+item[medida]
    else otros+=item[medida]
   }
   if(ordenados.length>cantidad)fila.OTRAS=otros
   return fila
  })
 },[datos,dimension,nombres.join('\u001f'),ordenados.length,cantidad,medida])
 const clavesSerie=dimension==='periodo'?['Total']:[...nombres,...(mostrarOtras&&ordenados.length>cantidad?['OTRAS']:[])]
 const detalle=ordenados.slice((pagina-1)*filasPorPagina,pagina*filasPorPagina)
 const totalPaginas=Math.max(1,Math.ceil(ordenados.length/filasPorPagina))
 useEffect(()=>{setPagina(p=>Math.min(p,totalPaginas))},[totalPaginas])
 const tituloMedida=medidas.find(x=>x.id===medida)?.nombre||medida
 const tituloDimension=dimensiones.find(x=>x[0]===dimension)?.[1]||dimension
 const consultar=(e:React.FormEvent)=>{e.preventDefault();setRevision(x=>x+1)}
 const limpiar=()=>{setFechaInicio('');setFechaFin('');setEstado('');setCliente('');setReferencia('');setDimension('referencia');setPeriodicidad('semana');setMedida('solicitadas');setGrafica('torta');setCantidad(7);setPeriodoSeleccionado('');setRevision(v=>v+1)}
 return <section className="consultas-acc consultas-estadisticas estadisticas-arcos-acc"><header className="cabecera-consulta"><div><h1>Estadísticas de pedidos</h1><p>Unidades y pedidos agrupados según los filtros seleccionados.</p></div></header>
 <div className="estadisticas-arcos-grid"><main className="estadisticas-arcos-principal" ref={principalRef}><form className="filtros-consulta estadisticas-arcos-filtros" onSubmit={consultar}>
 <label>Fecha inicial<input type="date" value={fechaInicio} onChange={e=>setFechaInicio(e.target.value)}/></label><label>Fecha final<input type="date" value={fechaFin} onChange={e=>setFechaFin(e.target.value)}/></label>
 <label>Estado del pedido<select value={estado} onChange={e=>setEstado(e.target.value)}><option value="">Todos</option>{(opciones.estados||[]).map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Cliente<select value={cliente} onChange={e=>setCliente(e.target.value)}><option value="">Todos</option>{(opciones.cliente||[]).map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Referencia<select value={referencia} onChange={e=>setReferencia(e.target.value)}><option value="">Todas</option>{(opciones.referencia||[]).map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Agrupar gráfica por<select value={dimension} onChange={e=>{setDimension(e.target.value);setPagina(1);setRevision(v=>v+1)}}>{dimensiones.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
 <label>Tipo de gráfica<select value={grafica} onChange={e=>{setGrafica(e.target.value);setPeriodoSeleccionado('');setPagina(1)}}><option value="torta">Torta</option><option value="barras">Barras</option><option value="lineas">Líneas</option></select></label>
 <label>Métrica<select value={medida} onChange={e=>{setMedida(e.target.value as Medida);setPagina(1)}}>{medidas.map(x=><option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
 <label>Categorías visibles<input type="number" min="1" max="20" value={cantidad} onChange={e=>setCantidad(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label>
 <label>Agrupar fechas<select value={periodicidad} onChange={e=>{setPeriodicidad(e.target.value);setRevision(v=>v+1)}}><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
 {grafica==='torta'&&<label>Período de la torta<select value={periodoSeleccionado} onChange={e=>{setPeriodoSeleccionado(e.target.value);setPagina(1)}}><option value="">Todo el período filtrado</option>{periodos.map(p=><option value={p} key={p}>{periodicidad==='semana'?`Semana del ${p}`:p}</option>)}</select></label>}
 <label className="otras-control-acc"><input type="checkbox" checked={mostrarOtras} onChange={e=>setMostrarOtras(e.target.checked)}/> Mostrar OTRAS</label><button disabled={cargando} type="submit">{cargando?'Consultando…':'Consultar'}</button><button className="boton-secundario-acc" type="button" onClick={limpiar}>Limpiar</button></form>
 {error&&<p role="alert">{error}</p>}{datos&&<><div className="indicadores-consulta estadisticas-arcos-indicadores">{([['Pedidos','pedidos'],['Unidades solicitadas','solicitadas'],['Entregadas acumuladas','entregadas'],['Pendientes','pendientes']] as [string,Medida][]).map(([t,k])=><div key={k}><small>{t}</small><strong>{formato(datos.totales[k])}</strong></div>)}</div>
 <div className="grafico-consulta estadisticas-arcos-grafico"><h2>{tituloMedida} por {tituloDimension.toLowerCase()}{grafica!=='torta'?' a lo largo del tiempo':periodoSeleccionado?` · ${periodoSeleccionado}`:' · todo el período'}</h2><p>{grafica==='torta'?'Distribución de las categorías seleccionadas.':'Eje horizontal: fecha. Cada categoría es una serie independiente.'} Se muestran hasta {cantidad} categorías{mostrarOtras?'; las restantes se agrupan como OTRAS.':'.'}</p>
 {(grafica==='torta'?gruposPie.length===0:datosTemporales.length===0)?<p>No hay datos para los filtros.</p>:<ResponsiveContainer width="100%" height={440}>{grafica==='torta'?<PieChart><Tooltip formatter={v=>formato(Number(v))}/><Legend/><Pie data={gruposPie} dataKey={medida} nameKey="nombre" outerRadius="66%" labelLine={{stroke:"#777",strokeWidth:1}} label={({cx,cy,midAngle,outerRadius,percent})=>{
  const porcentaje=Number(percent||0)*100
  if(porcentaje<=0)return null
  const angulo=-Number(midAngle||0)*Math.PI/180
  const distancia=Number(outerRadius||0)+44
  const x=Number(cx||0)+Math.cos(angulo)*distancia
  const y=Number(cy||0)+Math.sin(angulo)*distancia
  return <text x={x} y={y} textAnchor={Math.cos(angulo)>=0?'start':'end'} dominantBaseline="central" fill="#274136" fontSize={12} fontWeight={600}>{porcentaje.toFixed(1)}%</text>
 }}>{gruposPie.map((x,i)=><Cell key={x.nombre} fill={colores[i%colores.length]}/>)}</Pie></PieChart>:grafica==='lineas'?<LineChart data={datosTemporales}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="periodo"/><YAxis tickFormatter={formato}/><Tooltip formatter={v=>formato(Number(v))}/><Legend/>{clavesSerie.map((k,i)=><Line key={k} type="monotone" dataKey={k} stroke={colores[i%colores.length]} strokeWidth={2} dot={false}/>)}</LineChart>:<BarChart data={datosTemporales}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="periodo"/><YAxis tickFormatter={formato}/><Tooltip formatter={v=>formato(Number(v))}/><Legend/>{clavesSerie.map((k,i)=><Bar key={k} dataKey={k} fill={colores[i%colores.length]}/>)}</BarChart>}</ResponsiveContainer>}</div></>}
 </main><aside className="estadisticas-arcos-lateral"><div className="grafico-consulta estadisticas-arcos-tabla"><h2>Detalle por {tituloDimension.toLowerCase()}</h2><table><thead><tr><th>{tituloDimension}</th><th>{tituloMedida}</th></tr></thead><tbody>{detalle.map(x=><tr key={x.nombre}><td>{x.nombre}</td><td>{formato(x[medida])}</td></tr>)}</tbody></table><div className="paginacion"><button type="button" disabled={pagina<=1} onClick={()=>setPagina(x=>x-1)}>Anterior</button><span>{pagina} de {totalPaginas}</span><button type="button" disabled={pagina>=totalPaginas} onClick={()=>setPagina(x=>x+1)}>Siguiente</button></div></div></aside></div>
 <p className="nota-consulta">Las entregas acumuladas se atribuyen a la fecha del pedido, no a la fecha real de despacho.</p></section>
}
