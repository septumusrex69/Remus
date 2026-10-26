import { useEffect, useState, type InputHTMLAttributes } from 'react'

/**
 * A number box that behaves the way people expect on an iPad (Stephan, 26 Oct 2026: "there's a
 * 032, I can't take out the zero").
 *
 * A plain <input type="number"> bound to a number keeps whatever was typed after the 0 that was
 * already there, so typing 32 into a box showing 0 leaves "032" on screen. Here the box keeps its
 * own text: a leading zero is dropped as you type (0.5 stays 0.5), tapping in selects the number
 * so typing replaces it, and an emptied box means 0 without forcing a "0" back in while you type.
 *
 * `prefix` / `suffix` draw "R" or "%" inside the box, so it is plain what the number is.
 */
type NumInputProps = {
  value: number | null | undefined
  prefix?: string
  suffix?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'> &
  (
    | { allowEmpty?: false; onValue: (n: number) => void }
    /** An empty box means "not filled in" (null), e.g. a slip's VAT left for Remus to work out. */
    | { allowEmpty: true; onValue: (n: number | null) => void }
  )

export function NumInput(props: NumInputProps) {
  const { value, prefix, suffix, allowEmpty = false, className = '', onValue: given, ...rest } = props
  const onValue = given as (n: number | null) => void
  const show = (v: number | null | undefined) => (allowEmpty && (v === null || v === undefined) ? '' : fmt(v))
  const [text, setText] = useState(show(value))
  // Follow changes made elsewhere (Set markup, a picked rate), but never fight the person typing.
  useEffect(() => {
    setText((t) => {
      if (allowEmpty && (value === null || value === undefined)) return t === '' ? t : ''
      return t !== '' && Number(t) === Number(value ?? 0) ? t : show(value)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowEmpty])

  const input = (
    <input
      {...rest}
      type="text"
      inputMode={rest.inputMode ?? 'decimal'}
      className={`input ${prefix ? 'pl-6' : ''} ${suffix ? 'pr-6' : ''} ${className}`}
      value={text}
      onFocus={(e) => {
        e.currentTarget.select()
        rest.onFocus?.(e)
      }}
      onChange={(e) => {
        // Digits, one decimal point, a leading minus; anything else is ignored.
        let t = e.target.value.replace(/,/g, '.').replace(/[^\d.-]/g, '')
        t = t.replace(/(?!^)-/g, '').replace(/(\..*)\./g, '$1')
        t = t.replace(/^(-?)0+(?=\d)/, '$1')
        setText(t)
        const n = Number(t)
        if (t !== '' && t !== '-' && t !== '.' && Number.isFinite(n)) onValue(n)
        else if (t === '') onValue(allowEmpty ? null : 0)
      }}
      onBlur={(e) => {
        setText(allowEmpty && (text === '' || text === '-' || text === '.') ? '' : fmt(Number(text || 0)))
        rest.onBlur?.(e)
      }}
    />
  )
  if (!prefix && !suffix) return input
  return (
    <span className="relative block">
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-400">{prefix}</span>}
      {input}
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-400">{suffix}</span>}
    </span>
  )
}

function fmt(v: number | null | undefined): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? String(n) : '0'
}
