import { useEffect, useState } from 'react'
import {
  NavLink,
  useLocation,
  useNavigate,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import './App.css'
import logoArcoline from './assets/logo-arcoline.png'
import ConciliacionACCPage from './pages/ConciliacionACCPage'
import LoginPage from './pages/LoginPage'
import PedidosACCPage from './pages/PedidosACCPage'
import EstadisticasACCPage from './pages/EstadisticasACCPage'
import ParcialesACCPage from './pages/ParcialesACCPage'
import api from './services/api'

interface RespuestaSesion {
  autenticado: boolean
  usuario: string
}

function App() {
  const [importando, setImportando] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState<string | null>(
    null,
  )
  const [validandoSesion, setValidandoSesion] =
    useState(true)

  useEffect(() => {
    async function consultarSesion() {
      try {
        const respuesta =
          await api.get<RespuestaSesion>('/api/auth/me')

        setUsuario(respuesta.data.usuario)
      } catch {
        setUsuario(null)
      } finally {
        setValidandoSesion(false)
      }
    }

    consultarSesion()
  }, [])

  useEffect(() => {
    function manejarSesionExpirada() {
      setUsuario(null)
    }

    window.addEventListener(
      'sesion-expirada',
      manejarSesionExpirada,
    )

    return () => {
      window.removeEventListener(
        'sesion-expirada',
        manejarSesionExpirada,
      )
    }
  }, [])

  // Bloquea navegación solo dentro de esta aplicación mientras la importación está activa.
  // El servidor puede estar procesando aunque el navegador se recargue.
  useEffect(() => {
    const cambio = (evento: Event) => {
      setImportando(Boolean((evento as CustomEvent<{ activo: boolean }>).detail?.activo))
    }
    window.addEventListener('acc-importacion-activa', cambio)
    let vigente = true
    void api.get('/api/consultas-acc/estado-importacion')
      .then(r => { if (vigente && r.data?.en_curso) setImportando(true) })
      .catch(() => {})
    return () => {
      vigente = false
      window.removeEventListener('acc-importacion-activa', cambio)
    }
  }, [])

  useEffect(() => {
    if (importando && location.pathname !== '/importaciones') {
      navigate('/importaciones', { replace: true })
    }
  }, [importando, location.pathname, navigate])

  async function cerrarSesion() {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setUsuario(null)
    }
  }

  if (validandoSesion) {
    return (
      <main className="pantalla-login">
        <div className="mensaje-estado">
          Validando sesión...
        </div>
      </main>
    )
  }

  if (!usuario) {
    return <LoginPage onLogin={setUsuario} />
  }

  return (
    <div className="aplicacion">
      <header className="encabezado">
        <div className="marca">
          <img
            src={logoArcoline}
            alt="Logo de Arcoline"
            className="logo"
          />

          <span className="subtitulo">
            Plataforma produccion de accesorios
          </span>
        </div>

        <div className="controles-encabezado">
          <nav className="navegacion" aria-label="Navegación">
            <NavLink to="/importaciones">Importar</NavLink>
            {([['/pedidos','Pedidos'],['/estadisticas','Estadísticas'],['/parciales','Parciales']] as const).map(([ruta, nombre]) =>
              <NavLink key={ruta} to={ruta} aria-disabled={importando} tabIndex={importando ? -1 : undefined}
                title={importando ? 'Disponible cuando termine la importación' : undefined}
                onClick={e => { if (importando) e.preventDefault() }}
                className={importando ? 'navegacion-bloqueada' : undefined}>{nombre}</NavLink>
            )}
          </nav>

          <div className="sesion-encabezado">
            <span>{usuario}</span>

            <button
              type="button"
              onClick={cerrarSesion}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="contenido">
        <Routes>
          <Route
            path="/"
            element={
              <Navigate to="/importaciones" replace />
            }
          />

          <Route
            path="/importaciones"
            element={<ConciliacionACCPage />}
          />

          <Route path="/pedidos" element={<PedidosACCPage />} />
          <Route path="/estadisticas" element={<EstadisticasACCPage />} />
          <Route path="/parciales" element={<ParcialesACCPage />} />
          <Route path="/parciales/:id" element={<ParcialesACCPage />} />
          <Route
            path="*"
            element={
              <Navigate to="/importaciones" replace />
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
