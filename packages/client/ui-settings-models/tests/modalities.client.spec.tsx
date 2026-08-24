// @vitest-environment jsdom
/** Input-modality capsules: the declaration helpers and their two editor seats. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MODALITIES,
  ModalityChips,
  modalitiesOf,
  modalityOn,
  toggleModality,
} from '../src/client/ModalityChips.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { DeepSeekModelsEditor } from '../src/client/DeepSeekModelsEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** Open one row's advanced fold (1-based, as the aria labels read). */
function expandRow(position: number): void {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${String(position)}`))
}

describe('modalitiesOf', () => {
  it('reads only string arrays', () => {
    expect(modalitiesOf({}, 'input')).toBeUndefined()
    expect(modalitiesOf({ input: ['text', 'image'] }, 'input')).toEqual(['text', 'image'])
    expect(modalitiesOf({ input: 'text' }, 'input')).toBeUndefined()
    expect(modalitiesOf({ input: ['text', 7] }, 'input')).toEqual(['text'])
  })
})

describe('modalityOn', () => {
  it('answers the text-only default for an undeclared row', () => {
    expect(modalityOn(undefined, 'text')).toBe(true)
    expect(modalityOn(undefined, 'image')).toBe(false)
  })

  it('reads an explicit declaration', () => {
    expect(modalityOn(['text', 'image'], 'image')).toBe(true)
    expect(modalityOn(['text'], 'image')).toBe(false)
  })
})

describe('toggleModality', () => {
  it('declares vision explicitly and undeclares back to the default', () => {
    expect(toggleModality(undefined, 'image')).toEqual(['text', 'image'])
    expect(toggleModality(['text'], 'image')).toEqual(['text', 'image'])
    expect(toggleModality(['text', 'image'], 'image')).toBeUndefined()
  })

  it('repairs an image-only declaration instead of toggling into empty', () => {
    expect(toggleModality(['image'], 'image')).toBeUndefined()
    expect(toggleModality(['image'], 'text')).toEqual(['text', 'image'])
  })

  it('keeps a declaration whose text floor is already on', () => {
    expect(toggleModality(['text'], 'text')).toEqual(['text'])
    expect(toggleModality(undefined, 'text')).toBeUndefined()
  })
})

describe('ModalityChips', () => {
  it('locks the text floor on and toggles image', () => {
    const onChange = vi.fn()
    render(<ModalityChips
      value={undefined}
      onChange={onChange}
      disabled={false}
      ariaLabel={`${en.modelInputModalities} 1`}
      t={t}
    />)
    const text = screen.getByLabelText(`${en.modelInputModalities} 1 text`)
    const image = screen.getByLabelText(`${en.modelInputModalities} 1 image`)
    expect(text).toHaveProperty('disabled', true)
    expect(image).toHaveProperty('disabled', false)
    expect(image.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(image)
    expect(onChange).toHaveBeenCalledWith(['text', 'image'])
  })

  it('disables both chips when the editor is disabled', () => {
    render(<ModalityChips
      value={['text', 'image']}
      onChange={vi.fn()}
      disabled={true}
      ariaLabel={`${en.modelInputModalities} 1`}
      t={t}
    />)
    expect(screen.getByLabelText(`${en.modelInputModalities} 1 image`)).toHaveProperty('disabled', true)
  })

  it('names both modalities, in order', () => {
    expect(MODALITIES).toEqual(['text', 'image'])
  })
})

describe('editor seats', () => {
  it('writes input on a pi-ai row and drops the key on a second click', () => {
    const onChange = vi.fn()
    render(<ModelListEditor
      models={[{ id: 'acme-large' }]}
      onChange={onChange}
      probe={{ settingsNs: 'llm-pi-ai' }}
      api={{ llm: { discoverModels: vi.fn() } } as never}
      t={t}
      disabled={false}
    />)
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.modelInputModalities} 1 image`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'acme-large', input: ['text', 'image'] }])

    onChange.mockClear()
    cleanup()
    render(<ModelListEditor
      models={[{ id: 'acme-large', input: ['text', 'image'] }]}
      onChange={onChange}
      probe={{ settingsNs: 'llm-pi-ai' }}
      api={{ llm: { discoverModels: vi.fn() } } as never}
      t={t}
      disabled={false}
    />)
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.modelInputModalities} 1 image`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'acme-large' }])
  })

  it('writes inputModalities on a DeepSeek catalog row', () => {
    const onChange = vi.fn()
    render(<DeepSeekModelsEditor
      models={[{ id: 'deepseek-v4-flash', description: 'hidden' }]}
      overridden={true}
      defaultContextWindow={undefined}
      defaultMaxTokens={undefined}
      t={t}
      disabled={false}
      onChange={onChange}
      onReset={vi.fn()}
    />)
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.modelInputModalities} 1 image`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'deepseek-v4-flash', description: 'hidden', inputModalities: ['text', 'image'] },
    ])
  })
})
