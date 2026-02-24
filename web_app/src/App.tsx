import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Dashboard from './pages/Dashboard';
import Fingerprint from './pages/Fingerprint';
import Monitor from './pages/Monitor';
import Evidence from './pages/Evidence';
import Login from './pages/Login';
import Register from './pages/Register';
import Pricing from './pages/Pricing';
import Admin from './pages/Admin';

import { AppProvider } from './contexts/AppContext';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="fingerprint" element={<Fingerprint />} />
            <Route path="monitor" element={<Monitor />} />
            <Route path="evidence" element={<Evidence />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="admin" element={<Admin />} />
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
