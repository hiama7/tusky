// Doughnut chart showing the two win probabilities (shown only after unlock).
import { Doughnut } from 'react-chartjs-2';
import '../charts/setup';

export default function ProbabilityChart({ match, prediction }) {
  const data = {
    labels: [match.teamA.name, match.teamB.name],
    datasets: [{
      data: [prediction.probA, prediction.probB],
      backgroundColor: [match.teamA.color, match.teamB.color],
      borderColor: '#151D2E',
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
  const fav = prediction.probA >= prediction.probB ? match.teamA : match.teamB;
  return (
    <div className="relative h-64">
      <Doughnut data={data} options={options} aria-label="Win probability chart" />
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="font-display text-3xl font-bold">{Math.max(prediction.probA, prediction.probB)}%</p>
        <p className="text-xs text-muted">{fav.name} favoured</p>
      </div>
    </div>
  );
}
