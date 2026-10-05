import type { ButtonHTMLAttributes } from 'react';
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...props} />;
}
