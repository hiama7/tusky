// Subscription management (demo): current plan, choose a plan, cancel.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crown, CalendarDays, XCircle } from 'lucide-react';
import { DemoBanner, Modal, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import PricingPlans from '../../components/sections/PricingPlans';
import PaymentModal from '../../components/match/PaymentModal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { cancelSubscription, getSubscription, getWalletSync, subscribe } from '../../services/purchases';
import { planById } from '../../data/demo/plans';
import { fmtDate } from '../../utils/format';

export default function Subscription() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [plan, setPlan] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: sub, loading } = useAsync(() => getSubscription(user.id), [user.id]);
  const active = sub?.status === 'Active';

  // Pricing page links here with ?plan=monthly — open checkout automatically.
  useEffect(() => {
    const p = planById(params.get('plan'));
    if (p && !loading && !active) setPlan(p);
    if (params.get('plan') && !loading) setParams({}, { replace: true });
  }, [params, loading, active, setParams]);

  function choose(p) {
    if (active) return toast.warning('Cancel your current plan before switching (demo rule).');
    setPlan(p);
  }

  async function doCancel() {
    setBusy(true);
    await cancelSubscription(user);
    setBusy(false);
    setCancelOpen(false);
    toast.info('Subscription cancelled.');
  }

  const days = active ? Math.max(0, Math.ceil((new Date(sub.end) - Date.now()) / 864e5)) : 0;
  const current = sub && planById(sub.planId);

  return (
    <>
      <PageHeader title="Subscription" subtitle="Unlock every prediction while your plan is active." />
      {loading ? <Skeleton className="mb-8 h-36 rounded-2xl" /> : (
        <section className="glass mb-8 flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="stat-icon h-14 w-14 bg-gradient-to-br from-blue to-purple text-white"><Crown className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-muted">Current plan</p>
              <p className="text-xl font-bold">{current ? current.name : 'No subscription'}</p>
              {sub && <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><StatusBadge status={sub.status} /><CalendarDays className="h-3.5 w-3.5" /> {fmtDate(sub.start)} → {fmtDate(sub.end)}</p>}
            </div>
          </div>
          {active ? (
            <div className="w-full md:w-72">
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">{days} days remaining</span><span>{current.days} days</span></div>
              <div className="bar-track"><div className="bar-fill bg-gradient-to-r from-blue to-purple" style={{ width: `${(days / current.days) * 100}%` }} /></div>
              <button className="btn-ghost btn-sm mt-3 text-red" onClick={() => setCancelOpen(true)}><XCircle className="h-4 w-4" /> Cancel subscription</button>
            </div>
          ) : <p className="text-sm text-muted">Choose a plan below — individual purchases stay valid either way.</p>}
        </section>
      )}

      <PricingPlans onChoose={choose} activePlanId={active ? sub.planId : null} />
      <DemoBanner className="mt-6">Subscriptions are simulated in Stage 1. Stage 2 will use the payment gateway’s recurring billing and server-side expiry checks.</DemoBanner>

      <PaymentModal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={plan ? `${plan.name} subscription` : ''}
        subtitle={plan ? `${plan.days} days of unlimited predictions` : ''}
        amount={plan?.price || 0}
        walletBalance={getWalletSync(user.id)}
        onPay={(method) => subscribe(user, plan.id, method)}
        onSuccess={() => toast.success('All predictions are now unlocked while your plan is active.', 'Subscription active')}
      />

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel subscription?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setCancelOpen(false)}>Keep plan</button><button className="btn-danger" onClick={doCancel} disabled={busy}>{busy ? <span className="spinner" /> : 'Cancel plan'}</button></>}>
        <p className="text-sm text-muted">Subscription-only unlocks will lock again. Matches you bought individually or unlocked with your free trial stay unlocked.</p>
      </Modal>
    </>
  );
}
