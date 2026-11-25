import { t, type Locale } from '../lib/i18n';
import { AdaptiveSelect } from './AdaptiveSelect';

export function ScrollDirectionSelect({ locale, reverse, onChange, testId, tone }: {
  locale: Locale;
  reverse: boolean;
  onChange: (reverse: boolean) => void;
  testId: string;
  tone?: 'remote';
}) {
  return <AdaptiveSelect
    label={t(locale, 'scrollDirection')}
    testId={testId}
    tone={tone}
    value={reverse ? 'reverse' : 'natural'}
    options={[
      { value: 'natural', label: t(locale, 'scrollDirectionNatural') },
      { value: 'reverse', label: t(locale, 'scrollDirectionReverse') },
    ]}
    onChange={value => onChange(value === 'reverse')}
  />;
}
