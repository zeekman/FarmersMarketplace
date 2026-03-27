import React, { useEffect, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoadingProvider, LoadingContext } from './context/LoadingContext';
import { setLoadingCallback, setLogoutCallback } from './api/client';
import Navbar from './components/Navbar';
import LoadingSpinner from './components/LoadingSpinner';
import { LoginPage, RegisterPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Marketplace from './pages/Marketplace';
import ProductDetail from './pages/ProductDetail';
import Wallet from './pages/Wallet';
import Orders from './pages/Orders';
import FarmerProfile from './pages/FarmerProfile';

import AdminDashboard from './pages/AdminDashboard';

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (user.role === 'admin') return <Navigate to="/admin" />;
  return <Navigate to={user.role === 'farmer' ? '/dashboard' : '/marketplace'} />;
}

function AppContent() {
  const { setLoading } = useContext(LoadingContext);
  const { logout } = useAuth();

  useEffect(() => {
    setLoadingCallback(setLoading);
    setLogoutCallback(logout);
  }, [setLoading, logout]);

  return (
    <>
      <Navbar />
      <LoadingSpinner />
      <div style={{ paddingTop: 24 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute role="farmer">
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <PrivateRoute>
                <Wallet />
              </PrivateRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <PrivateRoute>
                <Orders />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PrivateRoute role="admin">
                <AdminDashboard />
              </PrivateRoute>
            }
          />
          <Route path="/farmer/:id" element={<FarmerProfile />} />
        </Routes>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LoadingProvider>
        <AppContent />
      </LoadingProvider>
    </AuthProvider>
  );
}
