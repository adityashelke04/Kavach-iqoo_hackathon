import type { TacticName } from './types.ts'

/**
 * Weighted term sets for the rules engine — SPEC.md §8.3, §5.6.
 *
 * Language coverage: English + Hinglish (Latin script) + Hindi (Devanagari script).
 * Designed for Indian audience speech and SMS communication.
 *
 * Weight guidance:
 *   ~2.0+  near-conclusive on its own (isolation phrases, remote-access apps)
 *   ~1.3   strong
 *   ~1.0   moderate
 *   ~0.7   weak, only meaningful in combination
 *
 * NEGATIVE terms are the false-positive defence and matter more than any
 * positive one. A real bank OTP message says "do not share this OTP with
 * anyone" — the exact opposite of an extraction attempt. Without these, the
 * engine flags every legitimate bank SMS or delivery call.
 */

export interface Term {
  re: RegExp
  w: number
}

/** All patterns are case-insensitive and global so matchAll gives us offsets. */
const t = (source: string, w: number): Term => ({
  re: new RegExp(source, 'gi'),
  w,
})

// ---------------------------------------------------------------------------
// AUTHORITY — claiming an institutional identity
// ---------------------------------------------------------------------------
const authority: Term[] = [
  // Law enforcement and government (English & Romanized)
  t(String.raw`cyber ?crime|cyber cell|cyber police|cyber branch`, 1.6),
  t(String.raw`crime branch|crime investigation`, 1.5),
  t(String.raw`\bcbi\b|c\.b\.i\.`, 1.6),
  t(String.raw`enforcement directorate|\bed department\b|\bed office\b`, 1.6),
  t(String.raw`narcotics|\bncb\b|n\.c\.b\.`, 1.5),
  t(String.raw`\bpolice\b|\bpolis\b|police station|police officer|mumbai police|delhi police`, 1.3),
  t(String.raw`\bsub[- ]?inspector\b|\binspector\b|\bconstable\b|\bhavaldar\b`, 1.2),
  t(String.raw`\bcommissioner\b|deputy commissioner|dcp|sp office`, 1.1),
  t(String.raw`income tax|\bit department\b|tax assessment`, 1.3),
  t(String.raw`\bcustoms\b|customs department|customs officer|customs clearance`, 1.3),
  t(String.raw`\bf\.?i\.?r\.?\b|fir lodged|fir registered|case registered`, 1.3),
  t(String.raw`arrest warrant|\bwarrant\b|non[- ]bailable warrant`, 1.3),
  t(String.raw`court summon|\bsummon(s|ed)?\b|magistrate|tribunal|judicial|high court|supreme court`, 1.2),
  t(String.raw`legal notice|show cause notice|official notice`, 1.2),
  t(String.raw`\btrai\b|department of telecom|telecom regulatory|\bdot\b|telecom department`, 1.3),
  t(String.raw`\buidai\b|aadha?ar (card|number|details|verification)`, 1.0),
  t(String.raw`\brbi\b|reserve bank of india|reserve bank`, 1.3),
  t(String.raw`government of india|govt\.? of india|\bgovt\b|ministry of`, 1.1),
  t(String.raw`passport office|embassy|consulate|immigration`, 1.0),
  t(String.raw`\bofficer\b|\bofficial\b`, 0.7),

  // Devanagari Hindi — Law enforcement & Government
  t(String.raw`साइबर\s*क्राइम|साइबर\s*सेल|साइबर\s*पुलिस`, 1.6),
  t(String.raw`क्राइम\s*ब्रांच|अपराध\s*शाखा`, 1.5),
  t(String.raw`सीबीआई|सी\.बी\.आई\.|सी\s*बी\s*आई`, 1.6),
  t(String.raw`प्रवर्तन\s*निदेशालय|ईडी|ई\.डी\.`, 1.6),
  t(String.raw`नारकोटिक्स|एनसीबी|एन\.सी\.बी\.`, 1.5),
  t(String.raw`पुलिस|थाना|चौकी|पुलिस\s*अधिकारी|मुंबई\s*पुलिस|दिल्ली\s*पुलिस`, 1.3),
  t(String.raw`सब\s*इंस्पेक्टर|इंस्पेक्टर|हवलदार|कमिश्नर|दरोगा`, 1.2),
  t(String.raw`आयकर\s*विभाग|इनकम\s*टैक्स`, 1.3),
  t(String.raw`कस्टम\s*विभाग|कस्टम्स|सीमा\s*शुल्क|कस्टम\s*अधिकारी`, 1.3),
  t(String.raw`एफ\.?आई\.?आर\.?|मुकदमा|केस\s*दर्ज|प्राथमिकी`, 1.3),
  t(String.raw`गिरफ्तारी\s*वारंट|अरेस्ट\s*वारंट|वारंट|गैर\s*जमानती`, 1.3),
  t(String.raw`कोर्ट\s*समन|अदालत|न्यायालय|समन|मजिस्ट्रेट`, 1.2),
  t(String.raw`कानूनी\s*नोटिस|विधिक\s*नोटिस`, 1.2),
  t(String.raw`ट्राई|दूरसंचार\s*विभाग|टेलीकॉम\s*विभाग`, 1.3),
  t(String.raw`यूआईडीएआई|आधार\s*(कार्ड|नंबर|विवरण)?`, 1.0),
  t(String.raw`आरबीआई|रिजर्व\s*बैंक|रिज़र्व\s*बैंक`, 1.3),
  t(String.raw`भारत\s*सरकार|सरकारी\s*विभाग|मंत्रालय`, 1.1),
  t(String.raw`पासपोर्ट\s*कार्यालय|दूतावास`, 1.0),

  // Banks and institutions (English & Romanized)
  t(String.raw`\bsbi\b|state bank of india`, 0.8),
  t(String.raw`\bhdfc\b|\bicici\b|\bkotak\b|\bpnb\b|axis bank|yes bank`, 0.8),
  t(String.raw`punjab national|bank of baroda|canara bank|union bank`, 0.8),
  t(String.raw`indian bank|indusind|\bidfc\b|federal bank`, 0.8),
  t(String.raw`\bnpci\b`, 1.0),
  t(String.raw`fraud (department|prevention|desk)|anti[- ]fraud`, 1.2),
  t(String.raw`bank (official|officer|representative|manager)`, 1.1),
  t(String.raw`customer (care|support) (executive|team)`, 0.8),
  t(String.raw`paytm|phone ?pe|google pay|\bgpay\b|bhim`, 0.7),
  t(String.raw`\bfedex\b|\bdhl\b|blue dart|india post|speed post|dtdc`, 0.9),
  t(String.raw`courier (company|service|department)`, 0.8),
  t(String.raw`electricity (board|department|connection)|bijli (connection|department|vibhag)`, 0.9),
  t(String.raw`\bbescom\b|\bmseb\b|\btneb\b|\bkseb\b|\buppcl\b|\bdhbbn\b`, 0.9),
  t(String.raw`amazon|flipkart|myntra`, 0.8),
  t(String.raw`netflix|hotstar|prime video|spotify|youtube premium`, 0.8),
  t(String.raw`\bjio\b|\bairtel\b|\bvodafone\b|\bbsnl\b`, 0.8),

  // Devanagari Hindi — Banks, Utilities, Couriers
  t(String.raw`स्टेट\s*बैंक|एसबीआई|एचडीएफसी|आईसीआईसीआई|कोटक|पीएनबी|एक्सिस\s*बैंक|बैंक\s*ऑफ\s*बड़ौदा|केनरा\s*बैंक`, 0.8),
  t(String.raw`बैंक\s*अधिकारी|बैंक\s*मैनेजर|धोखाधड़ी\s*विभाग`, 1.1),
  t(String.raw`बिजली\s*(विभाग|बोर्ड|कनेक्शन|कार्यालय)|विद्युत\s*विभाग`, 0.9),
  t(String.raw`कूरियर\s*(कंपनी|विभाग|सर्विस)|फेडेक्स|ब्लू\s*डार्ट|भारतीय\s*डाक`, 0.9),
  t(String.raw`डिजिटल\s*अरेस्ट|डिजिटल\s*हिरासत`, 1.6),

  // Hinglish / Hindi spoken framing
  t(String.raw`se bol raha|se baat kar raha|se call kar rah[ae]`, 1.0),
  t(String.raw`से\s*(बोल\s*रहा|बात\s*कर\s*रहा|कॉल\s*कर\s*रहा)`, 1.0),
]

