import { render, screen } from '@testing-library/react';
import { AssistantMessageText } from './assistant-message-text';

describe('AssistantMessageText', () => {
  it('renders paragraphs and bold without raw asterisks', () => {
    render(
      <AssistantMessageText text="Project **Auth & Security** looks fine." />,
    );
    expect(screen.getByText('Auth & Security').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('renders bullet lists with spacing', () => {
    render(
      <AssistantMessageText
        text={
          'I suggest deleting:\n\n- Walk the pets — Marina\n- Rate limiting — 10 attempts'
        }
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Walk the pets — Marina');
    expect(items[1]).toHaveTextContent('Rate limiting — 10 attempts');
  });
});
