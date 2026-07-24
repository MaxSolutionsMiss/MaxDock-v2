import { ArrowLeft, ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { user, signIn, requestPasswordReset, configured } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'reset'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setIsError(false);

    if (mode === 'reset') {
      const error = await requestPasswordReset(email.trim());
      setIsError(Boolean(error));
      setMessage(error ?? 'Password reset instructions have been sent to your email.');
    } else {
      const error = await signIn(email.trim(), password);
      setIsError(Boolean(error));
      setMessage(error);
    }

    setSubmitting(false);
  };

  return (
    <div className="login-page">
      <section className="login-brand-panel">
        <Logo large />
        <div className="login-message">
          <p className="eyebrow">Dock scheduling, rebuilt properly</p>
          <h1>One clear system for every appointment.</h1>
          <p>Flat, fast, operational, and designed to match the way a real dock board works.</p>
        </div>
        <p className="login-footer">Max Solutions · Secure dock operations</p>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{mode === 'reset' ? 'Account recovery' : 'Welcome back'}</p>
            <h2>{mode === 'reset' ? 'Reset your password' : 'Sign in to MaxDock'}</h2>
            <p>{mode === 'reset' ? 'Enter your email to receive a secure reset link.' : 'Use your assigned email and password.'}</p>
          </div>

          {!configured && (
            <div className="notice notice--signal">
              Supabase environment variables have not been added yet. Authentication activates after configuration.
            </div>
          )}

          <label className="field">
            <span className="field__label">Email</span>
            <span className="input-with-icon">
              <Mail size={16} />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </span>
          </label>

          {mode === 'sign-in' && (
            <label className="field">
              <span className="field__label">Password</span>
              <span className="input-with-icon">
                <LockKeyhole size={16} />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </span>
            </label>
          )}

          {message && <div className={`notice ${isError ? 'notice--stop' : 'notice--ok'}`}>{message}</div>}

          <button className="btn btn--primary btn--full" type="submit" disabled={submitting || !configured}>
            {submitting ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            <ArrowRight size={16} />
          </button>

          <button
            className="btn btn--ghost login-card__switch"
            type="button"
            onClick={() => {
              setMode(mode === 'reset' ? 'sign-in' : 'reset');
              setMessage(null);
            }}
          >
            {mode === 'reset' && <ArrowLeft size={14} />}
            {mode === 'reset' ? 'Back to sign in' : 'Forgot your password or username?'}
          </button>
        </form>
      </section>
    </div>
  );
}