// ---------------------------------------------------------------------------
// URGENCY — manufacturing a deadline
// ---------------------------------------------------------------------------
const urgency: Term[] = [
  // English & Romanized
  t(String.raw`\bimmediate(ly)?\b|\bturant\b|\bfauran\b`, 1.1),
  t(String.raw`\burgent(ly)?\b|on urgency`, 1.0),
  t(String.raw`within \d+ ?(hours?|hrs?|minutes?|mins?|days?)`, 1.3),
  t(String.raw`in the next \d+ ?(hours?|minutes?|days?)`, 1.2),
  t(String.raw`\b(24|48|2|3|6|12) ?(hours?|hrs?)\b`, 1.0),
  t(String.raw`last chance|final (notice|warning|reminder)|last warning`, 1.4),
  t(String.raw`expir(es|ing|ed) (today|tonight|soon)|expires in`, 1.2),
  t(
    String.raw`will be (blocked|suspended|deactivated|frozen|closed|terminated|cancelled|seized|disconnected)`,
    1.4,
  ),
  t(String.raw`has been (blocked|suspended|frozen|seized|held|disconnected)`, 1.2),
  t(String.raw`(account|card|sim|connection|number) (will be )?(block|suspend|freez|deactivat|disconnect)`, 1.2),
  t(String.raw`before (6|5|8|9|10|11|12)? ?(pm|am|midnight|today|tonight|tomorrow)`, 0.9),
  t(String.raw`act now|hurry|do ?n[o']?t delay|without delay|right now`, 1.2),
  t(String.raw`failure to (comply|respond|act|pay|verify)`, 1.4),
  t(String.raw`legal action (will|shall|may) be|legal consequences`, 1.3),
  t(String.raw`\barrest(ed)?\b|put you behind bars|send police`, 1.5),
  t(String.raw`penalty|fine (will|of) `, 1.0),
  t(String.raw`only \d+ ?(hours?|minutes?|days?) (left|remaining)|time is running`, 1.3),
  t(String.raw`to avoid (cancellation|suspension|disconnection|blocking|penalty|deactivation|arrest)`, 1.3),
  t(String.raw`payment (has )?(failed|declined|could not be processed)`, 0.8),

  // Hinglish
  t(String.raw`\bwarna\b|nahi to|nahin to`, 1.1),
  t(String.raw`band ho ja(yega|ega|egi)|block ho ja(yega|ega)|kat ja(yega|ega)`, 1.3),
  t(String.raw`\baaj hi\b|\babhi\b|abhi ke abhi|isi waqt|jaldi kijiye`, 1.0),
  t(String.raw`giraftar kar|jail bhej|police bhej(enge| rahe hai)`, 1.4),
  t(String.raw`\d+ ghante me|\d+ minute me`, 1.2),

  // Devanagari Hindi
  t(String.raw`तुरंत|फौरन|जल्दी|तत्काल|अभी\s*के\s*अभी|इसी\s*वक्त|आज\s*ही`, 1.1),
  t(String.raw`\b(24|48|2|3|6|12|२४|४८)\s*घंटे?|मिनट\s*में`, 1.1),
  t(String.raw`आखिरी\s*(मौका|चेतावनी|सूचना|नोटिस)|अंतिम\s*चेतावनी`, 1.4),
  t(String.raw`समाप्त\s*हो\s*(रहा|गया|जाएगा)|एक्सपायर`, 1.2),
  t(String.raw`(अकाउंट|खाता|कनेक्शन|सिम|नंबर|कार्ड|बिजली)\s*(ब्लॉक|बंद|सस्पेंड|फ्रीज|काट)\s*हो\s*(जाएगा|गया|देंगे)`, 1.4),
  t(String.raw`कानूनी\s*कार्रवाई\s*(की\s*जाएगी|होगी)|कार्रवाई\s*होगी`, 1.3),
  t(String.raw`गिरफ्तार(ी)?|जेल\s*भेज|पुलिस\s*भेज`, 1.5),
  t(String.raw`जुर्माना|पेनल्टी\s*लगेगी`, 1.0),
  t(String.raw`वरना|नहीं\s*तो`, 1.1),
]

