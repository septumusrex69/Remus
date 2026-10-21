import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app, so they get their own long-cached chunks.
        // Pages are already split per route (src/pages/build/routes.tsx).
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/](react-router|react-router-dom)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'date-fns', test: /node_modules[\\/]date-fns[\\/]/ },
          ],
        },
      },
    },
  },
})
