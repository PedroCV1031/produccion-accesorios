import axios from 'axios'

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ??
    'http://localhost:8000',
  withCredentials: true,
})

api.interceptors.response.use(
  (respuesta) => respuesta,
  (error) => {
    const url = String(error.config?.url ?? '')

    if (
      error.response?.status === 401 &&
      !url.includes('/api/auth/login')
    ) {
      window.dispatchEvent(
        new Event('sesion-expirada'),
      )
    }

    return Promise.reject(error)
  },
)

export default api