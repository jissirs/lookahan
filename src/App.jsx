import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthProvider.jsx'
import { InventoryProvider } from './context/InventoryProvider.jsx'
import ForgetPasswordPage from './pages/forgetpassword/ForgetPasswordPage.jsx'
import HomePage from './pages/home/HomePage.jsx'
import LoginPage from './pages/login/LoginPage.jsx'
import MenuFormPage from './pages/menu/MenuFormPage.jsx'
import MenuPage from './pages/menu/MenuPage.jsx'
import RecipePage from './pages/menu/RecipePage.jsx'
import RegisterPage from './pages/register/RegisterPage.jsx'
import CreateIngredientPage from './pages/stock/CreateIngredientPage.jsx'
import IngredientDetailPage from './pages/stock/IngredientDetailPage.jsx'
import LowStockPage from './pages/stock/LowStockPage.jsx'
import StockPage from './pages/stock/StockPage.jsx'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <InventoryProvider>
          <Routes>
            {/* ----- หน้าแรก ----- */}
            {/* TODO: ครอบด้วย <RequireAuth> เมื่อเชื่อม backend แล้ว (ตอนนี้ล็อกอินจริงยังไม่ได้ จึงเปิดให้เข้าได้เลย) */}
            <Route path="/" element={<HomePage />} />
            <Route path="/home" element={<HomePage />} />

            {/* ----- บัญชีผู้ใช้ ----- */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgetpassword" element={<ForgetPasswordPage />} />

            {/* ----- Stock (วัตถุดิบ) ----- */}
            <Route path="/stock" element={<StockPage />} />
            <Route path="/stock/low" element={<LowStockPage />} />
            <Route path="/stock/new" element={<CreateIngredientPage />} />
            {/* :id ต้องอยู่หลัง /low และ /new ไม่งั้นจะถูกตีความว่า id = "low" (router จัดอันดับให้อยู่แล้ว แต่เรียงไว้ให้อ่านง่าย) */}
            <Route path="/stock/:id" element={<IngredientDetailPage />} />

            {/* ----- Menu (เมนูอาหาร) ----- */}
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/menu/new" element={<MenuFormPage />} />
            <Route path="/menu/:id/edit" element={<MenuFormPage />} />
            <Route path="/menu/:id/recipe" element={<RecipePage />} />

            {/* path ที่ไม่มี (รวมหน้า Order / Statistics / Ai ที่ยังไม่ได้สร้าง) → กลับหน้าแรก */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </InventoryProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
