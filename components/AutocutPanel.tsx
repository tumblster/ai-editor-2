'use client'

// Panel de autorrecorte: checks + botón Autorrecorte (sin modal).
// El aviso de resultado es un toast en la página; el detalle de lo quitado se ve
// marcado en la línea de tiempo y en la transcripción.

import { useState } from 'react'

import type { AutocutOptions } from '@/lib/autocut'

interface Props {
  onApply: (options: AutocutOptions) => void
}

export default function AutocutPanel({ onApply }: Props) {
  const [silences, setSilences] = useState(true)
  const [fillers, setFillers] = useState(true)
  const [retakes, setRetakes] = useState(true)

  const check = (
    label: string,
    value: boolean,
    onChange: (v: boolean) => void
  ): React.ReactNode => (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )

  return (
    <div className="panel-body">
      {check('Quitar silencios', silences, setSilences)}
      {check('Quitar muletillas', fillers, setFillers)}
      {check('Quitar repeticiones', retakes, setRetakes)}
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => onApply({ silences, fillers, retakes })}
      >
        Autorrecorte
      </button>
    </div>
  )
}
