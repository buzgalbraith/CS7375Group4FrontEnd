import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The local interface preview never mounts the study or initializes its response queue.
const App = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'alignment'
  ? lazy(() => import('./components/AlignmentPreview.tsx'))
  : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main>Loading…</main>}>
      <App />
    </Suspense>
  </StrictMode>,
)
