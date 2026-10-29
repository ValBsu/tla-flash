import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArrowDownToLine, Bold, Check, ChevronDown, Contrast, FilePlus2, Folder, ImagePlus, Languages, LayoutGrid, Menu, Pencil, Plus, Redo2, Search, Share2, Sparkles, Trash2, Undo2, Upload, X,
} from 'lucide-react'
import { createEmptyBoard, type Board, type Cell, type FitzgeraldCategory, type Folder as TlaFolder, type PictogramResult, type PictogramBank } from './types'
import { moveOrSwapCells, normalizeWords, placeWords, resizeBoard, restoreOverflowCell } from './domain/layout'
import { bankName, searchBank, changeBoardBank, pictogramCredit } from './services/pictograms'
import { boardRepository, folderRepository } from './services/storage'
import { createBoardSaveQueue } from './services/saveQueue'
import { isAbortError, mapConcurrent } from './services/network'
import { Modal } from './components/Modal'
import { DeferredBoard } from './components/DeferredBoard'
import './App.css'

type BatchProposal = { word: string; result?: PictogramResult; choices?: PictogramResult[]; state: 'waiting' | 'loading' | 'ready' | 'empty' | 'error' }
type LibraryFilter = 'recent' | 'drafts' | 'favorites' | `folder:${string}`
type TranslationDraft = { title: string; cells: { id: string; original: string; translated: string }[]; overflowWords: string[] }

