import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginForm } from './components/auth/LoginForm';
import { RegisterForm } from './components/auth/RegisterForm';
import Overview from "./pages/Overview";
import InsightsPage from './pages/Insights';
import TransactionsPage from './pages/Transactions';
import BudgetsPage from './pages/Budgets';
import RecurringPage from './pages/Recurring';
import ConnectionsPage from './pages/Connections';
import NetWorthPage from './pages/NetWorth';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const LoadingSpinner: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-paper" role="status">
    <span className="text-sm text-muted-foreground">Opening your ledger…</span>
  </div>
);

const AuthLayout: React.FC<{ children: React.ReactNode; title: string; footer: React.ReactNode }> = ({ children, title, footer }) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-5 py-12">
    <div className="w-full max-w-sm">
      <p className="mb-10 text-center text-[15px] font-semibold tracking-tight text-ink">Mazzy Money</p>
      <div className="sheet px-6 py-8 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold text-ink">{title}</h1>
        {children}
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  </div>
);

// Route guards
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  return user ? <Navigate to="/overview" replace /> : <>{children}</>;
};

// Main App
const App: React.FC = () => {
  return (
    <AuthProvider>
      <TooltipProvider>
      <Router>
        <Routes>
          {/* Login */}
          <Route
            path="/login"
            element={
              <PublicRoute>
                <AuthLayout
                  title="Sign in"
                  footer={<>New to this server? <Link to="/register" className="font-medium text-ink underline underline-offset-4">Create an account</Link></>}
                >
                  <LoginForm />
                </AuthLayout>
              </PublicRoute>
            }
          />

          {/* Register */}
          <Route
            path="/register"
            element={
              <PublicRoute>
                <AuthLayout
                  title="Create an account"
                  footer={<>Already have an account? <Link to="/login" className="font-medium text-ink underline underline-offset-4">Sign in</Link></>}
                >
                  <RegisterForm />
                </AuthLayout>
              </PublicRoute>
            }
          />

          {/* Overview (main dashboard) */}
          <Route
            path="/overview"
            element={
              <ProtectedRoute>
                <Overview />
              </ProtectedRoute>
            }
          />

          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <TransactionsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/budgets"
            element={
              <ProtectedRoute>
                <BudgetsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/recurring"
            element={
              <ProtectedRoute>
                <RecurringPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/insights"
            element={
              <ProtectedRoute>
                <InsightsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/net-worth"
            element={
              <ProtectedRoute>
                <NetWorthPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/connections"
            element={
              <ProtectedRoute>
                <ConnectionsPage />
              </ProtectedRoute>
            }
          />

          {/* Legacy redirects */}
          <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
          <Route path="/reports" element={<Navigate to="/insights" replace />} />
          <Route path="/analytics" element={<Navigate to="/insights" replace />} />
          <Route path="/budget" element={<Navigate to="/budgets" replace />} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Router>
      <Toaster position="bottom-right" />
      </TooltipProvider>
    </AuthProvider>
  );
};

export default App;