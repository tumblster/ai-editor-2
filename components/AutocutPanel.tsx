'use client'

// Panel de autorrecorte: botón dividido. A la izquierda "Autorrecorte" aplica
// directo (sin modal); a la derecha, la flecha abre el desplegable con los 3
// interruptores. El botón muestra cuántos están activos. La última elección se
// guarda en el navegador (solo preferencia, nunca el video) para el siguiente video.
// El aviso de resultado es un toast en la página; lo quitado se ve marcado en
// la línea de tiempo y en la transcripción.

import { useEffect, useId, useRef, useState } from 'react'

import type { AutocutOptions } from '@/lib/autocut'

interface Props {
  onApply: (options: AutocutOptions) => void
}

const PREF_KEY = 'pref.autocut'
const DEFAULTS: AutocutOptions = { silences: true, fillers: true, retakes: true }

const OPTIONS: { key: keyof AutocutOptions; label: string }[] = [
  { key: 'silences', label: 'Silencios' },
  { key: 'fillers', label: 'Muletillas' },
  { key: 'retakes', label: 'Repeticiones' },
]

function loadPref(): AutocutOptions {
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AutocutOptions>
    return {
      silences: v.silences !== false,
      fillers: v.fillers !== false,
      retakes: v.retakes !== false,
    }
  } catch {
    return DEFAULTS
  }
}

function savePref(opts: AutocutOptions) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(opts))
  } catch {
    /* sin almacenamiento: la elección vale solo para esta sesión */
  }
}

export default function AutocutPanel({ onApply }: Props) {
  const [opts, setOpts] = useState<AutocutOptions>(DEFAULTS)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mainId = useId()
  const menuId = useId()

  // la preferencia se lee al montar (en el servidor no hay localStorage)
  useEffect(() => {
    setOpts(loadPref())
  }, [])

  // cerrar al tocar fuera o con Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // al abrir, que el desplegable quede a la vista (bajo el player fijo en móvil)
  useEffect(() => {
    if (open) menuRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  const toggle = (key: keyof AutocutOptions) => {
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      savePref(next)
      return next
    })
  }

  const active = OPTIONS.filter((o) => opts[o.key])

  return (
    <div className="panel-body autocut" ref={rootRef}>
      <div className="split-btn">
        <button
          id={mainId}
          type="button"
          className="btn btn-secondary split-main"
          disabled={active.length === 0}
          onClick={() => {
            setOpen(false)
            onApply(opts)
          }}
        >
          Autorrecorte
          {/* cuántos de los 3 están activos, sin texto nuevo */}
          <span className="split-pips" aria-hidden>
            {OPTIONS.map((o) => (
              <i key={o.key} className={opts[o.key] ? 'is-on' : ''} />
            ))}
          </span>
          <span className="visually-hidden">{active.map((o) => o.label).join(', ')}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary split-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          aria-labelledby={mainId}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className="split-chevron">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div id={menuId} ref={menuRef} className="autocut-menu" role="group" aria-labelledby={mainId}>
          {OPTIONS.map((o) => (
            <label key={o.key} className="autocut-option">
              <span>{o.label}</span>
              <span className="switch">
                <input type="checkbox" role="switch" checked={opts[o.key]} onChange={() => toggle(o.key)} />
                <i />
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
