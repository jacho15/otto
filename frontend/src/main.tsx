import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles.css'

// Each page loads when its route is first visited, so the 3D code stays out of the first download.
const Home = lazy(() => import('./pages/Home'))
const Liked = lazy(() => import('./pages/Liked'))
const RoomPage = lazy(() => import('./pages/RoomPage'))
const ScanStory = lazy(() => import('./pages/ScanStory'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="center-note muted">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/liked" element={<Liked />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
          <Route path="/rooms/:id/how-it-was-made" element={<ScanStory />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
