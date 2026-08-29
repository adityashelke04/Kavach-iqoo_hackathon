/**
 * Where a complaint actually goes — SPEC.md §10.6, decision D16.
 *
 * DATA ONLY. Every destination below is an official Indian government facility,
 * and every URL here was fetched and confirmed to resolve on 2026-08-30. If one
 * of them moves, this file is a one-line edit and nothing else changes — which
 * is the entire reason the routes are data and not markup.
 *
 * WHAT NEVER GOES IN THIS FILE: a destination that is not run by a government
 * body. Kavach hands a frightened person a place to file a fraud complaint, and
 * every entry has to survive being read out on stage.
 *
 * Only two schemes are permitted, and the §12 gate asserts it: `tel:` and
 * `https:`. Kavach dials or opens. It never posts.
 */
import type { Disclosure, ReportRoute } from './types.ts'

export const ROUTES: ReportRoute[] = [
  {
    id: 'helpline-1930',
    name: '1930',
    operator: 'Cyber Crime Helpline, Ministry of Home Affairs',
    purpose: 'Report money already lost to fraud. The sooner the call, the better the chance of freezing it.',
    action: 'tel',
    href: 'tel:1930',
    expect: 'A person answers and takes the details over the phone.',
    // The two cases where something is already in motion. A call reaches a
    // human faster than a form does, so this leads both of them.
    appliesTo: ['money', 'credentials'],
    order: 0,
  },
  {
    id: 'cybercrime-portal',
    name: 'National Cyber Crime Reporting Portal',
    operator: 'Ministry of Home Affairs',
    purpose: 'File the written complaint about the money, and get a record of it.',
    action: 'web',
    href: 'https://cybercrime.gov.in',
    expect: 'A form. Kavach has the details ready to paste into it.',
    appliesTo: ['money', 'credentials'],
    order: 1,
  },
  {
    id: 'chakshu',
    name: 'Chakshu — report a suspected fraud message',
    operator: 'Department of Telecommunications',
    purpose: 'Report the call or message itself, so the number behind it can be acted on.',
    action: 'web',
    href: 'https://sancharsaathi.gov.in/sfc/',
    expect: 'A short form for the message and the number it came from.',
    // The right home for a scam that has not cost anything yet. Filing that as
    // financial cybercrime helps nobody, including the person filing it.
    appliesTo: ['nothing'],
    order: 0,
  },
  {
    id: 'cybercrime-portal-report-only',
    name: 'National Cyber Crime Reporting Portal',
    operator: 'Ministry of Home Affairs',
    purpose: 'If you would also like it on record as an attempted cyber crime.',
    action: 'web',
    href: 'https://cybercrime.gov.in',
    expect: 'A form. Kavach has the details ready to paste into it.',
    appliesTo: ['nothing'],
    order: 1,
  },
  {
    id: 'dnd-1909',
    name: '1909',
    operator: 'TRAI, via your mobile operator',
    purpose: 'Report unwanted marketing messages and register Do Not Disturb.',
    action: 'tel',
    href: 'tel:1909',
    expect: 'An automated line that takes the complaint.',
    appliesTo: ['nuisance'],
    order: 0,
  },
  {
    id: 'sancharsaathi-nuisance',
    name: 'Sanchar Saathi',
    operator: 'Department of Telecommunications',
    purpose: 'Report the sender online instead of by phone.',
    action: 'web',
    href: 'https://sancharsaathi.gov.in',
    expect: 'The department’s citizen portal for telecom complaints.',
    appliesTo: ['nuisance'],
    order: 1,
  },
]

/**
 * The destinations correct for what the user told us, most urgent first.
 *
 * Every `Disclosure` resolves to at least one route — there is no dead end, and
 * the §12 gate asserts that for all four answers.
 */
export function routesFor(disclosure: Disclosure): ReportRoute[] {
  return ROUTES.filter((r) => r.appliesTo.includes(disclosure)).sort((a, b) => a.order - b.order)
}

/**
 * The ordered "do this now" list, shown above the receipt when something has
 * already been sent (D16).
 *
 * Naming the specific action beats naming the feeling, so there is no "stay
 * calm" and no "be careful" here. Four sentences, in the order they should
 * happen.
 */
export function urgentSteps(disclosure: Disclosure): string[] {
  if (disclosure === 'money') {
    return [
      'Do not reply to them again. They will call back — that call is part of it.',
      'Call 1930 now. Keep this message on your phone; they will ask what it said.',
      'Call your bank on the number printed on your card, never a number from the message.',
      'Then file the written complaint. Kavach has it ready below.',
    ]
  }
  if (disclosure === 'credentials') {
    return [
      'Do not reply to them again, and do not read out any more codes.',
      'Call your bank on the number printed on your card and have the account frozen.',
      'Change the password for anything you used that code or detail on.',
      'Call 1930 and file the complaint below, even though no money has gone yet.',
    ]
  }
  return []
}