// ---------------------------------------------------------------------------
// ISOLATION — cutting the victim off from anyone who would stop them
// Highest-weighted tactic: almost no legitimate message asks you not to tell
// your family.
// ---------------------------------------------------------------------------
const isolation: Term[] = [
  // English & Romanized
  t(String.raw`do ?n[o']?t tell (anyone|any ?one|anybody|your family|family|friends)`, 2.2),
  t(String.raw`do not tell\b`, 2.2),
  t(
    String.raw`do ?n[o']?t (discuss|inform|reveal|mention|share) (this |the |your )?(case|matter|call|investigation)? ?(with|to) (anyone|any ?one|anybody|family|lawyer)`,
    2.2,
  ),
  t(String.raw`kisi ko (mat|na|nahi) bat(a|aa)na|kisi ko mat bolna|kisi se mat kehna`, 2.2),
  t(String.raw`ghar\s*walo\s*ko\s*mat\s*batana|family\s*ko\s*mat\s*batana`, 2.2),
  t(String.raw`(strictly )?confidential (investigation|matter|case|proceeding|inquiry)`, 1.8),
  t(String.raw`strictly confidential|maintain confidentiality`, 1.8),
  t(String.raw`official secrets act|national security matter`, 2.0),
  t(String.raw`stay on the (line|call|phone)|keep this call connected`, 2.0),
  t(String.raw`do ?n[o']?t (disconnect|cut|end|hang ?up)`, 2.0),
  t(String.raw`call mat kaat|line p[ae]r? rah(iye|o|na)|phone mat kaat`, 2.0),
  t(String.raw`without informing (anyone|your|the)`, 1.6),
  t(String.raw`do ?n[o']?t (visit|go to) (the )?(branch|police|bank)`, 1.8),
  t(String.raw`keep this between us|between you and me`, 2.0),
  t(String.raw`non[- ]?co[- ]?operation|obstruction of justice`, 1.5),
  t(String.raw`do ?n[o']?t (contact|call) (the )?(police|bank|anyone)`, 2.0),
  t(String.raw`under surveillance|being monitored|skype call|video call verification`, 1.4),
  t(String.raw`your family (will|may) (also )?be`, 1.3),
  t(String.raw`digital arrest|digital custody`, 2.0),

  // Devanagari Hindi
  t(String.raw`किसी\s*को\s*(मत|ना|नहीं)\s*(बताना|बताएं|बोलना|कहना|साझा\s*करना)`, 2.2),
  t(String.raw`घरवालों\s*को\s*(मत|ना|नहीं)\s*(बताना|बोलना)|परिवार\s*को\s*(मत|ना)\s*बताना`, 2.2),
  t(String.raw`गुप्त\s*(जांच|मामला|कार्रवाई)|गोपनीय|अति\s*गोपनीय`, 1.8),
  t(String.raw`शासकीय\s*गोपनीयता\s*अधिनियम`, 2.0),
  t(String.raw`कॉल\s*(मत\s*काटना|चालू\s*रखिए|कट\s*मत\s*करना)|फोन\s*मत\s*काटना`, 2.0),
  t(String.raw`लाइन\s*पर\s*(रहिए|रहो|बने\s*रहिए)`, 2.0),
  t(String.raw`बैंक\s*या\s*पुलिस\s*के\s*पास\s*मत\s*जाना`, 1.8),
  t(String.raw`यह\s*बात\s*हमारे\s*बीच\s*रहनी\s*चाहिए`, 2.0),
  t(String.raw`डिजिटल\s*अरेस्ट|डिजिटल\s*हिरासत|कैमरा\s*ऑन\s*रखिए`, 2.0),
]

