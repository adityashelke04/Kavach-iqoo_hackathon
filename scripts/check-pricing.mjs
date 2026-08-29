import fs from 'node:fs'

const envContent = fs.readFileSync('.env', 'utf-8')
let apiKey = ''
for (const line of envContent.split('\n')) {
  if (line.startsWith('OPENROUTER_API_KEY=')) {
    apiKey = line.split('=')[1].trim()
  }
}

async function listGeminiAndLlama() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` }
  })
  const data = await res.json()
  const relevant = data.data
    .filter(m => m.id.includes('gemini') || m.id.includes('llama-3.2') || m.id.includes('qwen-2.5'))
    .map(m => ({ id: m.id, name: m.name, pricing: m.pricing }))
  console.log('Models found:', JSON.stringify(relevant, null, 2))
}

listGeminiAndLlama().catch(console.error)
