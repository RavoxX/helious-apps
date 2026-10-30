import { defineConfig } from 'vitepress';
export default defineConfig({
  title: 'Helious',
  description: 'Private knowledge, connected thinking.',
  base: '/docs/',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/app/helious-logo.png' }]],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Open app', link: '/../app/', target: '_self' },
    ],
    sidebar: [
      {
        text: 'The foundation',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Vaults, notes & search', link: '/knowledge' },
          { text: 'Markdown workspace', link: '/editor' },
          { text: 'Daily notes, templates & properties', link: '/authoring' },
          { text: 'Canvas', link: '/canvas' },
          { text: 'Knowledge graph', link: '/graph' },
          { text: 'Vault analytics', link: '/analytics' },
          { text: 'Spaces & permissions', link: '/spaces' },
          { text: 'History & recovery', link: '/history' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Account & API', link: '/api' },
          { text: 'Account data & deletion', link: '/account-data' },
          { text: 'Email & recovery', link: '/email' },
          { text: 'Security', link: '/security' },
          { text: 'Secrets, TOTP & key rotation', link: '/secrets' },
          { text: 'MCP & AI connections', link: '/mcp' },
          { text: 'Desktop, local folders & sync', link: '/desktop' },
          { text: 'Deployment & backups', link: '/deployment' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],
    search: { provider: 'local' },
    footer: { message: 'Helious · Application documentation' },
  },
});
