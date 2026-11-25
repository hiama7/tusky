import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import PricingPlans from '../../components/sections/PricingPlans';
import { DemoBanner } from '../../components/ui';

const FAQ = [
  ['Does buying one prediction unlock others?', 'No. Each match is unlocked independently. Subscriptions unlock every prediction while they are active.'],
  ['What is the free trial?', 'Every new account can unlock one match prediction of their choice for free, once.'],
  ['Which payment methods are supported?', 'UPI, cards, net banking and the TUSKY wallet. In this Stage 1 demo all payments are simulated.'],
  ['Are predictions guaranteed?', 'No. Predictions are probabilistic analysis for entertainment and research, not guarantees.'],
];

export default function Pricing() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
      <div className="text-center">
        <p className="eyebrow">Pricing</p>
        <h1 className="section-title mt-2">Pay per match or go unlimited</h1>
        <p className="section-sub mx-auto">Transparent pricing in Indian Rupees. Cancel anytime.</p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl"><DemoBanner>Stage 1 demo: plans and prices are sample values and payments are simulated — no real money is charged.</DemoBanner></div>
      <div className="mt-10"><PricingPlans /></div>

      <div className="glass mt-10 flex flex-col items-center justify-between gap-4 p-6 md:flex-row">
        <p className="flex items-center gap-3"><Gift className="h-6 w-6 text-green" /> <span><b>New here?</b> <span className="text-muted">Your first prediction is on us.</span></span></p>
        <Link to="/user/free-trial" className="btn-success">Activate Free Trial</Link>
      </div>

      <h2 className="mt-16 text-2xl font-bold">Frequently asked questions</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card group">
            <summary className="cursor-pointer list-none font-medium marker:hidden">{q}<span className="float-right text-muted transition-transform group-open:rotate-45">+</span></summary>
            <p className="mt-3 text-sm text-muted">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