// ---------------------------------------------------------------------------
// EXTRACTION — the actual ask
// ---------------------------------------------------------------------------
const extraction: Term[] = [
  // Credentials (English & Spoken Phonetics)
  t(String.raw`(share|send|provide|give|forward|tell|read)( me| us)? (the |your )?otp`, 1.9),
  t(String.raw`otp bhej|otp bata|otp share kar|otp dijiye|code batao`, 1.9),
  // Acronyms written in SMS or spoken in voice recognition
  t(String.raw`\bo[\s.]?t[\s.]?p\b|o\s*t\s*p`, 1.4),
  t(String.raw`one[- ]time password`, 1.5),
  t(String.raw`\bc[\s.]?v[\s.]?v\b|c\s*v\s*v`, 1.5),
  t(String.raw`\b(atm |card |upi )?pin\b`, 1.1),
  t(String.raw`(debit|credit) card (number|details|info)`, 1.4),
  t(String.raw`card number`, 1.3),
  t(String.raw`net ?banking (password|login|credentials|details)`, 1.6),
  t(String.raw`\bpassword\b`, 1.0),
  t(String.raw`login (id|credentials|details)`, 1.3),
  t(String.raw`(aadha?ar|pan) (number|card) (details|copy)?`, 1.2),
  t(String.raw`\ba[\s.]?p[\s.]?k\b|apk file|install apk`, 1.6),

  // Devanagari Hindi Credentials
  t(String.raw`ओटीपी|ओ\s*टी\s*पी|वन\s*टाइम\s*पासवर्ड`, 1.4),
  t(String.raw`(ओटीपी|कोड|पासवर्ड|पिन)\s*(भेजें|भेजिए|बताएं|बताइए|शेयर\s*करें|दीजिए|सुनाइए)`, 1.9),
  t(String.raw`सीवीवी|सी\s*वी\s*वी`, 1.5),
  t(String.raw`(एटीएम|कार्ड|यूपीआई)\s*पिन|पासवर्ड`, 1.1),
  t(String.raw`डेबिट\s*कार्ड|क्रेडिट\s*कार्ड\s*(नंबर|विवरण)`, 1.4),
  t(String.raw`नेट\s*बैंकिंग\s*(पासवर्ड|लॉगिन|विवरण)`, 1.6),
  t(String.raw`आधार\s*(नंबर|कार्ड)|पैन\s*(नंबर|कार्ड)\s*(विवरण)?`, 1.2),

  // Money movement (English & Hinglish)
  t(String.raw`\bu[\s.]?p[\s.]?i (id|pin|address)\b|u\s*p\s*i`, 1.4),
  t(String.raw`\bupi\b`, 1.0),
  t(String.raw`scan (this|the) qr|\bqr code\b|q\s*r\s*code`, 1.5),
  t(String.raw`(send|transfer|pay) (rs\.?|₹|inr|money|amount|the amount|fee)`, 1.5),
  t(String.raw`paise (bhej|transfer kar|dijiye|daalo)|rupaye bhej`, 1.5),
  t(String.raw`refundable (security )?deposit|security deposit`, 1.7),
  t(String.raw`security (amount|money)|deposit (of )?(rs\.?|₹|\d)`, 1.5),
  t(String.raw`update your (payment|billing|card) (details|information|method)`, 1.5),
  t(String.raw`work from home|part[- ]time job|earn rs\.?|daily income|selected for|telegram task`, 1.2),
  t(String.raw`https?:\/\/[^\s]+|\b[a-z0-9][a-z0-9-]*\.(com|in|co|net|org|xyz|info|online|site|top|live|shop)\/[^\s]*`, 0.7),
  t(
    String.raw`(processing|registration|verification|clearance|handling|convenience) (fee|charge)`,
    1.7,
  ),
  t(String.raw`customs duty|customs (fee|charge|clearance)`, 1.7),
  t(String.raw`gift ?card|gift voucher code`, 1.4),
  t(String.raw`you have won|lottery|prize money|lucky (winner|draw)|kbc prize`, 1.4),

  // Devanagari Hindi Money Movement
  t(String.raw`यूपीआई\s*(आईडी|पिन|एड्रेस)|यू\s*पी\s*आई`, 1.4),
  t(String.raw`क्यूआर\s*(कोड)?\s*(स्कैन\s*करें|स्कैन\s*करो|स्कैन\s*कीजिए)`, 1.5),
  t(String.raw`पैसे\s*(भेजें|भेजिए|ट्रांसफर\s*करें|डालें)|रुपये\s*(भेजें|ट्रांसफर)`, 1.5),
  t(String.raw`सिक्योरिटी\s*(डिपॉजिट|राशि)|रिफंडेबल\s*डिपॉजिट`, 1.7),
  t(String.raw`प्रोसेसिंग\s*(फीस|शुल्क)|रजिस्ट्रेशन\s*(फीस|शुल्क)|क्लियरेंस\s*(चार्ज|फीस)`, 1.7),
  t(String.raw`कस्टम\s*ड्यूटी|कस्टम\s*शुल्क`, 1.7),
  t(String.raw`लॉटरी|इनाम|प्राइज\s*मनी|लकी\s*ड्रॉ|जीता\s*है|केबीसी\s*इनाम`, 1.4),
  t(String.raw`घर\s*बैठे\s*कमाएं|पार्ट\s*टाइम\s*जॉब|रोजाना\s*कमाई`, 1.2),

  // Remote access — near-conclusive
  t(String.raw`any ?desk|team ?viewer|quick ?support|rust ?desk|air ?droid|screen ?share`, 2.2),
  t(String.raw`screen ?shar(e|ing)|share your screen|mirror your screen`, 1.8),
  t(String.raw`(install|download) (this|the|our) ?app`, 1.4),
  t(String.raw`एनीडेस्क|टीमव्यूअर|क्विकसपोर्ट|स्क्रीन\s*शेयर|स्क्रीन\s*मिरर`, 2.2),
  t(String.raw`ऐप\s*(इंस्टॉल|डाउनलोड)\s*करें`, 1.4),

  // Links and callbacks
  t(String.raw`bit\.ly|tinyurl|cutt\.ly|rb\.gy|shorturl|is\.gd|goo\.gl|t\.co/`, 1.7),
  t(String.raw`click (here|this link|on the link|below)`, 1.4),
  t(String.raw`verify your (kyc|account|identity|details|number)`, 1.4),
  t(String.raw`update your (kyc|account|details|pan|aadha?ar|record)`, 1.5),
  t(String.raw`\bk[\s.]?y[\s.]?c\b|k\s*y\s*c`, 1.0),
  t(String.raw`केवाईसी|के\s*वाई\s*सी\s*(अपडेट|वेरिफिकेशन)`, 1.4),
  t(String.raw`re[- ]?activate your (account|sim|number)`, 1.4),
  t(String.raw`whats ?app (me|us) (on|at)|व्हाट्सएप\s*(पर\s*मैसेज|करें)`, 1.5),
  t(String.raw`\b[6-9]\d{9}\b`, 1.2),
  t(String.raw`call (this number|on this|back on|immediately on)`, 1.2),
]

