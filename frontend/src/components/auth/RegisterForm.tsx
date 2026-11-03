import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export const RegisterForm: React.FC = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    inviteCode: ''
  });
  const [error, setError] = useState('');
  const { register, loading } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Basic validation
    if (!formData.email || !formData.password || !formData.fullName) {
      setError('All fields are required');
      return;
    }
    
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    try {
      await register(formData.email, formData.password, formData.fullName, formData.inviteCode || undefined);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-4">Create Account</h2>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm mb-4">
          {error}
        </div>
      )}
      
      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Full Name
        </label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          className="shadow-sm appearance-none border rounded-sm w-full py-2 px-3 text-gray-700 leading-tight focus:outline-hidden focus:shadow-outline"
          required
        />
      </div>
      
      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Email
        </label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          className="shadow-sm appearance-none border rounded-sm w-full py-2 px-3 text-gray-700 leading-tight focus:outline-hidden focus:shadow-outline"
          required
        />
      </div>
      
      <div className="mb-6">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Password
        </label>
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          className="shadow-sm appearance-none border rounded-sm w-full py-2 px-3 text-gray-700 leading-tight focus:outline-hidden focus:shadow-outline"
          required
        />
      </div>
      
      <div className="mb-6">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Invite code
        </label>
        <input
          type="text"
          name="inviteCode"
          value={formData.inviteCode}
          onChange={handleChange}
          placeholder="Not needed for the first account"
          className="shadow-sm appearance-none border rounded-sm w-full py-2 px-3 text-gray-700 leading-tight focus:outline-hidden focus:shadow-outline"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-sm focus:outline-hidden focus:shadow-outline disabled:opacity-50 w-full"
      >
        {loading ? 'Creating Account...' : 'Create Account'}
      </button>
    </form>
  );
};