import { useEffect, useRef, useState } from 'react'
import {
  Archive, ArrowDownToLine, Check, ChevronDown, FilePlus2, Folder, Grid2X2, ImagePlus, LayoutGrid, Menu, Mic, Pencil, Plus, Redo2, Search, Share2, Sparkles, Trash2, Undo2, Upload, X,
} from 'lucide-react'
import { createEmptyBoard, categoryColors, type Board, type Cell, type FitzgeraldCategory, type PictogramResult } from './types'
import { moveOrSwapCells, placeWords, resizeBoard } from './domain/layout'
import { suggestFolderId } from './domain/classification'
import { searchPictograms } from './services/arasaac'
import { boardRepository, folderRepository } from './services/storage'
import { exportBoardPdf } from './services/pdf'
import './App.css'

const sampleFolders = [
  { id: 'art', name: 'Art plastique' },
  { id: 'peinture', name: 'Peinture', parentId: 'art' },
  { id: 'pate', name: 'Pâte à modeler', parentId: 'art' },
  { id: 'cuisine', name: 'Cuisine' },
  { id: 'piscine', name: 'Piscine' },
]

type BatchProposal = { word: string; result?: PictogramResult; state: 'waiting' | 'loading' | 'ready' | 'empty' | 'error' }
type LibraryFilter = 'recent' | 'drafts' | 'favorites' | string

