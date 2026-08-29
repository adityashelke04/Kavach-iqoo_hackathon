import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeWithRules } from '../src/detector/rules.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const corpusDir = path.resolve(__dirname, '../corpus')

const voiceFiles = ['voice-en.json', 'voice-hi.json']
let allPassed = true
let totalTranscripts = 0
let totalChunks = 0
let totalLatencyMs = 0
let maxChunkLatencyMs = 0

console.log('\nKavach Streaming Voice Simulator & Benchmark\n')

for (const file of voiceFiles) {
  const filePath = path.join(corpusDir, file)
  if (!fs.existsSync(filePath)) continue

  const entries = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  console.log(`--- Testing ${file} (${entries.length} transcripts) ---`)

  for (const entry of entries) {
    totalTranscripts++
    const words = entry.text.split(' ')
    let accumulated = ''
    let reachedDanger = false
    let dangerAtChar = -1
    let dangerAtWord = -1
    let falsePositiveAt = null

    for (let i = 0; i < words.length; i += 3) {
      totalChunks++
      const chunk = words.slice(i, i + 3).join(' ')
      accumulated = accumulated ? `${accumulated} ${chunk}` : chunk
      const windowText = accumulated.slice(-600)

      const start = performance.now()
      const res = analyzeWithRules({ text: windowText, channel: 'voice' })
      const latency = performance.now() - start

      totalLatencyMs += latency
      if (latency > maxChunkLatencyMs) maxChunkLatencyMs = latency

      if (res.verdict === 'danger') {
        if (!reachedDanger) {
          reachedDanger = true
          dangerAtChar = accumulated.length
          dangerAtWord = i + 3
        }
        if (entry.expect === 'safe') {
          falsePositiveAt = { wordIdx: i + 3, chunk: windowText, tactics: res.tactics }
          break
        }
      }
    }

    if (entry.expect === 'danger') {
      if (reachedDanger) {
        console.log(`  ✓ [SCAM] ${entry.id.padEnd(18)} early blast at word ${dangerAtWord}/${words.length} (${dangerAtChar} chars)`)
      } else {
        allPassed = false
        console.error(`  ✗ [SCAM] ${entry.id.padEnd(18)} FAILED to trigger danger (stayed non-danger)`)
      }
    } else {
      if (falsePositiveAt) {
        allPassed = false
        console.error(`  ✗ [LEGIT] ${entry.id.padEnd(18)} FALSE POSITIVE at word ${falsePositiveAt.wordIdx}: ${falsePositiveAt.chunk}`)
      } else {
        console.log(`  ✓ [LEGIT] ${entry.id.padEnd(18)} remained safe across all ${Math.ceil(words.length / 3)} streaming chunks`)
      }
    }
  }
  console.log('')
}

const avgLatency = (totalLatencyMs / totalChunks).toFixed(3)
console.log('Stream Benchmark Summary:')
console.log(`  Total Transcripts:    ${totalTranscripts}`)
console.log(`  Total Speech Chunks:  ${totalChunks}`)
console.log(`  Avg Chunk Latency:    ${avgLatency} ms`)
console.log(`  Max Chunk Latency:    ${maxChunkLatencyMs.toFixed(3)} ms`)

if (!allPassed) {
  console.error('\n❌ Streaming voice verification failed.\n')
  process.exit(1)
} else {
  console.log('\n✅ All streaming voice assertions passed with zero false positives!\n')
}
