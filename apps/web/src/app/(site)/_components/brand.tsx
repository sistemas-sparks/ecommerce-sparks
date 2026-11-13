import Image from 'next/image';
import alternateLogo from '../../../../../../marca/logo/logo-alternativo.png';
import originalLogo from '../../../../../../marca/logo/logo-original.png';
import symbol from '../../../../../../marca/logo/simbolo.png';

export function Brand({
  variant = 'alternate',
}: {
  variant?: 'alternate' | 'original' | 'symbol';
}) {
  return (
    <Image
      src={variant === 'symbol' ? symbol : variant === 'original' ? originalLogo : alternateLogo}
      alt={variant === 'symbol' ? 'Símbolo da Sparks: dois clipes de papel' : 'Sparks Papelaria'}
      className={`site-brand site-brand-${variant}`}
      priority={variant === 'alternate'}
    />
  );
}