function App() {
  const [board, setBoard] = useState<Board>(() => createEmptyBoard())
  const [history, setHistory] = useState<Board[]>([])
  const [future, setFuture] = useState<Board[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [folders, setFolders] = useState(sampleFolders)
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('recent')
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'none' | 'search' | 'list' | 'preview'>('none')
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<PictogramResult[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saving')
  const [mobileNav, setMobileNav] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [listText, setListText] = useState('manger\nboire\nassiette\ncouteau\nfourchette\nserviette')
  const [batchProposals, setBatchProposals] = useState<BatchProposal[]>([])
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    void Promise.all([boardRepository.list(), folderRepository.list()]).then(([savedBoards, savedFolders]) => {
      if (savedBoards.length) {
        const latest = [...savedBoards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        setBoard(latest)
        setBoards(savedBoards)
      }
      if (savedFolders.length) setFolders(savedFolders)
      setSaveState('saved')
    }).catch(() => setSaveState('error'))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      const next = { ...board, updatedAt: new Date().toISOString() }
      void boardRepository.save(next).then(() => {
        setBoards((current) => [...current.filter((item) => item.id !== next.id), next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setSaveState('saved')
      }).catch(() => setSaveState('error'))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [board])

  const updateBoard = (next: Board) => {
    setHistory((current) => [...current.slice(-30), board])
    setFuture([])
    setBoard(next)
  }

  const updateCell = (cellId: string, patch: Partial<Cell>) => updateBoard({ ...board, cells: board.cells.map((cell) => cell.id === cellId ? { ...cell, ...patch } : cell) })
  const selectedCell = board.cells.find((cell) => cell.id === selectedCellId)
  const libraryBoards = boards.some((item) => item.id === board.id) ? boards : [...boards, board]
  const visibleBoards = libraryBoards
    .filter((item) => libraryFilter === 'recent' || (libraryFilter === 'drafts' && item.status === 'draft') || (libraryFilter === 'favorites' && item.cells.some((cell) => cell.favorite)) || item.folderId === libraryFilter)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, libraryFilter === 'recent' ? 2 : 8)
  const libraryLabel = libraryFilter === 'recent' ? 'TLA récents' : libraryFilter === 'drafts' ? 'Brouillons' : libraryFilter === 'favorites' ? 'Favoris' : folders.find((folder) => folder.id === libraryFilter)?.name ?? 'Documents'
  const openSavedBoard = (savedBoard: Board) => {
    setBoard(savedBoard)
    setHistory([])
    setFuture([])
    setSelectedCellId(null)
    setPanel('none')
    setMobileNav(false)
  }

  const openSearch = (cellId: string) => {
    setSelectedCellId(cellId); setSearchTerm(board.cells.find((cell) => cell.id === cellId)?.label ?? ''); setResults([]); setSearchState('idle'); setPanel('search'); setError('')
  }

  const runSearch = async (term = searchTerm) => {
    if (!term.trim()) return
    searchAbort.current?.abort()
    searchAbort.current = new AbortController()
    setSearchState('loading'); setError('')
    try { setResults(await searchPictograms(term, searchAbort.current.signal)); setSearchState('idle') } catch (cause) {
      if ((cause as Error).name !== 'AbortError') { setSearchState('error'); setError(navigator.onLine ? 'Le service ARASAAC ne répond pas pour le moment.' : 'Recherche indisponible hors connexion. Les tableaux locaux restent accessibles.') }
    }
  }

  const choosePictogram = (result: PictogramResult) => {
    if (!selectedCellId) return
    const lower = `${result.label} ${searchTerm}`.toLocaleLowerCase('fr-FR')
    const category: FitzgeraldCategory = /manger|boire|faire|aller|prendre/.test(lower) ? 'verbs' : /je|tu|il|elle|nous|vous/.test(lower) ? 'people' : 'nouns'
    updateCell(selectedCellId, { source: 'arasaac', pictogramId: result.id, imageData: result.imageUrl, label: searchTerm || result.label, searchTerm, category })
    setPanel('none')
  }

  const createBoard = () => { const next = createEmptyBoard(board.rows, board.columns); updateBoard(next); setSelectedCellId(null); setPanel('none') }
  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const folder = { id: crypto.randomUUID(), name }
    await folderRepository.save(folder)
    setFolders((current) => [...current, folder])
    setNewFolderName('')
    setIsCreatingFolder(false)
  }
  const renameFolder = async (folder: typeof folders[number]) => {
    const name = window.prompt('Nouveau nom du dossier', folder.name)?.trim()
    if (!name || name === folder.name) return
    const renamed = { ...folder, name }
    await folderRepository.save(renamed)
    setFolders((current) => current.map((item) => item.id === folder.id ? renamed : item))
  }
  const removeFolder = async (folder: typeof folders[number]) => {
    const count = boards.filter((item) => item.folderId === folder.id).length
    if (!window.confirm(count ? `Supprimer « ${folder.name} » ? ${count} TLA seront déplacés sans être supprimés.` : `Supprimer « ${folder.name} » ?`)) return
    const affected = boards.filter((item) => item.folderId === folder.id).map((item) => ({ ...item, folderId: undefined }))
    await Promise.all(affected.map((item) => boardRepository.save(item)))
    await folderRepository.remove(folder.id)
    setBoards((current) => current.map((item) => affected.find((updated) => updated.id === item.id) ?? item))
    if (board.folderId === folder.id) setBoard((current) => ({ ...current, folderId: undefined }))
    setFolders((current) => current.filter((item) => item.id !== folder.id))
    if (libraryFilter === folder.id) setLibraryFilter('recent')
  }
  const changeSize = (value: string) => { const [columns, rows] = value.split('x').map(Number); updateBoard(resizeBoard(board, rows, columns)) }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((current) => [...current, board]); setBoard(previous); setHistory((current) => current.slice(0, -1)) }
  const redo = () => { const next = future.at(-1); if (!next) return; setHistory((current) => [...current, board]); setBoard(next); setFuture((current) => current.slice(0, -1)) }
  const normalizeList = () => listText.split(/[\n,;]+/).map((word) => word.trim()).filter(Boolean)
  const loadBatchProposals = async () => {
    const words = normalizeList()
    if (!words.length) return
    setBatchState('loading')
    setBatchProposals(words.map((word) => ({ word, state: 'waiting' })))
    const proposals = await Promise.all(words.map(async (word): Promise<BatchProposal> => {
      setBatchProposals((current) => current.map((item) => item.word === word ? { ...item, state: 'loading' } : item))
      try {
        const results = await searchPictograms(word)
        return { word, result: results[0], state: results.length ? 'ready' : 'empty' }
      } catch {
        return { word, state: 'error' }
      }
    }))
    setBatchProposals(proposals)
    setBatchState('ready')
  }

  const generateList = () => {
    const proposals: BatchProposal[] = batchProposals.length ? batchProposals : normalizeList().map((word) => ({ word, state: 'empty' }))
    const next = placeWords(board, proposals.map((proposal) => proposal.word))
    const cells = next.cells.map((cell, index) => {
      const proposal = proposals[index]
      if (!proposal?.result) return cell
      const lower = `${proposal.word} ${proposal.result.label}`.toLocaleLowerCase('fr-FR')
      const category: FitzgeraldCategory = /manger|boire|faire|aller|prendre/.test(lower) ? 'verbs' : /je|tu|il|elle|nous|vous/.test(lower) ? 'people' : 'nouns'
      return { ...cell, source: 'arasaac' as const, pictogramId: proposal.result.id, imageData: proposal.result.imageUrl, label: proposal.word, searchTerm: proposal.word, category }
    })
    updateBoard({ ...next, cells })
    setPanel('none')
    setBatchProposals([])
    setBatchState('idle')
  }

  const classifyAutomatically = () => {
    const folderId = suggestFolderId(board, folders)
    if (!folderId) {
      setError('Aucun thème reconnu : choisissez un dossier manuellement.')
      return
    }
    updateBoard({ ...board, folderId })
    setError('Classement automatique appliqué.')
  }

  const importImage = (file: File) => {
    if (!selectedCellId) return
    const reader = new FileReader()
    reader.onload = () => updateCell(selectedCellId, { source: 'upload', imageData: String(reader.result), imageMime: file.type, label: selectedCell?.label || file.name.replace(/\.[^.]+$/, ''), category: 'other' })
    reader.readAsDataURL(file)
  }

  const toggleSpeech = () => {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => { lang: string; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null } }).SpeechRecognition
    if (!SpeechRecognition) { setError('La dictée n’est pas disponible dans ce navigateur. Utilisez le clavier.'); return }
    if (isSpeaking) { setIsSpeaking(false); return }
    const recognition = new SpeechRecognition(); recognition.lang = 'fr-FR'; setIsSpeaking(true)
    recognition.onresult = (event) => { const transcript = event.results[0][0].transcript; setSearchTerm(transcript); void runSearch(transcript) }
    recognition.onend = () => setIsSpeaking(false); recognition.onerror = () => { setError('Micro refusé ou reconnaissance indisponible.'); setIsSpeaking(false) }; recognition.start()
  }

  const printBoard = async () => {
    if (!sheetRef.current) return
    try {
      const blob = await exportBoardPdf(sheetRef.current, board, false)
      const frame = document.createElement('iframe')
      const url = URL.createObjectURL(blob)
      frame.title = 'Aperçu d’impression'
      frame.style.position = 'fixed'
      frame.style.width = '1px'
      frame.style.height = '1px'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.border = '0'
      frame.onload = () => {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
        window.setTimeout(() => { URL.revokeObjectURL(url); frame.remove() }, 1000)
      }
      frame.src = url
      document.body.appendChild(frame)
    } catch {
      setError('L’impression du PDF a échoué. Utilisez Télécharger le PDF puis imprimez le fichier.')
    }
  }
  const downloadBoard = async () => {
    if (!sheetRef.current) return
    try {
      await exportBoardPdf(sheetRef.current, board, true)
    } catch {
      setError('Le téléchargement du PDF a échoué. Vérifiez la connexion aux images puis réessayez.')
    }
  }
  const shareBoard = async () => {
    if (!sheetRef.current) return
    const blob = await exportBoardPdf(sheetRef.current, board, false)
    const file = new File([blob], `${board.title}.pdf`, { type: 'application/pdf' })
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ files: [file], title: board.title })
    else { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setError('Le partage natif n’est pas disponible : le PDF a été téléchargé.') }
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
      <div className="brand"><div className="brand-mark"><Grid2X2 size={18} /></div><span>TLA<span className="brand-soft">·</span>studio</span></div>
      <div className="topbar-divider" />
      <div className="save-status"><span className={`status-dot ${saveState}`} />{saveState === 'saved' ? 'Enregistré sur cet appareil' : saveState === 'error' ? 'Sauvegarde impossible' : 'Enregistrement…'}</div>
      <div className="top-actions">
        <button className="toolbar-button" onClick={() => setPanel('list')}><Sparkles size={16} /> Générer une liste</button>
        <button className="icon-button" title="Annuler" aria-label="Annuler" onClick={undo} disabled={!history.length}><Undo2 size={18} /></button>
        <button className="icon-button" title="Rétablir" aria-label="Rétablir" onClick={redo} disabled={!future.length}><Redo2 size={18} /></button>
        <button className="toolbar-button" onClick={() => setPanel('preview')}><LayoutGrid size={16} /> Aperçu</button>
        <button className="toolbar-button secondary" onClick={() => void shareBoard()}><Share2 size={16} /> Partager</button>
        <button className="primary-button" onClick={() => void printBoard()}><ArrowDownToLine size={16} /> Imprimer</button>
      </div>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header"><span>Bibliothèque</span><button className="icon-button close-mobile" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
        <button className="new-board" onClick={createBoard}><FilePlus2 size={17} /> Nouveau TLA <span className="shortcut">⌘ N</span></button>
        <nav className="main-nav"><button className={`nav-item ${libraryFilter === 'recent' ? 'active' : ''}`} onClick={() => setLibraryFilter('recent')}><Sparkles size={17} /> Récents <span className="nav-count">{libraryBoards.length}</span></button><button className="nav-item" onClick={() => { setPanel('list'); setMobileNav(false) }}><Sparkles size={17} /> Générer depuis une liste</button><button className={`nav-item ${libraryFilter === 'drafts' ? 'active' : ''}`} onClick={() => setLibraryFilter('drafts')}><Archive size={17} /> Brouillons</button><button className={`nav-item ${libraryFilter === 'favorites' ? 'active' : ''}`} onClick={() => setLibraryFilter('favorites')}><span className="star-icon">★</span> Favoris</button></nav>
        <div className="sidebar-section"><div className="section-label">Dossiers <button className="mini-button" title="Ajouter un dossier" aria-label="Ajouter un dossier" onClick={() => setIsCreatingFolder(true)}><Plus size={15} /></button></div>{isCreatingFolder && <form className="new-folder-form" onSubmit={(event) => { event.preventDefault(); void createFolder() }}><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Nom du dossier" aria-label="Nom du dossier" /><button type="submit" disabled={!newFolderName.trim()}><Check size={14} /></button><button type="button" onClick={() => { setIsCreatingFolder(false); setNewFolderName('') }}><X size={14} /></button></form>}{folders.map((folder) => <div className={`folder-row ${folder.parentId ? 'nested' : ''}`} key={folder.id}><button className={`folder-item ${libraryFilter === folder.id ? 'selected' : ''}`} onClick={() => { setLibraryFilter(folder.id); setMobileNav(false) }}><Folder size={15} />{folder.name}</button><span className="folder-actions"><button title={`Renommer ${folder.name}`} aria-label={`Renommer ${folder.name}`} onClick={() => void renameFolder(folder)}><Pencil size={12} /></button><button title={`Supprimer ${folder.name}`} aria-label={`Supprimer ${folder.name}`} onClick={() => void removeFolder(folder)}><Trash2 size={12} /></button></span></div>)}</div>
        <div className="saved-boards"><div className="saved-boards-heading"><span>{libraryLabel}</span><small>{visibleBoards.length}</small></div>{visibleBoards.length ? visibleBoards.map((savedBoard) => <button className={`saved-board ${savedBoard.id === board.id ? 'current' : ''}`} key={savedBoard.id} onClick={() => openSavedBoard(savedBoard)}><span className="saved-board-icon"><LayoutGrid size={14} /></span><span className="saved-board-copy"><strong>{savedBoard.title}</strong><small>{savedBoard.columns} × {savedBoard.rows} · {new Date(savedBoard.updatedAt).toLocaleDateString('fr-FR')}</small></span></button>) : <p className="saved-empty">Aucun TLA dans cette vue. Les données restent propres à chaque navigateur.</p>}</div>
        <div className="sidebar-footer"><div className="local-note"><span className="local-icon"><Check size={13} /></span><div><strong>Local à cet appareil</strong><small>Vos données restent privées</small></div></div></div>
      </aside>
      {mobileNav && <button className="scrim" aria-label="Fermer le menu" onClick={() => setMobileNav(false)} />}
      <main className="main-content">
        <div className="editor-header"><div><div className="eyebrow">Brouillon · A4 paysage</div><input className="title-input" value={board.title} onChange={(event) => updateBoard({ ...board, title: event.target.value })} aria-label="Titre du TLA" /></div><div className="editor-tools"><label className="select-control"><span>Grille</span><select value={`${board.columns}x${board.rows}`} onChange={(event) => changeSize(event.target.value)}><option value="5x4">5 × 4</option><option value="6x4">6 × 4</option><option value="4x3">4 × 3</option><option value="6x5">6 × 5</option></select><ChevronDown size={14} /></label><label className="select-control folder-control"><span>Dossier</span><select aria-label="Dossier du TLA" value={board.folderId ?? ''} onChange={(event) => updateBoard({ ...board, folderId: event.target.value || undefined })}><option value="">Sans dossier</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><ChevronDown size={14} /></label><button className="toolbar-button auto-classify" title="Proposer un dossier selon le titre et les mots" onClick={classifyAutomatically}><Sparkles size={14} /> Classer</button></div></div>
        {error && <div className="notice error-notice"><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
        <div className="canvas-wrap"><div className="sheet" ref={sheetRef}><div className="sheet-heading"><h1>{board.title}</h1><span className="sheet-format">A4 · paysage</span></div><div className="grid" style={{ gridTemplateColumns: `repeat(${board.columns}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)` }}>{board.cells.map((cell) => <CellCard key={cell.id} cell={cell} onOpen={() => openSearch(cell.id)} onEdit={(patch) => updateCell(cell.id, patch)} onDragStart={() => setDraggedId(cell.id)} onDrop={() => { if (draggedId) updateBoard(moveOrSwapCells(board, draggedId, cell.id)); setDraggedId(null) }} onDelete={() => updateCell(cell.id, { source: null, imageData: undefined, pictogramId: undefined, label: '', favorite: false })} />)}</div><div className="credit">Pictogrammes ARASAAC · CC BY-NC-SA</div></div></div>
        {board.overflowWords.length > 0 && <div className="overflow-notice"><strong>{board.overflowWords.length} mot{board.overflowWords.length > 1 ? 's' : ''} en attente</strong><span>{board.overflowWords.join(' · ')}</span><button onClick={() => setPanel('list')}>Revoir la sélection</button></div>}
        <div className="bottom-hint"><span><span className="key-hint">+</span> Ajouter un pictogramme</span><span>Glissez une case sur une autre pour les permuter</span></div>
      </main>
    </div>
    {panel === 'search' && <SearchPanel term={searchTerm} setTerm={setSearchTerm} results={results} state={searchState} error={error} onSearch={() => void runSearch()} onSpeech={toggleSpeech} speaking={isSpeaking} onChoose={choosePictogram} onClose={() => setPanel('none')} onUpload={() => fileInputRef.current?.click()} />}
    {panel === 'list' && <div className="modal-backdrop"><section className="modal list-modal"><div className="modal-head"><div><span className="eyebrow">Création en lot</span><h2>Générer depuis une liste</h2></div><button className="icon-button" onClick={() => setPanel('none')}><X size={19} /></button></div><p className="modal-intro">Un mot par ligne ou séparé par une virgule. Chaque mot est recherché sur ARASAAC : le mot saisi restera la légende, avec une proposition de pictogramme modifiable ensuite.</p><textarea value={listText} onChange={(event) => { setListText(event.target.value); setBatchProposals([]); setBatchState('idle') }} rows={6} autoFocus /><div className="list-meta"><span>{normalizeList().length} mots détectés</span><button className="text-button" onClick={toggleSpeech}><Mic size={15} /> Dictée manuelle</button></div>{batchState === 'idle' && <button className="proposal-button" onClick={() => void loadBatchProposals()}><Search size={16} /> Rechercher les pictogrammes proposés</button>}{batchState !== 'idle' && <div className="batch-proposals"><div className="proposal-heading"><strong>Propositions ARASAAC</strong><span>{batchState === 'loading' ? 'Recherche en cours…' : 'Vérifiez les choix avant insertion'}</span></div>{batchProposals.map((proposal) => <div className="proposal-row" key={proposal.word}><span className="proposal-word">{proposal.word}</span>{proposal.state === 'loading' && <span className="proposal-status">Recherche…</span>}{proposal.state === 'empty' && <span className="proposal-status muted">Aucun résultat</span>}{proposal.state === 'error' && <span className="proposal-status error">Indisponible</span>}{proposal.result && <><img src={proposal.result.imageUrl} alt="" /><span className="proposal-label">{proposal.result.label}</span><span className="proposal-hint">modifiable après insertion</span></>}</div>)}</div>}<div className="modal-actions"><button className="toolbar-button secondary" onClick={() => setPanel('none')}>Annuler</button><button className="primary-button" disabled={batchState !== 'ready'} onClick={generateList}><Sparkles size={16} /> Insérer les propositions</button></div></section></div>}
    {panel === 'preview' && <div className="modal-backdrop"><section className="preview-modal"><div className="modal-head"><div><span className="eyebrow">Sortie fidèle à l’impression</span><h2>Aperçu {board.pageSize}</h2></div><button className="icon-button" onClick={() => setPanel('none')}><X size={19} /></button></div><div className="preview-frame"><div className="preview-sheet"><div className="sheet-heading"><h1>{board.title}</h1><span className="sheet-format">A4 · paysage</span></div><div className="grid" style={{ gridTemplateColumns: `repeat(${board.columns}, 1fr)`, gridTemplateRows: `repeat(${board.rows}, 1fr)` }}>{board.cells.map((cell) => <CellCard key={cell.id} cell={cell} onOpen={() => undefined} onEdit={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDelete={() => undefined} preview />)}</div><div className="credit">Pictogrammes ARASAAC · CC BY-NC-SA</div></div></div><div className="modal-actions"><button className="toolbar-button secondary" onClick={() => setPanel('none')}>Retour à l’édition</button><button className="primary-button" onClick={() => void downloadBoard()}><ArrowDownToLine size={16} /> Télécharger le PDF</button></div></section></div>}
    <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importImage(file); event.target.value = '' }} />
  </div>
}

