// Route map. Client-side guards only control what is shown — every API call is
// authenticated and authorised again on the server.
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './components/layout/PublicLayout';
import UserLayout from './components/layout/UserLayout';
import AdminLayout from './components/layout/AdminLayout';

import Home from './pages/public/Home';
import Sports from './pages/public/Sports';
import Pricing from './pages/public/Pricing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import NotFound from './pages/public/NotFound';


const News = lazy(() => import('./pages/public/News'));
const ResetPassword = lazy(() => import('./pages/public/ResetPassword'));
const Policy = lazy(() => import('./pages/public/Policy'));
const TrackRecord = lazy(() => import('./pages/public/TrackRecord'));
const Dashboard = lazy(() => import('./pages/user/Dashboard'));
const UserSports = lazy(() => import('./pages/user/UserSports'));
const Matches = lazy(() => import('./pages/user/Matches'));
const Predictions = lazy(() => import('./pages/user/Predictions'));
const MatchDetails = lazy(() => import('./pages/user/MatchDetails'));
const Purchases = lazy(() => import('./pages/user/Purchases'));
const Subscription = lazy(() => import('./pages/user/Subscription'));
const FreeTrial = lazy(() => import('./pages/user/FreeTrial'));
const Wallet = lazy(() => import('./pages/user/Wallet'));
const Transactions = lazy(() => import('./pages/user/Transactions'));
const Profile = lazy(() => import('./pages/user/Profile'));
const UserNews = lazy(() => import('./pages/user/UserNews'));
const Results = lazy(() => import('./pages/user/Results'));
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
const AdminModel = lazy(() => import('./pages/admin/AdminModel'));

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
        <Route path="track-record" element={<TrackRecord />} />
        {['terms', 'privacy', 'refunds', 'disclaimer'].map((name) => <Route key={name} path={name} element={<Policy key={name} name={name} />} />)}
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />
      <Route path="reset-password" element={<ResetPassword />} />

      {/* User area (login required) */}
      <Route path="user" element={<UserLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="sports" element={<UserSports />} />
        <Route path="matches" element={<Matches />} />
        <Route path="predictions" element={<Predictions />} />
        <Route path="results" element={<Results />} />
        <Route path="match/:id" element={<MatchDetails />} />
        <Route path="match-details" element={<Navigate to="/user/matches" replace />} />
        <Route path="news" element={<UserNews />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="free-trial" element={<FreeTrial />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Profile tab="settings" />} />
      </Route>

      {/* Admin area (separate admin session) */}
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
        <Route path="model" element={<AdminModel />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
