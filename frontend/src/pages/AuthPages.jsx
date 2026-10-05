import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

function AuthForm({ mode }) {
  const isLogin = mode === 'login';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = isLogin ? await login({ email: form.email, password: form.password }) : await register(form);
      const fallback = user.role === 'admin' ? '/admin' : '/';
      navigate(location.state?.from || fallback, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        {!isLogin && (
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={set('name')} required minLength={2} autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={isLogin ? 1 : 8}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          {!isLogin && <small className="muted">At least 8 characters, with a letter and a number.</small>}
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Sign up'}
        </button>
        <p className="muted small center">
          {isLogin ? (
            <>
              No account? <Link to="/register">Sign up</Link>
            </>
          ) : (
            <>
              Already a member? <Link to="/login">Log in</Link>
            </>
          )}
        </p>
        {isLogin && (
          <div className="demo-creds small">
            <strong>Demo accounts</strong>
            <span>Admin: admin@cowork.test / Admin@123</span>
            <span>Member: member@cowork.test / Member@123</span>
          </div>
        )}
      </form>
    </div>
  );
}

export const LoginPage = () => <AuthForm mode="login" />;
export const RegisterPage = () => <AuthForm mode="register" />;
