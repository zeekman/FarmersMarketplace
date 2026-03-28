import React, { useEffect, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { LoadingProvider, LoadingContext } from './context/LoadingContext';
import { setLoadingCallback, setLogoutCallback } from './api/client';
import ErrorBoundary from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import LoadingSpinner from './components/LoadingSpinner';
import { LoginPage, RegisterPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Marketplace from './pages/Marketplace';
import ProductDetail from './pages/ProductDetail';
import Wallet from './pages/Wallet';
import Orders from './pages/Orders';
import Subscriptions from './pages/Subscriptions';
import FarmerProfile from './pages/FarmerProfile';

import AdminDashboard from './pages/AdminDashboard';
import AddressBook from './pages/AddressBook';

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
          <Route path="/dashboard" element={<PrivateRoute role="farmer"><Dashboard /></PrivateRoute>} />
          <Route path="/wallet" element={<PrivateRoute><Wallet /></PrivateRoute>} />
          <Route path="/orders" element={<PrivateRoute><Orders /></PrivateRoute>} />
          <Route path="/subscriptions" element={<PrivateRoute role="buyer"><Subscriptions /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute role="admin"><AdminDashboard /></PrivateRoute>} />
          <Route path="/farmer/:id" element={<FarmerProfile />} />
          <Route path="/addresses" element={<PrivateRoute role="buyer"><AddressBook /></PrivateRoute>} />
        </Routes>
      </div>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LoadingProvider>
          <AppContent />
        </LoadingProvider>
      </AuthProvider>
    </ErrorBoundary>
    <AuthProvider>
      <FavoritesProvider>
        <LoadingProvider>
          <AppContent />
        </LoadingProvider>
      </FavoritesProvider>
    </AuthProvider>
  );
}