export const TERMS: Record<TacticName, Term[]> = {
  authority,
  urgency,
  isolation,
  extraction,
}

// ---------------------------------------------------------------------------
// VOICE-ONLY TERMS — SPEC.md §5.6
//
// Merged on top of TERMS when `channel === 'voice'`. Call-centre and
// live-conversation patterns for Indian English, Hinglish, and Hindi speech.
// ---------------------------------------------------------------------------
const voiceAuthority: Term[] = [
  t(String.raw`i am (calling|speaking) from|this is .{0,25} (calling|speaking) from`, 1.4),
  t(String.raw`calling from (the )?(head ?office|head ?quarters|main branch|police headquarters)`, 1.3),
  t(String.raw`(this|the) call is being recorded|recorded for (legal|security|court) purposes?`, 1.2),
  t(String.raw`transferring your call|connecting you (to|with)|connect to senior officer`, 1.2),
  t(String.raw`(senior|higher) officer|my senior|investigating officer`, 1.1),
  t(String.raw`badge number|employee (id|code) is|officer id`, 1.2),
  t(String.raw`main .{0,25} se (bol|baat kar) raha hoon|police station se baat kar raha hu`, 1.4),
  t(String.raw`मैं\s*.{0,25}\s*से\s*(बोल|बात\s*कर)\s*रहा\s*(हूं|हु)|थाने\s*से\s*बात\s*कर\s*रहा`, 1.4),
  t(String.raw`यह\s*कॉल\s*रिकॉर्ड\s*की\s*जा\s*रही\s*है|वरिष्ठ\s*अधिकारी\s*से\s*बात`, 1.2),
]

