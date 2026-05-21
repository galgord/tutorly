import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field, Input } from './Field';

describe('Field', () => {
  it('associates the label with the control via the generated id', () => {
    render(<Field label="Email">{(id) => <Input id={id} />}</Field>);
    expect(screen.getByLabelText('Email')).toBeInstanceOf(HTMLInputElement);
  });

  it('renders a hint when provided', () => {
    render(<Field label="Name" hint="Your full name">{(id) => <Input id={id} />}</Field>);
    expect(screen.getByText('Your full name')).toBeInTheDocument();
  });

  it('error takes precedence over hint', () => {
    render(
      <Field label="Name" hint="a hint" error="Required">
        {(id) => <Input id={id} />}
      </Field>,
    );
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('a hint')).toBeNull();
  });
});
