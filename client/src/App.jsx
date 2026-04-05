import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './api/client';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ElectionDetail from './pages/ElectionDetail';
import RaceDetail from './pages/RaceDetail';
import RoundDetail from './pages/RoundDetail';
import BallotReviewQueue from './pages/BallotReviewQueue';
import BallotBoxDetail from './pages/BallotBoxDetail';
import BallotDesigner from './pages/BallotDesigner';
import Scanner from './pages/Scanner';
import Confirmation from './pages/Confirmation';
import ChairDecision from './pages/ChairDecision';
import PublicDashboard from './pages/PublicDashboard';
import PublicRoundDetail from './pages/PublicRoundDetail';
import PublicBallotViewer from './pages/PublicBallotViewer';
import UserManagement from './pages/UserManagement';
import ControlCenter from './pages/ControlCenter';

function ProtectedRoute({ children, auth, requiredRoles }) {
  if (!auth.checked) return null;
  if (!auth.role) return <Navigate to="/login" replace />;
  if (requiredRoles && !requiredRoles.includes(auth.role)) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

export default function App() {
  const [auth, setAuth] = useState({ role: null, token: null, user_id: null, name: null, checked: false });

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => {
        if (data.authenticated) {
          setAuth({ role: data.role, token: null, user_id: data.user_id, name: data.name, checked: true });
        } else {
          setAuth({ role: null, token: null, user_id: null, name: null, checked: true });
        }
      })
      .catch(() => setAuth({ role: null, token: null, user_id: null, name: null, checked: true }));
  }, []);

  const handleLogin = (role, token, user_id, name) => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setAuth({ role, token, user_id, name, checked: true });
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    delete api.defaults.headers.common['Authorization'];
    setAuth({ role: null, token: null, user_id: null, name: null, checked: true });
  };

  const loginRedirect = auth.role
    ? <Navigate to="/admin" replace />
    : <Login onLogin={handleLogin} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={loginRedirect} />

        {/* Admin routes — any authenticated user */}
        <Route path="/admin" element={
          <ProtectedRoute auth={auth}>
            <AdminDashboard onLogout={handleLogout} auth={auth} />
          </ProtectedRoute>
        } />
        <Route path="/admin/elections/:id" element={
          <ProtectedRoute auth={auth}><ElectionDetail /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/races/:raceId" element={
          <ProtectedRoute auth={auth}><RaceDetail /></ProtectedRoute>
        } />
        <Route path="/admin/elections/:id/ballot-design" element={
          <ProtectedRoute auth={auth}><BallotDesigner /></ProtectedRoute>
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
        <Route path="/admin/elections/:id/races/:raceId/rounds/:roundId/review" element={
          <ProtectedRoute auth={auth}><BallotReviewQueue /></ProtectedRoute>
        } />
        <Route path="/admin/rounds/:roundId/boxes" element={
          <ProtectedRoute auth={auth}><BallotBoxDetail /></ProtectedRoute>
        } />

        {/* User management — super_admin only */}
        <Route path="/admin/users" element={
          <ProtectedRoute auth={auth} requiredRoles={['super_admin']}>
            <UserManagement />
          </ProtectedRoute>
        } />

        {/* Control Center — super_admin only */}
        <Route path="/admin/control-center" element={
          <ProtectedRoute auth={auth} requiredRoles={['super_admin']}>
            <ControlCenter />
          </ProtectedRoute>
        } />

        {/* Scanner routes — no auth */}
        <Route path="/scan/:roundId" element={<Scanner />} />

        {/* Public routes — no auth */}
        <Route path="/public/:electionId" element={<PublicDashboard />} />
        <Route path="/public/:electionId/rounds/:roundId" element={<PublicRoundDetail />} />
        <Route path="/public/:electionId/ballots/:serialNumber" element={<PublicBallotViewer />} />
      </Routes>
    </BrowserRouter>
  );
}
