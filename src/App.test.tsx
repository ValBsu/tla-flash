// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createEmptyBoard, type Board } from './types'

const repositories = vi.hoisted(() => ({
  boards: { list: vi.fn(), listDeleted: vi.fn(), save: vi.fn(), remove: vi.fn(), trash: vi.fn(), restoreDeleted: vi.fn(), restore: vi.fn() },
  folders: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}))
const pdfService = vi.hoisted(() => ({ export: vi.fn(), exportMany: vi.fn() }))
const tdSnapService = vi.hoisted(() => ({ createExport: vi.fn() }))
const fileSaver = vi.hoisted(() => ({ saveAs: vi.fn() }))
const imageService = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('./services/storage', () => ({ boardRepository: repositories.boards, folderRepository: repositories.folders }))
vi.mock('./services/pdf', () => ({ exportBoardPdf: pdfService.export, exportBoardsPdf: pdfService.exportMany }))
vi.mock('./services/tdSnap', () => ({ createTdSnapExport: tdSnapService.createExport }))
vi.mock('file-saver', () => ({ saveAs: fileSaver.saveAs }))
vi.mock('./services/images', () => ({ readImportedImage: imageService.read }))
import App from './App'

const scleraIndex = [{ id: 1, label: 'école' }, { id: 2, label: 'chat' }, { id: 3, label: 'chien' }]

