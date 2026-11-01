import { readFile, writeFile } from 'fs/promises'
import { NextResponse } from 'next/server'

import { UPLOADS_DIR, fileExists } from '@/lib/uploads'
import type { ProjectState } from '@/types/project'

export const runtime = 'nodejs'

const PROJECT_PATH = `${UPLOADS_DIR}/project.json`

export async function GET() {
  try {
    if (!(await fileExists(PROJECT_PATH))) {
      return NextResponse.json({ project: null })
    }
    const raw = await readFile(PROJECT_PATH, 'utf-8')
    return NextResponse.json({ project: JSON.parse(raw) as ProjectState })
  } catch (err) {
    console.error('[project GET] error:', err)
    return NextResponse.json({ project: null })
  }
}

export async function PUT(req: Request) {
  try {
    const project = (await req.json()) as ProjectState
    if (!project || project.version !== 1 || !Array.isArray(project.videos)) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    await writeFile(PROJECT_PATH, JSON.stringify(project), 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[project PUT] error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
