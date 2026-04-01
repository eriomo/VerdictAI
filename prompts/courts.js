'use strict';

/**
 * VERDICT AI — COURT PROFILES
 * Court-specific intelligence injected when user specifies a court.
 * prompts/courts.js
 */

const COURT_PROFILES = {

  supreme_court: `
COURT-SPECIFIC INTELLIGENCE — SUPREME COURT OF NIGERIA:
This matter is before the Supreme Court of Nigeria, the apex court and final court of appeal. The Court sits in panels of five, seven, or nine justices depending on the nature of the appeal. Its decisions are binding on every other court in Nigeria without exception.

Arguments before the Supreme Court must engage directly and specifically with Supreme Court authorities. A Court of Appeal decision, however favourable, is insufficient — the Supreme Court will ask where the Supreme Court has spoken on this point. Arguments must address every ground of appeal specifically — grounds not argued are deemed abandoned with no further opportunity to revive them.

Written addresses must be technically perfect. The Court will not tolerate procedural errors at the appellate stage. Briefs of Argument at the Supreme Court level follow the Supreme Court Rules format strictly — issues for determination formulated with precision, arguments developed under each issue, cases cited with complete citations including the NWLR volume, part, and page number.

The Court asks pointed and specific questions from the bench. Oral arguments must be condensed to the essential points — the Court has read the briefs. Judgments at the Supreme Court are typically reserved — they are not delivered immediately after argument.

When drafting for or before the Supreme Court, the standard of precision required is the highest in the Nigerian legal system. Every proposition must be supported. Every citation must be complete and accurate.
`,

  court_of_appeal: `
COURT-SPECIFIC INTELLIGENCE — COURT OF APPEAL OF NIGERIA:
This matter is before the Court of Appeal, the intermediate appellate court. The Court sits in panels of three justices and has divisions in Lagos, Abuja, Enugu, Kaduna, Ibadan, Benin, Port Harcourt, Jos, Ilorin, Makurdi, Yola, Sokoto, and Kano. Identify the specific division where this appeal is filed — the applicable rules of the Court of Appeal apply uniformly but local practice varies.

The Court of Appeal is bound by Supreme Court decisions and by its own previous decisions on settled points of law. It is not bound by High Court decisions. Engage with Court of Appeal authorities from the same division where available.

The Court frequently decides appeals on the papers — the written address is the primary advocacy document. Oral arguments at the Court of Appeal are often brief, with the Court having read the briefs before hearing. Written addresses must therefore be complete, self-contained, and persuasive on the papers alone.

Every ground of appeal not argued in the written address is deemed abandoned — this is a strict rule applied without discretion. Every ground argued must be argued fully — a one-paragraph argument on a ground signals weakness and invites the Court to dismiss it summarily.

Notice periods, record compilation requirements, and filing deadlines under the Court of Appeal Rules must be strictly observed. Late filings require formal applications for extension and are not guaranteed.
`,

  fhc_lagos: `
COURT-SPECIFIC INTELLIGENCE — FEDERAL HIGH COURT, LAGOS DIVISION:
This matter is before the Federal High Court, Lagos Division — the busiest commercial court in Nigeria. The court sits at various courtrooms across Lagos. The Commercial Division operates a separate list managed under the Federal High Court (Civil Procedure) Rules 2019.

Judges in this division are experienced in complex commercial disputes, banking litigation, intellectual property matters, company law, taxation, and admiralty. They have seen every argument. Weak pleadings, vague reliefs, and unsupported submissions will be identified and criticised from the bench.

Subject matter jurisdiction is strictly limited by Section 251 of the 1999 Constitution. Confirm that the subject matter falls squarely within the Federal High Court's constitutional jurisdiction before filing — a successful jurisdictional challenge after extensive litigation is catastrophic. The court will raise jurisdiction on its own motion if the matter appears outside its constitutional competence.

Case management conferences are scheduled early in commercial matters. Compliance with case management directions is enforced. Costs orders for procedural failures and unnecessary delays are not uncommon.

Electronic filing is increasingly used. Registry filing requirements are strictly observed. Service of originating processes on corporate defendants must comply with the Companies and Allied Matters Act 2020 provisions on service.
`,

  fhc_abuja: `
COURT-SPECIFIC INTELLIGENCE — FEDERAL HIGH COURT, ABUJA DIVISION:
This matter is before the Federal High Court, Abuja Division. This division handles a high volume of constitutional matters, administrative law cases, electoral disputes (between elections), regulatory disputes, and commercial cases involving federal agencies and government bodies. Government entities are frequently parties in proceedings in this division.

Pre-action protocols for matters involving government parties — federal ministries, departments, agencies, parastatals — must be strictly observed. The Public Officers Protection Act creates limitation periods for actions against public officers in their official capacity. Notice requirements under the Attorney-General Act and relevant enabling legislation must be satisfied before suit is filed — failure is often fatal to the claim.

The court is alert to constitutional arguments and takes them seriously. Constitutional provisions must be pleaded and argued with precision — general invocations of constitutional rights without specific engagement with the relevant sections are insufficient.

Filing at the Abuja Division registry follows the Federal High Court (Civil Procedure) Rules 2019. Electronic filing is available. The court sits in the Federal Secretariat complex in the Central Business District.
`,

  lagos_high_court: `
COURT-SPECIFIC INTELLIGENCE — LAGOS STATE HIGH COURT:
This matter is before the Lagos State High Court, operating under the High Court of Lagos State (Civil Procedure) Rules 2019. The Commercial Division handles large commercial disputes under an expedited procedure designed to resolve disputes within 18 months.

Electronic filing is mandatory for most matter types in the Lagos State High Court. Failure to comply with e-filing requirements will result in documents being rejected by the registry. Ensure compliance with the Lagos State Judiciary e-Filing portal requirements before filing.

Case management conferences are conducted early and case management directions are enforced strictly. Parties who fail to comply with case management directions face applications for unless orders, costs sanctions, and in serious cases, striking out of claims or defences.

Costs orders are common in the Lagos State High Court, particularly for unmeritorious applications, unnecessary adjournments, and procedural failures. Budget for costs risk on every application.

The Commercial Division judges are experienced in complex financial, corporate, and commercial disputes. Arguments must be technically precise and economically sophisticated — judges in this division understand commercial reality and will engage with it.

Witness statements filed in advance replace examination-in-chief. Witnesses attend only for cross-examination and re-examination. Witness statements must therefore be complete, carefully drafted, and consistent with pleadings in every particular.
`,

  abuja_high_court: `
COURT-SPECIFIC INTELLIGENCE — HIGH COURT OF THE FEDERAL CAPITAL TERRITORY, ABUJA:
This matter is before the High Court of the FCT, Abuja — a state-equivalent court exercising jurisdiction over FCT matters. This court has jurisdiction over land matters within the FCT (administered differently from states under the Land Use Act due to the FCT's unique constitutional status), civil disputes between residents, and criminal matters under FCT legislation.

The court operates under the High Court of the FCT (Civil Procedure) Rules. Abuja is a planned city with significant real estate activity — land and property disputes are common in this court. The Minister of FCT plays the role of the Governor in relation to FCT land matters, and applications for statutory right of occupancy and derivative rights of occupancy have specific procedural requirements.

Filing at the registry follows FCT High Court rules. The court sits at the High Court Complex in Maitama. Case management is in operation — comply with all case management directions strictly.
`,

  kano_high_court: `
COURT-SPECIFIC INTELLIGENCE — KANO STATE HIGH COURT:
This matter is before the Kano State High Court. Kano State operates a dual court system — the State High Court for civil and criminal matters governed by general Nigerian law, and the Sharia Court of Appeal for matters governed by Islamic personal law between Muslim parties.

Confirm that this matter properly falls within the jurisdiction of the State High Court and not within the Sharia Court of Appeal's jurisdiction, which covers personal status, family, and succession matters between Muslim parties where all parties consent.

The court applies the High Court of Kano State (Civil Procedure) Rules. Criminal matters in Kano State are governed by the Criminal Procedure Code (applicable to Northern states). Filing and service requirements follow the applicable rules. The court sits in the High Court complex in Kano metropolis.
`,

  magistrate_court: `
COURT-SPECIFIC INTELLIGENCE — MAGISTRATE COURT:
This matter is before a Magistrate Court. Magistrate Courts are courts of limited jurisdiction — jurisdiction in civil matters is limited to monetary claims within the threshold set by the applicable Magistrate Court Law of the relevant state. Confirm that the value of the claim is within the court's monetary jurisdiction before proceeding.

Magistrate Courts exercise criminal jurisdiction over summary offences and some indictable offences triable summarily. The applicable criminal procedure law is the Criminal Procedure Code (for Northern states — Adamawa, Bauchi, Borno, Gombe, Jigawa, Kaduna, Kano, Katsina, Kebbi, Niger, Plateau, Sokoto, Taraba, Yobe, Zamfara, and FCT) or the Criminal Procedure Act (for Southern states and FCT depending on the specific matter).

Bail applications are decided expeditiously — often at first appearance. Most rulings in the Magistrate Court are delivered immediately after hearing, not reserved. Proceedings are less formal than the High Court but procedural rules are still applied.

Appeals from Magistrate Court decisions go to the State High Court. Time for appeal is strict — typically 30 days from the date of the decision. Advise clients immediately after any adverse Magistrate Court decision.
`
};

module.exports = { COURT_PROFILES };
