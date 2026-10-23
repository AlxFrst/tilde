import { useEffect } from 'react';
import { onPrompts } from '@/ipc/ssh';
import { useSsh } from '@/stores/ssh';
import { CredentialDialog } from './CredentialDialog';
import { HostKeyDialog } from './HostKeyDialog';

/** Shows the connections' questions one at a time, oldest first. */
export function PromptHost() {
  const prompt = useSsh((s) => s.prompts[0]);
  const answer = useSsh((s) => s.answer);

  useEffect(() => {
    const { ask, dismiss } = useSsh.getState();
    const off = onPrompts(ask, dismiss);
    return () => {
      void off.then((f) => {
        f();
      });
    };
  }, []);

  if (!prompt) return null;
  if (prompt.kind === 'hostKey') {
    return (
      <HostKeyDialog
        key={prompt.id}
        prompt={prompt}
        onAnswer={(decision) => {
          answer(prompt.id, { kind: 'hostKey', decision });
        }}
      />
    );
  }
  return (
    <CredentialDialog
      key={prompt.id}
      prompt={prompt}
      onAnswer={(reply) => {
        answer(prompt.id, reply);
      }}
    />
  );
}
