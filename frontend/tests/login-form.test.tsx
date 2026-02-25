import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { LoginForm } from '@/components/auth/login-form';

const pushMock = vi.fn();
const loginMock = vi.fn(async () => undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: pushMock,
  }),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    login: loginMock,
  }),
}));

describe('LoginForm', () => {
  it('shows validation messages when fields are invalid', async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
  });
});
