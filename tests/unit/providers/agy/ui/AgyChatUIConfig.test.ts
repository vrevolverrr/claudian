import { agyChatUIConfig } from '@/providers/agy/ui/AgyChatUIConfig';
import { CLAUDE_PROVIDER_ICON, GEMINI_PROVIDER_ICON, OPENAI_PROVIDER_ICON } from '@/shared/icons';

describe('agyChatUIConfig.getModelOptions', () => {
  it('tags each family with the icon of the model it wraps', () => {
    const options = agyChatUIConfig.getModelOptions({});

    const byLabel = new Map(options.map((option) => [option.label, option]));
    expect(byLabel.get('Gemini 3.1 Pro')?.providerIcon).toBe(GEMINI_PROVIDER_ICON);
    expect(byLabel.get('Claude Opus 4.6 (Thinking)')?.providerIcon).toBe(CLAUDE_PROVIDER_ICON);
    expect(byLabel.get('GPT-OSS 120B')?.providerIcon).toBe(OPENAI_PROVIDER_ICON);
  });
});
