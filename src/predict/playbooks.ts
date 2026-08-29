/**
 * The scripts — SPEC.md §10.6, decision D17.
 *
 * DATA ONLY. Ordered most specific first, which is also the tie-break when two
 * playbooks score equally (see `match.ts`).
 *
 * WRITING RULES, because this file is the one a later session will be most
 * tempted to pad:
 *
 * 1. **Three steps, in the order they arrive.** The third is where the money
 *    moves. If a script does not have a third step, it is not a playbook.
 * 2. **"They'll …", never "you should".** This predicts the sender. The moment
 *    it starts instructing the reader it has become advice, and advice belongs
 *    in `nextMove` or the report's urgent steps (D16).
 * 3. **Plain language (D11).** No "vector", "playbook", "script", "social
 *    engineering". A person's parent has to read this while frightened.
 * 4. **No number about the message (§4).** These describe the sender's
 *    behaviour, not how suspicious we found the text.
 * 5. **Real arcs only.** Every entry below is a shape that actually runs in
 *    India at volume. Inventing a plausible-sounding one is a lie told to
 *    somebody who is about to act on it.
 */
import type { Playbook } from './types.ts'

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'digital-arrest',
    // The single most damaging arc currently running in India, and the one with
    // the most recognisable middle: the "senior officer" hand-off and the
    // demand to be alone.
    marker:
      /digital ?arrest|digital ?custody|arrest warrant|court summon|\bfir\b|money laundering|narcotics|enforcement directorate|official secrets|confidential (investigation|matter)|डिजिटल\s*अरेस्ट|गिरफ्तारी|मनी\s*लॉन्ड्रिंग|गोपनीय\s*जांच/i,
    requiresTactics: ['authority'],
    supporting: [
      /cyber ?crime|\bcbi\b|\bed\b|enforcement directorate|police|inspector|officer|साइबर\s*क्राइम|पुलिस|इंस्पेक्टर/i,
      /video ?call|skype|whats ?app video/i,
      /alone|nobody|no one|do ?n[o']?t (tell|inform|visit|contact)|quiet room|अकेले|किसी\s*से\s*(बात\s*)?मत|दरवाजा\s*बंद/i,
      /verify|verification|safe (account|custody)|frozen|freeze|सत्यापन|जब्त/i,
    ],
    steps: [
      "They'll say the case is being passed to a senior officer, and put you on hold so it feels official.",
      "They'll ask you to go somewhere alone and stay on video — so nobody nearby can interrupt and ask what is going on.",
      "Then they'll ask you to move your money to a “safe account” for checking, and promise it comes straight back.",
    ],
    ending:
      'It does not come back. No police force in India freezes your money by asking you to send it somewhere.',
  },

  {
    id: 'parcel-customs',
    marker:
      /parcel|courier|consignment|fed ?ex|dhl|blue ?dart|customs|कस्टम|पार्सल|कूरियर/i,
    requiresTactics: ['authority'],
    supporting: [
      /seized|held|detained|illegal|drugs|narcotics|contraband|जब्त|अवैध|दवाइयां/i,
      /customs (duty|fee|charge|clearance)|clearance (fee|charge)|कस्टम\s*(क्लीयरेंस|फीस|शुल्क)/i,
      /cyber ?crime|police|officer|case ?id|fir|पुलिस|गिरफ्तार/i,
    ],
    steps: [
      "They'll say something illegal was found in a parcel sent in your name.",
      "They'll hand you to someone claiming to be from the police or customs, to make it feel like a real case.",
      "Then they'll ask for a clearance or customs fee to make it go away quietly.",
    ],
    ending:
      'Customs does not phone people to collect a fee, and there is no parcel. The fee is the entire point of the call.',
  },

  {
    id: 'remote-access',
    // Near-conclusive on its own — the detector already treats these app names
    // as a conclusive signal (§8.3), and the arc after them is always the same.
    marker:
      /any ?desk|team ?viewer|quick ?support|rust ?desk|air ?droid|screen ?shar|एनीडेस्क|टीमव्यूअर|स्क्रीन\s*शेयर/i,
    requiresTactics: ['extraction'],
    supporting: [
      /install|download|play ?store|apk/i,
      /help|fix|resolve|assist|support|refund/i,
      /code|\bid\b|9[- ]digit|number (shown|on the screen)/i,
    ],
    steps: [
      "They'll ask you to install an app so they can “see the problem and fix it for you”.",
      "They'll ask for the number the app shows you — that number is what lets them in.",
      "Then they'll ask you to put the phone down and not touch it for a few minutes.",
    ],
    ending:
      'In those few minutes they are inside your banking app, operating it while you watch.',
  },

  {
    id: 'kyc-otp',
    // "will be blocked", "has been temporarily suspended" and "PAN card has
    // been suspended" are the same arc in three phrasings, and a real corpus
    // carries all three — hence the gap rather than a fixed word order.
    marker:
      /\bk[\s.]?y[\s.]?c\b|केवाईसी|account.{0,40}(blocked|suspended|frozen|closed|deactivat)|(pan|aadha?ar).{0,30}(suspended|blocked|verify)|re[- ]?activate|खाता.{0,30}(ब्लॉक|बंद|सस्पेंड|फ्रीज)/i,
    requiresTactics: ['extraction'],
    supporting: [
      /\bo[\s.]?t[\s.]?p\b|one[- ]time password|ओटीपी/i,
      /bank|sbi|hdfc|icici|axis|paytm|income tax|कोटक|बैंक|स्टेट\s*बैंक/i,
      /24 hours|today|immediately|urgent|तुरंत|तत्काल/i,
      /verify|update|confirm|legal action|सत्यापन|बताइए/i,
    ],
    steps: [
      "They'll trigger a real code from your own bank, so the message that arrives looks completely genuine.",
      "They'll ask you to read it back “to confirm it is really you”.",
      "If you pause, they'll say that one expired and send another straight away.",
    ],
    ending:
      'That code is the only thing standing between them and your account. No bank ever asks anyone to read one out.',
  },

  {
    id: 'refund-overpayment',
    marker: /refund|reversal|credited (to you )?by mistake|extra amount|wrong(ly)? (credited|sent)|रिफंड|वापस/i,
    requiresTactics: ['extraction'],
    supporting: [
      /excess|extra|more than|by mistake|error|galti/i,
      /return|send (it )?back|transfer back|wapas/i,
      /\bupi\b|qr|scan|account number/i,
    ],
    steps: [
      "They'll say a refund reached you by mistake, for more than you were owed.",
      "They'll ask you to send the difference back right away, before it is noticed.",
      "If you check and the money is not there, they'll say it is “still pending” and push you to send anyway.",
    ],
    ending: 'There was no refund. The only real transfer will be the one you make.',
  },

  {
    id: 'upi-collect',
    marker: /scan (this|the) qr|\bqr ?code\b|collect request|payment request|क्यूआर/i,
    requiresTactics: ['extraction'],
    supporting: [
      /\bupi\b|gpay|google pay|phone ?pe|paytm|यूपीआई/i,
      /receive|credit|refund|cashback|प्राप्त/i,
      /\bpin\b|approve|accept/i,
    ],
    steps: [
      "They'll send a QR code or a payment request and call it your refund.",
      "They'll tell you to scan it, or approve it, to “receive” the money.",
      "They'll keep you talking so you do not stop to read what the screen is actually asking.",
    ],
    ending:
      'You never enter your UPI PIN to receive money. Entering it sends money — that is the whole trick.',
  },

  {
    id: 'job-task',
    marker:
      /work from home|part[- ]time job|daily income|earn rs\.?|telegram task|selected for|घर\s*बैठे\s*कमाएं|पार्ट\s*टाइम/i,
    requiresTactics: ['extraction'],
    supporting: [
      /telegram|whats ?app|join|register/i,
      /deposit|invest|recharge|top ?up|task|like.{0,15}video/i,
      // The joining fee is usually the corroboration; the withdrawal wall
      // comes later in the call, not in the message that opens it.
      /withdraw|payout|commission|profit|(registration|joining|one[- ]time) fee/i,
    ],
    steps: [
      "They'll pay you a small amount first, so that the next request feels safe.",
      "They'll ask for a deposit to unlock the better-paying tasks.",
      "When you try to take your money out, a tax or a fee will have to be paid first.",
    ],
    ending:
      'That first small payment is what the whole thing costs them. Nothing after it comes back.',
  },

  {
    id: 'prize-lottery',
    marker: /you have won|lottery|prize money|lucky (draw|winner)|kbc|लॉटरी|इनाम|जीता\s*है/i,
    requiresTactics: ['extraction'],
    supporting: [
      /processing fee|tax|gst|registration fee|शुल्क|फीस/i,
      /bank (account|details)|account number|खाता/i,
      /claim|release|transfer/i,
    ],
    steps: [
      "They'll ask for your bank details “so the prize money can be sent”.",
      "They'll say a tax or processing fee has to be cleared before it can be released.",
      "Each time you pay, one more fee will appear that nobody mentioned before.",
    ],
    ending:
      'A prize for something you never entered is not a prize. Nothing is ever released.',
  },

  {
    id: 'sim-deactivation',
    // The TRAI/SIM arc is a doorway, not a destination: the number threat only
    // exists to get you to press a key and be "transferred" to a fake officer.
    // Saying that out loud is the whole value of predicting it.
    marker:
      /\btrai\b|sim (card )?(will be )?(block|deactivat|disconnect)|mobile number.{0,40}(deactivat|block|disconnect)|telecom (department|vigilance)|टेलीकॉम|सिम\s*(कार्ड\s*)?(ब्लॉक|बंद)/i,
    requiresTactics: ['authority'],
    supporting: [
      /press \d|connect to|transferr?ed to|speak to (a |an )?(police|officer|vigilance)/i,
      /illegal (activit|marketing|messages)|complaint|warrant|अवैध|शिकायत|वारंट/i,
      /2 hours|two hours|within|immediately|turant|तुरंत/i,
      /cyber (cell|crime)|police|officer|supreme court|पुलिस|साइबर/i,
    ],
    steps: [
      "They'll tell you the number is about to be cut off over something illegal done in your name.",
      "They'll offer to connect you to a police or cyber-crime officer — and that “officer” is the same operation.",
      "Once you are on that call, they'll ask you to prove you are innocent by moving your money or reading out a code.",
    ],
    ending:
      'TRAI does not block numbers by phone, and no department transfers you to the police mid-call. The transfer is the trap.',
  },

  {
    id: 'family-emergency',
    // The one arc that works on people who would see through every other one,
    // because it does not ask you to believe a stranger — it asks you to
    // believe your own child.
    marker:
      /this is my new number|my old phone|papa|mummy|beta|aapka (beta|bacha|ladka)|your (son|daughter).{0,40}(custody|accident|trouble|arrested)|बेटा|नया\s*नंबर/i,
    requiresTactics: ['extraction'],
    supporting: [
      /urgent|immediately|right now|turant|abhi|तुरंत/i,
      /\bupi\b|transfer|send rs|paise|account|हजार|रुपये/i,
      /do ?n[o']?t tell|dont tell|mat batana|please|explain later|किसी\s*को\s*मत/i,
      /custody|police|station|hospital|accident|fight|case|f ?i ?r/i,
    ],
    steps: [
      "They'll give a reason you cannot check quickly — a broken phone, a police station, a hospital.",
      "They'll ask you to keep it between the two of you, so you do not ring anyone who would recognise the voice.",
      "Then they'll ask for money by UPI right now, and promise to explain properly afterwards.",
    ],
    ending:
      'Hang up and call the person on the number you already have for them. If it is really them, they will answer.',
  },

  {
    id: 'fake-billing',
    // Order confirmations and failed-payment notices work by manufacturing a
    // reason for *you* to reach out, which flips who is chasing whom.
    marker:
      /(order|subscription|payment|renewal).{0,40}(confirmed|failed|declined|expir|cancel)|did not place this order|update your (payment|billing|card) (details|information|method)/i,
    requiresTactics: ['extraction'],
    supporting: [
      /click (here|this|the link|below)|bit\.ly|tinyurl|cutt\.ly|https?:\/\//i,
      /cancel|refund|dispute|avoid|reactivate/i,
      /amazon|flipkart|netflix|prime|spotify|hotstar|myntra/i,
      /\d+ hours|today|urgent|immediately|within/i,
    ],
    steps: [
      "They'll show you a charge you do not recognise, so that you are the one hurrying to fix it.",
      "The link they give will open a page that looks exactly like the company's own.",
      "Then it will ask for your card or your login “to cancel the order” — and that is the whole purpose of the message.",
    ],
    ending:
      'Open the app you already have installed and check there. If the order is not in it, it never existed.',
  },

  {
    id: 'reward-points',
    // Distinct from fake-billing: nothing is wrong, you are being *given*
    // something. That reframing is why it gets past people who would hang up on
    // a threat, and why it deserves its own script rather than a shared one.
    marker:
      /reward ?points?|loyalty points|points.{0,25}expir|cashback offer|redeem.{0,25}points|रिवॉर्ड\s*(पॉइंट|अंक)/i,
    requiresTactics: ['extraction'],
    supporting: [
      /expir|tonight|today|before|last (day|chance)|समाप्त|आज/i,
      /credit|redeem|claim|transfer|convert/i,
      /card (number|details)|\bcvv\b|\botp\b|link|app|download/i,
      /bank|sbi|hdfc|icici|axis|credit card|बैंक/i,
    ],
    steps: [
      "They'll tell you something you have already earned is about to expire tonight.",
      "They'll offer to convert it to cash for you, which is why they need your card open in front of you.",
      "Then they'll ask for the card number, the three digits on the back, or the code that arrives — to “credit” it.",
    ],
    ending:
      'Reward points are redeemed inside your bank’s own app, by you. Nobody has to phone you to release them.',
  },

  {
    id: 'advance-fee-windfall',
    marker:
      /inheritance|unclaimed (funds|money|inheritance)|beneficiary|next of kin|usd ?\d|million|compensation fund|विरासत|अनक्लेम्ड/i,
    requiresTactics: ['extraction'],
    supporting: [
      /confidential|strictly private|do ?n[o']?t tell|keep this|गोपनीय/i,
      /bank (account|details)|account number|खाता\s*(नंबर|विवरण)/i,
      /(processing|transfer|legal|clearance) (fee|charge|cost)|शुल्क|फीस/i,
      /lawyer|barrister|solicitor|foreign|overseas|bank officer/i,
    ],
    steps: [
      "They'll ask for your bank details so the money can supposedly be moved to you.",
      "They'll ask you to keep it quiet, so nobody talks you out of it.",
      "Then a fee will appear — legal, transfer, clearance — that has to be paid before the money can be released.",
    ],
    ending:
      'Money nobody knew you were owed is never real. The fee is the only transaction that will actually happen.',
  },

  {
    id: 'utility-disconnection',
    marker:
      /electricity|power (supply|will be)|bijli|disconnect|बिजली|कनेक्शन\s*काट/i,
    requiresTactics: ['urgency'],
    supporting: [
      /bill|payment|due|outstanding|बिल/i,
      /tonight|today|9 ?pm|immediately|तुरंत/i,
      /call|whats ?app|contact|helpline/i,
    ],
    steps: [
      "They'll say the power will be cut tonight unless the bill is cleared now.",
      "They'll give you a number to call, or move the conversation to WhatsApp where it is harder to check.",
      "Then they'll walk you through a link or an app that takes the payment — and your card details with it.",
    ],
    ending:
      'An electricity board does not warn you by text hours before cutting you off, and never collects on WhatsApp.',
  },
]
