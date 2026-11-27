// One page layout for Terms, Privacy, Refunds and Disclaimer.
import { Link } from 'react-router-dom';
import { POLICIES, POLICY_LINKS } from '../../content/policies';
import { POLICIES_ARE_DRAFT, POLICY_UPDATED } from '../../content/site';
import { cx } from '../../utils/format';

export default function Policy({ name }) {
  const policy = POLICIES[name];
  return (
    <div className="mx-auto max-w-3xl px-4 pt-28 md:px-6">
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Policies">
        {POLICY_LINKS.map(([label, to]) => <Link key={to} to={to} className={cx('chip', to === `/${name}` && 'active')}>{label}</Link>)}
      </nav>
      {POLICIES_ARE_DRAFT && (
        <p className="mb-6 rounded-xl border border-orange/40 bg-orange/10 px-4 py-3 text-sm text-orange" role="note">
          Draft. This text has not yet been reviewed by a lawyer and may change.
        </p>
      )}
      <h1 className="text-3xl font-bold md:text-4xl">{policy.title}</h1>
      <p className="mt-2 text-xs text-muted">Last updated {POLICY_UPDATED}</p>
      <p className="mt-6 text-muted">{policy.intro}</p>
      {policy.sections.map(([heading, paragraphs]) => (
        <section key={heading} className="mt-8">
          <h2 className="text-lg font-semibold">{heading}</h2>
          {paragraphs.map((p) => <p key={p} className="mt-3 text-sm leading-relaxed text-muted">{p}</p>)}
        </section>
      ))}
    </div>
  );
}
