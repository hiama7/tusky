import NewsFeed from '../../components/sections/NewsFeed';
import { PageHeader } from '../../components/ui';

export default function UserNews() {
  return (
    <>
      <PageHeader title="Sports News" subtitle="Previews, transfers and player updates." />
      <NewsFeed />
    </>
  );
}