const voiceUrgency: Term[] = [
  t(String.raw`right now|abhi ke abhi|is[i]? waqt|turant ke turant`, 1.0),
  t(String.raw`in the next few (minutes|seconds|hours)|within five minutes`, 1.2),
  t(String.raw`do ?n[o']?t waste time|jaldi kar|jaldi kijiye`, 1.2),
  t(String.raw`abhi\s*karna\s*hoga|warna\s*case\s*darj\s*hoga`, 1.3),
  t(String.raw`अभी\s*करना\s*होगा|वरना\s*केस\s*दर्ज\s*होगा|दो\s*मिनट\s*में`, 1.2),
]

const voiceIsolation: Term[] = [
  // Establishing that the victim is unsupervised. Near-conclusive.
  t(String.raw`are you alone|is (anyone|someone) (with you|near you|at home|around)`, 2.2),
  t(String.raw`kya aap akele (hai|ho)|kya koi aas paas hai|kya koi sun raha hai`, 2.2),
  t(String.raw`go to a (quiet|separate|private) (room|place)`, 2.2),
  t(String.raw`shant kamre me jao|gate band kar lo|room me akele jao`, 2.2),
  t(String.raw`(is|are) (there )?(anyone|somebody|someone) listening`, 2.0),
  t(String.raw`please listen (to me )?carefully|dhyan se suniye`, 1.2),
  t(String.raw`do ?n[o']?t (put|keep) (the )?(phone|call) down`, 1.8),
  t(String.raw`phone mat rakhna|call disconnect mat karna`, 1.8),
  t(String.raw`do ?n[o']?t talk to (anyone|any ?one|anybody)`, 2.0),
  t(String.raw`camera on (rakho|karo)|video call pe aao`, 2.0),
  t(String.raw`क्या\s*आप\s*अकेले\s*हैं|कोई\s*आस\s*पास\s*है|कोई\s*सुन\s*तो\s*नहीं\s*रहा`, 2.2),
  t(String.raw`शांत\s*कमरे\s*में\s*जाइए|कमरा\s*बंद\s*कर\s*लीजिए`, 2.2),
  t(String.raw`फोन\s*मत\s*काटना|कॉल\s*चालू\s*रखिए|कैमरा\s*चालू\s*रखिए`, 2.0),
]

