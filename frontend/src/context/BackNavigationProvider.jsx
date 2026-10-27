import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BackNavigationContext } from './BackNavigationContext.js'

// จำกัดการย้อนกลับไว้เฉพาะหน้าที่เข้าหลังล็อกอินครั้งนี้
export function BackNavigationProvider({ children }) {
  const [startIndex] = useState(() => window.history.state?.idx ?? 0)
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const hasPreviousPage = (window.history.state?.idx ?? 0) > startIndex
  const section = `/${pathname.split('/')[1]}`
  const origin = state?.returnTo ?? state?.from?.to
  const safeOrigin = typeof origin === 'string' && origin.startsWith('/') && !origin.startsWith('//')
    && !/^\/(login|register|forgetpassword)(\/|$|[?#])/.test(origin) && origin !== pathname
  const fallback = safeOrigin ? origin : section !== pathname ? section : '/'
  const canGoBack = hasPreviousPage || (pathname !== '/' && pathname !== '/home')

  const goBack = () => {
    if (hasPreviousPage) navigate(-1)
    else navigate(fallback, { replace: true })
  }

  return (
    <BackNavigationContext.Provider value={{ goBack, canGoBack }}>
      {children}
    </BackNavigationContext.Provider>
  )
}
