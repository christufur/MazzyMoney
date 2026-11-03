import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 767px)';

const readable = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * True on a phone. The review queue changes shape with it, not behavior: one card
 * per screen that snaps, or a ruled list. A test environment without `matchMedia`
 * gets the desktop list, which is what a keyboard test wants anyway.
 */
export const usePhoneLayout = (): boolean => {
  const [phone, setPhone] = useState(() => (readable() ? window.matchMedia(PHONE_QUERY).matches : false));

  useEffect(() => {
    if (!readable()) return;
    const query = window.matchMedia(PHONE_QUERY);
    setPhone(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return phone;
};
