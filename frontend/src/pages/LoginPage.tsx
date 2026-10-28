import axios from 'axios'
import { useState } from 'react'
import type { SubmitEvent } from 'react'

import logoArcoline from '../assets/logo-arcoline.png'
import api from '../services/api'

interface RespuestaLogin {
  mensaje: string
  usuario: string
}

interface LoginPageProps {
  onLogin: (usuario: string) => void
}

function LoginPage({ onLogin }: LoginPageProps) {
  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [ingresando, setIngresando] = useState(false)
  const [error, setError] = useState('')

  async function iniciarSesion(
    evento: SubmitEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()

    if (!usuario.trim() || !contrasena) {
      setError('Debes ingresar el usuario y la contraseña.')
      return
    }

    try {
      setIngresando(true)
      setError('')

      const respuesta = await api.post<RespuestaLogin>(
        '/api/auth/login',
        {
          usuario: usuario.trim(),
          contrasena,
        },
      )

      onLogin(respuesta.data.usuario)
    } catch (errorLogin) {
      if (axios.isAxiosError(errorLogin)) {
        setError(
          errorLogin.response?.data?.detail ??
            'No fue posible iniciar sesión.',
        )
      } else {
        setError('Ocurrió un error inesperado.')
      }
    } finally {
      setIngresando(false)
    }
  }

  return (
    <main className="pantalla-login">
      <section className="tarjeta-login">
        <img
          src={logoArcoline}
          alt="Logo de Arcoline"
          className="logo-login"
        />

        <div className="encabezado-login">
          <h1>Iniciar sesión</h1>
        </div>

        <form
          className="formulario-login"
          onSubmit={iniciarSesion}
        >
          <div className="campo-login">
            <label htmlFor="usuario">Usuario</label>

            <input
              id="usuario"
              type="text"
              value={usuario}
              autoComplete="username"
              autoFocus
              onChange={(evento) =>
                setUsuario(evento.target.value)
              }
            />
          </div>

          <div className="campo-login">
            <label htmlFor="contrasena">
              Contraseña
            </label>

            <input
              id="contrasena"
              type="password"
              value={contrasena}
              autoComplete="current-password"
              onChange={(evento) =>
                setContrasena(evento.target.value)
              }
            />
          </div>

          {error && (
            <div className="mensaje-error">{error}</div>
          )}

          <button
            type="submit"
            className="boton-principal boton-login"
            disabled={ingresando}
          >
            {ingresando ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default LoginPage