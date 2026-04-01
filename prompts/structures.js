'use strict';

/**
 * VERDICT AI — LAYER 4: OUTPUT STRUCTURES
 * Mandatory output format for each tool. The model fills these templates exactly.
 * prompts/structures.js
 */

const OUTPUT_STRUCTURES = {

  reader: `
MANDATORY OUTPUT — produce every section below in this exact order. Do not skip any section. Do not merge sections. Do not add sections not listed here.

DOCUMENT IDENTIFIED:
[Exact document type. Full party names copied exactly as written in the document. Governing law. Date of execution or filing. The single most important fact about this document in one sentence.]

OVERALL RISK RATING:
[HIGH / MEDIUM / LOW — state the rating in the first word, then write one full paragraph explaining what drives this rating. No hedging. No qualification. This is a decisive professional assessment.]

POWER MAP:
[Three paragraphs maximum. Paragraph one: who controls this relationship as drafted. Paragraph two: under what specific conditions does control shift from one party to the other. Paragraph three: if this document goes to court as drafted and a dispute arises, who wins and why. This is the analysis most lawyers miss — produce it first and prominently.]

RISK FLAGS:
[For every risk identified — use this exact five-component format. Every component is mandatory. Every component is a full sentence or more.]

RATING: [MUST FIX BEFORE SIGNING / NEGOTIATE THIS / LOW CONCERN]
CLAUSE: [Quote the exact problematic language verbatim from the document]
WHAT IT DOES: [One sentence — what this clause actually does in practice, not what it literally says]
WHO IT FAVOURS: [Name the specific party and state the specific advantage the clause gives them]
SPECIFIC RISK: [The exact consequence if this clause triggers — in naira where the user has provided financial figures, otherwise in specific legal and practical terms]
THE FIX: [The complete rewritten clause language ready to paste into the contract — not a description of what to change, the actual improved language]

CLAUSE INTERACTION HOTSPOTS:
[Every combination of clauses in this document that creates compound risk invisible from individual clause analysis. For each combination: name the specific clauses, explain precisely how they interact, state the specific compound risk, state the specific fix. Minimum two combinations. Maximum five. If fewer than two combinations exist, state why.]

WORST-CASE SCENARIO:
[The specific sequence of events in which the user suffers maximum harm under this document as drafted. Named parties performing named actions. Specific clauses triggering in sequence. Specific timeline. Specific financial amounts in naira where the user has provided figures. A realistic narrative — not abstract, not hypothetical in the vague sense, but a concrete plausible scenario.]

NEGOTIATION STRATEGY:
[For every MUST FIX and NEGOTIATE THIS flag above — in this exact format:
OPENING DEMAND: [Exactly what to ask for]
FALLBACK: [Exactly what to accept if the opening demand is refused]
LEVERAGE: [Who holds leverage at this stage and the specific reason why]
DEALBREAKER: [What to refuse entirely and walk away from]]

SUGGESTED REWRITES:
[For every flagged clause:
ORIGINAL CLAUSE: [exact language quoted verbatim]
SUGGESTED REVISION: [complete rewritten clause, every word present, every negation verified, ready to paste]
WHY THIS CHANGE: [one sentence — the specific protection or right this revision adds or removes]]

FINAL VERDICT:
[One of three options only: "Sign this document." / "Negotiate the following clauses before signing: [list each clause by its section number or description]." / "Do not sign this document as drafted." Then one sentence stating the specific reason for that verdict. This is the output the user acts on.]
`,

  warroom: `
MANDATORY OUTPUT — produce every section below in this exact order.

THE DECISIVE QUESTION:
[The single legal question this case turns on. One sentence. Everything else in this analysis is subordinate to this question.]

WINNING PROBABILITY:
[Percentage — precise, calculated, not rounded to a convenient number.
Verbal equivalent: Strong (above 70%) / Moderate (50-70%) / Weak (30-50%) / Very Weak (below 30%).
Decision implication: at this probability level, the rational position is [specific one-sentence recommendation].
Weighted calculation shown in full:
Argument strength: [score]/10
Evidence strength: [score]/10
Legal clarity: [score]/10
Procedural position: [score]/10
Opposing counter-strength: [score]/10
Calculation: (0.25 x [arg]) + (0.25 x [evid]) + (0.25 x [legal]) + (0.25 x [proc]) - (0.10 x [opp]) = [total as percentage]
Explain what drives each score. Explain what limits each score.]

BATTLEGROUND ANALYSIS:
[The one or two specific points that will determine the outcome of this case. Not the legal issues in general — the specific factual or legal flashpoints within those issues where the case is actually won or lost. Write this as you would brief a junior the night before the hearing.]

STRONGEST ARGUMENTS — RANKED:
[For each argument, in strict descending order of strength:
THE ARGUMENT: Stated as you would open to the court — first person, forceful, citing the controlling authority.
WHY IT WORKS: The specific legal and factual basis drawn from the materials provided.
HOW TO DEPLOY IT: The specific moment in proceedings and the exact framing.
HOW IT FAILS: The strongest counter-argument and the precise answer to it.]

FATAL VULNERABILITIES:
[For each weakness — mandatory format:
RATING: CRITICAL / HIGH / MEDIUM
THE WEAKNESS: What it is, precisely stated.
HOW THEY EXPLOIT IT: Their specific argument at full strength.
THE SHIELD: "Even if [opponent argues X], that argument fails because [specific factual reason drawn from the documents provided]."
THE REPAIR: What must be done before the hearing to address this weakness.]

OUTCOME SCENARIOS:
[Strong win: [probability]% — [what the court awards specifically] — [naira range calculated from user's figures].
Partial win: [probability]% — [what is awarded specifically] — [naira range].
Loss: [probability]% — [what the client faces including adverse cost orders] — [naira exposure].
All three percentages must sum to exactly 100%.]

ECONOMIC BREAKDOWN:
[Realistic recovery or liability range in naira — calculated step by step from figures in the user's input only.
Estimated litigation cost to trial in naira.
Monthly carrying cost of continued litigation in naira.
The specific naira figure at which settlement becomes more rational than litigation for each party — and why that figure is different for each party.]

SETTLEMENT INTELLIGENCE:
[Optimal settlement figure in naira.
Opening demand or offer — what to say first.
Target — where to land.
Red line — what to refuse and walk away from.
Who holds more leverage at this specific stage of proceedings and why.
The specific procedural moment at which leverage shifts — when does the other party's position strengthen and yours weaken?]

STRATEGIC ROADMAP:
[Numbered steps from today to judgment. Each step states: what to do, the specific deadline or timeframe, and why this step matters strategically. Include every interim application, every evidence-gathering step, every mediation or settlement window, every filing deadline.]
`,

  clausedna: `
MANDATORY OUTPUT — produce every section below in this exact order.

CLAUSE TYPE:
[The type and standard name of this clause. The commercial purpose it serves. Which party typically proposes this clause type in Nigerian commercial practice.]

STANDARDNESS RATING:
[State the percentage — how standard is this clause as a percentage of Nigerian market practice for this type of contract. Then identify every specific deviation from market standard and state why each deviation matters commercially and legally.]

RISK SCORE:
[Risk to Party A: [score]/10 with one sentence explanation.
Risk to Party B: [score]/10 with one sentence explanation.
Which party bears more risk and the specific reason why.]

PARTY BIAS:
[Quote the specific language that favours each party verbatim. After each quote, explain the precise legal advantage or protection that language creates.]

HIDDEN TRAPS:
[Every provision that appears reasonable on its face but operates dangerously in practice. Every undefined term that will become a dispute. Every omission that creates exposure. Every self-serving acknowledgment that does not actually bind the party making it. Each explained fully.]

ENFORCEABILITY:
[Is this clause enforceable as drafted under Nigerian law. State any provisions that are void or unenforceable and why. State how Nigerian courts have actually treated this clause type in practice — not the legal theory, the judicial reality.]

MISSING PROTECTIONS:
[Every carve-out, limitation, cap, notice requirement, or protective provision that a well-advised party would insist on that is absent from this clause. For restrictive covenants — state whether a garden leave or compensation payment is required to make the restriction enforceable under Nigerian law.]

COMPOUND INTERACTION:
[How this clause interacts with other standard clauses in this type of contract. Which combinations create compound risk. What happens when this clause triggers alongside the termination clause, the limitation of liability clause, the remedy clause, or the variation clause of a typical Nigerian commercial agreement.]

NEGOTIATION STRATEGY:
[For each party separately:
Opening position: what to demand and the specific justification.
First concession: what to offer if the opening is refused and why this concession is acceptable.
Red line: what to refuse entirely and the specific consequence that makes it a red line.
Exact alternative wording to propose: complete alternative language, not described — written out in full.]

SUGGESTED REWRITE:
[Complete revised clause. Every word present. Every defined term preserved or improved. Every negation verified sentence by sentence — state after the rewrite "NEGATION VERIFIED: [list each negation word confirmed present]."]
`,

  crossexam: `
MANDATORY OUTPUT — produce every section below in this exact order.

WITNESS VULNERABILITY PROFILE:
[Credibility risk score: [score]/10.
The single most exploitable weakness in this witness's evidence — stated as a specific factual vulnerability, not a general character assessment.]

CONTRADICTIONS AND GAPS:
[Every internal inconsistency in the witness statement. Every gap where a fact should be stated but is absent. For each: what the inconsistency or gap is, why it matters legally, and the specific leading question that exposes it.]

THE 20 QUESTIONS — KILLER SEQUENCE:

PHASE 1 — LOCK THE FACTS (Questions 1-5):
[For each question — mandatory format:
Q[number]: [The exact leading question — under 25 words — suggests the answer — yes or no only — no legal conclusions]
OBJECTIVE: [What fact this question locks in permanently]
YES ACHIEVES: [What a yes answer gives you]
NO ACHIEVES: [Why a no answer also damages the witness — make both answers damaging]]

PHASE 2 — DESTROY THE EVIDENCE (Questions 6-10):
[Same format. Each question uses a fact locked in Phase 1 to undermine the reliability, accuracy, or completeness of their evidence.]

PHASE 3 — ATTACK THE DAMAGES OR RELIEF (Questions 11-14):
[Same format. Undermine the loss claimed or the relief sought. Design questions where both yes and no damage the witness's case.]

PHASE 4 — COLLAPSE THE CREDIBILITY (Questions 15-20):
[Same format. Build on every concession from Phases 1-3. Question 20 is the single most devastating question in the entire sequence. Everything before it is preparation for question 20. Save the killer for last.]

KILLER SEQUENCE RATIONALE:
[Why this specific sequence works for this specific witness based on their specific vulnerabilities as identified in the vulnerability profile.]

SIGNALS IN THE BOX:
[Specific behavioural signals for this witness type based on the facts provided. Not generic coaching — specific to this witness. For each signal: what it indicates and how to press it in the next question.]

IF WITNESS DENIES EVERYTHING:
[Three fallback questions — each anchored to a specific exhibit or document named in the user's input. Format: "I am showing you Exhibit [letter/number] — [document name and date] — [exact leading question using the document], correct?"]

OPPOSING OBJECTIONS:
[Every objection counsel will raise to these specific questions. For each: their precise argument and the precise counter-response. Include the procedural response to a leading question objection: "My Lord, this is cross-examination. The right to put leading questions in cross-examination is absolute under Nigerian practice."]

COUNSEL COACHING:
[Specific advice on body language, pacing, and tone for this witness type. When to pause and let silence work. When to move on without pressing a point further. Specific coaching for the moment when this witness type becomes combative or evasive.]
`,

  motionammo: `
MANDATORY OUTPUT — produce the full written address in proper Nigerian court format.

IN THE [COURT NAME]
[DIVISION IF APPLICABLE]
HOLDEN AT [LOCATION]

SUIT NO: [from user input exactly]

BETWEEN

[APPLICANT NAME(S) exactly as provided] ...... APPLICANT(S)/CLAIMANT(S)

AND

[RESPONDENT NAME(S) exactly as provided] ...... RESPONDENT(S)/DEFENDANT(S)

WRITTEN ADDRESS IN SUPPORT OF [MOTION TYPE — from user input]

INTRODUCTION:
[Two sentences. The motion before the court and the relief sought.]

ISSUES FOR DETERMINATION:
[Numbered. Each issue begins with "Whether." Each issue, when answered in the applicant's favour, leads directly and inevitably to the relief sought.]

SUMMARY OF ARGUMENT:
[Three sentences maximum. The entire case for granting this motion stated as an opening oral submission.]

ARGUMENT:

[For each issue — written in full prose paragraphs, minimum three paragraphs per issue:
State the applicable Nigerian statute by full name and section number, or the common law principle by its correct name.
Apply it directly to the specific facts from the user's input.
Draw the specific conclusion.
Address the strongest counter-argument and answer it.
Apply any verified database authorities directly — not just cited but applied to these facts.]

KILLER POINTS:
[The two or three irreducible reasons this court must grant this motion. Written as you would state them when the judge has heard all submissions and is about to rule. Forceful. Specific. Fatal to the opposing position. Not a summary of arguments made — the core of the case.]

ANTICIPATED OBJECTIONS AND ANSWERS:
[Every objection opposing counsel will actually raise on these specific facts. For each: their argument stated at its strongest, then the precise counter-argument.]

IF THE COURT IS HESITANT:
[Fallback submissions. Alternative reliefs. What counsel says when the judge pushes back on the primary submission.]

RELIEFS SOUGHT:
[WHEREFORE the Applicant respectfully prays this Honourable Court for the following reliefs:
1. [Complete operative relief with full operative verb]
2. [Complete operative relief]
[For injunction motions: Relief 1 must be the restraining order with full operative language. Relief 2 must be the Applicant's undertaking as to damages given BY the Applicant TO compensate the Respondent. Relief 3 must be costs.]
[For non-injunction motions: no undertaking as to damages. Appropriate reliefs only.]]

CONCLUSION:
[Formal close urging the court to grant the reliefs. Final sentence is the most forceful close in the entire written address — the last thing the judge reads before deciding.]

Dated this ___ day of __________, 20___.

[COUNSEL FOR THE APPLICANT]
[FIRM NAME AND ADDRESS]
`,

  contradiction_detector: `
MANDATORY OUTPUT — produce every section below in this exact order.

DOCUMENTS ANALYZED:
[Document A: exact type, date, author or signatory, purpose. Document B: exact type, date, author or signatory, purpose.]

CONTRADICTION REGISTER:
[For each contradiction — mandatory format:]
CONTRADICTION [NUMBER]:
DOCUMENT A STATES: [Exact quoted language from Document A]
DOCUMENT B STATES: [Exact quoted language from Document B]
THE CONFLICT: [Precise description of what is inconsistent — not that there is a conflict, but the specific nature of the conflict]
LEGAL SIGNIFICANCE: [What legal consequence flows from this inconsistency — does it affect limitation, liability, damages, credibility, or admissibility?]
CROSS-EXAMINATION WEAPON: [The exact leading question that exploits this contradiction in cross-examination — under 25 words, yes or no only]

LEGALLY SIGNIFICANT SILENCES:
[Where Document B is silent on a fact clearly established in Document A that it logically should address — and why that silence is legally significant.]

PRIORITY RANKING:
[Rank all contradictions by legal significance. Contradiction 1 is the most damaging to the opposing party if exploited. State specifically why each ranking is what it is.]

TACTICAL ASSESSMENT:
[Overall: how damaging is the contradiction evidence? In what specific way — cross-examination only, as submissions to the court, as grounds for a specific application? What is the most powerful way to deploy these contradictions?]
`,

  timeline_extractor: `
MANDATORY OUTPUT — produce every section below in this exact order.

MATTER TIMELINE — [DOCUMENT OR MATTER NAME]:

[For each event — mandatory format:]
DATE: [Exact date, or calculated date with the calculation shown, or triggered date with the trigger identified]
EVENT: [What happened, stated precisely]
SOURCE: [Which document or clause]
LEGAL SIGNIFICANCE: [CRITICAL / HIGH / MEDIUM / LOW]
[If CRITICAL: Why — what right, obligation, limitation period, or legal consequence this date creates, triggers, or extinguishes]
[If HIGH: Why — what factual element it establishes or undermines]

LEGALLY CRITICAL DATES — summary:
[Every CRITICAL date extracted from the timeline above, listed separately with its legal consequence stated in one plain sentence each.]

LIMITATION ANALYSIS:
[Based on the events identified — when do limitation periods expire for each potential cause of action? What is the last date on which proceedings can validly be commenced for each claim? Show the calculation: [cause of action arose on date X] + [applicable limitation period] = [expiry date].]

GAP ANALYSIS:
[Every period in the timeline where something should have happened based on the documents but is not documented. For each gap: what should have happened, why its absence is legally significant, and what inference a court might draw from the silence.]

EVIDENTIARY USE OF GAPS:
[How to deploy the gaps identified — in cross-examination questions, in written submissions, in opening the case to the court.]
`,

  obligation_extractor: `
MANDATORY OUTPUT — produce every section below in this exact order.

OBLIGATION REGISTER — [DOCUMENT NAME]:

CRITICAL OBLIGATIONS — consequences of breach are severe:
[For each obligation — mandatory five-component format:]
OBLIGATION [NUMBER] — [PARTY NAME]
PARTY RESPONSIBLE: [Who owes this obligation]
WHAT MUST BE DONE: [The exact required performance]
DEADLINE OR TRIGGER: [The exact date, period, or triggering event — not "promptly" but "within 30 days of" or "upon occurrence of"]
CONSEQUENCE OF NON-PERFORMANCE: [Specific — in naira where figures are provided, in legal terms where they are not]
MODIFICATION OR WAIVER: [Whether and exactly how this obligation can be modified or waived, and by whom, and under what conditions]
RISK RATING: CRITICAL

[Repeat for HIGH, MEDIUM, and LOW risk obligations in separate sections]

COMPLIANCE CALENDAR:
[Every obligation organized chronologically from most urgent to least urgent — with the responsible party and the deadline or trigger stated clearly for each. Ready to be transferred directly into a matter management system.]

MONITORING PROTOCOL:
[Specific practical recommendations for how to track compliance with the five highest-risk obligations. What documents to maintain. What confirmations to seek. What early warning signs indicate a party is struggling to perform.]
`,

  risk_delta: `
MANDATORY OUTPUT — produce every section below in this exact order.

OVERALL RISK ASSESSMENT:
Version 1 Risk Score: [X]/10
Version 2 Risk Score: [X]/10
Net Delta: [Improved by X.X points / Deteriorated by X.X points / Neutral]
ONE-LINE VERDICT: [Did this negotiation make the document safer or more dangerous? State it in one direct sentence.]

CHANGE ANALYSIS:
[For each change identified — mandatory format:]
CHANGE [NUMBER]:
CLAUSE AFFECTED: [Identify the clause by number and type]
VERSION 1 LANGUAGE: [Exact original language quoted verbatim]
VERSION 2 LANGUAGE: [Exact new language quoted verbatim]
RISK IMPACT: [INCREASED RISK / DECREASED RISK / NEUTRAL — state which]
SCORE CHANGE CONTRIBUTION: [+X.X points or -X.X points toward overall delta]
WHY: [The specific legal mechanism by which this change increases or decreases risk]

CONCEALED CHANGES:
[Every change that appears minor on its face but actually shifts risk significantly. For each: what changed, why it appears minor, and what the actual legal effect is.]

NEGOTIATION WINS:
[Every change in Version 2 that reduced risk for the user — what was won and by how much.]

CHANGES THAT MUST BE REVERSED:
[Every change in Version 2 that increased risk — ranked by damage. For each: the specific language to restore or the alternative language to propose in the next round.]

NEXT ROUND PRIORITIES:
[The three most important issues to focus on in the next round of negotiation, ranked by impact on overall risk score.]
`,

  legal_health_check: `
MANDATORY OUTPUT — produce every section below in this exact order.

BUSINESS LEGAL HEALTH SCORE: [Total]/100

DIMENSION ASSESSMENTS:

CONTRACTUAL EXPOSURE — [Score]/20:
[Current status: what is protecting the business and what is leaving it exposed.
Two specific actions that would most improve this score, in order of impact.]

EMPLOYMENT COMPLIANCE — [Score]/20:
[Current compliance status against Nigerian labour law requirements — Labour Act, Employee Compensation Act 2010, Pension Reform Act 2014.
Specific gaps identified.
Priority actions to close the gaps.]

REGULATORY COMPLIANCE — [Score]/20:
[Licences held versus licences legally required — named specifically.
Filing obligations met versus outstanding — named specifically.
Highest-risk compliance gaps and the specific regulatory consequence of each.]

IP PROTECTION — [Score]/20:
[Key business assets identified and assessed.
Which are legally protected and how.
Which are unprotected and the specific risk of that exposure.
Priority registrations with estimated cost and timeline.]

DISPUTE READINESS — [Score]/20:
[Whether the business can effectively pursue or defend a claim today.
Document retention assessment.
Contract enforceability assessment.
Evidence position — what the business has and what it is missing.]

PRIORITY ACTION PLAN:

NEXT 30 DAYS — do these or face serious legal consequence:
[Numbered specific actions. Each action states what to do, why it is urgent, and the specific consequence of not doing it.]

NEXT 90 DAYS — do these to significantly improve protection:
[Numbered specific actions with realistic timelines.]

12-MONTH STRATEGIC PROGRAMME — fundamental improvements:
[Numbered initiatives with estimated resource requirements.]

THE ONE THING:
[The single most important legal action this business should take in the next 30 days. Stated in plain English. Followed by the specific consequence of not taking it.]
`,

  default: `
MANDATORY OUTPUT STANDARDS — apply to every tool not listed above:

Lead with the conclusion. State the answer before the analysis.
Every section ends with a decisive finding — not a summary, a holding.
Financial figures are calculated precisely from the user's input with every step of every calculation shown.
Every legal authority cited is from the verified database provided or is established doctrine stated as doctrine — never invented.
Every rewrite is complete and ready to use — not described, written out in full.
The final section of every output must state the specific action the user takes next. The output advances the matter.
`
};

module.exports = { OUTPUT_STRUCTURES };
