import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui';
import TransactionTable from '../../components/sections/TransactionTable';
import { useAuth } from '../../context/AuthContext';

export default function Transactions() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Transaction History" subtitle="All demo payments, subscriptions and wallet top-ups." actions={<Link to="/user/wallet" className="btn-ghost">Open wallet</Link>} />
      <TransactionTable userId={user.id} />
    </>
  );
}
