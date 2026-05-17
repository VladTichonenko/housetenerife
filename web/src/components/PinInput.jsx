import { useRef } from 'react';

export default function PinInput({ value, onChange, disabled }) {
  const inputsRef = useRef([]);

  const digits = (value + '    ').slice(0, 4).split('');

  const setDigit = (index, char) => {
    const arr = digits.map((d) => d.trim() || '');
    arr[index] = char;
    onChange(arr.join('').slice(0, 4));
  };

  const handleChange = (index, e) => {
    const v = e.target.value.replace(/\D/g, '').slice(-1);
    setDigit(index, v);
    if (v && index < 3) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted) onChange(pasted);
    const next = Math.min(pasted.length, 3);
    inputsRef.current[next]?.focus();
  };

  return (
    <div className="pin-inputs" onPaste={handlePaste}>
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          className="pin-input"
          inputMode="numeric"
          maxLength={1}
          autoComplete="off"
          disabled={disabled}
          value={digits[i]?.trim() || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`Цифра ${i + 1}`}
        />
      ))}
    </div>
  );
}
