// Deshacer / Rehacer sobre el documento editable (frases, imágenes, estilo).

import type { EditDoc } from '@/types/project'

export interface HistoryState {
  past: EditDoc[]
  present: EditDoc
  future: EditDoc[]
}

export type HistoryAction =
  | { type: 'edit'; doc: EditDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; doc: EditDoc }

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'edit':
      if (action.doc === state.present) return state
      return { past: [...state.past, state.present].slice(-100), present: action.doc, future: [] }
    case 'undo': {
      const prev = state.past[state.past.length - 1]
      if (!prev) return state
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future].slice(0, 100),
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) }
    }
    case 'reset':
      return { past: [], present: action.doc, future: [] }
  }
}
