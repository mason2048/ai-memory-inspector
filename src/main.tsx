import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ProductionShell } from './components/ProductionShell'
import './components/production-shell.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductionShell>
      <App />
    </ProductionShell>
  </StrictMode>,
)
