import {
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react'
import type {
  ChangeEvent,
  ReactElement,
} from 'react'
import { useState } from 'react'

export interface SecretInputOptions {
  id: string
  ariaLabel: string
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  invalid?: boolean
  describedBy?: string
}

interface SecretInputProps extends SecretInputOptions {
  hideLabel: string
  showLabel: string
}

export function SecretInput({
  id,
  ariaLabel,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  readOnly = false,
  invalid = false,
  describedBy,
  hideLabel,
  showLabel,
}: SecretInputProps): ReactElement {
  const [visible, setVisible] = useState(false)
  const toggleLabel = visible ? hideLabel : showLabel

  return (
    <div className={`input-icon secret-input ${invalid ? 'invalid' : ''}`}>
      <KeyRound size={16} />
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        dir="auto"
        value={value}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onInput={(event) =>
          onChange(event as unknown as ChangeEvent<HTMLInputElement>)
        }
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
      />
      <button
        className="secret-toggle"
        type="button"
        aria-label={toggleLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
