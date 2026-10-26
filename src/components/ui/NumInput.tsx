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
export function NumInput({
  value,
  onValue,
  prefix,
  suffix,
  className = '',
  ...rest
}: {
  value: number | null | undefined
  onValue: (n: number) => void
  prefix?: string
  suffix?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'>) {
  const [text, setText] = useState(fmt(value))
  // Follow changes made elsewhere (Set markup, a picked rate), but never fight the person typing.
  useEffect(() => {
    setText((t) => (Number(t || 0) === Number(value ?? 0) ? t : fmt(value)))
  }, [value])

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
        else if (t === '') onValue(0)
      }}
      onBlur={(e) => {
        setText(fmt(Number(text || 0)))
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
