import fs from 'node:fs'

const envContent = fs.readFileSync('.env', 'utf-8')
let apiKey = ''
for (const line of envContent.split('\n')) {
  if (line.startsWith('OPENROUTER_API_KEY=')) {
    apiKey = line.split('=')[1].trim()
  }
}

async function listModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` }
  })
  const data = await res.json()
  const models = data.data.map(m => m.id)
  console.log('Total models:', models.length)
  
  const cheapOrFlash = models.filter(id => id.includes('gemini') || id.includes('flash') || id.includes('llama-3.2') || id.includes('qwen-2.5-7b') || id.includes('deepseek'))
  console.log('Flash/Cheap models on OpenRouter:', cheapOrFlash.slice(0, 30))
}

listModels().catch(console.error)
