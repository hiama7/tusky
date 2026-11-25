import NewsFeed from '../../components/sections/NewsFeed';
import { DemoTag, PageHeader } from '../../components/ui';

export default function UserNews() {
  return (
    <>
      <PageHeader title="Sports News" subtitle="Previews, transfers and player updates." actions={<DemoTag>Sample articles</DemoTag>} />
      <NewsFeed />
    </>
  );
}
