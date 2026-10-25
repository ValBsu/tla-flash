import { describe, expect, it, vi } from 'vitest'
import { createEmptyBoard, type Board } from '../types'
import { createBoardSaveQueue } from './saveQueue'

describe('sauvegarde des modifications successives', () => {
  it('conserve la dernière modification et avance les révisions sans écritures concurrentes', async () => {
    let release!: (board: Board) => void
    const firstWrite = new Promise<Board>((resolve) => { release = resolve })
    const save = vi.fn().mockImplementationOnce(() => firstWrite).mockImplementation(async (board: Board) => ({ ...board, revision: (board.revision ?? 0) + 1 }))
    const queue = createBoardSaveQueue(save)
    const board = { ...createEmptyBoard(), revision: 4 }
    const first = queue.enqueue({ ...board, title: 'Un' })
    const middle = queue.enqueue({ ...board, title: 'Deux' })
    const latest = queue.enqueue({ ...board, title: 'Trois' })
    expect(save).toHaveBeenCalledTimes(1)
    release({ ...board, title: 'Un', revision: 5 })
    await Promise.all([first, middle, latest])
    await queue.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Trois', revision: 5 }))
    expect(queue.revision(board.id)).toBe(6)
  })

  it('ne contourne pas un conflit de révision et permet une reprise explicite après une erreur', async () => {
    const error = new Error('Stockage indisponible')
    const save = vi.fn().mockRejectedValueOnce(error).mockImplementation(async (board: Board) => ({ ...board, revision: 1 }))
    const queue = createBoardSaveQueue(save)
    const board = createEmptyBoard()
    await expect(queue.enqueue(board)).rejects.toThrow(error)
    await expect(queue.flush()).rejects.toThrow(error)
    await expect(queue.enqueue({ ...board, title: 'Édition conservée' })).rejects.toThrow(error)
    expect(save).toHaveBeenCalledTimes(1)
    await queue.retry({ ...board, title: 'Édition conservée' })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Édition conservée', revision: 0 }))
  })
})
