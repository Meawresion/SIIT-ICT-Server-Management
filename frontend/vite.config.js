import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // One env file for the whole stack (the root .env). Only VITE_* keys reach the bundle.
  envDir: '..',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
