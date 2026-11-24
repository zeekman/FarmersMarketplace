import React, { lazy, Suspense, useEffect, useContext, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { CompareProvider } from './context/CompareContext';
import { NetworkProvider } from './context/NetworkContext';
import { LoadingProvider, LoadingContext } from './context/LoadingContext';
import { ThemeProvider } from './context/ThemeContext';
import { showToast } from './utils/toast';
import { setLoadingCallback, setLogoutCallback, setEmailNotVerifiedCallback } from './api/client';
import ErrorBoundary from './components/ErrorBoundary';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import Navbar from './components/Navbar';
import AnnouncementBanner from './components/AnnouncementBanner';
import EmailVerificationBanner from './components/EmailVerificationBanner';
import LoadingSpinner from './components/LoadingSpinner';
import PageLoader from './components/PageLoader';
import UpdatePrompt from './components/UpdatePrompt';
import OfflineBanner from './components/OfflineBanner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { startOutboxSync } from './utils/draftOutbox';
import { getLocaleDirection } from './i18n';

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })))
  : () => null;
import { initSentry } from './utils/sentry';
import { getLocaleDirection } from './i18n';

const LoginPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/PasswordReset').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/PasswordReset').then(m => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmail').then(m => ({ default: m.VerifyEmailPage })));
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
const Messages = lazy(() => import('./pages/Messages'));
const Notifications = lazy(() => import('./pages/Notifications'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RoleMismatch({ role }) {
  useEffect(() => {
    showToast(`This page is for ${role}s only`, 'error');
  }, [role]);
  return <Navigate to="/" replace />;
}

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (role && user.role !== role) return <RoleMismatch role={role} />;
function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const [shouldRedirect, setShouldRedirect] = React.useState(false);

  // Fire toast from effect, not during render, to avoid React 19 "setState in render" warning
  React.useEffect(() => {
    if (user && role && user.role !== role) {
      const roleMessages = {
        farmer: t('privateRoute.farmerOnly'),
        buyer: t('privateRoute.buyerOnly'),
        admin: t('privateRoute.adminOnly'),
      };
      if (roleMessages[role]) {
        toast(roleMessages[role], { type: 'warning' });
      }
      setShouldRedirect(true);
    }
  }, [user, role, t]);

  if (loading) return <PageLoader />;
  
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  if (role && user.role !== role) {
    const roleMessages = {
      farmer: t('privateRoute.farmerOnly'),
      buyer: t('privateRoute.buyerOnly'),
      admin: t('privateRoute.adminOnly'),
    };
    if (roleMessages[role]) {
      toast.warning(roleMessages[role]);
    if (shouldRedirect) {
      return <Navigate to="/" replace />;
    }
    return <PageLoader />;
  }
  

function RoleMismatch({ role }) {
  useEffect(() => {
    toast.error(`This page is for ${role}s only`);
  }, [role]);
  return <Navigate to="/" replace />;
}

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (role && user.role !== role) return <RoleMismatch role={role} />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" />;
  if (user.role === 'admin') return <Navigate to="/admin" />;
  return <Navigate to={user.role === 'farmer' ? '/dashboard' : '/marketplace'} />;
}

function AppContent() {
  const { startLoading, stopLoading } = useContext(LoadingContext);
  const { logout, user } = useAuth();
  const location = useLocation();
  const { i18n } = useTranslation();
  const [showVerifyBanner, setShowVerifyBanner] = useState(false);

  useEffect(() => {
    setLoadingCallback((isStart) => isStart ? startLoading() : stopLoading());
    setLogoutCallback(logout);
    setEmailNotVerifiedCallback(() => setShowVerifyBanner(true));
  }, [startLoading, stopLoading, logout]);

  // Keep document dir/lang in sync with the active i18n language
  useEffect(() => {
    const apply = (lng) => {
      document.documentElement.setAttribute('dir', getLocaleDirection(lng));
      document.documentElement.setAttribute('lang', lng);
    };
    apply(i18n.language);
    i18n.on('languageChanged', apply);
    return () => i18n.off('languageChanged', apply);
  }, [i18n]);

  // Announce page changes to screen readers
  useEffect(() => {
    const announcer = document.getElementById('page-announcer');
    if (announcer) announcer.textContent = `Navigated to ${document.title}`;
  }, [location.pathname]);

  return (
    <>
      <a
        href="#main-content"
        className="skip-link"
        onClick={() => document.getElementById('main-content')?.focus()}
      >
        Skip to main content
      </a>
      <AnnouncementBanner />
      {showVerifyBanner && <EmailVerificationBanner email={user?.email} onDismiss={() => setShowVerifyBanner(false)} />}
      <Navbar />
      <LoadingSpinner />
      <UpdatePrompt />
      <OfflineBanner />
      <main id="main-content" tabIndex={-1} style={{ paddingTop: 24, outline: 'none' }}>
        <Suspense fallback={<PageLoader />}>
          <RouteErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
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
            <Route path="/messages" element={<PrivateRoute><Messages /></PrivateRoute>} />
            <Route path="/notifications" element={<PrivateRoute><Notifications /></PrivateRoute>} />
            <Route path="/recover" element={<AccountRecovery />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </RouteErrorBoundary>
        </Suspense>
      </main>
    </>
  );
}

export default function App() {
  React.useEffect(() => {
    return startOutboxSync();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <FavoritesProvider>
            <CompareProvider>
              <LoadingProvider>
                <NetworkProvider>
                  <AppContent />
                </NetworkProvider>
              </LoadingProvider>
            </CompareProvider>
          </FavoritesProvider>
        </AuthProvider>
      </ThemeProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
