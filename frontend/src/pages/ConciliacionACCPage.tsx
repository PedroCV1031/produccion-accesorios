import { useState } from 'react'
import api from '../services/api'
import './ConciliacionACCPage.css'

type Datos = Record<string, unknown>
type HojaSeleccion = {hoja:string; formato_valido:boolean; motivo?:string|null}
type FilaError = { fila: number; motivo: string; datos_originales?: Datos }
type Item = { origen: string; accion: string; motivo: string; datos_fila?: Datos }
type Vista = {
  confirmacion_habilitada: boolean; permiso_servidor?: boolean; tipo_confirmacion?: 'piloto' | 'masiva';
  validacion: { total_validas: number; total_invalidas: number; hojas: { hoja: string; errores?: FilaError[] }[] };
  conciliacion: { items: Item[]; resumen: Record<string,number>; bloqueado:boolean };
  resumen_definitivo?: { filas_invalidas_excluidas:number; duplicados_rechazados?:number; casos_sin_resolver:number };
}
const numero=(n:number)=>new Intl.NumberFormat('es-CO').format(n)
const campos=['cliente','orden_compra','referencia','acabado_talla','color_codigo','fecha_pedido','cantidad_solicitada','cantidad_entregada_acumulada']
function csvDescarga(nombre:string, filas:unknown[][]) {
  const seguro=(v:unknown)=>{
    const s=v===null||v===undefined?'':String(v)
    const valor=/^\s*[=+@]/.test(s)||/^\s*-(?!\d)/.test(s)?"'"+s:s
    return '"'+valor.replaceAll('"','""')+'"'
  }
  const contenido='\uFEFF'+filas.map(f=>f.map(seguro).join(';')).join('\r\n')
  const url=URL.createObjectURL(new Blob([contenido],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a'); a.href=url; a.download=nombre; a.click(); URL.revokeObjectURL(url)
}
export default function ConciliacionACCPage(){
  const [archivo,setArchivo]=useState<File|null>(null)
  const [vista,setVista]=useState<Vista|null>(null)
  const [hojas,setHojas]=useState<HojaSeleccion[]>([])
  const [seleccion,setSeleccion]=useState<string[]>([])
  const [detectando,setDetectando]=useState(false)
  const [cargando,setCargando]=useState(false)
  const [confirmando,setConfirmando]=useState(false)
  const [error,setError]=useState('')
  const [exito,setExito]=useState('')
  const [detalle,setDetalle]=useState(false)
  const [pagina,setPagina]=useState(1)
  const rechazados=(vista?.conciliacion.items||[]).filter(i=>i.accion==='duplicado'||i.accion==='revision')
  const errores=vista?.validacion.hojas.flatMap(h=>(h.errores||[]).map(e=>({...e,hoja:h.hoja})))||[]
  function descargarErrores(){
    csvDescarga('ACC_corregir_excel.csv', [['Tipo','Hoja/Fila','Motivo',...campos],
      ...errores.map(e=>['Inválido',`${e.hoja}:${e.fila}`,e.motivo,...campos.map(c=>e.datos_originales?.[c]??'')]),
      ...rechazados.map(i=>[i.accion,i.origen,i.motivo,...campos.map(c=>i.datos_fila?.[c]??'')])])
  }
  async function elegirArchivo(nuevo: File|null){
    setArchivo(nuevo);setVista(null);setExito('');setError('');setHojas([]);setSeleccion([])
    if(!nuevo)return
    setDetectando(true)
    try {
      const form=new FormData();form.append('file',nuevo)
      const respuesta=await api.post('/api/conciliacion-acc/hojas',form)
      setHojas(respuesta.data.hojas||[])
      setSeleccion(respuesta.data.seleccion_inicial||[])
    }catch(e:unknown){const fallo=e as {response?:{data?:{detail?:string}};message?:string};setError(fallo.response?.data?.detail||fallo.message||'No fue posible analizar las hojas')}
    finally{setDetectando(false)}
  }
  function cambiarHoja(nombre:string, activada:boolean){
    setSeleccion(actual=>activada?[...actual,nombre]:actual.filter(x=>x!==nombre))
    setVista(null);setExito('')
  }
  async function solicitar(confirmar:boolean){
    if(!archivo||seleccion.length===0)return
    if(confirmar && !window.confirm('¿Importar los pedidos válidos a MongoDB? Los duplicados e inválidos se excluirán.'))return
    setError('');setExito(''); confirmar?setConfirmando(true):setCargando(true)
    try{
      const form=new FormData(); form.append('file',archivo);seleccion.forEach(hoja=>form.append('hojas',hoja))
      form.append('resoluciones_json','{}');form.append('exclusiones_invalidas_json','null')
      const ruta=confirmar?(vista?.tipo_confirmacion==='masiva'?'/api/conciliacion-acc/confirmar-masivo':'/api/conciliacion-acc/confirmar-piloto'):'/api/conciliacion-acc/previsualizar'
      const resp=await api.post(ruta,form)
      if(confirmar){
        const r=resp.data.resumen||{}
        setExito(`Importación completada. Nuevos: ${numero(r.nuevos||0)} · Actualizados: ${numero(r.actualizados||0)} · Sin cambios: ${numero(r.sin_cambios||0)} · Rechazados: ${numero(r.excluidos||0)} · Saldos iniciales: ${numero(r.saldos_iniciales||0)} · Parciales: ${numero(r.parciales||0)}.`)
        setVista(null)
      }else{setVista(resp.data);setPagina(1)}
    }catch(e:unknown){const fallo=e as {response?:{data?:{detail?:string}};message?:string};setError(fallo.response?.data?.detail||fallo.message||'No fue posible completar la operación')}
    finally{setCargando(false);setConfirmando(false)}
  }
  return <section className="acc-page acc-page-inicial">
    <header className="acc-heading"><div><p className="acc-eyebrow">PRODUCCIÓN ACCESORIOS / IMPORTACIÓN</p><h1>Importar pedidos</h1><p>Selecciona el archivo. El sistema identifica pedidos por clave única y excluye automáticamente los registros que necesitan corrección.</p></div></header>
    <div className="acc-import"><label htmlFor="excel-acc">Archivo Excel</label><div className="acc-import-row"><input id="excel-acc" type="file" accept=".xlsx,.xlsm" onChange={e=>void elegirArchivo(e.target.files?.[0]||null)}/><button disabled={!archivo||seleccion.length===0||detectando||cargando||confirmando} onClick={()=>solicitar(false)}>{cargando?'Validando...':'Validar Excel'}</button></div><p>El Excel no se modifica. Los errores y duplicados se reportan para corregirlos en el informe original.</p></div>
    {detectando&&<p role="status">Identificando hojas del archivo...</p>}
    {archivo&&hojas.length>0&&<div className="acc-import" aria-label="Selección de hojas">
      <h2>Seleccionar hojas para importar</h2>
      <p>Se marcan automáticamente las hojas con formato válido. Las demás no se pueden importar.</p>
      <div style={{display:'flex',flexWrap:'wrap',gap:'12px',margin:'12px 0'}}>
        {hojas.map(h=><label key={h.hoja} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',border:'1px solid #d7e0dc',borderRadius:9,opacity:h.formato_valido?1:.55}}>
          <input type="checkbox" disabled={!h.formato_valido||cargando||confirmando} checked={seleccion.includes(h.hoja)} onChange={e=>cambiarHoja(h.hoja,e.target.checked)}/>
          <span>{h.hoja} <small>{h.formato_valido?'✓ Formato válido':`— ${h.motivo||'Formato inválido'}`}</small></span>
        </label>)}
      </div>
      <p>{seleccion.length} hoja(s) seleccionada(s)</p>
    </div>}
    {error&&<div className="acc-error" role="alert">{error}</div>}
    {exito&&<div className="acc-notice" role="status">{exito}</div>}
    {vista&&<>
      <div className="acc-stats">
        <div><span>Pedidos nuevos</span><strong>{numero(vista.conciliacion.resumen.nuevo||0)}</strong></div>
        <div><span>Pedidos existentes</span><strong>{numero(vista.conciliacion.resumen.existente||0)}</strong></div>
        <div><span>Duplicados rechazados</span><strong>{numero(vista.conciliacion.resumen.duplicado||0)}</strong></div>
        <div><span>Filas inválidas</span><strong>{numero(vista.validacion.total_invalidas)}</strong></div>
        <div><span>Requieren corrección</span><strong>{numero(vista.conciliacion.resumen.revision||0)}</strong></div>
      </div>
      <div className="acc-toolbar"><button className="acc-secondary" type="button" disabled={errores.length+rechazados.length===0} onClick={descargarErrores}>Descargar errores y duplicados CSV ({numero(errores.length+rechazados.length)})</button><button type="button" className="acc-secondary" onClick={()=>setDetalle(!detalle)}>{detalle?'Ocultar detalle':'Ver detalle'}</button></div>
      {(vista.conciliacion.resumen.revision||0)>0&&<div className="acc-error">Hay cantidades entregadas que disminuyeron u otros cambios que requieren corregir el Excel. No se puede confirmar este archivo hasta resolverlos.</div>}
      {detalle&&<div className="acc-errors"><h2>Registros rechazados</h2><p>Se rechazan ambas filas cuando tienen la misma clave. Corrige los campos del informe y valida nuevamente.</p><table><thead><tr><th>Fila</th><th>Motivo</th><th>Cliente</th><th>Referencia</th></tr></thead><tbody>{[...rechazados.map(i=>({origen:i.origen,motivo:i.motivo,datos:i.datos_fila||{}})),...errores.map(e=>({origen:`${e.hoja}:${e.fila}`,motivo:e.motivo,datos:e.datos_originales||{}}))].slice((pagina-1)*30,pagina*30).map((i,index)=><tr key={i.origen+index}><td>{i.origen}</td><td>{i.motivo}</td><td>{String(i.datos.cliente??'—')}</td><td>{String(i.datos.referencia??'—')}</td></tr>)}</tbody></table><div><button className="acc-secondary" disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina} <button className="acc-secondary" disabled={pagina*30>=rechazados.length+errores.length} onClick={()=>setPagina(p=>p+1)}>Siguiente</button></div></div>}
      <div className="acc-import"><h2>Confirmar importación</h2><p>Se importarán únicamente los pedidos válidos y con clave no duplicada. Las demás filas quedarán fuera, con reporte CSV disponible.</p>{!vista.permiso_servidor&&<p>La escritura está desactivada. Revisa ACC_CONFIRMACION_MASIVA=true y reinicia FastAPI.</p>}<button type="button" onClick={()=>solicitar(true)} disabled={!vista.confirmacion_habilitada||confirmando||cargando}>{confirmando?'Importando a MongoDB...':'Confirmar importación'}</button></div>
    </>}
  </section>
}
