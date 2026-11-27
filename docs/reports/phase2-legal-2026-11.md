# Phase 2: legal and trust notes, 27 November 2026

Not legal advice. Take the questions below to a lawyer.

## Data sources on a paid commercial website

| Source | Used for | What its terms say | Verdict | To do |
|---|---|---|---|---|
| Cricsheet | Cricket training | Open Data Commons Attribution (XML: CC BY 4.0) ([licensing](https://cricsheet.org/licensing/)) | Allowed with credit | Credit is on the Disclaimer page |
| openfootball | Football results | Public domain (CC0), as recorded in the ML report; not re-read today | Allowed | None |
| TheSportsDB | 295 football results | "monetise projects that use it" is permitted on free and paid tiers; the free tier is also described as for "development projects" ([terms](https://www.thesportsdb.com/docs_terms_of_use.php)) | Appears allowed; confirm or subscribe | Do not use unverified artwork (none is used) |
| football-data.org | League tables | Requires the line "Football data provided by the Football-Data.org API"; one key per domain; stop showing the data after cancelling; crests need owners' consent. Commercial use is not expressly banned ([terms](https://www.football-data.org/about)) | Appears allowed; confirm in writing | Credit is in the footer |
| API-Sports / API-Football | Basketball and football history | Official terms could not be read (access refused). A third party quotes them as giving no licence to publish the data ([quote](https://github.com/RecklessReef-ai/bosnian-support-schedule/issues/66)) | **Unclear** | Read the terms yourself and ask them |
| GNews, free plan | Headlines | Non-commercial only; commercial use needs a paid plan ([pricing](https://gnews.io/)) | **Not allowed** | Pay or turn news import off before charging |
| Open-Meteo, free | Weather experiments (not in production models) | Free service is non-commercial; sites with subscriptions count as commercial ([terms](https://open-meteo.com/en/terms)) | **Not allowed** on a paid site | Do not run `ml:weather` for the paid service without a plan |
| Google Fonts | Fonts | Visitors' browsers contact Google | Disclosed in the Privacy Policy | Optionally host the fonts yourself |

## Questions for a lawyer

1. **Online Gaming Act.** The Promotion and Regulation of Online Gaming Act, 2025 is reported in force from 1 May 2026 and bans online money games ([SCC Online](https://www.scconline.com/blog/post/2026/04/23/meity-notified-enforcement-of-promotion-regulation-online-gaming-act-2025/)); a challenge is before the Supreme Court ([SC Observer](https://www.scobserver.in/cases/challenge-to-the-promotion-and-regulation-of-online-gaming-act-2025/)). Nothing I found addresses selling predictions with no stake or prize. Does it, or its advertising ban, touch this service?
2. **State betting and gambling laws.** Does selling match predictions raise issues in any state you will serve? Should any state be blocked?
3. **Data protection.** Commentary puts the main DPDP duties (notice, consent, security, breach reporting, rights, grievance) at May 2027 ([Taxmann](https://www.taxmann.com/post/blog/analysis-indias-dpdp-act-and-rules/)). What is needed now and then? Is the sign-up checkbox enough, given that consent is not recorded with a date or version?
4. **Consumer and e-commerce rules** (from general knowledge, not checked): seller details, grievance officer, response times, and whether the "no refund after unlock" rule holds.
5. **Tax** (not checked): GST registration and invoicing for digital services.
6. **Policy drafts.** Review all four, above all liability, refunds, jurisdiction and age.

## Ask Razorpay in writing

Its merchant list of prohibited businesses was not found. Razorpay's public terms pages do not mention tips or predictions. Other processors do restrict them: PayPal and [Zoho Payments](https://www.zoho.com/in/payments/prohibited-restricted-businesses.html) list gambling tips or sports forecasting in some form. Describe the service plainly and get a written yes before building further on payments.

## Decisions only you can make

- Business name, support email, address, grievance officer and court city: fill in `frontend/PREDICTX/src/content/site.js`.
- The refund rules in the draft are proposals that match how the code behaves.
- Account deletion is by request only; there is no button.
- Set `POLICIES_ARE_DRAFT` to `false` only after legal review.

## What changed in the code

- Terms, Privacy, Refund and Disclaimer pages, linked from the footer and sign-up.
- Placeholder contact details removed.
- Sport descriptions and plan features now describe what exists. "Most popular" became "Recommended"; "Cancel anytime" became "no automatic renewal".
- Existing database wording updated with `npm run copy:fix` (`copy:restore` undoes it). Other installations need to run it.
