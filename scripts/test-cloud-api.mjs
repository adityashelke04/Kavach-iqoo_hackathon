import fs from 'node:fs'
import handler from '../api/analyze.ts'
import { resultFromLlm } from '../src/detector/llm.ts'
import { classifySender } from '../src/detector/sender.ts'

// Parse .env manually so we don't depend on external dotenv package
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      process.env[key] = val
    }
  }
}

console.log('=== TESTING CLOUD LLM API WITH OPENROUTER ===\n')

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error('❌ ERROR: OPENROUTER_API_KEY is not set in .env or environment!')
  process.exit(1)
}

const maskedKey = apiKey.slice(0, 8) + '...' + apiKey.slice(-4)
console.log(`🔑 Using API Key: ${maskedKey}`)
console.log(`🤖 Configured Model: ${process.env.KAVACH_CLOUD_MODEL || 'google/gemini-2.0-flash-001 (default)'}\n`)

const testMessages = [
  {
    label: 'Scam KYC Phishing Message',
    text: 'Dear Customer, your SBI account will be blocked in 2 hours. Update KYC immediately at http://sbi-kyc-verify.in/update to avoid penalty.',
    sender: '+91 98765 43210',
    expectDanger: true
  },
  {
    label: 'Legitimate Bank Transaction Alert',
    text: 'Your A/C 1234 credited with Rs 5,000.00 on 29-Aug-26. Available balance Rs 24,500.00. Do not share OTP with anyone.',
    sender: 'VM-SBIINB',
    expectDanger: false
  }
]

async function runTest() {
  for (const tc of testMessages) {
    console.log(`--- Testing: ${tc.label} ---`)
    console.log(`Input Text: "${tc.text}"`)
    console.log(`Sender: "${tc.sender}"`)

    const startTime = Date.now()
    const req = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: tc.text,
        sender: tc.sender,
        channel: 'text'
      })
    })

    try {
      const res = await handler(req)
      const latency = Date.now() - startTime
      console.log(`HTTP Status: ${res.status} (${latency}ms)`)

      const data = await res.json()
      if (res.status !== 200) {
        console.error('❌ Cloud API Error Response:', data)
        process.exit(1)
      }

      console.log('Raw Model Response Content:\n', data.content)

      const parsed = resultFromLlm(data.content, {
        input: { text: tc.text, sender: tc.sender },
        senderSignal: classifySender(tc.sender),
        engineId: 'cloud',
        latencyMs: latency
      })

      console.log('\n✅ Parsed Detection Result:')
      console.log(`- Verdict: ${parsed.verdict.toUpperCase()}`)
      console.log(`- Confidence: ${(parsed.confidence * 100).toFixed(1)}%`)
      console.log(`- Tactics Detected: ${parsed.tactics.map(t => t.name).join(', ') || 'None'}`)
      console.log(`- Explanation: ${parsed.explanation}`)
      console.log(`- Next Move: ${parsed.nextMove}`)
      console.log(`- Latency: ${parsed.latencyMs}ms\n`)

      if (tc.expectDanger && parsed.verdict !== 'danger') {
        console.warn(`⚠️ Warning: Expected danger verdict for scam message, got "${parsed.verdict}"`)
      }
      if (!tc.expectDanger && parsed.verdict === 'danger') {
        console.warn(`⚠️ Warning: Expected non-danger verdict for legit message, got "${parsed.verdict}"`)
      }
    } catch (err) {
      console.error('❌ Test threw error:', err)
      process.exit(1)
    }
  }

  console.log('==============================================')
  console.log('🎉 ALL CLOUD API TESTS PASSED SUCCESSFULLY!')
  console.log('==============================================')
}

runTest()
