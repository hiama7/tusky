// Route map. Paths mirror the Stage 1 brief's file names
// (index.html → "/", user/dashboard.html → "/user/dashboard", …).
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './components/layout/PublicLayout';
import UserLayout from './components/layout/UserLayout';
import AdminLayout from './components/layout/AdminLayout';

import Home from './pages/public/Home';
import Sports from './pages/public/Sports';
import News from './pages/public/News';
import Pricing from './pages/public/Pricing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import NotFound from './pages/public/NotFound';

import Dashboard from './pages/user/Dashboard';
import UserSports from './pages/user/UserSports';
import Matches from './pages/user/Matches';
import Predictions from './pages/user/Predictions';
import MatchDetails from './pages/user/MatchDetails';
import Purchases from './pages/user/Purchases';
import Subscription from './pages/user/Subscription';
import FreeTrial from './pages/user/FreeTrial';
import Wallet from './pages/user/Wallet';
import Transactions from './pages/user/Transactions';
import Profile from './pages/user/Profile';
import UserNews from './pages/user/UserNews';

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminMatches = lazy(() => import('./pages/admin/AdminMatches'));
const AdminPredictions = lazy(() => import('./pages/admin/AdminPredictions'));
const AdminNews = lazy(() => import('./pages/admin/AdminNews'));
const AdminSubscriptions = lazy(() => import('./pages/admin/AdminSubscriptions'));
const AdminTransactions = lazy(() => import('./pages/admin/AdminTransactions'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));

// Admin pages are lazy-loaded so regular visitors don't download them.
const Loading = () => <div className="flex min-h-screen items-center justify-center"><span className="spinner" /></div>;

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      {/* Public site */}
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<Home scrollTo="about" />} />
        <Route path="sports" element={<Sports />} />
        <Route path="news" element={<News />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />

      {/* User area (demo session required) */}
      <Route path="user" element={<UserLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="sports" element={<UserSports />} />
        <Route path="matches" element={<Matches />} />
        <Route path="predictions" element={<Predictions />} />
        <Route path="match/:id" element={<MatchDetails />} />
        <Route path="match-details" element={<Navigate to="/user/match/m101" replace />} />
        <Route path="news" element={<UserNews />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="free-trial" element={<FreeTrial />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Profile tab="settings" />} />
      </Route>

      {/* Admin area (separate demo session) */}
      <Route path="admin/login" element={<AdminLogin />} />
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="matches" element={<AdminMatches />} />
        <Route path="predictions" element={<AdminPredictions />} />
        <Route path="news" element={<AdminNews />} />
        <Route path="subscriptions" element={<AdminSubscriptions />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
