import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className = '', ...rest }, ref) => {
    const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="space-y-1">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={`
            block w-full rounded-lg border px-3 py-2 text-sm shadow-sm
            transition-colors placeholder:text-gray-400
            focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500
            ${error ? 'border-red-500' : 'border-gray-300'}
            ${className}
          `}
          {...rest}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
