import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../services/api'
import './ConsultasACC.css'
type Mov = { _id: string; tipo?: string; cantidad?: number; acumulado_anterior?: number; acumulado_nuevo?: number; fecha_entrega?: string; fecha_entrega_referencial?: string; fecha_deteccion?: string; numero?: number; historico_sin_desglose?: boolean }
type Detalle = {id:string;pedido:Record<string,string|number|null>;estado:string;movimientos:Mov[];total_movimientos:number}
const fmt=(x:unknown)=>typeof x==='number'?x.toLocaleString('es-CO'):String(x??'—')
const fecha=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?`${x.slice(8,10)}/${x.slice(5,7)}/${x.slice(0,4)}`:fmt(x)
export default function ParcialesACCPage(){
 const {id}=useParams();const [datos,setDatos]=useState<Detalle|null>(null),[error,setError]=useState('')
 useEffect(()=>{if(!id)return;let ok=true;api.get<Detalle>(`/api/consultas-acc/pedidos/${id}/parciales`).then(r=>{if(ok)setDatos(r.data)}).catch(()=>{if(ok)setError('No fue posible cargar el historial.')});return()=>{ok=false}},[id])
 return <section className="consultas-acc consultas-parciales"><header className="cabecera-consulta"><div><h1>Historial de parciales</h1><p>Entregas registradas y saldo inicial del pedido.</p></div><Link to="/pedidos">Volver a Pedidos</Link></header>
 {error&&<p role="alert">{error}</p>}{!id&&<p>Selecciona un pedido desde la tabla de <Link to="/pedidos">Pedidos</Link> y pulsa «Ver parciales».</p>}{id&&!datos&&!error&&<p>Cargando historial…</p>}{datos&&<>
 <div className="indicadores-consulta"><div><small>Cliente</small><strong>{fmt(datos.pedido.cliente)}</strong></div><div><small>Referencia</small><strong>{fmt(datos.pedido.referencia)}</strong></div><div><small>Solicitado</small><strong>{fmt(datos.pedido.cantidad_solicitada)}</strong></div><div><small>Acumulado entregado</small><strong>{fmt(datos.pedido.cantidad_entregada_acumulada)}</strong></div><div><small>Estado</small><strong>{datos.estado}</strong></div></div>
 <div className="grafico-consulta"><h2>Información de las entregas</h2><p>Fecha del pedido: {fmt(datos.pedido.fecha_pedido)} · Fecha comprometida: {fmt(datos.pedido.fecha_comprometida)}</p></div>
 {datos.movimientos.filter(m=>m.tipo==='parcial').length>=2&&<section className="linea-tiempo-acc" aria-label="Línea de tiempo de entregas"><h2>Seguimiento de entregas</h2><div className="hitos-acc">{datos.movimientos.map((m,i)=><article className="hito-acc" key={m._id}><span className="hito-numero">{i+1}</span><div><strong>{m.tipo==='saldo_inicial'?'Saldo histórico inicial':'Entrega parcial '+(i+1)}</strong><small>{fecha(m.fecha_entrega||m.fecha_entrega_referencial||m.fecha_deteccion)}</small><p>+{fmt(m.cantidad)} · Acumulado: {fmt(m.acumulado_nuevo)}</p></div></article>)}</div></section>}
 <div className="tabla-scroll"><table><thead><tr><th>N.º</th><th>Tipo</th><th>Fecha entrega</th><th>Registrado el</th><th>Cantidad</th><th>Acumulado previo</th><th>Nuevo acumulado</th></tr></thead><tbody>{datos.movimientos.map(x=><tr key={x._id}><td>{fmt(x.numero)}</td><td>{x.tipo==='saldo_inicial'?'Saldo histórico inicial':x.tipo==='parcial'?'Entrega parcial':fmt(x.tipo)}</td><td>{fecha(x.fecha_entrega||x.fecha_entrega_referencial)}</td><td>{fecha(x.fecha_deteccion)}</td><td>{fmt(x.cantidad)}</td><td>{fmt(x.acumulado_anterior)}</td><td>{fmt(x.acumulado_nuevo)}</td></tr>)}</tbody></table>{!datos.movimientos.length&&<p>Este pedido no tiene movimientos registrados.</p>}</div>
 <p className="nota-consulta">El saldo inicial es histórico y no permite reconstruir cada despacho previo a la primera importación.</p>
 </>}</section>
}