const voiceExtraction: Term[] = [
  t(
    String.raw`(read|tell|say|give|share)( it)?( me| us| out| to me| back)+ (the |that )?(code|number|otp|o[\s.]?t[\s.]?p|password|pin)`,
    1.9,
  ),
  t(String.raw`what is the (code|otp|o[\s.]?t[\s.]?p|number|pin) (you|that you) (got|received)`, 1.9),
  t(String.raw`(nine|9|six|6|four|4)[ -]digit (code|number|pin)`, 1.6),
  t(String.raw`(open|go to|install from) (the )?(play ?store|google play|app ?store)`, 1.4),
  t(String.raw`play store kholiye|anydesk download kijiye|app install kijiye`, 1.5),
  t(String.raw`switch on (your )?(internet|mobile data|data)`, 1.3),
  t(String.raw`open your (banking|bank|payment|phonepe|gpay|paytm) app`, 1.5),
  t(String.raw`press (one|two|nine|zero|1|2|9|0)\b`, 0.9),
  t(String.raw`(thousand|lakh|crore|hundred) rupees|rupees only|hazar rupaye`, 1.0),
  t(String.raw`keep (the|your) phone (with you|on|unlocked)`, 1.2),
  t(String.raw`apna screen share karo|screen share start kijiye`, 1.8),
  t(String.raw`कोड\s*बताइए|ओटीपी\s*(बताइए|दीजिए|सुनाइए)|स्क्रीन\s*शेयर\s*कीजिए`, 1.9),
  t(String.raw`प्ले\s*स्टोर\s*खोलिए|एनीडेस्क\s*डाउनलोड\s*कीजिए`, 1.5),
  t(String.raw`बैंक\s*ऐप\s*खोलिए|मोबाइल\s*डेटा\s*ऑन\s*कीजिए`, 1.4),
  t(String.raw`(हज़ार|लाख|करोड़)\s*रुपये`, 1.0),
]

export const VOICE_TERMS: Record<TacticName, Term[]> = {
  authority: voiceAuthority,
  urgency: voiceUrgency,
  isolation: voiceIsolation,
  extraction: voiceExtraction,
}

// ---------------------------------------------------------------------------
// NEGATIVE TERMS — legitimacy markers
//
// Scoped to the tactic they defend, and subtracted BEFORE the presence
// threshold, so a genuine bank message never registers extraction at all.
// ---------------------------------------------------------------------------
export interface NegativeTerm extends Term {
  /** Which tactic this defends. Omit to subtract from overall confidence. */
  tactic?: TacticName
}

export const NEGATIVES: NegativeTerm[] = [
  // Anti-extraction: A real bank tells you NOT to share the OTP
  {
    ...t(
      String.raw`do ?n[o']?t (share|disclose|reveal) (your |this |the )?(otp|pin|cvv|password|card details|credentials)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`never share (your |this |the )?(otp|pin|cvv|password|card details|credentials)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`kisi (ke saath|ko) (bhi )?(otp|pin|cvv|password) (share|saajha) (na|mat) kar(en|e|na)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`अपना\s*ओटीपी\s*(किसी\s*को\s*भी|किसी\s*के\s*साथ)\s*(शेयर|साझा|मत\s*बताएं|ना\s*करें|मत\s*दें)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`ओटीपी\s*किसी\s*को\s*ना\s*बताएं|ओटीपी\s*शेयर\s*ना\s*करें`, 3.2),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`(bank|we) (never|will never|do not|does not) ask`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`we (will )?never (call|ask|request)`, 2.5),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`bank\s*kabhi\s*bhi\s*(otp|pin|password)\s*nahi\s*maangta`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`बैंक\s*कभी\s*(भी\s*)?(ओटीपी|पिन|पासवर्ड)\s*नहीं\s*मांगता`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`if (you|this was) (did ?n[o']?t|was not|not) (you|initiated|requested|authorised|authorized)`,
      2.0,
    ),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`to report (this |any )?(fraud|unauthorised|unauthorized|dispute)`, 2.0),
    tactic: 'extraction',
  },

  // Transaction-notification vocabulary
  {
    ...t(String.raw`(debited|credited) (from|to|by|in) (your )?a\/?c`, 1.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`खाते\s*(से\s*निकाले|में\s*जमा\s*किए)\s*गए|खाते\s*से\s*डेबिट`, 1.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`avl(bl)? bal|available balance|a\/?c balance|closing balance`, 1.5),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`(txn|transaction|ref|reference|utr)[. ]?(id|no|number)`, 1.2),
    tactic: 'extraction',
  },
  { ...t(String.raw`\b1800[- ]?\d{3}[- ]?\d{3,4}\b|toll[- ]?free`, 1.5), tactic: 'extraction' },
  {
    ...t(String.raw`(has been|is) (delivered|shipped|dispatched|out for delivery)`, 1.2),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`never ask(s|ed)? (you )?for (your |the )?(otp|pin|cvv|password)`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`do ?n[o']?t share (it|this|these) with (anyone|any ?one|anybody)`, 2.0),
    tactic: 'extraction',
  },

  // Real Delivery / Cab handover OTP protections (English, Hinglish & Devanagari)
  {
    ...t(String.raw`delivery (otp|code|partner|executive|agent|boy)`, 1.8),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`with (your|the) (driver|delivery|cab|technician|executive|partner|rider|swiggy|zomato|amazon|flipkart)`,
      2.5,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`delivery\s*(partner|boy|agent)\s*(ke\s*saath|ko\s*share|ko\s*bataen|ko\s*de)`,
      2.5,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`डिलीवरी\s*(पार्टनर|बॉय|कोड|ओटीपी)\s*(को\s*दें|के\s*साथ\s*शेयर\s*करें|को\s*बताएं)`,
      2.5,
    ),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`swiggy|zomato|zepto|blinkit|uber|ola|rapido|apollo clinic`, 1.5),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`स्विगी|ज़ोमैटो|ज़ेप्टो|ब्लिंकइट|उबर|ओला`, 1.5),
    tactic: 'extraction',
  },

  // Global legitimacy markers
  { ...t(String.raw`this is an automated (message|sms|notification|call)`, 1.2) },
  { ...t(String.raw`यह\s*एक\s*स्वचालित\s*(संदेश|कॉल)\s*है`, 1.2) },
  { ...t(String.raw`do ?n[o']?t reply to this (message|sms|email)`, 1.0) },
  { ...t(String.raw`thank you for (banking|shopping|choosing|using)`, 1.0) },
]

