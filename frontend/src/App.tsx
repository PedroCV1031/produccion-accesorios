import { useEffect, useState } from 'react'
import {
  NavLink,
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
            Produccion accesorios
          </span>
        </div>

        <div className="controles-encabezado">
          <nav className="navegacion">
            <NavLink to="/importaciones">Importar</NavLink>
            <NavLink to="/pedidos">Pedidos</NavLink>
            <NavLink to="/estadisticas">Estadísticas</NavLink>
            <NavLink to="/parciales">Parciales</NavLink>
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
