import { Link } from 'expo-router';
import React from 'react';
import { openExternalUrl } from '@/utils/tauri';

export function ExternalLink(
  props: Omit<React.ComponentProps<typeof Link>, 'href'> & { href: string }
) {
  return (
    <Link
      target="_blank"
      {...props}
      href={props.href as any}
      onPress={(e) => {
        e.preventDefault();
        void openExternalUrl(props.href, { nativeBrowser: 'in-app' });
      }}
    />
  );
}
