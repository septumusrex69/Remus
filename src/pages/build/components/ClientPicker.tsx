import { useState } from 'react'
import { Plus } from 'lucide-react'
import { companies, contactName, contacts, type ClientDirectory } from '../../../lib/api'
import { Button, Field, Modal } from '../../../components/ui'
import type { ClientRef } from '../../../types'

/**
 * Picks a client: a company (optionally with a contact person at it) or a private individual
 * (a contact with no company). Value shape matches Raptor's company_id/contact_id pair.
 */
export function ClientPicker({
  dir,
  value,
  onChange,
  onCreated,
}: {
  dir: ClientDirectory | null
  value: ClientRef
  onChange: (v: ClientRef) => void
  onCreated?: () => void
}) {
  const [creating, setCreating] = useState(false)
  const companyContacts = dir?.contacts.filter((c) => value.company_id && c.company_id === value.company_id) ?? []
  const individuals = dir?.contacts.filter((c) => !c.company_id) ?? []
  const selectValue = value.company_id ? `co:${value.company_id}` : value.contact_id ? `ct:${value.contact_id}` : ''

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className="input"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value
            if (!v) onChange({ company_id: null, contact_id: null })
            else if (v.startsWith('co:')) onChange({ company_id: v.slice(3), contact_id: null })
            else onChange({ company_id: null, contact_id: v.slice(3) })
          }}
        >
          <option value="">— Select client —</option>
          {dir && dir.companies.length > 0 && (
            <optgroup label="Companies">
              {dir.companies.map((c) => (
                <option key={c.id} value={`co:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
          )}
          {individuals.length > 0 && (
            <optgroup label="Private clients">
              {individuals.map((c) => (
                <option key={c.id} value={`ct:${c.id}`}>{contactName(c)}</option>
              ))}
            </optgroup>
          )}
        </select>
        <Button onClick={() => setCreating(true)} title="New client" aria-label="New client">
          <Plus size={16} />
        </Button>
      </div>
      {value.company_id && companyContacts.length > 0 && (
        <select className="input" value={value.contact_id ?? ''} onChange={(e) => onChange({ ...value, contact_id: e.target.value || null })}>
          <option value="">— Contact person (optional) —</option>
          {companyContacts.map((c) => (
            <option key={c.id} value={c.id}>{contactName(c)}</option>
          ))}
        </select>
      )}
      <NewClientModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(ref) => {
          setCreating(false)
          onCreated?.()
          onChange(ref)
        }}
      />
    </div>
  )
}

export function NewClientModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (ref: ClientRef) => void }) {
  const [kind, setKind] = useState<'company' | 'individual'>('individual')
  const [name, setName] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [vatNo, setVatNo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A company saved on an earlier attempt whose contact person then failed: retries reuse it.
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null)

  function reset() {
    setName(''); setFirst(''); setLast(''); setEmail(''); setPhone(''); setAddress(''); setVatNo('')
    setCreatedCompanyId(null)
    setError(null)
  }

  function cancel() {
    // Don't lose a company that was already saved: hand it back without the contact person.
    const partial = createdCompanyId
    reset()
    if (partial) onSaved({ company_id: partial, contact_id: null })
    else onClose()
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (kind === 'company') {
        if (!name.trim()) throw new Error('Company name is required')
        const fields = { name: name.trim(), email: email || null, phone: phone || null, address: address || null, vat_no: vatNo || null }
        let companyId = createdCompanyId
        if (companyId) await companies.update(companyId, fields)
        else {
          companyId = (await companies.create(fields)).id
          setCreatedCompanyId(companyId)
        }
        let contactId: string | null = null
        if (first.trim()) {
          try {
            const ct = await contacts.create({ first_name: first.trim(), last_name: last.trim(), company_id: companyId, email: email || null, mobile: phone || null })
            contactId = ct.id
          } catch (e) {
            throw new Error(`The company was saved, but the contact person could not be added: ${e instanceof Error ? e.message : String(e)}. Save again to retry, or Cancel to keep just the company.`)
          }
        }
        onSaved({ company_id: companyId, contact_id: contactId })
      } else {
        if (!first.trim()) throw new Error('First name is required')
        const ct = await contacts.create({ first_name: first.trim(), last_name: last.trim(), email: email || null, mobile: phone || null, address: address || null })
        onSaved({ company_id: null, contact_id: ct.id })
      }
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={cancel}
      title="New client"
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button variant="dark" onClick={save} loading={saving}>Save client</Button>
        </>
      }
    >
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {(['individual', 'company'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} disabled={!!createdCompanyId && k === 'individual'} className={`rounded-md px-3 py-1.5 ${kind === k ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>
            {k === 'individual' ? 'Private individual' : 'Company'}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === 'company' && (
          <Field label="Company name" className="sm:col-span-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={kind === 'company' ? 'Contact first name' : 'First name'}>
          <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
        </Field>
        <Field label="Last name">
          <input className="input" value={last} onChange={(e) => setLast(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {kind === 'company' && (
          <Field label="VAT number">
            <input className="input" value={vatNo} onChange={(e) => setVatNo(e.target.value)} />
          </Field>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