beforeEach(() => {
  vi.resetAllMocks()
  const preferences = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, value: string) => preferences.set(key, value), removeItem: (key: string) => preferences.delete(key), clear: () => preferences.clear() })
  repositories.boards.list.mockResolvedValue([])
  repositories.boards.listDeleted.mockResolvedValue([])
  repositories.boards.save.mockImplementation(async (board: Board) => ({ ...board, revision: (board.revision ?? 0) + 1 }))
  repositories.folders.list.mockResolvedValue([])
  repositories.folders.remove.mockResolvedValue([])
  pdfService.export.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
  tdSnapService.createExport.mockImplementation(async (board: Board) => ({
    blob: new Blob(['snap'], { type: 'application/octet-stream' }), filename: `${board.title}.spb`, pageTitle: 'Arasaac',
  }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => scleraIndex }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('commandes propres à chaque TLA', () => {
  it('place l’export TD Snap juste après le premier bouton Partager', async () => {
    render(<App />)
    const exportButton = screen.getByRole('button', { name: 'Exporter vers TD Snap' })
    expect(exportButton.previousElementSibling).toBe(screen.getAllByRole('button', { name: 'Partager le PDF' })[0])
    expect(exportButton.textContent).toContain('Exporter vers TD Snap')
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  })

  it('télécharge directement le TLA en cours en .spb avec ses dernières modifications', async () => {
    const first = { ...createEmptyBoard(1, 1), title: 'Premier tableau', createdAt: '2020-01-01T00:00:00.000Z' }
    const current = { ...createEmptyBoard(1, 1), title: 'Tableau en cours', createdAt: '2021-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([first, current])
    localStorage.setItem('tla-flash-active-board', current.id)
    const blob = new Blob(['SQLite TD Snap'], { type: 'application/octet-stream' })
    tdSnapService.createExport.mockResolvedValue({ blob, filename: 'Tableau modifié.spb', pageTitle: 'Arasaac' })
    render(<App />)
    fireEvent.change(await screen.findByDisplayValue('Tableau en cours'), { target: { value: 'Tableau modifié' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exporter vers TD Snap' }))
    await waitFor(() => expect(fileSaver.saveAs).toHaveBeenCalledWith(blob, 'Tableau modifié.spb'))
    expect(tdSnapService.createExport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: current.id, title: 'Tableau modifié' }))
    expect(screen.queryByRole('dialog', { name: 'Exporter vers TD Snap' })).toBeNull()
    expect(screen.queryByLabelText('Fichier de la page personnelle TD Snap')).toBeNull()
    expect((await screen.findByText(/^Téléchargement de Tableau modifié.spb lancé/)).textContent).toContain('Chaque nouvel export utilise cette même page')
  })

  it('conserve le tableau et le nom capturés au clic et évite les exports simultanés', async () => {
    let finishExport!: (result: { blob: Blob; filename: string; pageTitle: string }) => void
    tdSnapService.createExport.mockReturnValue(new Promise<{ blob: Blob; filename: string; pageTitle: string }>((resolve) => { finishExport = resolve }))
    render(<App />)
    const exportButton = screen.getByRole('button', { name: 'Exporter vers TD Snap' })
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
    const title = screen.getByRole('textbox', { name: 'Titre du TLA 1' })
    fireEvent.change(title, { target: { value: 'Titre au clic' } })
    fireEvent.click(exportButton)
    fireEvent.click(exportButton)
    await waitFor(() => expect(tdSnapService.createExport).toHaveBeenCalledOnce())
    expect((exportButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(title, { target: { value: 'Titre pendant préparation' } })
    const blob = new Blob(['snap'])
    finishExport({ blob, filename: 'Titre au clic.spb', pageTitle: 'Arasaac' })
    await waitFor(() => expect(fileSaver.saveAs).toHaveBeenCalledWith(blob, 'Titre au clic.spb'))
    expect(tdSnapService.createExport).toHaveBeenCalledWith(expect.objectContaining({ title: 'Titre au clic' }))
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  })

  it('signale un échec d’export TD Snap et permet de réessayer', async () => {
    tdSnapService.createExport.mockRejectedValueOnce(new Error('Une image du TLA est inaccessible.'))
    render(<App />)
    const exportButton = screen.getByRole('button', { name: 'Exporter vers TD Snap' })
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(exportButton)
    expect((await screen.findByRole('alert')).textContent).toContain('Une image du TLA est inaccessible.')
    expect(fileSaver.saveAs).not.toHaveBeenCalled()
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(exportButton)
    await screen.findByText(/^Téléchargement de .* lancé. À l’import dans TD Snap, remplace la page/)
    expect(tdSnapService.createExport).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fileSaver.saveAs).toHaveBeenCalledOnce()
  })

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
    repositories.boards.trash.mockResolvedValue({ id: second.id, board: second, deletedAt: new Date().toISOString() })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    const trash = await screen.findByRole('button', { name: 'Supprimer le TLA 2 : À supprimer' })
    fireEvent.click(trash)
    expect(repositories.boards.trash).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    // Activer ce tableau avant sa suppression vérifie le retour à un tableau restant.
    fireEvent.change(screen.getByRole('textbox', { name: 'Titre du TLA 2' }), { target: { value: 'À supprimer maintenant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le TLA 2 : À supprimer maintenant' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Supprimer le TLA 2 : À supprimer maintenant' })).toBeNull())
    expect(repositories.boards.trash).toHaveBeenCalledWith(second.id, expect.any(Number))
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

describe('choix de la banque de pictogrammes', () => {
  it('sélectionne la banque Makaton fournie pour ce TLA', async () => {
    repositories.boards.list.mockResolvedValue([])
    repositories.folders.list.mockResolvedValue([])
    render(<App />)
    const bank = screen.getByRole('combobox', { name: 'Banque de pictogrammes' }) as HTMLSelectElement
    fireEvent.change(bank, { target: { value: 'makaton' } })
    await waitFor(() => expect(bank.value).toBe('makaton'))
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ pictogramBank: 'makaton' })))
  })

  it('génère une liste dans Sclera et mémorise la banque dans le TLA', async () => {
    repositories.boards.list.mockResolvedValue([])
    repositories.folders.list.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => scleraIndex }))
    render(<App />)
    const bank = screen.getByRole('combobox', { name: 'Banque de pictogrammes' }) as HTMLSelectElement
    fireEvent.change(bank, { target: { value: 'sclera' } })
    await waitFor(() => expect(bank.value).toBe('sclera'))
    fireEvent.click(screen.getByRole('button', { name: 'Générer depuis une liste' }))
    fireEvent.change(screen.getByPlaceholderText('Ajouter ici vos mots'), { target: { value: 'école, inconnu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher les pictogrammes proposés' }))
    await screen.findByText('Aucun résultat')
    fireEvent.click(screen.getByRole('button', { name: /Insérer|Générer le TLA/i }))
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ pictogramBank: 'sclera', cells: expect.arrayContaining([expect.objectContaining({ label: 'ÉCOLE', source: 'sclera' }), expect.objectContaining({ label: 'inconnu', source: null })]) })))
  })
})

