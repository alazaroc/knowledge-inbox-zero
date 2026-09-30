import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { configureAmplify } from './lib/amplify';
import { AuthProvider } from './context/AuthContext';
import { ReloadPrompt } from './components/ReloadPrompt';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './pages/app/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import ItemsPage from './pages/app/ItemsPage';
import ProfilePage from './pages/app/ProfilePage';

configureAmplify();

export default function App() {
  return (
    <AuthProvider>
      <ReloadPrompt />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ItemsPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
