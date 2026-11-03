import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI, setAuthToken, removeAuthToken } from '../services/api';
import { User } from '../types/auth';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, inviteCode?: string) => Promise<void>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for saved token on app load
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('userData');
    
    if (savedToken) {
      setTokenState(savedToken);
      setAuthToken(savedToken);
      
      // Try to load saved user data
      if (savedUser) {
        try {
          // Older versions stored the Plaid access token here; drop it.
          const { plaidAccessToken, ...cleanUser } = JSON.parse(savedUser);
          setUser(cleanUser);
        } catch (error) {
          console.error('Error parsing saved user data:', error);
          localStorage.removeItem('userData');
        }
      }
    }
    setLoading(false);
  }, []);

  // Save user data to localStorage whenever it changes
  useEffect(() => {
    if (user) {
      localStorage.setItem('userData', JSON.stringify(user));
    } else {
      localStorage.removeItem('userData');
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const response = await authAPI.login(email, password);
      const { token: newToken, user: userData } = response;
      
      setUser(userData);
      setTokenState(newToken);
      setAuthToken(newToken);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string, fullName: string, inviteCode?: string) => {
    setLoading(true);
    try {
      const response = await authAPI.register(email, password, fullName, inviteCode);
      const { token: newToken, user: userData } = response;
      
      setUser(userData);
      setTokenState(newToken);
      setAuthToken(newToken);
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setTokenState(null);
    removeAuthToken();
    localStorage.removeItem('userData');
  };

  // Update user data (useful for bank connection updates)
  const updateUser = (userData: Partial<User>) => {
    setUser(prevUser => prevUser ? { ...prevUser, ...userData } : null);
  };

  // Refresh user data from server (if you have a /me endpoint)
  const refreshUser = async () => {
    if (!token) return;
    
    try {
      console.log('Refreshing user data from server...');
      const response = await authAPI.getCurrentUser();
      console.log('Fresh user data:', response.user);
      setUser(response.user);
    } catch (error) {
      console.error('Failed to refresh user data:', error);
    }
  };
  

  const value = {
    user,
    token,
    login,
    register,
    logout,
    updateUser,
    refreshUser,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};