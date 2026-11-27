// Turn authenticator-app sign-in on or off for the signed-in administrator.
import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Field, Skeleton } from '../ui';
import PasswordInput from '../ui/PasswordInput';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { twoFactorDisable, twoFactorEnable, twoFactorSetup, twoFactorStatus } from '../../services/auth';

export default function TwoFactorPanel() {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: status } = useAsync(() => twoFactorStatus(), [version], { live: false });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(null); // { secret, otpauthUrl }
  const [recovery, setRecovery] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(Object.values(e.fields || {})[0] || e.message);
    } finally {
      setBusy(false);
    }
  }
  const reset = () => { setPassword(''); setCode(''); setPending(null); setError(''); };

  const start = (e) => { e.preventDefault(); run(async () => setPending(await twoFactorSetup(password))); };
  const confirm = (e) => {
    e.preventDefault();
    run(async () => {
      const { recoveryCodes } = await twoFactorEnable(code);
      reset();
      setRecovery(recoveryCodes);
      setVersion((v) => v + 1);
      toast.success('Two-factor sign-in is on.');
    });
  };
  const turnOff = (e) => {
    e.preventDefault();
    run(async () => {
      await twoFactorDisable(password, code);
      reset();
      setRecovery(null);
      setVersion((v) => v + 1);
      toast.success('Two-factor sign-in is off.');
    });
  };

  const codeField = (label) => (
    <Field label={label}><input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} /></Field>
  );

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-brand" /> Two-factor sign-in</h2>
      {!status ? <Skeleton className="h-24" /> : (
        <>
          <p className="text-sm text-muted">
            {status.enabled ? `On. ${status.recoveryCodesLeft} recovery codes left.` : 'Off. Add a code from an authenticator app to your admin sign-in.'}
          </p>
          {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{error}</p>}

          {recovery && (
            <div className="rounded-xl border border-orange/40 bg-orange/10 p-3 text-sm">
              <p className="font-semibold">Save these recovery codes now. They are not shown again.</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
              <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setRecovery(null)}>I have saved them</button>
            </div>
          )}

          {!status.enabled && !pending && (
            <form onSubmit={start} className="space-y-3">
              <Field label="Your admin password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              <div className="flex justify-end"><button className="btn-primary" disabled={busy || !password}>{busy ? <span className="spinner" /> : 'Set up'}</button></div>
            </form>
          )}

          {!status.enabled && pending && (
            <form onSubmit={confirm} className="space-y-3">
              <p className="text-sm">In your authenticator app choose “enter a setup key” (time-based) and type this key:</p>
              <p className="select-all break-all rounded-lg bg-white/5 px-3 py-2 font-mono text-sm tracking-wider">{pending.secret.match(/.{1,4}/g).join(' ')}</p>
              <p className="text-xs text-muted">On the phone that has the app, <a className="text-brand underline" href={pending.otpauthUrl}>add it directly</a>.</p>
              {codeField('Code shown by the app')}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={reset}>Cancel</button>
                <button className="btn-primary" disabled={busy || code.length < 6}>{busy ? <span className="spinner" /> : 'Turn on'}</button>
              </div>
            </form>
          )}

          {status.enabled && (
            <form onSubmit={turnOff} className="space-y-3">
              <Field label="Your admin password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              {codeField('Code from the app, or a recovery code')}
              <div className="flex justify-end"><button className="btn-danger" disabled={busy || !password || code.length < 6}>{busy ? <span className="spinner" /> : 'Turn off'}</button></div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
