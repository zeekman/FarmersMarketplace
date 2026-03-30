import React, { lazy, Suspense, useEffect, useContext } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { CompareProvider } from './context/CompareContext';
import { LoadingProvider, LoadingContext } from './context/LoadingContext';
import { setLoadingCallback, setLogoutCallback } from './api/client';
import ErrorBoundary from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import LoadingSpinner from './components/LoadingSpinner';
import PageLoader from './components/PageLoader';

const LoginPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.RegisterPage })));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Compare = lazy(() => import('./pages/Compare'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Orders = lazy(() => import('./pages/Orders'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const FarmerProfile = lazy(() => import('./pages/FarmerProfile'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AddressBook = lazy(() => import('./pages/AddressBook'));
const Settings = lazy(() => import('./pages/Settings'));
const AccountRecovery = lazy(() => import('./pages/Settings').then(m => ({ default: m.AccountRecovery })));

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
  const location = useLocation();

  useEffect(() => {
    setLoadingCallback(setLoading);
    setLogoutCallback(logout);
  }, [setLoading, logout]);

  // Announce page changes to screen readers
  useEffect(() => {
    const announcer = document.getElementById('page-announcer');
    if (announcer) announcer.textContent = `Navigated to ${document.title}`;
  }, [location.pathname]);

  return (
    <>
      <Navbar />
      <LoadingSpinner />
      <main id="main-content" style={{ paddingTop: 24 }}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/dashboard" element={<PrivateRoute role="farmer"><Dashboard /></PrivateRoute>} />
            <Route path="/wallet" element={<PrivateRoute><Wallet /></PrivateRoute>} />
            <Route path="/orders" element={<PrivateRoute><Orders /></PrivateRoute>} />
            <Route path="/subscriptions" element={<PrivateRoute role="buyer"><Subscriptions /></PrivateRoute>} />
            <Route path="/admin" element={<PrivateRoute role="admin"><AdminDashboard /></PrivateRoute>} />
            <Route path="/farmer/:id" element={<FarmerProfile />} />
            <Route path="/addresses" element={<PrivateRoute role="buyer"><AddressBook /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
            <Route path="/recover" element={<AccountRecovery />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <FavoritesProvider>
          <CompareProvider>
            <LoadingProvider>
              <AppContent />
            </LoadingProvider>
          </CompareProvider>
        </FavoritesProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
