import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, execSync } from 'child_process'

// Auto-start the proxy server alongside Vite — no second terminal needed
function proxyPlugin() {
  let proxyProcess = null
  return {
    name: 'auto-proxy',
    configureServer() {
      if (proxyProcess) return

      // Kill any existing process on port 3001
      try { execSync('lsof -ti:3001 | xargs kill -9', { stdio: 'ignore' }) } catch (_) {}

      console.log('[vite] Starting API proxy on port 3001...')
      proxyProcess = spawn('node', ['proxy.mjs'], { stdio: 'inherit' })
      proxyProcess.on('error', (e) => console.error('[proxy] Failed to start:', e.message))
      process.on('exit', () => { try { proxyProcess.kill() } catch(_) {} })
      process.on('SIGINT', () => { try { proxyProcess.kill() } catch(_) {} process.exit() })
    }
  }
}

export default defineConfig({
  plugins: [react(), proxyPlugin()],
  server: { port: 3000, open: true },
})
