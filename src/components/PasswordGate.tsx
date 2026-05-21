import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

const PASS_KEY = 'dashboard-authenticated';
const DEFAULT_PASSWORD = 'Shovon@#124422';
const DASHBOARD_PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD || DEFAULT_PASSWORD;

export const isAuthenticated = () => sessionStorage.getItem(PASS_KEY) === 'true';
export const setAuthenticated = () => sessionStorage.setItem(PASS_KEY, 'true');

export const PasswordGate = ({ onSuccess }: { onSuccess: () => void }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === DASHBOARD_PASSWORD) {
      setAuthenticated();
      onSuccess();
    } else {
      setError(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard Login</h1>
          <p className="text-sm text-muted-foreground">Enter password to continue</p>
          {DASHBOARD_PASSWORD === DEFAULT_PASSWORD && (
            <p className="text-xs text-muted-foreground text-center">
              Secure dashboard access is enabled.
            </p>
          )}
        </div>
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(false); }}
          className={error ? 'border-destructive' : ''}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">Wrong password</p>}
        <Button type="submit" className="w-full">Login</Button>
      </form>
    </div>
  );
};
