import { useEffect, useState } from 'react'
import api from '../services/api'
import { Link } from 'react-router-dom'
import './ConsultasACC.css'

type Pedido = Record<string, string | number | null>
const claseEstado = (estado: string) => {
 const e=estado.toLocaleLowerCase('es').trim()
 if(e==='entregado a tiempo')return 'estado-exito'
 if(e==='entregado tarde'||e==='vencido sin entregar')return 'estado-alerta'
 if(e==='entrega próxima')return 'estado-proximo'
 if(e==='entregado'||e==='entregado sin fecha')return 'estado-entregado'
 return 'estado-proceso'
}
const columnas: [string, string][] = [
  ['fecha_pedido','Fecha pedido'],['fecha_solicitada','Solicitada'],['fecha_comprometida','Comprometida'],
  ['cliente','Cliente'],['comercial','Comercial'],['orden_compra','Orden compra'],['referencia','Referencia'],
  ['acabado_talla','Acabado/talla'],['color_codigo','Color/código'],['cantidad_solicitada','Cantidad solicitada'],
  ['fecha_ultima_entrega','Última entrega'],['cantidad_entregada_acumulada','Entregado'],['factura','Factura'],
]
export default function PedidosACCPage() {
  const [cliente,setCliente]=useState(''), [referencia,setReferencia]=useState(''), [orden,setOrden]=useState(''), [comercial,setComercial]=useState(''), [acabado,setAcabado]=useState(''), [color,setColor]=useState('')
  const [desde,setDesde]=useState(''), [hasta,setHasta]=useState('')
  const [estado,setEstado]=useState(''), [pagina,setPagina]=useState(1)
  const [datos,setDatos]=useState<Pedido[]>([]), [total,setTotal]=useState(0)
  const [cargando,setCargando]=useState(false), [error,setError]=useState('')
  const [revision,setRevision]=useState(0),[porPagina,setPorPagina]=useState(50),[ordenar,setOrdenar]=useState('fecha_pedido'),[direccion,setDireccion]=useState('desc')
  const [opciones,setOpciones]=useState<Record<string,string[]>>({})
  useEffect(()=>{api.get('/api/consultas-acc/opciones-filtros').then(r=>setOpciones(r.data)).catch(()=>{})},[])
  useEffect(()=>{
    let activo=true
    async function cargar(){
      setCargando(true);setError('')
      try {
        const {data}=await api.get('/api/consultas-acc/pedidos',{params:{pagina,por_pagina:porPagina,cliente:cliente||undefined,orden_compra:orden||undefined,comercial:comercial||undefined,acabado_talla:acabado||undefined,color_codigo:color||undefined,ordenar,direccion,
          referencia:referencia||undefined,fecha_inicio:desde||undefined,fecha_fin:hasta||undefined,estado:estado||undefined}})
        if(activo){setDatos(data.pedidos);setTotal(data.total)}
      }catch{if(activo)setError('No fue posible cargar los pedidos.')}
      finally{if(activo)setCargando(false)}
    }
    void cargar();return ()=>{activo=false}
  },[pagina,revision,porPagina])
  const paginas=Math.max(1,Math.ceil(total/porPagina))
  return <section className="consultas-acc">
    <header className="cabecera-consulta"><div><h1>Pedidos</h1><p>Tabla completa de pedidos almacenados en MongoDB.</p></div><strong>{total.toLocaleString('es-CO')} pedidos</strong></header>
    <form className="filtros-consulta" onSubmit={e=>{e.preventDefault();setPagina(1);setRevision(v=>v+1)}}>
      <label>Cliente<input value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="Buscar cliente" /></label>
      <label>Orden de compra<input value={orden} onChange={e=>setOrden(e.target.value)} placeholder="Orden" /></label>
      <label>Comercial<select value={comercial} onChange={e=>setComercial(e.target.value)}><option value="">Todos</option>{(opciones.comercial||[]).map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Acabado/talla<select value={acabado} onChange={e=>setAcabado(e.target.value)}><option value="">Todos</option>{(opciones.acabado_talla||[]).map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Color<select value={color} onChange={e=>setColor(e.target.value)}><option value="">Todos</option>{(opciones.color_codigo||[]).map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Referencia<input value={referencia} onChange={e=>setReferencia(e.target.value)} placeholder="Referencia" /></label>
      <label>Desde<input type="date" value={desde} onChange={e=>setDesde(e.target.value)} /></label>
      <label>Hasta<input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} /></label>
      <label>Estado<select value={estado} onChange={e=>setEstado(e.target.value)}><option value="">Todos</option>{(opciones.estados||[]).map(x=><option key={x} value={x}>{x}</option>)}</select></label>
      <label>Ordenar<select value={ordenar} onChange={e=>setOrdenar(e.target.value)}>{columnas.map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label><label>Dirección<select value={direccion} onChange={e=>setDireccion(e.target.value)}><option value="desc">Descendente</option><option value="asc">Ascendente</option></select></label><label>Por página<select value={porPagina} onChange={e=>{setPorPagina(Number(e.target.value));setPagina(1)}}>{[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button type="submit">Aplicar filtros</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {cargando?<p>Cargando pedidos…</p>:<div className="tabla-scroll"><table><thead><tr><th>ID</th>{columnas.map(([clave,nombre])=><th key={clave}>{nombre}</th>)}<th>Pendiente</th><th>Estado</th><th>Historial</th></tr></thead>
    <tbody>{datos.map(p=><tr key={String(p.id)}><td title={String(p.id)}>{String(p.id).slice(-8)}</td>{columnas.map(([clave])=><td key={clave}>{p[clave]==null?'—':typeof p[clave]==='number'?Number(p[clave]).toLocaleString('es-CO'):String(p[clave])}</td>)}<td>{(Number(p.cantidad_solicitada||0)-Number(p.cantidad_entregada_acumulada||0)).toLocaleString('es-CO')}</td><td><span className={`estado-pedido-acc ${claseEstado(String(p.estado||''))}`}>{String(p.estado||"—")}</span></td><td><Link to={`/parciales/${p.id}`}>Ver parciales</Link></td></tr>)}</tbody></table>{datos.length===0&&<p>Sin pedidos para estos filtros.</p>}</div>}
    <div className="paginacion"><button disabled={pagina<=1||cargando} onClick={()=>setPagina(p=>p-1)}>Anterior</button><span>Página {pagina} de {paginas}</span><button disabled={pagina>=paginas||cargando} onClick={()=>setPagina(p=>p+1)}>Siguiente</button></div>
  </section>
}
