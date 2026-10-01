import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { configureAmplify } from './lib/amplify';
import { AuthProvider } from './context/AuthContext';
import { ReloadPrompt } from './components/ReloadPrompt';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './pages/app/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import ProfilePage from './pages/app/ProfilePage';
import AddContentPage from './pages/app/AddContentPage';
import LibraryPage from './pages/app/LibraryPage';
import DocumentDetailPage from './pages/app/DocumentDetailPage';

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
            <Route index element={<LibraryPage />} />
            <Route path="add" element={<AddContentPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/:documentId" element={<DocumentDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
