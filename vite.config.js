import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/zero7barber/',
  build: {
    rollupOptions: {
      external: [],
    }
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/database']
  }
})