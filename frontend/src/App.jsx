/**
 * จุดรวมของแอป: ครอบ provider ทั้งหมด และกำหนดเส้นทาง (route) ของทุกหน้า
 *
 * ลำดับการครอบ (นอก → ใน):
 *   BrowserRouter      ให้ใช้ Link / useNavigate ได้ทั้งแอป
 *   └ AuthProvider      ข้อมูลผู้ใช้ที่ล็อกอิน
 *     └ InventoryProvider  ข้อมูลวัตถุดิบ/เมนู/ออเดอร์ — โหลดจาก Backend "หลังล็อกอินแล้วเท่านั้น"
 *
 * หน้าส่วนใหญ่ต้องล็อกอินก่อน (ครอบด้วย RequireAuth) ยกเว้น Login / Register / Forget password
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import RequireAuth from './components/RequireAuth.jsx'
import { useAuth } from './context/AuthContext.js'
import { AuthProvider } from './context/AuthProvider.jsx'
import { BackNavigationProvider } from './context/BackNavigationProvider.jsx'
import { InventoryProvider } from './context/InventoryProvider.jsx'
import ForgetPasswordPage from './pages/forgetpassword/ForgetPasswordPage.jsx'
import HomePage from './pages/home/HomePage.jsx'
import LoginPage from './pages/login/LoginPage.jsx'
import LandingPage from './pages/landing/LandingPage.jsx'
import MenuFormPage from './pages/menu/MenuFormPage.jsx'
import MenuPage from './pages/menu/MenuPage.jsx'
import OrderCreatePage from './pages/order/OrderComposer.jsx'
import OrderPage from './pages/order/OrderPage.jsx'
import RecipePage from './pages/menu/RecipePage.jsx'
import RegisterPage from './pages/register/RegisterPage.jsx'
import CreateIngredientPage from './pages/stock/CreateIngredientPage.jsx'
import IngredientDetailPage from './pages/stock/IngredientDetailPage.jsx'
import LowStockPage from './pages/stock/LowStockPage.jsx'
import StockPage from './pages/stock/StockPage.jsx'

// ครอบหน้าที่ต้องล็อกอินก่อน: guard(<StockPage />)
const guard = (page) => <RequireAuth>{page}</RequireAuth>
const AiPage = lazy(() => import('./pages/ai/AiPage.jsx'))
const StatisticsPage = lazy(() => import('./pages/statistics/StatisticsPage.jsx'))

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      {/* ----- บัญชีผู้ใช้ (ไม่ต้องล็อกอิน) ----- */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgetpassword" element={<ForgetPasswordPage />} />

      {/* ----- หน้าแรก ----- */}
      <Route path="/" element={isAuthenticated ? guard(<HomePage />) : <LandingPage />} />
      <Route path="/welcome" element={<LandingPage />} />
      <Route path="/home" element={guard(<HomePage />)} />

      {/* ----- Stock (วัตถุดิบ) ----- */}
      <Route path="/stock" element={guard(<StockPage />)} />
      <Route path="/stock/low" element={guard(<LowStockPage />)} />
      <Route path="/stock/new" element={guard(<CreateIngredientPage />)} />
      {/* :id ต้องอยู่หลัง /low และ /new ไม่งั้นจะถูกตีความว่า id = "low" (router จัดอันดับให้อยู่แล้ว แต่เรียงไว้ให้อ่านง่าย) */}
      <Route path="/stock/:id" element={guard(<IngredientDetailPage />)} />

      {/* ----- Menu (เมนูอาหาร) ----- */}
      <Route path="/menu" element={guard(<MenuPage />)} />
      <Route path="/menu/new" element={guard(<MenuFormPage />)} />
      <Route path="/menu/:id/edit" element={guard(<MenuFormPage />)} />
      <Route path="/menu/:id/recipe" element={guard(<RecipePage />)} />

      {/* ----- Order (ออเดอร์) ----- */}
      <Route path="/order" element={guard(<OrderPage />)} />
      <Route path="/order/new" element={guard(<OrderCreatePage />)} />

      {/* ลิงก์ปิดร้านเดิม → ส่วนบันทึกใน Statistics */}
      <Route path="/closing" element={guard(<Navigate to="/statistics#closing" replace />)} />

      {/* ----- Ai (ผู้ช่วยวิเคราะห์) ----- */}
      <Route path="/ai" element={guard(<AiPage />)} />

      {/* ----- Statistics (สถิติ) ----- */}
      <Route path="/statistics" element={guard(<StatisticsPage />)} />

      {/* path ที่ไม่มี → กลับหน้าแรก */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

// โหลดข้อมูลคลังจาก Backend เฉพาะตอนล็อกอินแล้ว (ยังไม่ล็อกอิน Backend จะปฏิเสธคำขอ)
// key={token}: ล็อกอินคนใหม่หรือออกจากระบบ แล้วข้อมูลของคนเก่าจะถูกล้างทิ้ง ไม่ค้างข้ามบัญชี
function AppContent() {
  const { isAuthenticated, isLoading, token } = useAuth()

  if (isLoading || !isAuthenticated) return <AppRoutes />

  return (
    <BackNavigationProvider key={token}>
      <InventoryProvider>
        <AppRoutes />
      </InventoryProvider>
    </BackNavigationProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<p className="app-loading" role="status">กำลังโหลดหน้า…</p>}><AppContent /></Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
