// @vitest-environment jsdom
/**
 * Field-control behavior: what a control renders for a staged draft, how an
 * overridden field offers its reset, and that a control never writes on its own.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretField, SelectField, ToggleField, ValueField } from '../src/client/fields.tsx'

afterEach(cleanup)

const frame = {
  id: 'field',
  label: 'Command timeout',
  hint: 'How long one command may run.',
  overriddenLabel: 'Overridden',
  resetLabel: 'Reset to default',
  invalidLabel: 'Enter a number.',
  disabled: false,
  overridden: false,
  invalid: false,
}

describe('ValueField', () => {
  it('stages every keystroke without writing', () => {
    const onEdit = vi.fn()
    render(<ValueField {...frame} text="60000" onEdit={onEdit} onReset={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Command timeout'), { target: { value: '9000' } })

    expect(onEdit).toHaveBeenCalledWith('9000')
  })

  it('renders the staged text it is given rather than a draft of its own', () => {
    const { rerender } = render(<ValueField {...frame} text="60000" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '60000')

    rerender(<ValueField {...frame} text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '9000')
  })

  it('offers the reset only while an override would stand', () => {
    const onReset = vi.fn()
    const { rerender } = render(<ValueField {...frame} text="9000" onEdit={vi.fn()} onReset={onReset} />)
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

    rerender(<ValueField {...frame} overridden text="9000" onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('replaces the hint with the reason an invalid draft cannot be saved', () => {
    render(<ValueField {...frame} invalid text="soon" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByText('Enter a number.')).toBeTruthy()
    expect(screen.queryByText('How long one command may run.')).toBeNull()
    expect(screen.getByLabelText('Command timeout').getAttribute('aria-invalid')).toBe('true')
  })

  it('hints a numeric keypad and renders a placeholder when asked', () => {
    render(
      <ValueField
        {...frame}
        numeric
        placeholder="https://api.deepseek.com"
        text=""
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Command timeout')

    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input).toHaveProperty('placeholder', 'https://api.deepseek.com')
  })

  it('disables the control and its reset while the document is read-only', () => {
    render(<ValueField {...frame} disabled overridden text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveProperty('disabled', true)
  })
})

describe('ToggleField', () => {
  const toggle = {
    id: 'enabled',
    label: 'Enable this backend',
    hint: 'Off parks this backend.',
    overriddenLabel: 'Overridden',
    resetLabel: 'Reset to default',
    disabled: false,
    overridden: false,
  }

  it('reports the check and uncheck as on/off text', () => {
    const onEdit = vi.fn()
    render(<ToggleField {...toggle} checked={false} onEdit={onEdit} onReset={vi.fn()} />)
    const control = screen.getByLabelText('Enable this backend')

    expect(control).toHaveProperty('checked', false)
    fireEvent.click(control)

    expect(onEdit).toHaveBeenCalledWith('on')
  })

  it('offers the reset only while an override would stand', () => {
    const onReset = vi.fn()
    const { rerender } = render(<ToggleField {...toggle} checked onEdit={vi.fn()} onReset={onReset} />)
    expect(screen.getByLabelText('Enable this backend')).toHaveProperty('checked', true)
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

    rerender(<ToggleField {...toggle} overridden checked onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

    expect(onReset).toHaveBeenCalledOnce()
  })

  it('disables the control while the document is read-only', () => {
    render(<ToggleField {...toggle} disabled checked onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Enable this backend')).toHaveProperty('disabled', true)
  })
})

describe('SelectField', () => {
  const select = {
    id: 'protocol',
    label: 'API protocol',
    hint: 'The wire protocol this endpoint speaks.',
    disabled: false,
    placeholder: 'Default (OpenAI chat completions)',
    options: [
      { value: 'openai-chat', label: 'OpenAI chat completions' },
      { value: 'anthropic', label: 'Anthropic Messages' },
    ],
  }

  it('renders the placeholder first and stages the picked option', () => {
    const onEdit = vi.fn()
    render(<SelectField {...select} value="" onEdit={onEdit} />)
    const control = screen.getByLabelText('API protocol')

    expect(control).toHaveProperty('value', '')
    expect(screen.getByRole('option', { name: 'Default (OpenAI chat completions)' })).toBeTruthy()

    fireEvent.change(control, { target: { value: 'anthropic' } })

    expect(onEdit).toHaveBeenCalledWith('anthropic')
  })

  it('renders the staged value it is given', () => {
    render(<SelectField {...select} value="openai-chat" onEdit={vi.fn()} />)

    expect(screen.getByLabelText('API protocol')).toHaveProperty('value', 'openai-chat')
  })

  it('disables the control while the document is read-only', () => {
    render(<SelectField {...select} disabled value="" onEdit={vi.fn()} />)

    expect(screen.getByLabelText('API protocol')).toHaveProperty('disabled', true)
  })
})

describe('SecretField', () => {
  const secret = {
    id: 'key',
    label: 'API key',
    hint: 'Stored outside the settings file.',
    disabled: false,
  }

  it('stages the draft and never renders it', () => {
    const onEdit = vi.fn()
    render(
      <SecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={onEdit}
      />,
    )
    const input = screen.getByLabelText('API key')

    fireEvent.change(input, { target: { value: 'ds-secret' } })

    expect(onEdit).toHaveBeenCalledWith('ds-secret')
    expect(input).toHaveProperty('type', 'password')
  })

  it('reports the configured state the Host holds', () => {
    const { rerender } = render(
      <SecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText('No key is configured.')).toBeTruthy()

    rerender(
      <SecretField
        {...secret}
        text="ds-secret"
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByText('A key is configured.')).toBeTruthy()
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'ds-secret')
  })

  it('disables the control when it is told to', () => {
    render(
      <SecretField
        {...secret}
        disabled
        text=""
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('API key')).toHaveProperty('disabled', true)
  })
})
