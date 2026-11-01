'use client'

// Motor de reproducción de la línea de tiempo: un solo requestAnimationFrame,
// salto directo entre segmentos mantenidos (preview sin re-codificar) y
// suscripción para que cabezal, tiempo y transcripción se muevan a 60 fps.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CutSegment } from '@/types/project'
import { totalDuration } from './timeline'

export interface Playback {
  playing: boolean
  duration: number
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  getTime: () => number
  subscribe: (cb: (t: number) => void) => () => void
  registerVideo: (index: number, el: HTMLVideoElement | null) => void
  activeVideoElement: () => HTMLVideoElement | null
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

export function usePlayback(segments: CutSegment[]): Playback {
  const [playing, setPlaying] = useState(false)
  const duration = useMemo(() => totalDuration(segments), [segments])

  const segsRef = useRef(segments)
  segsRef.current = segments
  const tRef = useRef(0)
  const activeRef = useRef(0)
  const playingRef = useRef(false)
  const videoEls = useRef<(HTMLVideoElement | null)[]>([])
  const subsRef = useRef(new Set<(t: number) => void>())

  const notify = useCallback(() => {
    for (const cb of subsRef.current) cb(tRef.current)
  }, [])

  const setVisibility = useCallback((showIndex: number) => {
    videoEls.current.forEach((el, i) => {
      if (el) el.style.opacity = i === showIndex ? '1' : '0'
    })
  }, [])

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    videoEls.current.forEach((el) => el?.pause())
  }, [])

  // Recorta el tiempo si los cortes cambiaron y quedó fuera de rango
  useEffect(() => {
    if (tRef.current > duration) {
      tRef.current = duration
      notify()
    }
  }, [duration, notify])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!playingRef.current) return
      const segs = segsRef.current
      if (!segs.length) return
      let seg = segs[Math.min(activeRef.current, segs.length - 1)]
      let el = videoEls.current[seg.videoIndex]
      if (!el) return

      if (el.ended || el.currentTime >= seg.srcEnd - 0.02) {
        const nextIdx = activeRef.current + 1
        if (nextIdx >= segs.length) {
          tRef.current = seg.tlEnd
          notify()
          pause()
          return
        }
        const next = segs[nextIdx]
        if (next.videoIndex !== seg.videoIndex) el.pause()
        activeRef.current = nextIdx
        seg = next
        el = videoEls.current[seg.videoIndex]
        if (!el) return
        setVisibility(seg.videoIndex)
        el.currentTime = seg.srcStart
        tRef.current = seg.tlStart
        el.play().catch(() => {})
      } else {
        tRef.current = Math.min(seg.tlStart + (el.currentTime - seg.srcStart), seg.tlEnd)
      }
      notify()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [notify, pause, setVisibility])

  const seek = useCallback(
    (t: number) => {
      const segs = segsRef.current
      tRef.current = clamp(t, 0, totalDuration(segs))
      if (!segs.length) {
        notify()
        return
      }
      let idx = segs.findIndex((s) => tRef.current < s.tlEnd)
      if (idx === -1) idx = segs.length - 1
      const seg = segs[idx]
      activeRef.current = idx
      setVisibility(seg.videoIndex)
      const el = videoEls.current[seg.videoIndex]
      if (el) {
        const target = seg.srcStart + (tRef.current - seg.tlStart)
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target
        if (playingRef.current) el.play().catch(() => {})
      }
      notify()
    },
    [notify, setVisibility]
  )

  const play = useCallback(() => {
    const segs = segsRef.current
    if (!segs.length) return
    if (tRef.current >= totalDuration(segs) - 0.05) seek(0)
    let idx = segs.findIndex((s) => tRef.current < s.tlEnd)
    if (idx === -1) idx = segs.length - 1
    const seg = segs[idx]
    activeRef.current = idx
    setVisibility(seg.videoIndex)
    const el = videoEls.current[seg.videoIndex]
    if (!el) return
    const target = seg.srcStart + (tRef.current - seg.tlStart)
    if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target
    el
      .play()
      .then(() => {
        playingRef.current = true
        setPlaying(true)
      })
      .catch(() => {})
  }, [seek, setVisibility])

  const toggle = useCallback(() => {
    if (playingRef.current) pause()
    else play()
  }, [pause, play])

  const subscribe = useCallback(
    (cb: (t: number) => void) => {
      subsRef.current.add(cb)
      cb(tRef.current)
      return () => {
        subsRef.current.delete(cb)
      }
    },
    []
  )

  const registerVideo = useCallback((index: number, el: HTMLVideoElement | null) => {
    videoEls.current[index] = el
  }, [])

  const activeVideoElement = useCallback(() => {
    const segs = segsRef.current
    if (!segs.length) return videoEls.current[0] ?? null
    const seg = segs[Math.min(activeRef.current, segs.length - 1)]
    return videoEls.current[seg.videoIndex] ?? null
  }, [])

  return {
    playing,
    duration,
    play,
    pause,
    toggle,
    seek,
    getTime: () => tRef.current,
    subscribe,
    registerVideo,
    activeVideoElement,
  }
}
