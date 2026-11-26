// Split-screen layout for login / register / admin login.
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Logo, ProbBar } from '../ui';
import StadiumArt from '../graphics/StadiumArt';
import { cx } from '../../utils/format';

export default function AuthLayout({ title, subtitle, children, admin = false, points }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Visual side */}
      <div className={cx('relative hidden overflow-hidden border-r border-white/5 bg-ink-2 lg:flex lg:flex-col lg:justify-between lg:p-12', admin && 'admin-accent')}>
        <StadiumArt className="absolute -bottom-6 left-0 w-full opacity-60" />
        <Logo admin={admin} className="relative" />
        <div className="relative">
          <h2 className="max-w-md text-4xl font-bold leading-tight">{admin ? 'Run the platform with clarity.' : <>Make every match day <span className="text-gradient">smarter.</span></>}</h2>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            {(points || ['Win probabilities for every featured match', 'Team form, head-to-head & player stats', 'Your first prediction free']).map((p) => (
              <li key={p} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green" /> {p}</li>
            ))}
          </ul>
          <div className="glass mt-10 max-w-sm p-5 animate-float">
            <p className="text-xs text-muted">{admin ? "Today's revenue (sample)" : 'Brazil vs Argentina — preview'}</p>
            <div className="mt-3 space-y-2"><ProbBar value={admin ? 72 : 54} /><ProbBar value={admin ? 48 : 46} color="#FFFFFF" delay={150} /></div>
          </div>
        </div>
        <p className="relative text-xs text-muted">© TUSKY — sports analytics</p>
      </div>

      {/* Form side */}
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to site</Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10 page-enter">
          <div className="mb-6 lg:hidden"><Logo admin={admin} /></div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
