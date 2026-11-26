// Keeps betting tips and repeats of the same story out of imported headlines.

// Promotional betting copy only: news *about* betting (a scandal, a ban) still passes.
const BETTING = /\b(bet of the (day|week)|betting (tips?|odds|picks?|preview|offers?)|best bets?|free bets?|bet builder|bonus (bet|code)s?|promo codes?|accumulator tips|parlays?|sportsbooks?|(odds|prediction),? (and |& )?(best )?(picks?|tips))\b/i;

export const isBettingTip = ({ title = '', description = '' }) => BETTING.test(`${title}\n${description}`);

// words too common in sports headlines to say two stories are the same
const COMMON = new Set(('the a an and or of to in on at for with from after before as by is are was be will its his her their this that out off over ' +
  'not new vs live when where watch stream streaming score scores box report news update preview match game final semi ' +
  'cricket football soccer tennis basketball men mens women womens school high team').split(' '));

export function titleWords(title) {
  return new Set(String(title || '').normalize('NFD').replace(/\p{M}|['’]/gu, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !COMMON.has(w)));
}

const plain = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Same headline, or enough telling words shared: four covering most of the shorter one,
 *  or three covering nearly all of it. Looser rules merge unrelated template headlines. */
export function sameStory(a, b) {
  if (plain(a) === plain(b)) return true;
  const x = titleWords(a);
  const y = titleWords(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  const cover = shared / Math.min(x.size, y.size);
  return (shared >= 4 && cover >= 0.6) || (shared >= 3 && cover >= 0.75);
}