// ---------------------------------------------------------------------------
// CONCLUSIVE SIGNALS
// ---------------------------------------------------------------------------
export interface ConclusiveSignal {
  all: RegExp[]
  floor: number
  why: string
  /** If any of these match, the signal is suppressed entirely. */
  unless?: RegExp[]
}

export const CONCLUSIVE: ConclusiveSignal[] = [
  {
    all: [/any ?desk|team ?viewer|quick ?support|rust ?desk|air ?droid|एनीडेस्क|टीमव्यूअर|क्विकसपोर्ट/gi],
    floor: 0.78,
    why: 'remote-access app',
  },
  {
    all: [/digital ?arrest|digital ?custody|डिजिटल\s*अरेस्ट|डिजिटल\s*कस्टडी/gi],
    floor: 0.78,
    why: 'digital arrest intimidation tactic',
  },
  {
    all: [
      /(share|send|provide|give|forward|tell|read|bata|bhej|शेयर|भेज|बता)( me| us| out| to me)? (the |your |that |apna )?(otp|o[\s.]?t[\s.]?p|ओटीपी|ओ\s*टी\s*पी)/gi,
    ],
    // Couriers and cab drivers legitimately ask for an OTP at handover.
    unless: [
      /with (your|the) (driver|delivery|cab|technician|executive|partner|rider)/i,
      /delivery (otp|code|partner|executive|agent|boy)/i,
      /डिलीवरी\s*(पार्टनर|बॉय|कोड|ओटीपी)/i,
      /swiggy|zomato|zepto|blinkit|uber|ola/i,
    ],
    floor: 0.76,
    why: 'asks for the OTP',
  },
  {
    all: [/(deposit|pay|send|transfer|bhej|जमा|भेज)(\s+\S+){0,4}\s+(security (amount|deposit)|refundable|सिक्योरिटी|रिफंडेबल)/gi],
    floor: 0.74,
    why: 'upfront deposit demanded',
  },
  {
    all: [/(share|send|provide|give|bata|बता)( me| us)?.{0,30}(cvv|card number|card details|atm pin|सीवीवी|पिन|कार्ड नंबर)/gi],
    floor: 0.74,
    why: 'asks for card credentials',
  },
  {
    all: [/refundable\s+(\w+\s+){0,2}(fee|charge|deposit)|रिफंडेबल\s*(फीस|शुल्क|डिपॉजिट)/gi],
    floor: 0.74,
    why: 'refundable fee — advance-fee hook',
  },
  {
    all: [
      /(pay|paying|send|transfer|bhej|भेज)/gi,
      /(processing|registration|clearance|verification|handling|प्रोसेसिंग|रजिस्ट्रेशन|क्लियरेंस) (fee|charge|शुल्क|फीस)/gi,
    ],
    floor: 0.74,
    why: 'advance fee demanded',
  },
  {
    all: [
      /you have won|lottery|prize money|lucky (draw|winner)|jeeta hai|लॉटरी|इनाम\s*जीता/gi,
      /(fee|charge|deposit|bank account number|फीस|शुल्क|खाता नंबर)/gi,
    ],
    floor: 0.74,
    why: 'prize requiring payment or account details',
  },
  {
    all: [
      /(do ?n[o']?t|never|kisi\s*ko\s*mat|किसी\s*को\s*मत) (tell|inform|discuss|batana|बताएं|बताना)/gi,
      /(anyone|any ?one|anybody|family|gharwalo|परिवार)/gi,
    ],
    floor: 0.74,
    why: 'instructs you to hide the call from everyone',
  },
]