describe('régressions de fiabilité dans les parcours utilisateur', () => {
  it('retrouve le dernier TLA ouvert sans écraser sa préférence avant le chargement local', async () => {
    const source = { ...createEmptyBoard(1, 1), title: 'Mon dernier tableau ouvert' }
    localStorage.setItem('tla-flash-active-board', source.id)
    let finishLoading!: (boards: Board[]) => void
    repositories.boards.list.mockReturnValue(new Promise<Board[]>((resolve) => { finishLoading = resolve }))
    render(<App />)
    expect(localStorage.getItem('tla-flash-active-board')).toBe(source.id)
    finishLoading([source])
    await waitFor(() => expect((document.querySelector('.board-page.active-board .title-input') as HTMLInputElement)?.value).toBe('Mon dernier tableau ouvert'))
    expect(localStorage.getItem('tla-flash-active-board')).toBe(source.id)
    expect(screen.getAllByRole('textbox', { name: /Titre du TLA/ })).toHaveLength(1)
    expect(repositories.boards.save).not.toHaveBeenCalled()
  })

  it('exporte seulement les TLA présents dans le filtre Favoris', async () => {
    const favorite = { ...createEmptyBoard(1, 1), title: 'Tableau favori', createdAt: '2020-01-01T00:00:00.000Z' }
    favorite.cells[0] = { ...favorite.cells[0], label: 'CHAT', favorite: true }
    const other = { ...createEmptyBoard(1, 1), title: 'Tableau hors favoris', createdAt: '2021-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([favorite, other])
    render(<App />)
    await screen.findByDisplayValue('Tableau favori')
    fireEvent.click(screen.getByRole('button', { name: 'Bibliothèque' }))
    fireEvent.click(screen.getByRole('button', { name: /Favoris/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Exporter les TLA en PDF' }))
    await waitFor(() => expect(pdfService.exportMany).toHaveBeenCalledWith([favorite], 'Favoris'))
  })

  it('préserve un brouillon lors d’un aller-retour entre TLA pendant une sauvegarde différée', async () => {
    const first = { ...createEmptyBoard(1, 1), title: 'Tableau A original', createdAt: '2020-01-01T00:00:00.000Z' }
    const second = { ...createEmptyBoard(1, 1), title: 'Tableau B', createdAt: '2021-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([first, second])
    let finishSave!: () => void
    let delayed = false
    repositories.boards.save.mockImplementation(async (next: Board) => {
      if (next.id === first.id && !delayed) {
        delayed = true
        return new Promise<Board>((resolve) => { finishSave = () => resolve({ ...next, revision: (next.revision ?? 0) + 1 }) })
      }
      return { ...next, revision: (next.revision ?? 0) + 1 }
    })
    render(<App />)
    fireEvent.change(await screen.findByDisplayValue('Tableau A original'), { target: { value: 'Tableau A modifié' } })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, title: 'Tableau A modifié' })))
    fireEvent.click(screen.getByRole('button', { name: 'Bibliothèque' }))
    fireEvent.click(screen.getByRole('button', { name: /^Tableau B/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Tableau A/ }))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Tableau A modifié')
    finishSave()
    await waitFor(() => expect(screen.getByText('Enregistré sur cet appareil')).toBeTruthy())
    const firstWrites = repositories.boards.save.mock.calls.map(([next]) => next as Board).filter((next) => next.id === first.id)
    expect(firstWrites.length).toBeGreaterThan(0)
    expect(firstWrites.every((next) => next.title === 'Tableau A modifié')).toBe(true)
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Tableau A modifié')
  })

  it('reprend les sauvegardes après une suppression échouée', async () => {
    render(<App />)
    const title = screen.getByRole('textbox', { name: 'Titre du TLA 1' })
    fireEvent.change(title, { target: { value: 'Avant suppression' } })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Avant suppression' })))
    const id = (repositories.boards.save.mock.calls.at(-1)![0] as Board).id
    repositories.boards.trash.mockRejectedValue(new Error('IndexedDB indisponible'))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le TLA 1 : Avant suppression' }))
    await screen.findByText('Impossible de supprimer « Avant suppression ». Réessaie.')
    fireEvent.change(title, { target: { value: 'Après suppression échouée' } })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenLastCalledWith(expect.objectContaining({ id, title: 'Après suppression échouée', revision: expect.any(Number) })))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Après suppression échouée')
  })

  it('préserve un titre modifié pendant la préparation asynchrone d’une photo', async () => {
    const source = { ...createEmptyBoard(1, 1), title: 'Titre avant import', createdAt: '2020-01-01T00:00:00.000Z' }
    source.cells[0].label = 'OBJET'
    repositories.boards.list.mockResolvedValue([source])
    let finishImport!: (image: { dataUrl: string; mime: string }) => void
    imageService.read.mockReturnValue(new Promise((resolve) => { finishImport = resolve }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner OBJET' }))
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!
    fireEvent.change(fileInput, { target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] } })
    await waitFor(() => expect(imageService.read).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByRole('textbox', { name: 'Titre du TLA 1' }), { target: { value: 'Titre modifié pendant import' } })
    finishImport({ dataUrl: 'data:image/png;base64,cGhvdG8=', mime: 'image/png' })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: source.id, title: 'Titre modifié pendant import',
      cells: [expect.objectContaining({ id: source.cells[0].id, source: 'upload', imageData: 'data:image/png;base64,cGhvdG8=' })],
    })))
    expect((screen.getByRole('textbox', { name: 'Titre du TLA 1' }) as HTMLInputElement).value).toBe('Titre modifié pendant import')
  })

  it('génère chat et chien une seule fois à partir d’une liste contenant un doublon', async () => {
    const source = { ...createEmptyBoard(1, 2), title: 'Deux cases', pictogramBank: 'sclera' as const, createdAt: '2020-01-01T00:00:00.000Z' }
    repositories.boards.list.mockResolvedValue([source])
    render(<App />)
    const title = await screen.findByDisplayValue('Deux cases')
    fireEvent.change(title, { target: { value: 'Deux cases éditées' } })
    fireEvent.click(screen.getByRole('button', { name: 'Générer depuis une liste' }))
    fireEvent.change(screen.getByPlaceholderText('Ajouter ici vos mots'), { target: { value: 'chat, chat, chien' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher les pictogrammes proposés' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Insérer les propositions' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Insérer les propositions' }))
    await waitFor(() => {
      const saved = repositories.boards.save.mock.calls.at(-1)![0] as Board
      expect(saved.id).toBe(source.id)
      expect(saved.cells.map((cell) => cell.label)).toEqual(['CHAT', 'CHIEN'])
      expect(saved.overflowWords).toEqual([])
      expect(saved.cells.map((cell) => cell.pictogramId)).toEqual([2, 3])
    })
  })

  it('récupère une photo et son style après réduction puis réagrandissement de la grille', async () => {
    const source = { ...createEmptyBoard(1, 2), title: 'Photo à préserver', createdAt: '2020-01-01T00:00:00.000Z' }
    source.cells[1] = { ...source.cells[1], label: 'PHOTO', source: 'upload', imageData: 'data:image/png;base64,cGhvdG8=', textSize: 'large', textColor: '#ff0000', blackAndWhite: true, bold: false }
    repositories.boards.list.mockResolvedValue([source])
    render(<App />)
    const title = await screen.findByDisplayValue('Photo à préserver')
    const page = title.closest('.board-page') as HTMLElement
    fireEvent.click(within(page).getByRole('button', { name: 'Grille 2 colonnes par 1 lignes' }))
    fireEvent.click(within(page).getByRole('gridcell', { name: '1 colonnes, 1 lignes' }))
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ id: source.id, columns: 1, overflowCells: [expect.objectContaining({ id: source.cells[1].id, imageData: source.cells[1].imageData })] })))
    fireEvent.click(within(page).getByRole('button', { name: 'Grille 1 colonnes par 1 lignes' }))
    fireEvent.click(within(page).getByRole('gridcell', { name: '2 colonnes, 1 lignes' }))
    await waitFor(() => {
      const saved = repositories.boards.save.mock.calls.at(-1)![0] as Board
      expect(saved.columns).toBe(2)
      expect(saved.cells[1]).toEqual(source.cells[1])
      expect(saved.overflowCells).toEqual([])
      expect(saved.overflowWords).toEqual([])
    })
  })

  it('affiche dans le dialogue d’aperçu la raison précise d’un échec de génération PDF', async () => {
    const message = 'Le PDF n’a pas été créé : impossible de préparer les images de « CHAT ».'
    pdfService.export.mockRejectedValue(new Error(message))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Aperçu PDF' }))
    const dialog = await screen.findByRole('dialog', { name: /Aperçu PDF/ })
    expect((await within(dialog).findByRole('alert')).textContent).toContain(message)
  })

  it('duplique un TLA avec des identifiants de cases distincts et préserve l’original', async () => {
    const source = { ...createEmptyBoard(1, 1), title: 'Tableau original', createdAt: '2020-01-01T00:00:00.000Z' }
    source.cells[0].label = 'CHAT'
    repositories.boards.list.mockResolvedValue([source])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner CHAT' }))
    fireEvent.click(screen.getAllByRole('button', { name: /Dupliquer/i })[0])
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tableau original (copie)' })))
    const copy = repositories.boards.save.mock.calls.at(-1)![0] as Board
    expect(copy.id).not.toBe(source.id)
    expect(copy.cells[0].id).not.toBe(source.cells[0].id)
    const copiedPage = screen.getByDisplayValue('Tableau original (copie)').closest('.board-page') as HTMLElement
    fireEvent.click(copiedPage.querySelector<HTMLButtonElement>('.cell-main')!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Légende du pictogramme CHAT' }), { target: { value: 'CHIEN' } })
    await waitFor(() => expect(repositories.boards.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: copy.id, cells: [expect.objectContaining({ label: 'CHIEN' })] })))
    const originalPage = screen.getByDisplayValue('Tableau original').closest('.board-page') as HTMLElement
    expect(within(originalPage).getByRole('button', { name: 'Sélectionner CHAT' })).toBeTruthy()
    expect(source.cells[0].label).toBe('CHAT')
  })
})
