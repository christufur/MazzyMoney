import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const RegisterForm: React.FC = () => {
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const { register, loading } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.email || !formData.password || !formData.fullName) {
      setError('Fill in your name, email, and a password.');
      return;
    }
    if (formData.password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    try {
      await register(formData.email, formData.password, formData.fullName, formData.inviteCode || undefined);
    } catch (err: any) {
      const code = err.response?.data?.error;
      setError(code === 'Invite code required'
        ? 'This server needs an invite code. Ask the person who set it up.'
        : code === 'User already exists'
          ? 'An account with this email already exists. Sign in instead.'
          : code || 'Could not create the account. Try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <p role="alert" className="rounded-md bg-terra-tint px-3.5 py-2.5 text-sm text-terra">{error}</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="fullName">Name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" value={formData.fullName} onChange={handleChange} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" value={formData.email} onChange={handleChange} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" value={formData.password} onChange={handleChange} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inviteCode">Invite code</Label>
        <Input id="inviteCode" name="inviteCode" autoComplete="off" value={formData.inviteCode} onChange={handleChange} />
        <p className="text-xs text-muted-foreground">Not needed for the first account on this server.</p>
      </div>
      <Button type="submit" disabled={loading} className="h-10 w-full">
        {loading ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
};
