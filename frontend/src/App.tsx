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
import './App.css';
import InsightsPage from './pages/Insights';
import TransactionsPage from './pages/Transactions';
import BudgetsPage from './pages/Budgets';
import ConnectionsPage from './pages/Connections';

// Loading spinner
const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center items-center h-screen">
    <div className="animate-pulse flex space-x-4">
      <div className="rounded-full bg-blue-400 h-6 w-6"></div>
      <div className="flex-1 space-y-2">
        <div className="text-lg">Loading...</div>
      </div>
    </div>
  </div>
);

// Auth layout wrapper
const AuthLayout: React.FC<{
  children: React.ReactNode;
  title: string;
}> = ({ children, title }) => (
  <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <h1 className="text-center text-3xl font-extrabold text-gray-900 mb-8">
        Money App
      </h1>
    </div>
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
        {children}
      </div>
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
  return user ? <Navigate to="/dashboard" replace /> : <>{children}</>;
};

// Main App
const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Login */}
          <Route
            path="/login"
            element={
              <PublicRoute>
                <AuthLayout title="Sign In">
                  <LoginForm />
                  <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600">
                      Don&apos;t have an account?{' '}
                      <Link
                        to="/register"
                        className="text-blue-600 hover:text-blue-500 font-medium"
                      >
                        Sign up
                      </Link>
                    </p>
                  </div>
                </AuthLayout>
              </PublicRoute>
            }
          />

          {/* Register */}
          <Route
            path="/register"
            element={
              <PublicRoute>
                <AuthLayout title="Create Account">
                  <RegisterForm />
                  <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600">
                      Already have an account?{' '}
                      <Link
                        to="/login"
                        className="text-blue-600 hover:text-blue-500 font-medium"
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>
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
            path="/insights"
            element={
              <ProtectedRoute>
                <InsightsPage />
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
    </AuthProvider>
  );
};

export default App;