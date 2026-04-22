import { Header } from "./components/Header"
import { Footer } from "./components/Footer"
import { Hero } from "./components/Hero"
import { Features } from "./components/Features"
import { Download } from "./components/Download"

export function App() {
  return (
    <div id="top" className="relative min-h-dvh overflow-x-hidden">
      <a
        href="#main"
        className="
          sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
          focus:rounded-md focus:border focus:border-live focus:bg-ink-0 focus:px-3 focus:py-2
          focus:font-mono focus:text-[11px] focus:uppercase focus:tracking-[0.18em] focus:text-paper-0
        "
      >
        Skip to content
      </a>

      <Header />

      <main id="main">
        <Hero />

        <Features />

        <Download />
      </main>

      <Footer />
    </div>
  )
}
