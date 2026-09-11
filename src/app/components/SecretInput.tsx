import { Eye, EyeOff } from 'lucide-react'
import { useState, type InputHTMLAttributes, type Ref } from 'react'

type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  revealLabel: string
  hideLabel: string
  inputRef?: Ref<HTMLInputElement>
}

export function SecretInput({
  revealLabel,
  hideLabel,
  inputRef,
  ...inputProps
}: SecretInputProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <>
      <input ref={inputRef} {...inputProps} type={revealed ? 'text' : 'password'} />
      <button
        type="button"
        className="zc-icon-btn"
        aria-label={revealed ? hideLabel : revealLabel}
        aria-pressed={revealed}
        data-tooltip={revealed ? hideLabel : revealLabel}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </>
  )
}
