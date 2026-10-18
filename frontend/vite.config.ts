import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the big libraries in their own files so app code stays small and they cache between releases.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Only needed when someone uploads an .obj, .stl or .ply file: left to load on demand.
          if (/three[\/]examples[\/]jsm[\/](loaders[\/](OBJ|STL)Loader|exporters[\/]GLTFExporter)/.test(id)) return undefined
          if (/node_modules[\/](three|@react-three)[\/]/.test(id)) return 'three'
          if (/node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
    },
  },
})
