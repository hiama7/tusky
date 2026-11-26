// User transaction history table (wallet top-ups, predictions, subscriptions).
import { useState } from 'react';
import { Chips, DataTable, StatusBadge } from '../ui';
import { useAsync } from '../../hooks/useAsync';
import { getUserTransactions } from '../../services/purchases';
import { fmtDateTime, inr } from '../../utils/format';

export default function TransactionTable({ userId }) {
  const [type, setType] = useState('all');
  const { data, loading } = useAsync(() => getUserTransactions(), [userId]);
  const rows = (data || []).filter((t) => type === 'all' || t.type === type);
  return (
    <>
      <div className="mb-4"><Chips options={[{ value: 'all', label: 'All' }, { value: 'prediction', label: 'Predictions' }, { value: 'subscription', label: 'Subscriptions' }, { value: 'wallet', label: 'Wallet top-ups' }]} value={type} onChange={setType} /></div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="No transactions yet."
        columns={[
          { key: 'id', label: 'Transaction ID', render: (t) => <span className="font-mono text-xs">{t.id}</span> },
          { key: 'item', label: 'Description' },
          { key: 'method', label: 'Method', render: (t) => <span className="text-muted">{t.method}</span> },
          { key: 'date', label: 'Date', render: (t) => <span className="text-muted">{fmtDateTime(t.date)}</span> },
          { key: 'amount', label: 'Amount', render: (t) => <span className={t.type === 'wallet' ? 'font-semibold text-green' : 'font-semibold'}>{t.type === 'wallet' ? '+' : '−'}{inr(t.amount)}</span> },
          { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
        ]}
      />
    </>
  );
}
