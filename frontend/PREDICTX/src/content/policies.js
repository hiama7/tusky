// Policy texts. They describe what the code does today; change them when it changes.
// Drafts for a lawyer to review, not legal advice.
import { SITE } from './site';

const operator = SITE.legalName || `the operator of ${SITE.name}`;
const contact = SITE.email
  ? `Write to ${SITE.email}${SITE.address ? ` or ${SITE.address}` : ''}.`
  : 'Contact details will be published here before the service is offered for payment.';

export const POLICIES = {
  terms: {
    title: 'Terms of Use',
    intro: `These terms are an agreement between you and ${operator}. By creating an account or using ${SITE.name} you accept them.`,
    sections: [
      ['What the service is', [`${SITE.name} publishes statistical estimates of sports match results, with related information. It is for information and entertainment.`, `${SITE.name} does not take bets, hold stakes, pay winnings or run contests. A prediction is not a promise about what will happen.`]],
      ['Who may use it', ['You must be 18 or older and able to enter a contract. You are responsible for checking that using this service is lawful where you are.']],
      ['Your account', ['Give accurate details, keep your password private and tell us if you think someone else has used your account. One person, one account, one free trial.']],
      ['Paying', ['Prices are in Indian Rupees and shown before you pay. A single purchase unlocks one match. A subscription unlocks the sports its plan covers until it ends. Plans are paid once and do not renew automatically.', 'A plan can only unlock matches that are actually listed. Some sports may have none at a given time.', 'Refunds are covered by the Refund Policy.']],
      ['What you may not do', ['Do not resell, republish or bulk-copy predictions, share your account, probe or overload the service, or use it for anything unlawful, including unlawful betting.']],
      ['Suspension', ['We may suspend an account that breaks these terms. Where we do so without such a breach, we will refund unused paid access.']],
      ['Liability', ['The service is provided as it is. We do not guarantee that predictions, data or availability are free of error. To the extent the law allows, we are not liable for losses from decisions you make using them, and our total liability is limited to what you paid us in the previous twelve months. Nothing here removes rights you have under consumer law.']],
      ['Changes and disputes', [`We may change these terms and will show the date of the last change. Indian law applies${SITE.courts ? `, and the courts of ${SITE.courts} have jurisdiction` : ''}.`]],
      ['Contact and complaints', [contact, ...(SITE.grievanceOfficer ? [`Grievance officer: ${SITE.grievanceOfficer}.`] : [])]],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    intro: `This explains what ${operator} collects when you use ${SITE.name}, and why.`,
    sections: [
      ['What we collect', ['From you: your name, email address, mobile number and password. The password is stored only as a one-way hash.', 'From your use: purchases, subscriptions, wallet entries, free-trial use, favourite sports, notifications and an activity history.', 'For security: the IP address and browser description of each signed-in session.']],
      ['Why', ['To run your account, deliver what you buy, take payments, send password-reset messages, prevent abuse and meet legal and tax duties. We do not sell your information.']],
      ['Cookies and browser storage', ['We set a sign-in cookie that scripts cannot read, and keep a few display preferences in your browser. We use no advertising or analytics cookies.']],
      ['Who else receives information', ['Razorpay processes payments and receives your name, email and phone number with the order. Card and bank details go to Razorpay, not to us.', 'Our email and hosting providers process data to run the service.', 'Fonts are loaded from Google Fonts, so Google receives your IP address.', 'Links in news items take you to other sites with their own policies.']],
      ['How long we keep it', ['Account information is kept while your account exists. Payment and tax records are kept as long as the law requires, even after an account is closed.']],
      ['Your choices', ['You can see and correct your profile in your account. To get a copy of your data, withdraw consent or have your account deleted, contact us. Deletion is not yet automatic.']],
      ['Children', ['The service is not for anyone under 18, and we do not knowingly collect their data.']],
      ['Contact and complaints', [contact, 'You may also complain to the Data Protection Board of India once its procedures apply.']],
    ],
  },
  refunds: {
    title: 'Refund Policy',
    intro: 'When money is returned, and how.',
    sections: [
      ['Single match predictions', ['Because a prediction is shown to you as soon as you unlock it, it is not refundable because you changed your mind or because the match ended differently.']],
      ['When we do refund', ['You were charged twice for the same item.', 'You paid but access was not given.', 'The match was cancelled and no prediction could be used. Ask us; this is not automatic.']],
      ['Subscriptions', ['You can cancel at any time. Access ends immediately and the unused part is not refunded, except where the law requires it or we end the service.']],
      ['Wallet credit', ['A top-up that has not been spent can be refunded to the original payment method on request. Credit already spent cannot.']],
      ['How refunds are paid', ['To the way you paid: card, UPI or bank refunds go through Razorpay and wallet purchases return to your wallet. Banks usually take several working days.']],
      ['How to ask', [contact, 'Include the transaction reference from your Transaction History.']],
    ],
  },
  disclaimer: {
    title: 'Disclaimer and data sources',
    intro: 'Read this before relying on any number on this site.',
    sections: [
      ['Predictions are estimates', ['Probabilities come from statistical models of past results. A 70% estimate is expected to be wrong about three times in ten.', 'In a test on 2,263 past football matches that the model had not seen, it picked the right result (home win, draw or away win) 52.5% of the time. Always picking the home team scores 44.2%.', 'The football model does not know about injuries, line-ups, transfers or the weather.']],
      ['No betting advice', ['Nothing here is advice to place a bet or make a financial decision. We do not accept bets. Betting is restricted or illegal in many places; follow the law where you live.']],
      ['No affiliation', ['Team, league and competition names belong to their owners. This site is not affiliated with or endorsed by them.']],
      ['Data sources', ['Football data provided by the Football-Data.org API.', 'Cricket data from Cricsheet (cricsheet.org), used under the Open Data Commons Attribution Licence.', 'Football results from openfootball (public domain) and TheSportsDB.', 'Basketball and earlier football history from API-Sports.', 'News headlines link to their publishers and are supplied through GNews.']],
    ],
  },
};

export const POLICY_LINKS = [['Terms of Use', '/terms'], ['Privacy Policy', '/privacy'], ['Refund Policy', '/refunds'], ['Disclaimer', '/disclaimer']];