function App() {
  const [board, setBoardState] = useState<Board>(() => createEmptyBoard())
  const activeBank = board.pictogramBank ?? 'arasaac'
  const [switchingBank, setSwitchingBank] = useState(false)
  const [history, setHistory] = useState<Board[]>([])
  const [future, setFuture] = useState<Board[]>([])
  const [boards, setBoardsState] = useState<Board[]>([])
  const boardsRef = useRef<Board[]>([])
  const setBoards = useCallback((value: Board[] | ((current: Board[]) => Board[])) => {
    const next = typeof value === 'function' ? value(boardsRef.current) : value
    boardsRef.current = next
    setBoardsState(next)
  }, [])
  const [folders, setFolders] = useState<TlaFolder[]>([])
  const editableBoardIds = useRef(new Set<string>())
  const deletedBoardIds = useRef(new Set<string>())
  const boardRef = useRef(board)
  const setBoard = useCallback((value: Board | ((current: Board) => Board)) => {
    const next = typeof value === 'function' ? value(boardRef.current) : value
    boardRef.current = next
    setBoardState(next)
  }, [])
  const saveQueue = useMemo(() => createBoardSaveQueue((next) => boardRepository.save(next)), [])
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('recent')
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([])
  const [sidebarTab, setSidebarTab] = useState<'pictograms' | 'library' | 'edit'>('pictograms')
  const [panel, setPanel] = useState<'none' | 'search' | 'list' | 'preview' | 'translation'>('none')
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<PictogramResult[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [advanceAfterInsert, setAdvanceAfterInsert] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saving')
  const [mobileNav, setMobileNav] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [listText, setListText] = useState('')
  const [batchProposals, setBatchProposals] = useState<BatchProposal[]>([])
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [translationSource, setTranslationSource] = useState<Board | null>(null)
  const [translationDraft, setTranslationDraft] = useState<TranslationDraft | null>(null)
  const [translationState, setTranslationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [translationError, setTranslationError] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [deletedBoards, setDeletedBoards] = useState<{ id: string; board: Board; deletedAt: string }[]>([])
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null)
  const [insertMode, setInsertMode] = useState<'replace' | 'empty'>('replace')
  const [previewUrl, setPreviewUrl] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [storageInfo, setStorageInfo] = useState<{ used: number; quota: number; persistent: boolean } | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const libraryBusyRef = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const searchAbort = useRef<AbortController | null>(null)
  const batchAbort = useRef<AbortController | null>(null)
  const translationAbort = useRef<AbortController | null>(null)
  const bankAbort = useRef<AbortController | null>(null)
  const imageAbort = useRef<AbortController | null>(null)
  const lastQueued = useRef(new Map<string, Board>())
  const localDrafts = useRef(new Map<string, Board>())
  const editVersions = useRef(new Map<string, number>())
  const previewCache = useRef<{ board: Board; blob: Blob } | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([boardRepository.list(), folderRepository.list(), boardRepository.listDeleted()]).then(([savedBoards, savedFolders, removed]) => {
      if (cancelled) return
      saveQueue.register(savedBoards)
      setBoards([...new Map([...savedBoards, ...localDrafts.current.values()].map((item) => [item.id, item])).values()])
      setFolders(savedFolders)
      setDeletedBoards(removed)
      try {
        const lastId = localStorage.getItem('tla-flash-active-board')
        const previous = savedBoards.find((item) => item.id === lastId)
        if (previous && !editableBoardIds.current.has(boardRef.current.id)) setBoard(previous)
      } catch { /* Preferences are optional when browser storage is restricted. */ }
      setSaveState('saved')
      setInitialized(true)
    }).catch((cause: unknown) => { if (!cancelled) { setSaveState('error'); setError(cause instanceof Error ? cause.message : 'Le stockage local est indisponible. Réessayez ou conservez votre travail dans une sauvegarde ZIP.'); setInitialized(true) } })
    return () => { cancelled = true }
  }, [saveQueue, setBoard, setBoards])

  const persistBoard = useCallback((current: Board, retry = false) => {
    setSaveState('saving')
    localDrafts.current.set(current.id, current)
    setBoards((items) => [...items.filter((item) => item.id !== current.id), current])
    const next = { ...current, status: 'draft' as const, updatedAt: new Date().toISOString() }
    const task = retry ? saveQueue.retry(next) : saveQueue.enqueue(next)
    void task.then((saved) => {
      if (deletedBoardIds.current.has(saved.id)) return
      if (localDrafts.current.get(saved.id) === current) {
        localDrafts.current.delete(saved.id)
        setBoards((items) => [...items.filter((item) => item.id !== saved.id), saved].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        if (boardRef.current === current) {
          const acknowledged = { ...current, revision: saved.revision, folderId: saved.folderId, updatedAt: saved.updatedAt }
          lastQueued.current.set(saved.id, acknowledged)
          setBoard(acknowledged)
        }
      }
      void saveQueue.flush(saved.id).then(() => {
        if (boardRef.current.id === saved.id && lastQueued.current.get(saved.id) === boardRef.current) setSaveState('saved')
      }).catch(() => {})
    }).catch((cause: unknown) => {
      setSaveState('error')
      setError(cause instanceof Error ? cause.message : 'La sauvegarde a échoué. Votre travail reste à l’écran ; réessayez ou téléchargez une sauvegarde ZIP.')
    })
  }, [saveQueue, setBoards, setBoard])

  useEffect(() => {
    if (!initialized) return
    try { localStorage.setItem('tla-flash-active-board', board.id) } catch { /* Optional preference. */ }
    if (!initialized || !editableBoardIds.current.has(board.id) || deletedBoardIds.current.has(board.id) || lastQueued.current.get(board.id) === board) return
    lastQueued.current.set(board.id, board)
    persistBoard(board)
  }, [board, initialized, persistBoard])

  useEffect(() => {
    const saveCurrentDraft = () => {
      // All edits are queued immediately. Never rewrite an old snapshot merely
      // because an inactive tab is closing.
      void saveQueue.flush().catch(() => {})
    }
    window.addEventListener('pagehide', saveCurrentDraft)
    window.addEventListener('beforeunload', saveCurrentDraft)
    return () => {
      window.removeEventListener('pagehide', saveCurrentDraft)
      window.removeEventListener('beforeunload', saveCurrentDraft)
    }
  }, [saveQueue])

  useEffect(() => {
    return () => { searchAbort.current?.abort(); batchAbort.current?.abort(); translationAbort.current?.abort(); bankAbort.current?.abort(); imageAbort.current?.abort() }
  }, [])

  useEffect(() => {
    return () => {
      if (panel === 'search') searchAbort.current?.abort()
      if (panel === 'list') batchAbort.current?.abort()
      if (panel === 'translation') translationAbort.current?.abort()
    }
  }, [panel])

  useEffect(() => {
    if (panel !== 'preview') return
    let cancelled = false
    let url = ''
    void import('./services/pdf').then(async ({ exportBoardPdf }) => {
      if (cancelled) return
      setPdfBusy(true)
      setPreviewError('')
      setPreviewUrl('')
      const blob = previewCache.current?.board === board ? previewCache.current.blob : await exportBoardPdf(sheetRef.current ?? document.createElement('div'), board, false)
      if (cancelled) return
      previewCache.current = { board, blob }
      url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    }).catch((cause: unknown) => { if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : 'L’aperçu PDF est indisponible.') }).finally(() => { if (!cancelled) setPdfBusy(false) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [panel, board])

  const updateBoard = (next: Board) => {
    if (libraryBusyRef.current) return
    if (deletedBoardIds.current.has(next.id)) return
    editVersions.current.set(next.id, (editVersions.current.get(next.id) ?? 0) + 1)
    editableBoardIds.current.add(next.id)
    setHistory((current) => [...current.slice(-30), boardRef.current])
    setFuture([])
    setBoard({ ...next, status: 'draft' })
  }

  const switchBank = async (bank: PictogramBank) => {
    if (bank === activeBank || switchingBank) return
    const current = board
    const version = editVersions.current.get(current.id) ?? 0
    setSwitchingBank(true)
    setError('')
    bankAbort.current?.abort()
    const controller = new AbortController()
    bankAbort.current = controller
    searchAbort.current?.abort()
    setResults([])
    setBatchProposals([])
    setBatchState('idle')
    setPanel('none')
    try {
      const next = await changeBoardBank(current, bank, controller.signal)
      if (controller.signal.aborted) return
      if (boardRef.current.id !== current.id || (editVersions.current.get(current.id) ?? 0) !== version) {
        setError('Le TLA a changé pendant la recherche. Réessayez le changement de banque.')
        return
      }
      updateBoard(next)
      setSuccess(`Banque ${bankName(bank)} sélectionnée pour ce TLA.`)
    } catch (cause) {
      if (!isAbortError(cause)) setError(`Banque ${bankName(bank)} indisponible. Le TLA a été conservé. Réessayez.`)
    } finally { setSwitchingBank(false) }
  }

  const updateCell = (cellId: string, patch: Partial<Cell>) => {
    const current = boardRef.current
    updateBoard({ ...current, cells: current.cells.map((cell) => cell.id === cellId ? { ...cell, ...patch } : cell) })
  }
  const selectedCells = board.cells.filter((cell) => selectedCellIds.includes(cell.id))
  const selectedTextSize = selectedCells[0]?.textSize ?? 'normal'
  const selectedTextCase = selectedCells[0]?.textCase ?? 'uppercase'
  const selectedBold = selectedCells.every((cell) => cell.bold !== false)
  const updateSelectedCells = (patch: Partial<Cell>) => {
    if (!selectedCellIds.length) return
    updateBoard({ ...board, cells: board.cells.map((cell) => selectedCellIds.includes(cell.id) ? { ...cell, ...patch } : cell) })
  }
  const libraryBoards = boards
  const allPageBoards = useMemo(() => boards.filter((item) => item.id !== board.id).concat(board).sort((left, right) => left.createdAt.localeCompare(right.createdAt)), [boards, board])
  const selectedFolderId = libraryFilter.startsWith('folder:') ? libraryFilter.slice('folder:'.length) : null
  const visibleBoards = libraryBoards
    .filter((item) => libraryFilter === 'recent' || (libraryFilter === 'drafts' && item.status === 'draft') || (libraryFilter === 'favorites' && item.cells.some((cell) => cell.favorite)) || (selectedFolderId !== null && item.folderId === selectedFolderId))
    .filter((item) => `${item.title} ${item.cells.map((cell) => cell.label).join(' ')}`.toLocaleLowerCase('fr-FR').includes(librarySearch.trim().toLocaleLowerCase('fr-FR')))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const visibleIds = new Set(visibleBoards.map((item) => item.id))
  const pageBoards = allPageBoards.filter((item) => item.id === board.id || ((libraryFilter === 'recent' && !librarySearch.trim()) || visibleIds.has(item.id)))
  const libraryLabel = selectedFolderId ? folders.find((folder) => folder.id === selectedFolderId)?.name ?? 'Dossiers' : libraryFilter === 'recent' ? 'Tous les TLA' : libraryFilter === 'drafts' ? 'Brouillons' : 'Favoris'
  const openSavedBoard = (savedBoard: Board) => {
    imageAbort.current?.abort()
    bankAbort.current?.abort()
    const snapshot = localDrafts.current.get(savedBoard.id) ?? savedBoard
    if (!localDrafts.current.has(snapshot.id)) lastQueued.current.set(snapshot.id, snapshot)
    setBoard(snapshot)
    setHistory([])
    setFuture([])
    setSelectedCellId(null)
    setSelectedCellIds([])
    setSidebarTab('library')
    setBatchProposals([])
    setBatchState('idle')
    setPanel('none')
    setMobileNav(false)
  }

  const selectPageCell = (page: Board, cellId: string) => {
    if (page.id !== board.id) {
      const snapshot = localDrafts.current.get(page.id) ?? page
      if (!localDrafts.current.has(snapshot.id)) lastQueued.current.set(snapshot.id, snapshot)
      setBoard(snapshot)
      setHistory([])
      setFuture([])
      setSelectedCellIds([cellId])
    } else {
      setSelectedCellIds((current) => current.includes(cellId) ? current.filter((id) => id !== cellId) : [...current, cellId])
    }
    setSelectedCellId(cellId)
    setSidebarTab('edit')
    setMobileNav(false)
  }

  const openSearch = (cellId: string) => {
    setSelectedCellId(cellId)
    setSelectedCellIds([cellId])
    setSidebarTab('edit')
    setSearchTerm(board.cells.find((cell) => cell.id === cellId)?.label ?? '')
    setResults([])
    setSearchState('idle')
    setPanel('search')
    setError('')
  }

  const openPageSearch = (page: Board, cellId: string) => {
    if (page.id !== board.id) {
      const snapshot = localDrafts.current.get(page.id) ?? page
      if (!localDrafts.current.has(snapshot.id)) lastQueued.current.set(snapshot.id, snapshot)
      setBoard(snapshot)
      setHistory([])
      setFuture([])
    }
    setSelectedCellId(cellId)
    setSelectedCellIds([cellId])
    setSidebarTab('edit')
    setSearchTerm(page.cells.find((cell) => cell.id === cellId)?.label ?? '')
    setResults([])
    setSearchState('idle')
    setPanel('search')
    setError('')
  }

  const updatePageBoard = (page: Board, next: Board) => {
    if (libraryBusyRef.current) return
    if (page.id === board.id) updateBoard(next)
    else {
      editableBoardIds.current.add(page.id)
      editVersions.current.set(page.id, (editVersions.current.get(page.id) ?? 0) + 1)
      setBoard({ ...next, status: 'draft' })
      setHistory([page])
      setFuture([])
      setSelectedCellId(null)
      setSelectedCellIds([])
    }
  }

  const updatePageCell = (page: Board, cellId: string, patch: Partial<Cell>) => {
    updatePageBoard(page, { ...page, cells: page.cells.map((cell) => cell.id === cellId ? { ...cell, ...patch } : cell) })
  }

  const runSearch = async (term = searchTerm) => {
    if (!term.trim()) return
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setSearchState('loading'); setError('')
    try { const found = await searchBank(term, activeBank, controller.signal); if (!controller.signal.aborted) { setResults(found); setSearchState('idle') } } catch (cause) {
      if ((cause as Error).name !== 'AbortError') { setSearchState('error'); setError(navigator.onLine ? `La banque ${bankName(activeBank)} ne répond pas pour le moment.` : 'Recherche indisponible hors connexion. Les tableaux locaux restent accessibles.') }
    }
  }

  const choosePictogram = (result: PictogramResult) => {
    if (!selectedCellId) return
    const lower = `${result.label} ${searchTerm}`.toLocaleLowerCase('fr-FR')
    const category: FitzgeraldCategory = /\b(manger|boire|faire|aller|prendre)\b/.test(lower) ? 'verbs' : /\b(je|tu|il|elle|nous|vous)\b/.test(lower) ? 'people' : 'nouns'
    updateCell(selectedCellId, { source: activeBank, pictogramId: result.id, imageData: result.imageUrl, label: (searchTerm || result.label).toLocaleUpperCase('fr-FR'), searchTerm, category })
    if (advanceAfterInsert) {
      const nextEmpty = boardRef.current.cells.find((cell) => !cell.label.trim() && !cell.imageData)
      if (nextEmpty) {
        setSelectedCellId(nextEmpty.id); setSelectedCellIds([nextEmpty.id]); setSearchTerm(''); setResults([]); setSearchState('idle')
        return
      }
    }
    setPanel('none')
  }

  const createBoard = () => {
    if (libraryBusyRef.current) return
    const next = { ...createEmptyBoard(board.rows, board.columns), pictogramBank: activeBank }
    imageAbort.current?.abort()
    bankAbort.current?.abort()
    editableBoardIds.current.add(next.id)
    setBoard(next)
    setHistory([])
    setFuture([])
    setSelectedCellId(null)
    setSelectedCellIds([])
    setSidebarTab('library')
    setLibraryFilter('recent')
    setBatchProposals([])
    setBatchState('idle')
    setPanel('none')
  }
  const removeBoard = async (savedBoard: Board) => {
    if (libraryBusyRef.current) return
    if (!window.confirm(`Déplacer « ${savedBoard.title} » dans la corbeille ? Vous pourrez le restaurer depuis la bibliothèque.`)) return
    if (deletingBoardId) return
    setDeletingBoardId(savedBoard.id)
    const wasEditable = editableBoardIds.current.has(savedBoard.id)
    deletedBoardIds.current.add(savedBoard.id)
    editableBoardIds.current.delete(savedBoard.id)
    try {
      await saveQueue.flush(savedBoard.id)
      const removed = await boardRepository.trash(savedBoard.id, saveQueue.revision(savedBoard.id) ?? savedBoard.revision)
      localDrafts.current.delete(savedBoard.id)
      setDeletedBoards((current) => [removed, ...current.filter((item) => item.id !== savedBoard.id)])
      setBoards((current) => current.filter((item) => item.id !== savedBoard.id))
      if (boardRef.current.id === savedBoard.id) {
        const fallback = boardsRef.current.find((item) => item.id !== savedBoard.id)
        setBoard(fallback ? localDrafts.current.get(fallback.id) ?? fallback : createEmptyBoard(boardRef.current.rows, boardRef.current.columns))
        setHistory([])
        setFuture([])
        setSelectedCellId(null)
        setSelectedCellIds([])
      }
      setSuccess(`« ${savedBoard.title} » a été déplacé dans la corbeille.`)
      setError('')
    } catch {
      deletedBoardIds.current.delete(savedBoard.id)
      if (wasEditable) editableBoardIds.current.add(savedBoard.id)
      setError(`Impossible de supprimer « ${savedBoard.title} ». Réessaie.`)
      setSuccess('')
    } finally { setDeletingBoardId(null) }
  }
  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const folder: TlaFolder = { id: crypto.randomUUID(), name }
    try {
      await folderRepository.save(folder)
      setFolders((current) => [...current, folder])
      setNewFolderName('')
      setIsCreatingFolder(false)
    } catch { setError('Le dossier n’a pas pu être créé. Réessayez.') }
  }
  const renameFolder = async (folder: TlaFolder) => {
    const name = window.prompt('Nouveau nom du dossier', folder.name)?.trim()
    if (!name || name === folder.name) return
    const renamed = { ...folder, name }
    try {
      await folderRepository.save(renamed)
      setFolders((current) => current.map((item) => item.id === folder.id ? renamed : item))
    } catch { setError('Le dossier n’a pas pu être renommé. Réessayez.') }
  }
  const removeFolder = async (folder: TlaFolder) => {
    if (libraryBusyRef.current) return
    const affected = libraryBoards.filter((item) => item.folderId === folder.id)
    if (!window.confirm(affected.length ? `Supprimer « ${folder.name} » ? ${affected.length} TLA resteront dans la bibliothèque, sans dossier.` : `Supprimer « ${folder.name} » ?`)) return
    libraryBusyRef.current = true
    setLibraryBusy(true)
    try {
      await saveQueue.flush()
      const unfiledBoards = await folderRepository.remove(folder.id)
      unfiledBoards.forEach((item) => localDrafts.current.delete(item.id))
      saveQueue.register(unfiledBoards)
      setBoards((current) => current.map((item) => unfiledBoards.find((updated) => updated.id === item.id) ?? item))
      if (boardRef.current.folderId === folder.id) {
        const next = unfiledBoards.find((item) => item.id === boardRef.current.id) ?? { ...boardRef.current, folderId: undefined }
        lastQueued.current.set(next.id, next)
        setBoard(next)
      }
      setHistory([]); setFuture([])
      setFolders((current) => current.filter((item) => item.id !== folder.id))
      if (selectedFolderId === folder.id) setLibraryFilter('recent')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Le dossier n’a pas pu être supprimé. Aucun déplacement partiel n’a été appliqué.') }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const undo = () => { const previous = history.at(-1); if (!previous || libraryBusyRef.current) return; editVersions.current.set(previous.id, (editVersions.current.get(previous.id) ?? 0) + 1); setFuture((current) => [...current, board]); setBoard(previous); setHistory((current) => current.slice(0, -1)) }
  const redo = () => { const next = future.at(-1); if (!next || libraryBusyRef.current) return; editVersions.current.set(next.id, (editVersions.current.get(next.id) ?? 0) + 1); setHistory((current) => [...current, board]); setBoard(next); setFuture((current) => current.slice(0, -1)) }
  const normalizeList = () => normalizeWords(listText.split(/[\n,;]+/))
  const loadBatchProposals = async () => {
    const words = normalizeList()
    if (!words.length) return
    if (words.length > 500) { setError('La création en lot est limitée à 500 mots. Séparez votre liste en plusieurs tableaux.'); return }
    batchAbort.current?.abort()
    const controller = new AbortController()
    batchAbort.current = controller
    setBatchState('loading')
    setBatchProposals(words.map((word) => ({ word, state: 'waiting' })))
    try {
    const proposals = await mapConcurrent(words, async (word): Promise<BatchProposal> => {
      setBatchProposals((current) => current.map((item) => item.word === word ? { ...item, state: 'loading' } : item))
      try {
        const results = await searchBank(word, activeBank, controller.signal)
        const proposal: BatchProposal = { word, result: results[0], choices: results, state: results.length ? 'ready' : 'empty' }
        if (!controller.signal.aborted) setBatchProposals((current) => current.map((item) => item.word === word ? proposal : item))
        return proposal
      } catch (cause) {
        if (isAbortError(cause)) throw cause
        return { word, state: 'error' }
      }
    }, controller.signal, 4)
    if (controller.signal.aborted) return
    setBatchProposals(proposals)
    setBatchState('ready')
    } catch (cause) { if (!isAbortError(cause)) { setError('La recherche en lot a échoué. Réessayez.'); setBatchState('idle') } }
  }

  const generateList = () => {
    const proposals: BatchProposal[] = batchProposals.length ? batchProposals : normalizeList().map((word) => ({ word, state: 'empty' }))
    const next = insertMode === 'replace' ? placeWords(board, proposals.map((proposal) => proposal.word)) : { ...board }
    const targets = next.cells.filter((cell) => insertMode === 'replace' || (!cell.label.trim() && !cell.imageData))
    const targetsById = new Map(targets.map((cell, index) => [cell.id, proposals[index]]))
    const cells = next.cells.map((cell) => {
      const proposal = targetsById.get(cell.id)
      if (proposal && !proposal.result) return { ...cell, label: proposal.word, source: null, imageData: undefined, pictogramId: undefined }
      if (!proposal?.result) return cell
      const lower = `${proposal.word} ${proposal.result.label}`.toLocaleLowerCase('fr-FR')
      const category: FitzgeraldCategory = /\b(manger|boire|faire|aller|prendre)\b/.test(lower) ? 'verbs' : /\b(je|tu|il|elle|nous|vous)\b/.test(lower) ? 'people' : 'nouns'
      return { ...cell, source: activeBank, pictogramId: proposal.result.id, imageData: proposal.result.imageUrl, label: proposal.word.toLocaleUpperCase('fr-FR'), searchTerm: proposal.word, category }
    })
    updateBoard({ ...next, cells, overflowWords: insertMode === 'replace' ? next.overflowWords : normalizeWords([...next.overflowWords, ...proposals.slice(targets.length).map((item) => item.word)]) })
    setPanel('none')
    setBatchProposals([])
    setBatchState('idle')
  }

  const translateBoard = async () => {
    const source = board
    const filledCells = [...source.cells, ...(source.overflowCells ?? [])].filter((cell) => cell.label.trim())
    translationAbort.current?.abort()
    const controller = new AbortController()
    translationAbort.current = controller
    setTranslationSource(source)
    setTranslationDraft(null)
    setTranslationError('')
    setTranslationState('loading')
    setPanel('translation')
    try {
      const { translateTexts } = await import('./services/translation')
      const translated = await translateTexts([source.title, ...filledCells.map((cell) => cell.label), ...source.overflowWords], controller.signal)
      if (controller.signal.aborted) return
      setTranslationDraft({
        title: translated[0] || source.title,
        cells: filledCells.map((cell, index) => ({ id: cell.id, original: cell.label.toLocaleUpperCase('fr-FR'), translated: (translated[index + 1] || cell.label).toLocaleUpperCase('fr-FR') })),
        overflowWords: source.overflowWords.map((word, index) => translated[filledCells.length + index + 1] || word),
      })
      setTranslationState('ready')
    } catch (cause) {
      if (isAbortError(cause)) return
      setTranslationError(cause instanceof Error ? cause.message : 'La traduction est indisponible. Vérifie ta connexion puis réessaie.')
      setTranslationState('error')
    }
  }

  const createTranslatedCopy = () => {
    if (!translationSource || !translationDraft) return
    const translatedCells = new Map(translationDraft.cells.map((cell) => [cell.id, cell.translated.trim()]))
    const now = new Date().toISOString()
    const translatedBoard: Board = {
      ...translationSource,
      id: crypto.randomUUID(),
      revision: undefined,
      title: translationDraft.title.trim() || `${translationSource.title} (EN)`,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      cells: translationSource.cells.map((cell) => ({
        ...cell,
        id: crypto.randomUUID(),
        label: (translatedCells.get(cell.id) || cell.label).toLocaleUpperCase('fr-FR'),
      })),
      overflowCells: translationSource.overflowCells?.map((cell) => ({ ...cell, id: crypto.randomUUID(), label: (translatedCells.get(cell.id) || cell.label).toLocaleUpperCase('fr-FR') })),
      overflowWords: translationDraft.overflowWords.map((word, index) => word.trim() || translationSource.overflowWords[index]),
    }
    updateBoard(translatedBoard)
    setLibraryFilter('recent')
    setPanel('none')
    setTranslationSource(null)
    setTranslationDraft(null)
    setTranslationState('idle')
    setSelectedCellId(null)
    setSelectedCellIds([])
    setSidebarTab('library')
  }

  const importImage = async (file: File) => {
    if (!selectedCellId) return
    const targetId = boardRef.current.id
    const cellId = selectedCellId
    imageAbort.current?.abort()
    const controller = new AbortController()
    imageAbort.current = controller
    try {
      const { readImportedImage } = await import('./services/images')
      const image = await readImportedImage(file, controller.signal)
      const current = boardRef.current
      const target = current.cells.find((cell) => cell.id === cellId)
      if (controller.signal.aborted || current.id !== targetId || !target || deletedBoardIds.current.has(targetId)) return
      updateCell(cellId, { source: 'upload', imageData: image.dataUrl, imageMime: image.mime, pictogramId: undefined, label: (target.label || file.name.replace(/\.[^.]+$/, '')).toLocaleUpperCase('fr-FR'), category: 'other' })
      setPanel('none')
    } catch (cause) { if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : 'Cette image n’a pas pu être importée.') }
  }

  const downloadBackup = async () => {
    try {
      const savedBoards = [...boards.filter((savedBoard) => savedBoard.id !== board.id), board]
      const { exportBackupFile } = await import('./services/backup')
      await exportBackupFile(savedBoards, board.title, folders)
      setError('')
      setSuccess('Sauvegarde téléchargée.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La sauvegarde n’a pas pu être créée. Réessayez.')
      setSuccess('')
    }
  }

  const restoreBackup = async (file: File) => {
    if (libraryBusyRef.current) return
    libraryBusyRef.current = true
    setLibraryBusy(true)
    try {
      const { readBackupFile } = await import('./services/backup')
      const backup = await readBackupFile(file)
      const boardIds = new Set([...boards, board].map((savedBoard) => savedBoard.id))
      const folderIds = new Set(folders.map((folder) => folder.id))
      const boardConflicts = backup.boards.filter((savedBoard) => boardIds.has(savedBoard.id)).length
      const folderConflicts = backup.folders.filter((folder) => folderIds.has(folder.id)).length
      if ((boardConflicts || folderConflicts) && !window.confirm(`Cette sauvegarde remplacera ${boardConflicts} TLA et ${folderConflicts} dossier(s) déjà présents. Les autres éléments seront conservés. Continuer ?`)) return
      await saveQueue.flush()
      const restoredBoards = await boardRepository.restore(backup.boards, backup.folders)
      restoredBoards.forEach((item) => localDrafts.current.delete(item.id))
      restoredBoards.forEach((savedBoard) => deletedBoardIds.current.delete(savedBoard.id))
      saveQueue.register(restoredBoards)
      setBoards((current) => {
        const merged = new Map(current.map((savedBoard) => [savedBoard.id, savedBoard]))
        restoredBoards.forEach((savedBoard) => merged.set(savedBoard.id, savedBoard))
        return [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      })
      setFolders((current) => {
        const merged = new Map(current.map((folder) => [folder.id, folder]))
        backup.folders.forEach((folder) => merged.set(folder.id, folder))
        return [...merged.values()]
      })
      const newestRestoredBoard = [...restoredBoards].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      if (newestRestoredBoard) {
        setBoard(newestRestoredBoard)
        setHistory([])
        setFuture([])
        setSelectedCellId(null)
        setSelectedCellIds([])
        lastQueued.current.set(newestRestoredBoard.id, newestRestoredBoard)
        setPanel('none')
      }
      setDeletedBoards(await boardRepository.listDeleted())
      setError('')
      setSuccess(`Restauration terminée : ${backup.boards.length} TLA et ${backup.folders.length} dossiers ajoutés ou actualisés.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La restauration a échoué. Aucune donnée n’a été remplacée.')
      setSuccess('')
    } finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }

  const getPdf = async () => {
    const source = boardRef.current
    if (previewCache.current?.board === source) return previewCache.current.blob
    const { exportBoardPdf } = await import('./services/pdf')
    const blob = await exportBoardPdf(sheetRef.current ?? document.createElement('div'), source, false)
    previewCache.current = { board: source, blob }
    return blob
  }

  const printBoard = async () => {
    if (pdfBusy) return
    const printWindow = window.open('about:blank', '_blank')
    if (!printWindow) {
      setError('Le navigateur a bloqué l’impression. Le PDF a été téléchargé à la place.')
      void downloadBoard()
      return
    }
    setPdfBusy(true)
    try {
      const blob = await getPdf()
      const url = URL.createObjectURL(blob)
      printWindow.document.title = `Imprimer ${board.title}`
      const release = () => URL.revokeObjectURL(url)
      printWindow.addEventListener('pagehide', release, { once: true })
      printWindow.addEventListener('load', () => {
        try {
          printWindow.focus()
          printWindow.print()
          printWindow.addEventListener('afterprint', release, { once: true })
        } catch {
          setError('L’impression automatique est indisponible. Utilisez Imprimer dans le nouvel onglet PDF.')
        }
      }, { once: true })
      printWindow.location.href = url
      setError('')
    } catch (cause) {
      printWindow.close()
      setError(cause instanceof Error ? cause.message : 'L’impression du PDF a échoué. Réessayez depuis l’aperçu.')
    } finally { setPdfBusy(false) }
  }
  const downloadBoard = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await getPdf()
      const { saveAs } = await import('file-saver')
      saveAs(blob, `${boardRef.current.title || 'tla'}.pdf`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le téléchargement du PDF a échoué.')
    } finally { setPdfBusy(false) }
  }
  const shareBoard = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
    const blob = await getPdf()
    const file = new File([blob], `${board.title}.pdf`, { type: 'application/pdf' })
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ files: [file], title: board.title })
    else { const { saveAs } = await import('file-saver'); saveAs(blob, file.name); setSuccess('Le partage natif est indisponible. Le PDF a été téléchargé.') }
    } catch (cause) { if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : 'Le partage n’a pas pu aboutir.') }
    finally { setPdfBusy(false) }
  }

  const duplicateBoard = (source = boardRef.current) => {
    const now = new Date().toISOString()
    const next = { ...source, id: crypto.randomUUID(), revision: undefined, title: `${source.title} (copie)`, createdAt: now, updatedAt: now, cells: source.cells.map((cell) => ({ ...cell, id: crypto.randomUUID() })), overflowCells: source.overflowCells?.map((cell) => ({ ...cell, id: crypto.randomUUID() })) }
    editableBoardIds.current.add(next.id)
    setBoard(next); setHistory([]); setFuture([]); setSelectedCellId(null); setSelectedCellIds([]); setError(''); setLibraryFilter('recent')
    setSuccess('Copie créée. Le tableau d’origine est conservé.')
  }

  const restoreDeleted = async (id: string) => {
    try {
      const restored = await boardRepository.restoreDeleted(id)
      localDrafts.current.delete(id)
      deletedBoardIds.current.delete(id)
      saveQueue.register([restored])
      lastQueued.current.set(id, restored)
      setBoards((current) => [...current.filter((item) => item.id !== id), restored])
      setDeletedBoards((current) => current.filter((item) => item.id !== id))
      openSavedBoard(restored)
      setSuccess(`« ${restored.title} » a été restauré.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'La restauration a échoué.') }
  }

  const protectStorage = async () => {
    try {
      if (!navigator.storage?.persist) { setError('Ce navigateur ne propose pas la protection du stockage. Conservez une sauvegarde ZIP.'); return }
      const persistent = await navigator.storage.persist()
      const estimate = await navigator.storage.estimate()
      setStorageInfo({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent })
      setSuccess(persistent ? 'Le navigateur a accordé un stockage persistant. Conservez aussi vos sauvegardes ZIP.' : 'Le navigateur n’a pas accordé la persistance. Les sauvegardes ZIP restent disponibles.')
    } catch { setError('L’état du stockage est indisponible. Vous pouvez toujours télécharger une sauvegarde ZIP.') }
  }

  const exportFolder = async () => {
    if (pdfBusy) return
    const sources = visibleBoards.map((item) => item.id === boardRef.current.id ? boardRef.current : localDrafts.current.get(item.id) ?? item)
    if (!sources.length) return
    setPdfBusy(true)
    try { const { exportBoardsPdf } = await import('./services/pdf'); await exportBoardsPdf(sources, libraryLabel) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'L’export du dossier a échoué.') }
    finally { setPdfBusy(false) }
  }

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || !(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
      <div className="brand"><div className="brand-mark"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="TLA Flash" /></div><span>TLA Flash</span></div>
      <div className="topbar-divider" />
      <div className="save-status" role="status"><span className={`status-dot ${saveState}`} />{saveState === 'saved' ? 'Enregistré sur cet appareil' : saveState === 'error' ? 'Sauvegarde impossible' : 'Enregistrement…'}</div>
      <div className="top-actions">
        <button className="icon-button" title="Annuler" aria-label="Annuler" onClick={undo} disabled={!history.length || libraryBusy}><Undo2 size={18} /></button>
        <button className="icon-button" title="Rétablir" aria-label="Rétablir" onClick={redo} disabled={!future.length || libraryBusy}><Redo2 size={18} /></button>
        <button className="toolbar-button" aria-label="Aperçu PDF" disabled={pdfBusy || libraryBusy} onClick={() => setPanel('preview')}><LayoutGrid size={16} /> Aperçu</button>
        <button className="toolbar-button secondary" aria-label="Partager le PDF" disabled={pdfBusy || libraryBusy} onClick={() => void shareBoard()}><Share2 size={16} /> Partager</button>
        <button className="primary-button" disabled={pdfBusy || libraryBusy} onClick={() => void printBoard()}><ArrowDownToLine size={16} /> {pdfBusy ? 'Préparation…' : 'Imprimer'}</button>
      </div>
    </header>
    <div className="workspace">
      <aside inert={libraryBusy} className={`sidebar ${mobileNav ? 'sidebar-open' : ''} ${sidebarTab !== 'library' ? 'sidebar-editing' : ''}`}>
        <div className="sidebar-header"><span>{sidebarTab === 'pictograms' ? 'Pictogrammes' : sidebarTab === 'edit' ? 'Modifier' : 'Bibliothèque'}</span><button className="icon-button close-mobile" aria-label="Fermer le menu" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
        <div className="sidebar-tabs" role="group" aria-label="Panneaux latéraux">
          <button className={`pictograms-tab ${sidebarTab === 'pictograms' ? 'active' : ''}`} aria-pressed={sidebarTab === 'pictograms'} onClick={() => setSidebarTab('pictograms')}><ImagePlus size={15} /> Pictogrammes <small>{bankName(activeBank)}</small></button>
          <button aria-pressed={sidebarTab === 'edit'} className={sidebarTab === 'edit' ? 'active' : ''} onClick={() => setSidebarTab('edit')}>Modifier <span>{selectedCellIds.length || ''}</span></button>
          <button aria-pressed={sidebarTab === 'library'} className={sidebarTab === 'library' ? 'active' : ''} onClick={() => setSidebarTab('library')}>Bibliothèque</button>
        </div>
        {sidebarTab === 'pictograms' && <section className="pictogram-banks" aria-label="Banque de pictogrammes">
          <h2>Les pictos de mon TLA</h2>
          <p>Choisissez la banque de pictogrammes à utiliser pour ce TLA.</p>
          <div className="bank-options">
            {(['arasaac', 'sclera', 'makaton'] as const).map((bank) => <button type="button" key={bank} aria-label={`${bankName(bank)} ${activeBank === bank ? "Banque de ce TLA" : "Choisir pour ce TLA"}`} className={`bank-option ${activeBank === bank ? 'selected' : ''}`} aria-pressed={activeBank === bank} disabled={switchingBank} onClick={() => void switchBank(bank)}><span><strong>{bankName(bank)}</strong><small>{activeBank === bank ? 'Banque de ce TLA' : 'Choisir pour ce TLA'}</small></span>{activeBank === bank && <Check size={18} />}</button>)}
            <button type="button" className="bank-option" disabled><span><strong>Milmo</strong><small>Banque à venir</small></span><span className="bank-status">À venir</span></button>
          </div>
          <p className="bank-help">{switchingBank ? 'Recherche des pictogrammes en cours…' : 'Le choix est enregistré pour ce TLA. Sans correspondance, seul le mot est affiché. Les photos personnelles sont conservées.'}</p>
          <button type="button" className="new-board bank-continue" onClick={() => setSidebarTab('edit')}><Pencil size={16} /> Modifier mon TLA</button>
        </section>}
        {sidebarTab === 'edit' && <>
          <button className="new-board" onClick={createBoard}><FilePlus2 size={17} /> Nouveau TLA</button>
          <button className="sidebar-tool" onClick={() => { setListText(''); setBatchProposals([]); setBatchState('idle'); setInsertMode(board.cells.some((cell) => cell.label || cell.imageData) ? 'empty' : 'replace'); setPanel('list'); setMobileNav(false) }}><Sparkles size={16} /> Générer depuis une liste</button>
          <button className="sidebar-tool" onClick={() => duplicateBoard()}><FilePlus2 size={16} /> Dupliquer ce TLA</button>
          <button className="sidebar-tool" aria-describedby="translation-information" onClick={() => void translateBoard()}><Languages size={16} /> Traduire le TLA complet</button>
          <p className="tool-information" id="translation-information">La traduction envoie le titre et les mots à MyMemory. Évitez les informations personnelles.</p>
        </>}
        {sidebarTab === 'edit' && <section className="selection-panel">
          <div className="section-label"><span>Texte · {selectedCells.length}</span><button className="mini-button" title="Effacer la sélection" aria-label="Effacer la sélection" onClick={() => { setSelectedCellIds([]); setSelectedCellId(null) }}><X size={15} /></button></div>
          {selectedCells.length ? <div className="selection-cell-list">{selectedCells.map((cell) => <label className="selection-cell" key={cell.id}><span>{cell.source === 'arasaac' || cell.source === 'sclera' || cell.source === 'makaton' ? `${bankName(cell.source)} #${cell.pictogramId}` : cell.source === 'upload' ? 'Image importée' : 'Pictogramme'}</span><input aria-label={`Légende du pictogramme ${cell.label}`} value={cell.textCase === 'lowercase' ? cell.label.toLocaleLowerCase('fr-FR') : cell.label.toLocaleUpperCase('fr-FR')} onChange={(event) => updateCell(cell.id, { label: cell.textCase === 'lowercase' ? event.target.value.toLocaleLowerCase('fr-FR') : event.target.value.toLocaleUpperCase('fr-FR') })} /></label>)}</div> : <p className="saved-empty">Clique sur un pictogramme pour le sélectionner.</p>}
          <details className="style-panel">
            <summary><Contrast size={15} /> Style</summary>
            <div className="style-controls">
              <button className="selection-action" disabled={!selectedCells.length} onClick={() => updateSelectedCells({ blackAndWhite: !selectedCells.every((cell) => cell.blackAndWhite) })}><Contrast size={15} /> {selectedCells.length && selectedCells.every((cell) => cell.blackAndWhite) ? 'Remettre en couleur' : 'Noir et blanc'}</button>
              <div className="style-option"><span>Taille du texte</span><div className="style-segments">
                <button aria-pressed={selectedTextSize === 'small'} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ textSize: 'small' })}>Petit</button>
                <button aria-pressed={selectedTextSize === 'normal'} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ textSize: 'normal' })}>Normal</button>
                <button aria-pressed={selectedTextSize === 'large'} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ textSize: 'large' })}>Grand</button>
              </div></div>
              <div className="style-option"><span>Casse</span><div className="style-segments">
                <button aria-pressed={selectedTextCase === 'uppercase'} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ textCase: 'uppercase' })}>MAJ</button>
                <button aria-pressed={selectedTextCase === 'lowercase'} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ textCase: 'lowercase' })}>min</button>
              </div></div>
              <button className="selection-action" aria-pressed={selectedBold} disabled={!selectedCells.length} onClick={() => updateSelectedCells({ bold: !selectedBold })}><Bold size={15} /> Gras</button>
              <label className="style-color"><span>Couleur du texte</span><input type="color" aria-label="Couleur du texte" disabled={!selectedCells.length} value={selectedCells[0]?.textColor ?? '#263332'} onChange={(event) => updateSelectedCells({ textColor: event.target.value })} /></label>
            </div>
          </details>
          {selectedCells.length === 1 && <button className="selection-action" onClick={() => openSearch(selectedCells[0].id)}><ImagePlus size={15} /> Remplacer le pictogramme</button>}
          {selectedCells.length === 1 && <label className="template-picker"><span>Déplacer ou échanger la case</span><select aria-label="Destination du pictogramme sélectionné" value="" onChange={(event) => { if (event.target.value) updateBoard(moveOrSwapCells(board, selectedCells[0].id, event.target.value)) }}><option value="">Choisir une position…</option>{board.cells.filter((cell) => cell.id !== selectedCells[0].id).map((cell) => <option key={cell.id} value={cell.id}>Ligne {cell.row + 1}, colonne {cell.column + 1}{cell.label ? ` · ${cell.label}` : ' · vide'}</option>)}</select></label>}
        </section>}
        {sidebarTab === 'edit' && (board.overflowWords.length > 0 || Boolean(board.overflowCells?.length)) && <section className="reserve-panel" aria-label="Cases et mots en réserve"><h2>En réserve</h2><p>Les cases retirées restent disponibles. Agrandissez la grille ou réinsérez-les dans une case vide.</p>{board.overflowCells?.map((cell) => <button key={cell.id} className="reserve-item" disabled={!board.cells.some((item) => !item.label && !item.imageData)} onClick={() => updateBoard(restoreOverflowCell(board, cell.id))}>{cell.imageData && <img loading="lazy" src={cell.imageData} alt="" />}<span>Réinsérer {cell.label || 'l’image'}</span></button>)}{board.overflowWords.filter((word) => !board.overflowCells?.some((cell) => cell.label.toLocaleLowerCase('fr-FR') === word.toLocaleLowerCase('fr-FR'))).map((word) => <button key={word} className="reserve-item" disabled={!board.cells.some((cell) => !cell.label && !cell.imageData)} onClick={() => { const empty = board.cells.find((cell) => !cell.label && !cell.imageData); if (empty) updateBoard({ ...board, cells: board.cells.map((cell) => cell.id === empty.id ? { ...cell, label: word } : cell), overflowWords: board.overflowWords.filter((item) => item !== word) }) }}>Réinsérer {word}</button>)}</section>}
        <div className="backup-actions"><button type="button" onClick={() => void downloadBackup()}><ArrowDownToLine size={13} /> Sauvegarder</button><button type="button" onClick={() => backupInputRef.current?.click()}><Upload size={13} /> Restaurer</button></div>
        <input ref={backupInputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); event.target.value = '' }} />
        <nav className="main-nav"><button className={`nav-item ${libraryFilter === 'recent' ? 'active' : ''}`} onClick={() => setLibraryFilter('recent')}><Sparkles size={17} /> Tous les TLA <span className="nav-count">{libraryBoards.length}</span></button><button className={`nav-item ${libraryFilter === 'drafts' ? 'active' : ''}`} onClick={() => setLibraryFilter('drafts')}><Archive size={17} /> Brouillons</button><button className={`nav-item ${libraryFilter === 'favorites' ? 'active' : ''}`} onClick={() => setLibraryFilter('favorites')}><span className="star-icon">★</span> Favoris</button></nav>
        {sidebarTab === 'library' && <div className="sidebar-section"><div className="section-label"><span>Dossiers</span><button className="mini-button" title="Ajouter un dossier" aria-label="Ajouter un dossier" onClick={() => setIsCreatingFolder(true)}><Plus size={15} /></button></div>{isCreatingFolder && <form className="new-folder-form" onSubmit={(event) => { event.preventDefault(); void createFolder() }}><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Nom du dossier" aria-label="Nom du dossier" /><button type="submit" aria-label="Créer le dossier" disabled={!newFolderName.trim()}><Check size={14} /></button><button type="button" aria-label="Annuler la création du dossier" onClick={() => { setIsCreatingFolder(false); setNewFolderName('') }}><X size={14} /></button></form>}{folders.length ? [...folders].sort((left, right) => left.name.localeCompare(right.name, 'fr')).map((folder) => <div className="folder-row" key={folder.id}><button className={`folder-item ${selectedFolderId === folder.id ? 'selected' : ''}`} onClick={() => { setLibraryFilter(`folder:${folder.id}`); setMobileNav(false) }}><Folder size={15} />{folder.name}<small className="nav-count">{libraryBoards.filter((item) => item.folderId === folder.id).length}</small></button><span className="folder-actions"><button title={`Renommer ${folder.name}`} aria-label={`Renommer ${folder.name}`} onClick={() => void renameFolder(folder)}><Pencil size={12} /></button><button title={`Supprimer ${folder.name}`} aria-label={`Supprimer ${folder.name}`} onClick={() => void removeFolder(folder)}><Trash2 size={12} /></button></span></div>) : <p className="saved-empty">Crée un dossier pour retrouver facilement tes TLA.</p>}</div>}
        {sidebarTab === 'library' && <label className="library-search"><Search size={15} /><input aria-label="Rechercher dans la bibliothèque" placeholder="Titre ou mot du TLA…" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} /></label>}
        <div className="saved-boards"><div className="saved-boards-heading"><span>{libraryLabel}</span><small>{visibleBoards.length}</small></div>{visibleBoards.length ? visibleBoards.map((savedBoard) => <div className="saved-board-row" key={savedBoard.id}><button className={`saved-board ${savedBoard.id === board.id ? 'current' : ''}`} onClick={() => openSavedBoard(savedBoard)}><BoardThumbnail board={savedBoard} /><span className="saved-board-copy"><strong>{savedBoard.title}</strong><small>{savedBoard.columns} × {savedBoard.rows} · {new Date(savedBoard.updatedAt).toLocaleDateString('fr-FR')}</small></span></button><button className="saved-board-delete" type="button" title={`Supprimer ${savedBoard.title}`} aria-label={`Supprimer ${savedBoard.title}`} onClick={() => void removeBoard(savedBoard)}><Trash2 size={15} /></button></div>) : <p className="saved-empty">{selectedFolderId ? 'Aucun TLA dans ce dossier.' : 'Aucun TLA dans cette vue. Les données restent propres à chaque navigateur.'}</p>}</div>
        {sidebarTab === 'library' && <><button className="sidebar-tool" disabled={pdfBusy || !visibleBoards.length} onClick={() => void exportFolder()}><ArrowDownToLine size={16} /> {selectedFolderId ? 'Exporter ce dossier en PDF' : 'Exporter les TLA en PDF'}</button><details className="trash-panel"><summary>Corbeille · {deletedBoards.length}</summary>{deletedBoards.map((item) => <div className="trash-item" key={item.id}><span>{item.board.title}</span><button type="button" aria-label={`Restaurer ${item.board.title}`} onClick={() => void restoreDeleted(item.id)}>Restaurer</button></div>)}</details></>}
        <div className="sidebar-footer"><div className="local-note"><span className="local-icon"><Check size={13} /></span><div><strong>TLA enregistrés sur cet appareil</strong><small>Recherche ARASAAC et traduction : services externes.</small></div></div><button type="button" className="text-button storage-button" onClick={() => void protectStorage()}>Protéger le stockage local</button>{storageInfo && <p className="tool-information">{(storageInfo.used / 1048576).toFixed(1)} Mo utilisés{storageInfo.quota ? ` sur ${(storageInfo.quota / 1048576).toFixed(0)} Mo` : ''} · {storageInfo.persistent ? 'persistant' : 'sauvegarde ZIP conseillée'}</p>}</div>
      </aside>
      {mobileNav && <button className="scrim" aria-label="Fermer le menu" onClick={() => setMobileNav(false)} />}
      <main className="main-content">
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><button aria-label="Fermer le message d’erreur" onClick={() => setError('')}><X size={15} /></button></div>}{success && <div className="notice success-notice" role="status"><span>{success}</span><button aria-label="Fermer la confirmation" onClick={() => setSuccess('')}><X size={15} /></button></div>}
        {saveState === 'error' && <div className="recovery-actions"><button className="toolbar-button secondary" onClick={() => persistBoard(boardRef.current, true)}>Réessayer l’enregistrement</button><button className="toolbar-button secondary" onClick={() => duplicateBoard()}>Conserver ma version en copie</button><button className="toolbar-button secondary" onClick={() => void downloadBackup()}>Sauvegarder en ZIP</button></div>}
        {libraryBusy && <p className="pdf-progress" role="status">Mise à jour de la bibliothèque…</p>}
        {pdfBusy && <p className="pdf-progress" role="status">Préparation du document PDF…</p>}
        <div className="board-pages">{pageBoards.map((page) => <DeferredBoard key={page.id} active={page.id === board.id}><BoardSheet locked={libraryBusy || deletingBoardId === page.id} board={page} onDeleteBoard={() => void removeBoard(page)} folders={folders} onUpdateBoard={(next) => updatePageBoard(page, next)} pageNumber={allPageBoards.findIndex((item) => item.id === page.id) + 1} active={page.id === board.id} selectedCellIds={selectedCellIds} setSheetRef={(element) => { if (page.id === board.id) sheetRef.current = element }} onSelectCell={(cellId) => selectPageCell(page, cellId)} onOpenCell={(cellId) => openPageSearch(page, cellId)} onUpdateCell={(cellId, patch) => updatePageCell(page, cellId, patch)} onDragStart={setDraggedId} onDrop={(cellId) => { if (page.id === board.id && draggedId) updateBoard(moveOrSwapCells(board, draggedId, cellId)); setDraggedId(null) }} onDelete={(cellId) => updatePageCell(page, cellId, { source: null, imageData: undefined, imageMime: undefined, pictogramId: undefined, searchTerm: undefined, label: '', favorite: false, blackAndWhite: false })} /></DeferredBoard>)}</div>
        <div className="bottom-hint"><button className="quick-new-board" type="button" onClick={createBoard}><span className="key-hint"><Plus size={14} /></span> Nouveau TLA vierge</button><span>Le TLA en cours reste dans les brouillons</span></div>
      </main>
    </div>
    {panel === 'search' && <SearchPanel bank={activeBank} term={searchTerm} setTerm={setSearchTerm} results={results} state={searchState} error={error} advance={advanceAfterInsert} setAdvance={setAdvanceAfterInsert} onSearch={() => void runSearch()} onChoose={choosePictogram} onClose={() => setPanel('none')} onUpload={() => fileInputRef.current?.click()} />}
    {panel === 'list' && <div className="modal-backdrop"><Modal className="modal list-modal" label="Générer depuis une liste" onClose={() => setPanel('none')}>
      <div className="modal-head"><div><span className="eyebrow">Création en lot</span><h2>Générer depuis une liste</h2></div><button className="icon-button" aria-label="Fermer la création en lot" onClick={() => setPanel('none')}><X size={19} /></button></div>
      <p className="modal-intro">Un mot par ligne ou séparé par une virgule. Chaque mot est recherché dans la banque {bankName(activeBank)} : le mot saisi restera la légende, avec une proposition de pictogramme modifiable ensuite.</p>
      <textarea aria-label="Mots à insérer" value={listText} onChange={(event) => { batchAbort.current?.abort(); setListText(event.target.value); setBatchProposals([]); setBatchState('idle') }} rows={6} autoFocus placeholder="Ajouter ici vos mots" />
      <label className="insertion-mode"><span>Insérer dans le tableau</span><select aria-label="Mode d’insertion des propositions" value={insertMode} onChange={(event) => setInsertMode(event.target.value as 'replace' | 'empty')}><option value="empty">Remplir les cases vides</option><option value="replace">Remplacer le contenu du tableau</option></select></label>
      <div className="list-meta"><span>{normalizeList().length} mots détectés</span></div>
      {batchState === 'idle' && <button className="proposal-button" onClick={() => void loadBatchProposals()}><Search size={16} /> Rechercher les pictogrammes proposés</button>}
      {batchState !== 'idle' && <div className="batch-proposals"><div className="proposal-heading"><strong>Propositions {bankName(activeBank)}</strong><span role="status">{batchState === 'loading' ? `${batchProposals.filter((item) => item.state === 'ready' || item.state === 'empty' || item.state === 'error').length}/${batchProposals.length} recherches terminées…` : 'Vérifiez les choix avant insertion'}</span></div>{batchProposals.map((proposal) => <div className="proposal-row" key={proposal.word}><span className="proposal-word">{proposal.word}</span>{proposal.state === 'loading' && <span className="proposal-status">Recherche…</span>}{proposal.state === 'empty' && <span className="proposal-status muted">Aucun résultat</span>}{proposal.state === 'error' && <span className="proposal-status error">Indisponible</span>}{proposal.result && <><img loading="lazy" src={proposal.result.imageUrl} alt="" /><span className="proposal-label">{proposal.result.label}</span>{(proposal.choices?.length ?? 0) > 1 && <button type="button" className="text-button" aria-label={`Autre pictogramme pour ${proposal.word}`} onClick={() => setBatchProposals((current) => current.map((item) => item.word !== proposal.word || !item.choices ? item : { ...item, result: item.choices[(item.choices.findIndex((choice) => choice.id === item.result?.id) + 1) % item.choices.length] }))}>Autre proposition</button>}</>}</div>)}</div>}
      <div className="modal-actions"><button className="toolbar-button secondary" onClick={() => setPanel('none')}>Annuler</button><button className="primary-button" disabled={batchState !== 'ready'} onClick={generateList}><Sparkles size={16} /> Insérer les propositions</button></div>
    </Modal></div>}
    {panel === 'preview' && <div className="modal-backdrop"><Modal className="preview-modal" label={`Aperçu PDF ${board.pageSize}`} onClose={() => { setPanel('none'); setPdfBusy(false) }}>
      <div className="modal-head"><div><span className="eyebrow">Document prêt à imprimer</span><h2>Aperçu {board.pageSize}</h2></div><button className="icon-button" aria-label="Fermer l’aperçu" onClick={() => { setPanel('none'); setPdfBusy(false) }}><X size={19} /></button></div>
      {pdfBusy && <p role="status">Chargement du PDF…</p>}
      {previewError && <p className="inline-error" role="alert">{previewError}</p>}
      {previewUrl && <><iframe className="pdf-preview" title={`Aperçu PDF de ${board.title}`} src={previewUrl} /><p className="tool-information">Si le lecteur intégré n’est pas disponible sur votre appareil, téléchargez le PDF pour l’ouvrir.</p></>}
      <div className="modal-actions"><button className="toolbar-button secondary" onClick={() => { setPanel('none'); setPdfBusy(false) }}>Retour à l’édition</button><button className="primary-button" disabled={pdfBusy || !previewUrl} onClick={() => void downloadBoard()}><ArrowDownToLine size={16} /> Télécharger le PDF</button></div>
    </Modal></div>}
    {panel === 'translation' && <div className="modal-backdrop"><Modal className="modal translation-modal" label="Vérifier la traduction" onClose={() => { setPanel('none'); setTranslationState('idle') }}><div className="modal-head"><div><span className="eyebrow">Copie du TLA · anglais</span><h2>Vérifier la traduction</h2></div><button className="icon-button" aria-label="Fermer" onClick={() => { setPanel('none'); setTranslationState('idle') }}><X size={19} /></button></div><p className="translation-privacy">Le titre et les mots sont envoyés au service public MyMemory pour traduction. N’inclus pas d’informations personnelles.</p>{translationState === 'loading' && <div className="search-start"><Languages size={28} /><p>Traduction en cours…</p></div>}{translationState === 'error' && <div className="inline-error">{translationError}<button className="text-button" onClick={() => void translateBoard()}>Réessayer</button></div>}{translationState === 'ready' && translationDraft && translationSource && <><p className="modal-intro">L’original reste intact. Corrige les propositions ci-dessous, puis crée la copie anglaise.</p><label className="translation-title"><span>Titre du TLA</span><input value={translationDraft.title} onChange={(event) => setTranslationDraft((current) => current ? { ...current, title: event.target.value } : current)} /></label><div className="translation-rows">{translationDraft.cells.map((translatedCell) => { const sourceCell = translationSource.cells.find((cell) => cell.id === translatedCell.id); return <div className="translation-row" key={translatedCell.id}>{sourceCell?.imageData ? <img src={sourceCell.imageData} alt="" /> : <span className="translation-icon"><LayoutGrid size={17} /></span>}<span className="translation-original">{translatedCell.original}</span><input aria-label={`Traduction de ${translatedCell.original}`} value={translatedCell.translated} onChange={(event) => setTranslationDraft((current) => current ? { ...current, cells: current.cells.map((cell) => cell.id === translatedCell.id ? { ...cell, translated: event.target.value } : cell) } : current)} /></div>})}</div>{translationDraft.overflowWords.length > 0 && <div className="translation-overflow"><strong>Mots en attente</strong>{translationDraft.overflowWords.map((word, index) => <label key={`${translationSource.overflowWords[index]}-${index}`}><span>{translationSource.overflowWords[index]}</span><input aria-label={`Traduction du mot en attente ${translationSource.overflowWords[index]}`} value={word} onChange={(event) => setTranslationDraft((current) => current ? { ...current, overflowWords: current.overflowWords.map((item, itemIndex) => itemIndex === index ? event.target.value : item) } : current)} /></label>)}</div>}</>}<div className="modal-actions"><button className="toolbar-button secondary" onClick={() => { setPanel('none'); setTranslationState('idle') }}>Annuler</button><button className="primary-button" onClick={createTranslatedCopy} disabled={translationState !== 'ready' || !translationDraft}>{translationState === 'ready' ? 'Créer la copie anglaise' : 'Traduction…'}</button></div></Modal></div>}
    <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImage(file); event.target.value = '' }} />
  </div>
}

