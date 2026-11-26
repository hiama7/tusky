// Subscription: current plan (from the server), queued renewals, history,
// purchase via checkout, and cancellation.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crown, CalendarDays, XCircle } from 'lucide-react';
import { DataTable, EmptyState, Modal, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import PricingPlans from '../../components/sections/PricingPlans';
import PaymentModal from '../../components/match/PaymentModal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { cancelSubscription, getPlans, getSubscription, getWallet } from '../../services/purchases';
import { fmtDate } from '../../utils/format';

export default function Subscription() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [plan, setPlan] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useAsync(() => getSubscription(), [user.id]);
  const { data: wallet } = useAsync(() => getWallet(), [user.id]);
  const { data: plans } = useAsync(() => getPlans(), []);
  const current = data?.current;

  // Pricing page links here with ?plan=<id> — open checkout automatically.
  useEffect(() => {
    const wanted = Number(params.get('plan'));
    if (!wanted || !plans) return;
    const p = plans.find((x) => x.id === wanted);
    if (p) setPlan(p);
    setParams({}, { replace: true });
  }, [params, plans, setParams]);

  async function doCancel() {
    setBusy(true);
    try {
      await cancelSubscription();
      toast.info('Subscription cancelled.');
      setCancelOpen(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <EmptyState title="Couldn’t load your subscription" text={error.message} />;
  const days = current ? Math.max(0, Math.ceil((new Date(current.end) - Date.now()) / 864e5)) : 0;
  const total = current ? Math.max(1, Math.round((new Date(current.end) - new Date(current.start)) / 864e5)) : 1;

  return (
    <>
      <PageHeader title="Subscription" subtitle="Unlock predictions for the sports your plan covers, for as long as it is active." />
      {loading ? <Skeleton className="mb-8 h-36 rounded-2xl" /> : (
        <section className="glass mb-8 flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="stat-icon h-14 w-14 bg-gradient-to-br from-solid to-deep text-ink"><Crown className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-muted">Current plan</p>
              <p className="text-xl font-bold">{current ? current.plan.name : 'No active subscription'}</p>
              {current && <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><StatusBadge status={current.status} /><CalendarDays className="h-3.5 w-3.5" /> {fmtDate(current.start)} → {fmtDate(current.end)} · {current.plan.allSports ? 'All sports' : current.plan.sports.join(', ')}</p>}
              {data?.queued?.length > 0 && <p className="mt-1 text-xs text-green">+ {data.queued.length} renewal{data.queued.length > 1 ? 's' : ''} queued (until {fmtDate(data.queued[0].end)})</p>}
            </div>
          </div>
          {current ? (
            <div className="w-full md:w-72">
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">{days} days remaining</span><span>{total} days</span></div>
              <div className="bar-track"><div className="bar-fill bg-gradient-to-r from-brand to-accent" style={{ width: `${(days / total) * 100}%` }} /></div>
              <button className="btn-ghost btn-sm mt-3 text-red" onClick={() => setCancelOpen(true)}><XCircle className="h-4 w-4" /> Cancel subscription</button>
            </div>
          ) : <p className="text-sm text-muted">Choose a plan below — individual purchases stay valid either way.</p>}
        </section>
      )}

      <PricingPlans onChoose={setPlan} />
      {current && <p className="mt-3 text-xs text-muted">Buying a plan while one is active adds a new period that starts when the current one ends.</p>}

      {data?.history?.length > 0 && (
        <>
          <h2 className="mb-4 mt-10 text-lg font-semibold">Subscription history</h2>
          <DataTable rows={data.history} columns={[
            { key: 'plan', label: 'Plan', render: (s) => s.plan?.name },
            { key: 'start', label: 'Start', render: (s) => fmtDate(s.start) },
            { key: 'end', label: 'End', render: (s) => fmtDate(s.end) },
            { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.upcoming ? 'Scheduled' : s.status} /> },
          ]} />
        </>
      )}

      <PaymentModal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={plan ? `${plan.name} subscription` : ''}
        subtitle={plan ? `${plan.days} days · ${plan.allSports ? 'all sports' : plan.sports.join(', ')}` : ''}
        amount={plan?.price || 0}
        walletBalance={wallet?.balance || 0}
        item={plan ? { type: 'SUBSCRIPTION', planId: plan.id } : null}
        onSuccess={() => toast.success('Predictions covered by your plan are now unlocked.', 'Subscription active')}
      />

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel subscription?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setCancelOpen(false)}>Keep plan</button><button className="btn-danger" onClick={doCancel} disabled={busy}>{busy ? <span className="spinner" /> : 'Cancel plan'}</button></>}>
        <p className="text-sm text-muted">Access through the plan ends immediately (including any queued renewals). Matches you bought individually or unlocked with your free trial stay unlocked. For a refund, contact support.</p>
      </Modal>
    </>
  );
}
