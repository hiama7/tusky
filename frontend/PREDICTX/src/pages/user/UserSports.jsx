import SportsGrid from '../../components/sections/SportsGrid';
import { PageHeader } from '../../components/ui';

export default function UserSports() {
  return (
    <>
      <PageHeader title="Sports" subtitle="Pick a sport to see its upcoming matches." />
      <SportsGrid exploreBase="/user/matches" />
    </>
  );
}