function BoardThumbnail({ board }: { board: Board }) {
  const pictures = board.cells.filter((cell) => cell.imageData).slice(0, 4)
  return <span className="saved-board-icon board-thumbnail" aria-hidden="true">{pictures.length ? pictures.map((cell) => <img key={cell.id} loading="lazy" src={cell.imageData} alt="" />) : <LayoutGrid size={18} />}</span>
}

function BoardSheet({ board, locked, onDeleteBoard, folders, onUpdateBoard, pageNumber, active, selectedCellIds, setSheetRef, onSelectCell, onOpenCell, onUpdateCell, onDragStart, onDrop, onDelete }: { board: Board; locked: boolean; onDeleteBoard: () => void; folders: TlaFolder[]; onUpdateBoard: (next: Board) => void; pageNumber: number; active: boolean; selectedCellIds: string[]; setSheetRef: (element: HTMLDivElement | null) => void; onSelectCell: (cellId: string) => void; onOpenCell: (cellId: string) => void; onUpdateCell: (cellId: string, patch: Partial<Cell>) => void; onDragStart: (cellId: string) => void; onDrop: (cellId: string) => void; onDelete: (cellId: string) => void }) {
  return <>
    <div className={`canvas-wrap board-page ${active ? 'active-board' : ''}`} aria-busy={locked}>
      <fieldset className="board-fieldset" disabled={locked}>
      <div className="page-label"><strong>TLA {pageNumber}</strong><div className="page-actions">{active && <span>Modification en cours</span>}<button className="board-delete-button" type="button" title={`Supprimer « ${board.title} »`} aria-label={`Supprimer le TLA ${pageNumber} : ${board.title}`} onClick={onDeleteBoard}><Trash2 size={18} /></button></div></div>
      <div className="editor-header board-editor-header">
        <label className="board-title-control">
          <span className="eyebrow">Modifier le titre du TLA · {board.pageSize} paysage</span>
          <input className="title-input" value={board.title} onChange={(event) => onUpdateBoard({ ...board, title: event.target.value })} aria-label={`Titre du TLA ${pageNumber}`} />
        </label>
        <div className="editor-tools">
          <GridPicker rows={board.rows} columns={board.columns} onSelect={(rows, columns) => onUpdateBoard(resizeBoard(board, rows, columns))} />
          <label className="select-control"><span>Format</span><select aria-label={`Format du TLA ${pageNumber}`} value={board.pageSize} onChange={(event) => onUpdateBoard({ ...board, pageSize: event.target.value as 'A4' | 'A3' })}><option value="A4">A4</option><option value="A3">A3</option></select></label>
          <label className="select-control folder-control"><span>Dossier</span><select aria-label={`Dossier du TLA ${pageNumber}`} value={board.folderId ?? ''} onChange={(event) => onUpdateBoard({ ...board, folderId: event.target.value || undefined })}><option value="">Sans dossier</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><ChevronDown size={14} /></label>
        </div>
      </div>
      <div className="sheet" ref={setSheetRef}>
        <div className="sheet-heading"><h1>{board.title}</h1><span className="sheet-format">{board.pageSize} · paysage</span></div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${board.columns}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)` }}>
          {board.cells.map((cell) => <CellCard key={cell.id} cell={cell} selected={selectedCellIds.includes(cell.id)} canEdit={active && !locked} onOpen={() => cell.label ? onSelectCell(cell.id) : onOpenCell(cell.id)} onToggleSelect={() => onSelectCell(cell.id)} onEdit={(patch) => onUpdateCell(cell.id, patch)} onEditPictogram={() => onOpenCell(cell.id)} onDragStart={() => onDragStart(cell.id)} onDrop={() => onDrop(cell.id)} onDelete={() => onDelete(cell.id)} />)}
        </div>
        <div className="credit">{pictogramCredit(board)}</div>
      </div>
      </fieldset>
    </div>
  </>
}

function GridPicker({ rows, columns, onSelect }: { rows: number; columns: number; onSelect: (rows: number, columns: number) => void }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<{ rows: number; columns: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const preview = hovered ?? { rows, columns }
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const close = () => { setOpen(false); setHovered(null); triggerRef.current?.focus() }
  return <div ref={rootRef} className="grid-picker" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
    <button ref={triggerRef} className="grid-picker-trigger" type="button" aria-label={`Grille ${columns} colonnes par ${rows} lignes`} aria-expanded={open} onClick={() => { setOpen((value) => !value); setHovered(null) }}>
      <LayoutGrid size={15} /><span>Grille</span><strong>{columns} × {rows}</strong><ChevronDown size={14} />
    </button>
    {open && <div className="grid-picker-popover" onMouseLeave={() => setHovered(null)}>
      <form className="grid-numbers" onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const nextRows = Number(data.get('rows'))
        const nextColumns = Number(data.get('columns'))
        if (Number.isInteger(nextRows) && Number.isInteger(nextColumns) && nextRows >= 1 && nextRows <= 10 && nextColumns >= 1 && nextColumns <= 15) { onSelect(nextRows, nextColumns); close() }
      }}>
        <label>Lignes<input name="rows" aria-label="Nombre de lignes" type="number" min="1" max="10" required defaultValue={rows} /></label>
        <label>Colonnes<input name="columns" aria-label="Nombre de colonnes" type="number" min="1" max="15" required defaultValue={columns} /></label>
        <button type="submit">Appliquer</button>
      </form>
      <div className="grid-picker-size">{preview.columns} colonnes × {preview.rows} lignes</div>
      <div className="grid-picker-scroll"><div className="grid-picker-matrix" role="grid" aria-label="Choisir le nombre de cases">
        {Array.from({ length: 10 }, (_, rowIndex) => <div role="row" key={rowIndex} className="grid-picker-row">{Array.from({ length: 15 }, (_, columnIndex) => {
          const column = columnIndex + 1
          const row = rowIndex + 1
          const active = column <= preview.columns && row <= preview.rows
          return <button key={column} className={active ? 'active' : ''} data-grid-row={row} data-grid-column={column} type="button" role="gridcell" tabIndex={row === rows && column === columns ? 0 : -1} aria-selected={row === rows && column === columns} aria-label={`${column} colonnes, ${row} lignes`} title={`${column} × ${row}`} onMouseEnter={() => setHovered({ rows: row, columns: column })} onFocus={() => setHovered({ rows: row, columns: column })} onKeyDown={(event) => {
            const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
            if (!delta) return
            event.preventDefault()
            const nextRow = Math.max(1, Math.min(10, row + delta[0]))
            const nextColumn = Math.max(1, Math.min(15, column + delta[1]))
            rootRef.current?.querySelector<HTMLButtonElement>(`[data-grid-row="${nextRow}"][data-grid-column="${nextColumn}"]`)?.focus()
          }} onClick={() => { onSelect(row, column); close() }} />
        })}</div>)}
      </div></div>
      <div className="grid-picker-limits">Maximum : 15 colonnes × 10 lignes. Les cases retirées sont conservées en réserve.</div>
    </div>}
  </div>
}

function CellCard({ cell, onOpen, onEdit, onEditPictogram, onToggleSelect, onDragStart, onDrop, onDelete, selected = false, canEdit = true, preview = false }: { cell: Cell; onOpen: () => void; onEdit: (patch: Partial<Cell>) => void; onEditPictogram?: () => void; onToggleSelect?: () => void; onDragStart: () => void; onDrop: () => void; onDelete: () => void; selected?: boolean; canEdit?: boolean; preview?: boolean }) {
  return <article className={`cell-card ${cell.label ? 'filled' : 'empty'} ${cell.favorite ? 'is-favorite' : ''} ${selected ? 'selected' : ''}`} draggable={Boolean(cell.label) && canEdit && !preview} onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    {cell.label ? <><button className="cell-main" onClick={onOpen} aria-label={`Sélectionner ${cell.label.toLocaleUpperCase('fr-FR')}`} aria-pressed={selected}>{cell.imageData ? <img loading="lazy" decoding="async" src={cell.imageData} alt="" style={{ filter: cell.blackAndWhite ? 'grayscale(1)' : undefined }} /> : null}<span style={{ color: cell.textColor, fontSize: cell.textSize === 'small' ? 'clamp(8px, .8vw, 11px)' : cell.textSize === 'large' ? 'clamp(12px, 1.35vw, 18px)' : undefined, fontWeight: cell.bold === false ? 500 : 700, textTransform: cell.textCase === 'lowercase' ? 'lowercase' : 'uppercase' }}>{cell.label.toLocaleUpperCase('fr-FR')}</span></button>{!preview && canEdit && <><button className="selection-bubble" type="button" aria-label={`${selected ? 'Désélectionner' : 'Sélectionner'} ${cell.label}`} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onToggleSelect?.() }}>{selected && <Check size={14} />}</button><div className="cell-actions"><button title="Remplacer le pictogramme" aria-label={`Remplacer le pictogramme ${cell.label}`} onClick={() => onEditPictogram?.()}><Pencil size={13} /></button><button title="Favori" aria-label={`Favori ${cell.label}`} aria-pressed={cell.favorite} onClick={() => onEdit({ favorite: !cell.favorite })}>★</button><button title="Effacer" aria-label={`Effacer ${cell.label}`} onClick={onDelete}><Trash2 size={13} /></button></div></>}</> : <button className="empty-add" onClick={onOpen}><span className="plus-circle"><Plus size={22} /></span><span>Ajouter</span></button>}
  </article>
}

function SearchPanel({ bank, advance, setAdvance, term, setTerm, results, state, error, onSearch, onChoose, onClose, onUpload }: { bank: PictogramBank; advance: boolean; setAdvance: (value: boolean) => void; term: string; setTerm: (value: string) => void; results: PictogramResult[]; state: 'idle' | 'loading' | 'error'; error: string; onSearch: () => void; onChoose: (result: PictogramResult) => void; onClose: () => void; onUpload: () => void }) {
  return <div className="modal-backdrop"><Modal className="modal search-modal" label={`Rechercher un pictogramme ${bankName(bank)}`} onClose={onClose}>
    <div className="modal-head"><div><span className="eyebrow">Ajouter dans la case sélectionnée</span><h2>Quel pictogramme ?</h2></div><button className="icon-button" aria-label="Fermer la recherche" onClick={onClose}><X size={19} /></button></div>
    <div className="search-row"><div className="search-input-wrap"><Search size={18} /><input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }} aria-label="Mot à rechercher" placeholder="Rechercher en français…" /></div><button className="primary-button" onClick={onSearch} disabled={state === 'loading'}>{state === 'loading' ? 'Recherche…' : 'Rechercher'}</button></div>
    <div className="search-source"><span className="source-dot" /> Résultats {bankName(bank)} <span>·</span> <button onClick={onUpload}><Upload size={14} /> Importer une photo</button></div>
    <label className="quick-entry"><input type="checkbox" checked={advance} onChange={(event) => setAdvance(event.target.checked)} />Passer à la prochaine case vide</label>
    {bank === 'arasaac' && <p className="tool-information">Le mot recherché est envoyé au service ARASAAC.</p>}
    {state === 'error' && <div className="inline-error" role="alert">{error}</div>}
    {state === 'idle' && !results.length && term && <div className="empty-results"><Search size={27} /><strong>Aucun résultat pour « {term} »</strong><span>Vérifiez l’orthographe ou essayez un mot plus général.</span></div>}
    {state === 'idle' && !results.length && !term && <div className="search-start"><Sparkles size={28} /><p>Recherchez un mot pour voir les pictogrammes disponibles.</p></div>}
    {state === 'loading' && <div className="result-grid loading-grid">{Array.from({ length: 6 }, (_, index) => <div className="result-skeleton" key={index} />)}</div>}
    {results.length > 0 && <div className="result-grid">{results.map((result) => <button className="result-card" key={result.id} onClick={() => onChoose(result)}><img loading="lazy" src={result.imageUrl} alt="" /><span>{result.label}</span><small>{bankName(bank)} #{result.id}</small></button>)}</div>}
    <div className="arasaac-note">{bank === 'sclera' ? 'Pictogrammes : www.sclera.be · CC BY-NC 2.0 BE. Usage non commercial.' : bank === 'makaton' ? 'Pictogrammes Makaton — Niveau 1, fichiers fournis par l’utilisateur.' : 'Pictogrammes ARASAAC · CC BY-NC-SA.'} La mention de crédit sera conservée dans le PDF.</div>
  </Modal></div>
}

export default App
