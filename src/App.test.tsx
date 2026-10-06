// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createEmptyBoard } from './types'

const repositories = vi.hoisted(() => ({
  boards: { list: vi.fn(), save: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), restore: vi.fn() },
  folders: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}))
const pdfService = vi.hoisted(() => ({ export: vi.fn() }))
vi.mock('./services/storage', () => ({ boardRepository: repositories.boards, folderRepository: repositories.folders }))
vi.mock('./services/pdf', () => ({ exportBoardPdf: pdfService.export }))
import App from './App'

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('commandes propres à chaque TLA', () => {
  it('ouvre la fenêtre d’impression au clic et imprime après chargement du PDF', async () => {
    repositories.boards.list.mockResolvedValue([])
    repositories.folders.list.mockResolvedValue([])
    pdfService.export.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    const listeners = new Map<string, EventListener>()
    const printWindow = {
      document: { title: '' },
      location: { href: 'about:blank' },
      addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(printWindow as unknown as Window)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:tla-pdf'), revokeObjectURL: vi.fn() })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Imprimer' }))
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
    await waitFor(() => expect(printWindow.location.href).toBe('blob:tla-pdf'))
    expect(printWindow.document.title).toBe('Imprimer Mon nouveau TLA')
    listeners.get('load')?.(new Event('load'))
    expect(printWindow.focus).toHaveBeenCalledOnce()
    expect(printWindow.print).toHaveBeenCalledOnce()
  })

  it('supprime le tableau ciblé depuis sa poubelle et conserve les autres', async () => {
    const first = { ...createEmptyBoard(), title: 'À conserver', createdAt: '2020-01-01T00:00:00.000Z' }
    const second = { ...createEmptyBoard(), title: 'À supprimer', createdAt: '2021-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([first, second])
    repositories.folders.list.mockResolvedValue([])
    repositories.boards.remove.mockResolvedValue(undefined)
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    const trash = await screen.findByRole('button', { name: 'Supprimer le TLA 2 : À supprimer' })
    fireEvent.click(trash)
    expect(repositories.boards.remove).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    // Activer ce tableau avant sa suppression vérifie le retour à un tableau restant.
    fireEvent.change(screen.getByRole('textbox', { name: 'Titre du TLA 2' }), { target: { value: 'À supprimer maintenant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le TLA 2 : À supprimer maintenant' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Supprimer le TLA 2 : À supprimer maintenant' })).toBeNull())
    expect(repositories.boards.remove).toHaveBeenCalledWith(second.id)
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('À conserver')
    expect(screen.getAllByRole('textbox', { name: /Titre du TLA/ })).toHaveLength(1)
  })

  it('modifie le titre, le dossier et la grille du TLA ajouté sans changer le précédent', async () => {
    const first = { ...createEmptyBoard(), title: 'Premier tableau', createdAt: '2020-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([first])
    repositories.folders.list.mockResolvedValue([{ id: 'repas', name: 'Repas' }])
    render(<App />)
    await screen.findByRole('textbox', { name: 'Titre du TLA 2' })
    // Le tableau vierge initial est le deuxième. En créer un autre répète les commandes.
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau TLA vierge' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Titre du TLA 2' }), { target: { value: 'Nouveau tableau' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Dossier du TLA 2' }), { target: { value: 'repas' } })
    const firstGrid = screen.getAllByRole('button', { name: 'Grille 5 colonnes par 4 lignes' })[0]
    const secondPage = screen.getByRole('textbox', { name: 'Titre du TLA 2' }).closest('.board-page')
    if (!secondPage) throw new Error('Deuxième page introuvable')
    const secondPageElement = secondPage as HTMLElement
    fireEvent.click(within(secondPageElement).getByRole('button', { name: 'Grille 5 colonnes par 4 lignes' }))
    fireEvent.click(within(secondPageElement).getByRole('gridcell', { name: '4 colonnes, 3 lignes' }))
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nouveau tableau', folderId: 'repas', columns: 4, rows: 3, cells: expect.any(Array) })))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Premier tableau')
    expect((screen.getByRole('combobox', { name: 'Dossier du TLA 1' }) as HTMLSelectElement).value).toBe('')
    expect(firstGrid.getAttribute('aria-label')).toBe('Grille 5 colonnes par 4 lignes')
    // Modifier le premier tableau alors que le deuxième est actif cible le premier.
    fireEvent.change(screen.getByRole('textbox', { name: 'Titre du TLA 1' }), { target: { value: 'Premier renommé' } })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, title: 'Premier renommé' })))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 2' }) as HTMLInputElement).value).toBe('Nouveau tableau')
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Premier tableau')
  })
})