function CellCard({ cell, onOpen, onEdit, onDragStart, onDrop, onDelete, preview = false }: { cell: Cell; onOpen: () => void; onEdit: (patch: Partial<Cell>) => void; onDragStart: () => void; onDrop: () => void; onDelete: () => void; preview?: boolean }) {
  return <article className={`cell-card ${cell.label ? 'filled' : 'empty'} ${cell.favorite ? 'is-favorite' : ''}`} style={{ borderColor: cell.label ? cell.colorOverride ?? categoryColors[cell.category] : undefined }} draggable={Boolean(cell.label) && !preview} onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    {cell.label ? <><button className="cell-main" onClick={onOpen} aria-label={`Modifier ${cell.label}`}>{cell.imageData ? <img src={cell.imageData} alt="" /> : <div className="image-placeholder"><ImagePlus size={25} /></div>}<span>{cell.label}</span></button>{!preview && <div className="cell-actions"><button title="Favori" onClick={() => onEdit({ favorite: !cell.favorite })}>★</button><button title="Effacer" onClick={onDelete}><Trash2 size={13} /></button></div>}</> : <button className="empty-add" onClick={onOpen}><span className="plus-circle"><Plus size={22} /></span><span>Ajouter</span></button>}
  </article>
}

function SearchPanel({ term, setTerm, results, state, error, onSearch, onSpeech, speaking, onChoose, onClose, onUpload }: { term: string; setTerm: (value: string) => void; results: PictogramResult[]; state: 'idle' | 'loading' | 'error'; error: string; onSearch: () => void; onSpeech: () => void; speaking: boolean; onChoose: (result: PictogramResult) => void; onClose: () => void; onUpload: () => void }) {
  return <div className="modal-backdrop"><section className="modal search-modal"><div className="modal-head"><div><span className="eyebrow">Ajouter dans la case sélectionnée</span><h2>Quel pictogramme ?</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="search-row"><div className="search-input-wrap"><Search size={18} /><input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }} placeholder="Rechercher en français…" /><button className={`mic-button ${speaking ? 'listening' : ''}`} title="Dictée manuelle" onClick={onSpeech}><Mic size={17} /></button></div><button className="primary-button" onClick={onSearch} disabled={state === 'loading'}>{state === 'loading' ? 'Recherche…' : 'Rechercher'}</button></div><div className="search-source"><span className="source-dot" /> Résultats réels ARASAAC <span>·</span> <button onClick={onUpload}><Upload size={14} /> Importer une photo</button></div>{state === 'error' && <div className="inline-error">{error}</div>}{state === 'idle' && !results.length && term && <div className="empty-results"><Search size={27} /><strong>Aucun résultat pour « {term} »</strong><span>Vérifiez l’orthographe ou essayez un mot plus général.</span></div>}{state === 'idle' && !results.length && !term && <div className="search-start"><Sparkles size={28} /><p>Recherchez un mot pour voir les pictogrammes disponibles.</p></div>}{state === 'loading' && <div className="result-grid loading-grid">{Array.from({ length: 6 }, (_, index) => <div className="result-skeleton" key={index} />)}</div>}{results.length > 0 && <div className="result-grid">{results.map((result) => <button className="result-card" key={result.id} onClick={() => onChoose(result)}><img src={result.imageUrl} alt="" /><span>{result.label}</span><small>ARASAAC #{result.id}</small></button>)}</div>}<div className="arasaac-note">Les pictogrammes ARASAAC sont utilisés selon leurs conditions de licence. La mention de crédit sera conservée dans le PDF.</div></section></div>
}

export default App
