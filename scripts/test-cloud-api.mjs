import fs from 'node:fs'
import handler from '../api/analyze.ts'
import { resultFromLlm } from '../src/detector/llm.ts'
import { classifySender } from '../src/detector/sender.ts'

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

console.log('=== TESTING CLOUD LLM API WITH NODE SERVERLESS HANDLER ===\n')

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error('❌ ERROR: OPENROUTER_API_KEY is not set!')
  process.exit(1)
}

const testMessages = [
  {
    label: 'Scam KYC Phishing Message',
    text: 'Dear Customer, your SBI account will be blocked in 2 hours. Update KYC immediately at http://sbi-kyc-verify.in/update to avoid penalty.',
    sender: '+91 98765 43210',
    expectDanger: true
  }
]

async function runTest() {
  for (const tc of testMessages) {
    console.log(`--- Testing: ${tc.label} ---`)
    const startTime = Date.now()
    let responseStatus = 200
    let responseBody = null

    const req = {
      method: 'POST',
      body: {
        text: tc.text,
        sender: tc.sender,
        channel: 'text'
      }
    }

    const res = {
      status(code) {
        responseStatus = code
        return this
      },
      json(data) {
        responseBody = data
      },
      setHeader() {
        return this
      }
    }

    await handler(req, res)
    const latency = Date.now() - startTime
    console.log(`Response Status: ${responseStatus} (${latency}ms)`)
    console.log('Response Content:\n', responseBody)

    if (responseStatus !== 200) {
      console.error('❌ Failed with non-200 status')
      process.exit(1)
    }

    const parsed = resultFromLlm(responseBody.content, {
      input: { text: tc.text, sender: tc.sender },
      senderSignal: classifySender(tc.sender),
      engineId: 'cloud',
      latencyMs: latency
    })

    console.log('✅ Parsed Verdict:', parsed.verdict)
  }
}

runTest().catch(console.error)
