// Reproductions de constats d'audit au 25/10/2026.
// Les assertions décrivent volontairement les défaillances actuelles.
// Exécution via audit/reproductions-2026-10-25.config.mts, hors suite habituelle.
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createEmptyBoard, type Board } from '../src/types'
import { isBackupData, readBackupFile } from '../src/services/backup'
import JSZip from 'jszip'
const repos=vi.hoisted(()=>({boards:{list:vi.fn(),save:vi.fn().mockResolvedValue(undefined),remove:vi.fn(),restore:vi.fn()},folders:{list:vi.fn(),save:vi.fn(),remove:vi.fn()}}))
vi.mock('../src/services/storage',()=>({boardRepository:repos.boards,folderRepository:repos.folders}))
vi.mock('../src/services/pdf',()=>({exportBoardPdf:vi.fn()}))
import App from '../src/App'
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks()})
it('reproduction: une suppression échouée désactive les prochains autosaves',async()=>{
const board={...createEmptyBoard(),title:'Audit',createdAt:'2020-01-01T00:00:00Z'};
repos.boards.list.mockResolvedValue([board]);repos.folders.list.mockResolvedValue([]);repos.boards.remove.mockRejectedValue(new Error('AbortError'));
vi.spyOn(window,'confirm').mockReturnValue(true);
render(React.createElement(App));
await screen.findByRole('textbox',{name:'Titre du TLA 1'});
fireEvent.change(screen.getByRole('textbox',{name:'Titre du TLA 1'}),{target:{value:'Avant suppression'}});
await waitFor(()=>expect(repos.boards.save).toHaveBeenCalledWith(expect.objectContaining({id:board.id,title:'Avant suppression'})));
fireEvent.click(screen.getByRole('button',{name:'Supprimer le TLA 1 : Avant suppression'}));
await screen.findByText('Impossible de supprimer « Avant suppression ». Réessaie.');
repos.boards.save.mockClear();
fireEvent.change(screen.getByRole('textbox',{name:'Titre du TLA 1'}),{target:{value:'Changement perdu'}});
await new Promise(resolve=>setTimeout(resolve,50));
expect(repos.boards.save).not.toHaveBeenCalled();
expect((screen.getByRole('textbox',{name:'Titre du TLA 1'}) as HTMLInputElement).value).toBe('Changement perdu');
})

it('reproduction: import photo asynchrone rétablit un ancien titre',async()=>{
const board={...createEmptyBoard(),title:'Avant photo',createdAt:'2020-01-01T00:00:00Z'};
board.cells[0].label='Photo';
repos.boards.list.mockResolvedValue([board]);repos.folders.list.mockResolvedValue([]);
const reader={result:'data:image/png;base64,aGVsbG8=',onload:null as (()=>void)|null,readAsDataURL(){}};
vi.stubGlobal('FileReader',function(){return reader});
render(React.createElement(App));
await screen.findByRole('textbox',{name:'Titre du TLA 1'});
fireEvent.click(screen.getByRole('button',{name:'Sélectionner PHOTO',exact:true}));
fireEvent.change(document.querySelector('input[accept="image/*"]')!,{target:{files:[new File(['hello'],'photo.png',{type:'image/png'})]}});
fireEvent.change(screen.getByRole('textbox',{name:'Titre du TLA 1'}),{target:{value:'Titre modifié pendant lecture'}});
expect((screen.getByRole('textbox',{name:'Titre du TLA 1'}) as HTMLInputElement).value).toBe('Titre modifié pendant lecture');
reader?.onload?.();
await waitFor(()=>expect((screen.getByRole('textbox',{name:'Titre du TLA 1'}) as HTMLInputElement).value).toBe('Avant photo'));
await waitFor(()=>expect(repos.boards.save).toHaveBeenCalledWith(expect.objectContaining({id:board.id,title:'Avant photo',cells:expect.arrayContaining([expect.objectContaining({source:'upload'})])})));
})

it.each([
['dimensions négatives', (b:Board)=>({...b,rows:-1,columns:-9})],
['dimensions de 1 000 000', (b:Board)=>({...b,rows:1000000,columns:1000000})],
['grille sans cellules', (b:Board)=>({...b,cells:[]})],
['identifiants et positions de cellule dupliqués', (b:Board)=>({...b,cells:[b.cells[0],b.cells[0]]})],
['URL image externe arbitraire', (b:Board)=>({...b,cells:[{...b.cells[0],source:'upload',imageData:'https://example.invalid/track?user=abc'}]})],
['date invalide', (b:Board)=>({...b,updatedAt:'not-a-date'})],
])('reproduction validation: accepte %s', (_name, transform)=>{
expect(isBackupData({format:'tla-studio-backup',version:1,exportedAt:new Date().toISOString(),boards:[transform(createEmptyBoard())]})).toBe(true)
})

it('reproduction portabilité: restaurer conserve le préfixe URL de l’ancien hébergement', async()=>{
const board=createEmptyBoard();
board.cells[0]={...board.cells[0],label:'Maison',source:'sclera',pictogramId:1,imageData:'/tla-flash/pictograms/sclera/1.png'};
const zip=new JSZip();
zip.file('backup.json',JSON.stringify({format:'tla-studio-backup',version:1,exportedAt:new Date().toISOString(),boards:[board]}));
const blob=await zip.generateAsync({type:'blob'});
const restored=await readBackupFile(new File([blob],'portabilite.zip',{type:'application/zip'}));
expect(restored.boards[0].cells[0].imageData).toBe('/tla-flash/pictograms/sclera/1.png');
})
