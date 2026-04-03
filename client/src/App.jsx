import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './api/client';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ElectionDetail from './pages/ElectionDetail';
import RaceDetail from './pages/RaceDetail';
import RoundDetail from './pages/RoundDetail';
import Scanner from './pages/Scanner';
import SpoiledBallot from './pages/SpoiledBallot';
import Confirmation from './pages/Confirmation';
import ChairDecision from './pages/ChairDecision';
import PublicDashboard from './pages/PublicDashboard';
import PublicRoundDetail from './pages/PublicRoundDetail';
import PublicBallotViewer from './pages/PublicBallotViewer';

function ProtectedRoute({ children, auth }) {
  if (!auth.checked) return null; // still loading
  if (!auth.role) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [auth, setAuth] = useState({ role: null, token: null, checked: false });

  useEffect(() => {
    // Check if already logged in (cookie-based)
    api.get('/auth/me')
      .then(({ data }) => {
        if (data.authenticated) {
          setAuth({ role: data.role, token: null, checked: true });
        } else {
          setAuth({ role: null, token: null, checked: true });
        }
      })
      .catch(() => setAuth({ role: null, token: null, checked: true }));
  }, []);

  const handleLogin = (role, token) => {
    // Store token for API calls
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setAuth({ role, token, checked: true });
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    delete api.defaults.headers.common['Authorization'];
    setAuth({ role: null, token: null, checked: true });
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={
          auth.role ? <Navigate to="/admin" replace /> : <Login onLogin={handleLogin} />
        } />

        {/* Admin routes — protected */}
        <Route path="/admin" element={
          <ProtectedRoute auth={auth}><AdminDashboard onLogout={handleLogout} auth={auth} /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id" element={
          <ProtectedRoute auth={auth}><ElectionDetail /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/races/:raceId" element={
          <ProtectedRoute auth={auth}><RaceDetail /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/races/:raceId/rounds/:roundId" element={
          <ProtectedRoute auth={auth}><RoundDetail /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/races/:raceId/rounds/:roundId/confirm" element={
          <ProtectedRoute auth={auth}><Confirmation /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/races/:raceId/rounds/:roundId/chair" element={
          <ProtectedRoute auth={auth}><ChairDecision /></ProtectedRoute>
        } />

        {/* Scanner routes — no auth (tally operators) */}
        <Route path="/scan/:roundId" element={<Scanner />} />
        <Route path="/scan/:roundId/spoiled" element={<SpoiledBallot />} />

        {/* Public routes — no auth */}
        <Route path="/public/:electionId" element={<PublicDashboard />} />
        <Route path="/public/:electionId/rounds/:roundId" element={<PublicRoundDetail />} />
        <Route path="/public/:electionId/ballots/:serialNumber" element={<PublicBallotViewer />} />
      </Routes>
    </BrowserRouter>
  );
}
