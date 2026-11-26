// Doughnut chart of the win (and draw) probabilities — rendered only after unlock.
import { Doughnut } from 'react-chartjs-2';
import '../charts/setup';

export default function ProbabilityChart({ match, prediction }) {
  const draw = prediction.probDraw !== null && prediction.probDraw !== undefined;
  const data = {
    labels: [match.teamA.name, ...(draw ? ['Draw'] : []), match.teamB.name],
    datasets: [{
      data: [prediction.probA, ...(draw ? [prediction.probDraw] : []), prediction.probB],
      backgroundColor: [match.teamA.color, ...(draw ? ['#A7B4D6'] : []), match.teamB.color],
      borderColor: '#090E1D',
      borderWidth: 4,
      hoverOffset: 6,
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    animation: { animateRotate: true, duration: 1200 },
    plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw}%` } } },
  };
  const outcome = prediction.predictedOutcome;
  const label = outcome === 'DRAW' ? 'Draw predicted' : `${(outcome === 'TEAM_B' ? match.teamB : match.teamA).name} favoured`;
  const top = outcome === 'DRAW' ? prediction.probDraw : outcome === 'TEAM_B' ? prediction.probB : prediction.probA;
  return (
    <div className="relative h-64">
      <Doughnut data={data} options={options} aria-label="Win probability chart" />
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="font-display text-3xl font-bold">{top}%</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}
