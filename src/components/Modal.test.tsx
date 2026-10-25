// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from './Modal'

afterEach(() => { cleanup(); document.body.style.overflow = ''; vi.restoreAllMocks() })

describe('Modal', () => {
  it('nomme le dialogue, place le focus et restaure le déclencheur après Échap', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const close = vi.fn()
    const { unmount } = render(<Modal label="Rechercher un pictogramme" onClose={close}><input aria-label="Mot" autoFocus /><button>Fermer</button></Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Rechercher un pictogramme' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Mot' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    unmount()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
    trigger.remove()
  })

  it('maintient Tab et Maj+Tab dans les contrôles visibles, même après un nouveau rendu', () => {
    const previousClose = vi.fn()
    const nextClose = vi.fn()
    const content = <><button>Premier</button><button hidden>Invisible</button><button disabled>Désactivé</button><button>Dernier</button></>
    const { rerender } = render(<Modal label="Modifier" onClose={previousClose}>{content}</Modal>)
    const first = screen.getByRole('button', { name: 'Premier' })
    const last = screen.getByRole('button', { name: 'Dernier' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    rerender(<Modal label="Modifier" onClose={nextClose}>{content}</Modal>)
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(previousClose).not.toHaveBeenCalled()
    expect(nextClose).toHaveBeenCalledOnce()
  })

  it('garde le focus dans un dialogue vide et empêche son déplacement vers le fond', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    const { unmount } = render(<Modal label="Préparation" onClose={() => undefined}>Patientez</Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Préparation' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
    outside.focus()
    expect(document.activeElement).toBe(dialog)
    unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
